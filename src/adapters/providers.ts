import { parsePublicEvent, parsePublicEvents } from '../boot';
import { safeUrl } from '../dom';
import { isValidSlug, restUrl } from '../util/url';
import type {
  EventProvider,
  ListeningMode,
  NotReadyReason,
  PlaybackSource,
  PlaybackSourceProvider,
  PublicEvent,
} from '../types';

/**
 * Data providers (spec 8.5, plan 4/5).
 *
 * - bootstrap: events already validated by readBootConfig(); no network.
 * - REST: GET wg-live/v1/events, events/{slug}, playback. URLs are built only with restUrl()
 *   (pretty and plain permalinks). Every response is validated defensively; nothing from the
 *   network is trusted, and no URL is ever logged or put into an error message.
 */

export type ProviderErrorCode =
  | 'network' // fetch() rejected (offline, DNS, CORS, blocked)
  | 'http' // a non-2xx response that is not a handled "not found"
  | 'invalid_response' // 2xx, but not JSON or not the expected shape
  | 'invalid_request'; // the caller passed an argument that can never be valid

/** Typed failure of a provider call. AbortError is never wrapped: aborts reject with a DOMException. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  /** HTTP status for code 'http', otherwise null. */
  readonly status: number | null;
  constructor(code: ProviderErrorCode, status: number | null = null) {
    super(`provider request failed (${code}${status === null ? '' : ` ${status}`})`);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

const MAX_BODY_CHARS = 2_000_000;
const MODES: readonly ListeningMode[] = ['binaural', 'atmos'];
const NOT_READY_REASONS: readonly NotReadyReason[] = [
  'disabled',
  'event_not_found',
  'mode_unavailable',
  'not_entitled',
  'entitlement_unavailable',
  'source_not_configured',
  'event_not_playable',
];
/** audio/mpeg, audio/mp4; codecs="mp4a.40.2", video/mp4 ... */
const MIME_RE = /^(?:audio|video)\/[A-Za-z0-9][A-Za-z0-9.+_-]*(?:\s*;\s*codecs="?[A-Za-z0-9.,\s_-]+"?)?$/;
const MAX_MIME_LENGTH = 120;

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

interface JsonResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/** GET + JSON with typed failures. `body` is `undefined` when the response was not parseable JSON. */
async function getJson(url: string, signal: AbortSignal | undefined, init: RequestInit): Promise<JsonResponse> {
  if (signal?.aborted) throw abortError();
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (isAbort(error, signal)) throw abortError();
    throw new ProviderError('network');
  }

  let body: unknown;
  try {
    const text = await response.text();
    if (text.length <= MAX_BODY_CHARS) body = JSON.parse(text);
  } catch (error) {
    if (isAbort(error, signal)) throw abortError();
    body = undefined;
  }
  if (signal?.aborted) throw abortError();
  return { status: response.status, ok: response.ok, body };
}

