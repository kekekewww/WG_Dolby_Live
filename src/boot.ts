/**
 * Read and validate the PHP -> JS bootstrap (plan 3.1). The JSON sits in the page, so it is
 * treated as untrusted input: unknown fields are dropped, every URL passes safeUrl(), slugs
 * must match the shared pattern, and anything that does not fit fails closed
 * (an unknown deployment mode becomes 'disabled', an event with a bad slug is dropped).
 */
import type {
  BootConfig,
  CompatibilityRow,
  CompatibilityState,
  DeploymentMode,
  EventStatus,
  FaqItem,
  HelpContent,
  ListeningMode,
  LiveView,
  PosterImage,
  PublicEvent,
  SiteLinks,
  SourceKind,
} from './types';
import { safeUrl } from './dom';
import { isValidSlug } from './util/url';

const VIEWS: readonly LiveView[] = ['events', 'player', 'help'];
const STATUSES: readonly EventStatus[] = ['scheduled', 'doors_open', 'live', 'intermission', 'ended', 'cancelled'];
const SOURCE_KINDS: readonly SourceKind[] = ['not_configured', 'demo', 'hls', 'iframe'];
const MODES: readonly ListeningMode[] = ['binaural', 'atmos'];
const COMPAT_STATES: readonly CompatibilityState[] = ['pending', 'verified', 'not_working'];
const DEFAULT_ZONE = 'Asia/Taipei';
const MAX_EVENTS = 100;
const MAX_ITEMS = 100;

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_ITEMS) : [];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function posInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0 ? v : null;
}

/** Keep the original string when it is a safe http(s)/relative URL; mailto only when allowed. */
function url(v: unknown, allowMailto = false): string | null {
  if (typeof v !== 'string') return null;
  const safe = safeUrl(v);
  if (safe === null) return null;
  if (!allowMailto && safe.startsWith('mailto:')) return null;
  return v.trim();
}

function zone(v: unknown): string {
  if (typeof v !== 'string' || v === '') return DEFAULT_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return v;
  } catch {
    return DEFAULT_ZONE;
  }
}

function parsePoster(v: unknown): PosterImage | null {
  if (!isRec(v)) return null;
  const posterUrl = url(v.url);
  const width = posInt(v.width);
  const height = posInt(v.height);
  if (posterUrl === null || width === null || height === null) return null;
  return {
    url: posterUrl,
    width,
    height,
    alt: str(v.alt),
    // srcset candidates are re-checked by h() when rendered.
    srcset: typeof v.srcset === 'string' && v.srcset !== '' ? v.srcset : null,
    sizes: typeof v.sizes === 'string' && v.sizes !== '' ? v.sizes : null,
  };
}

/**
 * Validate one PublicEvent from untrusted JSON (the bootstrap or a REST response).
 * Returns null when it is unusable: bad id/slug/status/start time.
 */
export function parsePublicEvent(raw: unknown): PublicEvent | null {
  if (!isRec(raw)) return null;
  const id = posInt(raw.id);
  const status = oneOf(raw.status, STATUSES);
  const startsAt = str(raw.startsAt);
  if (id === null || status === null || !isValidSlug(raw.slug) || Number.isNaN(Date.parse(startsAt))) return null;

  const modes: ListeningMode[] = [];
  if (Array.isArray(raw.availableModes)) {
    for (const m of raw.availableModes) {
      const mode = oneOf(m, MODES);
      if (mode && !modes.includes(mode)) modes.push(mode);
    }
  }

  return {
    id,
    slug: raw.slug,
    title: str(raw.title),
    performers: strList(raw.performers),
    description: str(raw.description),
    startsAt,
    displayTimezone: zone(raw.displayTimezone),
    status,
    posterUrl: url(raw.posterUrl),
    mediaKind: raw.mediaKind === 'video' ? 'video' : 'audio',
    availableModes: modes,
    programme: strList(raw.programme),
    productUrl: url(raw.productUrl),
    replayAvailable: raw.replayAvailable === true,
    isDemo: raw.isDemo === true,
    poster: parsePoster(raw.poster),
    sourceKind: oneOf(raw.sourceKind, SOURCE_KINDS) ?? 'not_configured',
  };
}

