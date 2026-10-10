import { safeUrl } from '../dom';
import type {
  AdapterEnv,
  AdapterErrorDetail,
  AdapterEvent,
  MediaHost,
  PlaybackAdapter,
  PlaybackSource,
  PlayerCapabilities,
} from '../types';

/**
 * PlaybackAdapter over the shared media element (plan D9, 6.3-6.5, 6.10; spec 9).
 *
 * - It never creates, replaces or clones the element: `host.media` is created once by the player
 *   shell and reused for every source.
 * - load() assigns `media.src` synchronously (no <source> children) and returns a promise that only
 *   reports readiness. The caller must not await it before play() (start invariant, plan 6.3).
 * - Failures are classified here (plan 6.5) and reported once per load(): the `error` event carries an
 *   AdapterErrorDetail and a still-pending load() promise rejects with an AdapterLoadError carrying
 *   the same detail. A media `error` event and a `play()` NotSupportedError therefore count once.
 * - The element is shared, so only the adapter that last loaded it may reset it; destroy() of a
 *   superseded adapter just removes its own listeners.
 */

type Listener = (detail?: AdapterErrorDetail) => void;
type LoadableSource = Exclude<PlaybackSource, { kind: 'not_ready' }>;

export interface NativeMediaOptions {
  /** Adapter kind reported to the coordinator. Default 'demo'. */
  kind?: PlaybackAdapter['kind'];
  /** Set `media.loop` while this adapter owns the element. Demo sources loop (plan 6.4). */
  loop?: boolean;
}

/** Thrown (as a rejection of load()) when a source cannot be loaded. `detail` is the classified failure. */
export class AdapterLoadError extends Error {
  readonly detail: AdapterErrorDetail;
  constructor(detail: AdapterErrorDetail) {
    super(`media load failed (${detail.code})`);
    this.name = 'AdapterLoadError';
    this.detail = detail;
  }
}

const HAVE_METADATA = 1;

/** Which adapter currently owns each shared element. */
const owners = new WeakMap<HTMLMediaElement, object>();

/**
 * Plan 6.5 classification, first match wins:
 *   canPlayType(mimeType) === '' before load  -> unsupported
 *   navigator.onLine === false                -> network
 *   MediaError 2                              -> network
 *   MediaError 3                              -> decode
 *   MediaError 4 (or play() NotSupportedError, pass 4) with readyState HAVE_NOTHING -> network
 *   MediaError 4 after metadata               -> unsupported
 * Anything else is 'unknown'. Native media gives up after the first error, so `fatal` is always true.
 */
export function classifyMediaFailure(
  media: Pick<HTMLMediaElement, 'readyState'>,
  mediaErrorCode: number | null,
  mimeSupported = true,
): AdapterErrorDetail {
  if (!mimeSupported) return { code: 'unsupported', fatal: true };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { code: 'network', fatal: true };
  switch (mediaErrorCode) {
    case 2:
      return { code: 'network', fatal: true };
    case 3:
      return { code: 'decode', fatal: true };
    case 4:
      return { code: media.readyState < HAVE_METADATA ? 'network' : 'unsupported', fatal: true };
    default:
      return { code: 'unknown', fatal: true };
  }
}

function abortError(message = 'The operation was aborted.'): DOMException {
  return new DOMException(message, 'AbortError');
}

interface WebkitVideo {
  webkitEnterFullscreen?: () => void;
}

function canFullscreen(media: HTMLMediaElement): boolean {
  if (media.tagName !== 'VIDEO') return false;
  if (typeof document !== 'undefined' && document.fullscreenEnabled === false) return false;
  return (
    typeof media.requestFullscreen === 'function' ||
    typeof (media as unknown as WebkitVideo).webkitEnterFullscreen === 'function'
  );
}

interface Pending {
  resolve(): void;
  reject(error: unknown): void;
  cleanup(): void;
}