function restRootUsable(root: string): boolean {
  return typeof root === 'string' && root.trim() !== '';
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Serves the events that came with the page. Use when REST is unavailable (and in unit tests). */
export function createBootstrapEventProvider(events: PublicEvent[]): EventProvider {
  const snapshot = events.slice();
  return {
    list(signal?: AbortSignal): Promise<PublicEvent[]> {
      if (signal?.aborted) return Promise.reject(abortError());
      return Promise.resolve(snapshot.slice());
    },
    get(slug: string, signal?: AbortSignal): Promise<PublicEvent | null> {
      if (signal?.aborted) return Promise.reject(abortError());
      return Promise.resolve(snapshot.find((e) => e.slug === slug) ?? null);
    },
  };
}

/**
 * REST event provider.
 *  - list():       GET events          -> { events: PublicEvent[] }; invalid events are dropped.
 *  - get(slug):    GET events/{slug}   -> { event }; 404 -> null (but 404 `rest_no_route` means the
 *                  plugin's route is missing, which is an error, not "no such event").
 *  - errors:       ProviderError('network' | 'http' | 'invalid_response' | 'invalid_request'); aborts
 *                  reject with a DOMException AbortError.
 *
 * `fallback` is used ONLY when `restRoot` is empty (REST is not available on this page), in which case
 * the provider behaves like createBootstrapEventProvider(fallback). It is never served after a failed
 * request: stale data must not revert a status the poller already learned (plan 6.4).
 */
export function createRestEventProvider(restRoot: string, fallback?: PublicEvent[]): EventProvider {
  if (!restRootUsable(restRoot)) return createBootstrapEventProvider(fallback ?? []);

  return {
    async list(signal?: AbortSignal): Promise<PublicEvent[]> {
      const res = await getJson(restUrl(restRoot, 'events'), signal, {});
      if (!res.ok) throw new ProviderError('http', res.status);
      if (!isRecord(res.body) || !Array.isArray(res.body.events)) throw new ProviderError('invalid_response');
      return parsePublicEvents(res.body.events);
    },

    async get(slug: string, signal?: AbortSignal): Promise<PublicEvent | null> {
      if (!isValidSlug(slug)) throw new ProviderError('invalid_request');
      const res = await getJson(restUrl(restRoot, `events/${slug}`), signal, {});
      if (res.status === 404) {
        const code = isRecord(res.body) ? res.body.code : undefined;
        if (code === 'rest_no_route') throw new ProviderError('http', 404);
        return null;
      }
      if (!res.ok) throw new ProviderError('http', res.status);
      if (!isRecord(res.body)) throw new ProviderError('invalid_response');
      const event = parsePublicEvent(res.body.event);
      // The answer must be for the event that was asked for.
      if (!event || event.slug !== slug) throw new ProviderError('invalid_response');
      return event;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

const NOT_CONFIGURED: PlaybackSource = { kind: 'not_ready', reason: 'source_not_configured' };

/**
 * Strictly validate a /playback response (plan 5.1). Anything unknown becomes
 * not_ready/source_not_configured. In M1 the server never emits `hls` or `iframe` and the client treats
 * them as not configured (plan D5, 6.9), so they are downgraded here too and no URL leaves this function.
 */
export function parsePlaybackSource(raw: unknown): PlaybackSource {
  if (!isRecord(raw)) return NOT_CONFIGURED;

  if (raw.kind === 'not_ready') {
    const reason = (NOT_READY_REASONS as readonly unknown[]).includes(raw.reason)
      ? (raw.reason as NotReadyReason)
      : 'source_not_configured';
    return { kind: 'not_ready', reason };
  }

  if (raw.kind === 'demo') {
    const { url, mimeType } = raw;
    if (typeof url !== 'string' || typeof mimeType !== 'string') return NOT_CONFIGURED;
    if (mimeType.length > MAX_MIME_LENGTH || !MIME_RE.test(mimeType)) return NOT_CONFIGURED;
    const safe = safeUrl(url);
    if (safe === null) return NOT_CONFIGURED;
    let protocol: string;
    try {
      protocol = new URL(safe).protocol;
    } catch {
      return NOT_CONFIGURED;
    }
    // safeUrl() also admits mailto:; a media source must be http(s) (relative URLs resolved to this origin).
    if (protocol !== 'http:' && protocol !== 'https:') return NOT_CONFIGURED;
    return { kind: 'demo', url: safe, mimeType };
  }

  // 'hls' | 'iframe' (M2) and everything else.
  return NOT_CONFIGURED;
}

/**
 * GET playback?event=<id>&mode=<mode>. Never cached (entitlement-dependent). A 2xx with an unknown
 * shape resolves to not_ready/source_not_configured; network and HTTP failures throw ProviderError.
 */
export function createRestPlaybackProvider(restRoot: string): PlaybackSourceProvider {
  return {
    async resolve(eventId: number, mode: ListeningMode, signal?: AbortSignal): Promise<PlaybackSource> {
      if (!Number.isSafeInteger(eventId) || eventId <= 0 || !(MODES as readonly unknown[]).includes(mode)) {
        throw new ProviderError('invalid_request');
      }
      // REST unavailable on this page: nothing can be resolved, never invent a source.
      if (!restRootUsable(restRoot)) return NOT_CONFIGURED;
      const res = await getJson(restUrl(restRoot, 'playback', { event: eventId, mode }), signal, {
        cache: 'no-store',
      });
      if (!res.ok) throw new ProviderError('http', res.status);
      return parsePlaybackSource(res.body);
    },
  };
}