/** Validate a list of events; invalid entries are dropped, duplicates by slug keep the first. */
export function parsePublicEvents(raw: unknown): PublicEvent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PublicEvent[] = [];
  for (const item of raw.slice(0, MAX_EVENTS)) {
    const event = parsePublicEvent(item);
    if (event && !seen.has(event.slug)) {
      seen.add(event.slug);
      out.push(event);
    }
  }
  return out;
}

function parseLinks(raw: unknown): SiteLinks {
  const r = isRec(raw) ? raw : {};
  return {
    home: url(r.home) ?? '/',
    events: url(r.events),
    player: url(r.player),
    help: url(r.help),
    account: url(r.account),
    store: url(r.store),
    contact: url(r.contact, true),
  };
}

function parseHelp(raw: unknown): HelpContent {
  const r = isRec(raw) ? raw : {};
  const faq: FaqItem[] = [];
  if (Array.isArray(r.faq)) {
    for (const item of r.faq.slice(0, MAX_ITEMS)) {
      if (isRec(item) && typeof item.question === 'string' && typeof item.answer === 'string' && item.question !== '') {
        faq.push({ question: item.question, answer: item.answer });
      }
    }
  }
  const compatibility: CompatibilityRow[] = [];
  if (Array.isArray(r.compatibility)) {
    for (const item of r.compatibility.slice(0, MAX_ITEMS)) {
      if (!isRec(item)) continue;
      const state = oneOf(item.status, COMPAT_STATES) ?? 'pending';
      const testedAt = typeof item.testedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.testedAt) ? item.testedAt : null;
      // Never show "verified"/"not working" without a test date (plan 4.3): fall back to pending.
      const status: CompatibilityState = state !== 'pending' && testedAt === null ? 'pending' : state;
      compatibility.push({
        device: str(item.device),
        os: str(item.os),
        browser: str(item.browser),
        outputPath: str(item.outputPath),
        sourceFormat: str(item.sourceFormat),
        status,
        testedAt: status === 'pending' ? null : testedAt,
        notes: str(item.notes),
      });
    }
  }
  return { faq, compatibility, supportNote: str(r.supportNote) };
}

/** Find the config script that belongs to this root (not one nested in another .wg-live). */
function findConfigScript(root: HTMLElement): HTMLScriptElement | null {
  for (const script of Array.from(root.querySelectorAll<HTMLScriptElement>('script.wg-live__config'))) {
    if (script.closest('.wg-live') === root) return script;
  }
  return null;
}

/**
 * Parse and validate the root's `<script type="application/json" class="wg-live__config">`.
 * Returns null when it is missing, not JSON, has the wrong schema, or has no usable REST root.
 */
export function readBootConfig(root: HTMLElement): BootConfig | null {
  const script = findConfigScript(root);
  if (!script) return null;

  let data: unknown;
  try {
    data = JSON.parse(script.textContent ?? '');
  } catch {
    return null;
  }
  if (!isRec(data) || data.schema !== 1) return null;

  const rest = isRec(data.rest) ? data.rest : {};
  const restRoot = url(rest.root);
  if (restRoot === null) return null;

  const view = oneOf(root.dataset.wgLiveView, VIEWS) ?? oneOf(data.view, VIEWS);
  if (view === null) return null;

  return {
    schema: 1,
    pluginVersion: str(data.pluginVersion),
    view,
    // Fail closed: anything but an explicit 'demo' is treated as disabled.
    deploymentMode: (data.deploymentMode === 'demo' ? 'demo' : 'disabled') satisfies DeploymentMode,
    timezone: zone(data.timezone),
    rest: { root: restRoot },
    links: parseLinks(data.links),
    fixedEventSlug: isValidSlug(data.fixedEventSlug) ? data.fixedEventSlug : null,
    featuredEventSlug: isValidSlug(data.featuredEventSlug) ? data.featuredEventSlug : null,
    heading: data.heading === 'h1' ? 'h1' : 'h2',
    events: parsePublicEvents(data.events),
    help: parseHelp(data.help),
    devTools: data.devTools === true,
  };
}