export function createNativeMediaAdapter(
  host: MediaHost,
  env: AdapterEnv,
  options: NativeMediaOptions = {},
): PlaybackAdapter {
  const media = host.media;
  const kind = options.kind ?? 'demo';
  const loop = options.loop === true;
  const token = {};

  const subscribers = new Map<AdapterEvent, Set<{ fn: Listener }>>();
  let destroyed = false;
  let hasSource = false;
  let failed = false;
  let mimeSupported = true;
  let live = false;
  let pending: Pending | null = null;
  let detachElement: (() => void) | null = null;

  const emit = (event: AdapterEvent, detail?: AdapterErrorDetail): void => {
    if (destroyed) return;
    const set = subscribers.get(event);
    if (!set) return;
    for (const entry of [...set]) {
      try {
        entry.fn(detail);
      } catch {
        // A listener must not break the others or the element's event dispatch.
      }
    }
  };

  const isActive = (): boolean => !destroyed && owners.get(media) === token;

  const settle = (action: 'resolve' | 'reject', error?: unknown): void => {
    const p = pending;
    if (!p) return;
    pending = null;
    p.cleanup();
    if (action === 'resolve') p.resolve();
    else p.reject(error);
  };

  /** Report a failure once per load(): one `error` event, and reject a still-pending load(). */
  const fail = (detail: AdapterErrorDetail): void => {
    if (destroyed || failed) return;
    failed = true;
    emit('error', detail);
    settle('reject', new AdapterLoadError(detail));
  };

  const refreshLive = (): void => {
    // Live only when the duration is Infinity and something is seekable (checked after metadata).
    live = media.duration === Infinity && media.seekable.length > 0;
  };

  const onReady = (): void => {
    if (destroyed) return;
    refreshLive();
    settle('resolve');
  };
  const onMediaError = (): void => {
    fail(classifyMediaFailure(media, media.error ? media.error.code : null, mimeSupported));
  };
  const handlers: Array<[string, () => void]> = [
    ['playing', () => emit('playing')],
    // A queued 'pause' from a superseded adapter can arrive after play() of the next source:
    // only a real pause (the element is paused now) counts.
    [
      'pause',
      () => {
        if (media.paused) emit('paused');
      },
    ],
    ['waiting', () => emit('waiting')],
    ['stalled', () => emit('stalled')],
    ['ended', () => emit('ended')],
    ['loadedmetadata', onReady],
    ['canplay', onReady],
    ['error', onMediaError],
  ];

  const attach = (): void => {
    if (detachElement) return;
    for (const [type, fn] of handlers) media.addEventListener(type, fn);
    detachElement = () => {
      for (const [type, fn] of handlers) media.removeEventListener(type, fn);
      detachElement = null;
    };
  };

  const onPlayRejected = (error: unknown): void => {
    const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
    // NotAllowedError (play_blocked) and AbortError (benign) belong to the caller (plan 6.4/6.5).
    if (name === 'NotSupportedError') fail(classifyMediaFailure(media, 4, mimeSupported));
  };

  const adapter: PlaybackAdapter = {
    kind,

    get capabilities(): PlayerCapabilities {
      return {
        playPause: true,
        mute: true,
        volume: env.volumeSettable,
        seekToLive: live,
        fullscreen: canFullscreen(media),
        remotePlayback: false, // M1: no AirPlay/Cast button (spec 9.2: progressive enhancement, unverified)
        reliablePlaybackEvents: true,
      };
    },

    load(source: LoadableSource, signal: AbortSignal): Promise<void> {
      if (destroyed) return Promise.reject(abortError('The adapter was destroyed.'));
      if (signal.aborted) return Promise.reject(abortError());

      // A new load() supersedes an unfinished one.
      settle('reject', abortError('Superseded by a newer load.'));
      failed = false;
      hasSource = false;
      live = false;
      attach();
      owners.set(media, token);

      const promise = new Promise<void>((resolve, reject) => {
        const onAbort = (): void => settle('reject', abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        pending = { resolve, reject, cleanup: () => signal.removeEventListener('abort', onAbort) };
      });
      // Callers deliberately do not await load() (start invariant); a rejection is also reported
      // through the 'error' event, so it must not surface as an unhandled rejection.
      promise.catch(() => undefined);

      if (source.kind !== 'demo') {
        // Only file sources are handled here. hls/iframe have their own adapters (inert in M1).
        fail({ code: 'unknown', fatal: true });
        return promise;
      }

      const href = safeUrl(source.url);
      let protocolOk = false;
      if (href !== null) {
        try {
          const protocol = new URL(href).protocol;
          protocolOk = protocol === 'http:' || protocol === 'https:';
        } catch {
          protocolOk = false;
        }
      }
      if (href === null || !protocolOk) {
        fail({ code: 'unknown', fatal: true });
        return promise;
      }

      mimeSupported = source.mimeType === '' || media.canPlayType(source.mimeType) !== '';
      if (!mimeSupported) {
        fail(classifyMediaFailure(media, null, false));
        return promise;
      }

      media.loop = loop;
      media.preload = 'auto'; // playback follows in the same gesture; the shell starts at 'none' (D9)
      media.src = href; // synchronous assignment, no <source> children
      hasSource = true;
      return promise;
    },

    play(): Promise<void> {
      if (destroyed) return Promise.reject(abortError('The adapter was destroyed.'));
      if (!hasSource || !isActive()) {
        return Promise.reject(new DOMException('No playable source is loaded.', 'NotSupportedError'));
      }
      let result: Promise<void> | undefined;
      try {
        result = media.play();
      } catch (error) {
        return Promise.reject(error);
      }
      // Older engines return undefined; modern ones return the element's promise, which is returned as is.
      const promise = result ?? Promise.resolve();
      promise.then(undefined, onPlayRejected);
      return promise;
    },

    pause(): void {
      if (isActive()) media.pause();
    },

    setMuted(muted: boolean): void {
      if (isActive()) media.muted = muted === true;
    },

    setVolume(volume: number): void {
      // iOS ignores writes; an inert slider must not exist, so the capability says false there.
      if (!isActive() || !env.volumeSettable || !Number.isFinite(volume)) return;
      media.volume = Math.min(1, Math.max(0, volume));
    },

    seekToLive(): void {
      if (!isActive() || !live) return;
      const ranges = media.seekable;
      if (ranges.length === 0) return;
      try {
        media.currentTime = ranges.end(ranges.length - 1);
      } catch {
        // Seeking can throw while the element is between sources; nothing useful to do.
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // Listeners go FIRST so the pause/emptied events of the reset below reach nobody.
      if (detachElement) detachElement();
      subscribers.clear();
      settle('reject', abortError('The adapter was destroyed.'));

      const owner = owners.get(media);
      if (owner !== undefined && owner !== token) return; // a newer adapter owns the element now
      owners.delete(media);
      try {
        media.pause();
      } catch {
        // ignore
      }
      media.removeAttribute('src');
      media.preload = 'none';
      media.loop = false;
      try {
        media.load(); // aborts the in-flight fetch: no further network activity
      } catch {
        // ignore
      }
    },

    on(event: AdapterEvent, listener: Listener): () => void {
      if (destroyed) return () => undefined;
      let set = subscribers.get(event);
      if (!set) {
        set = new Set();
        subscribers.set(event, set);
      }
      const entry = { fn: listener };
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
  };

  return adapter;
}
