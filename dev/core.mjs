// @ts-check
// Framework-free core of the dev harness, shared by the Vite dev plugin (dev/mock-rest.ts) and the
// zero-dependency dist server (dev/serve-dist.mjs). Plain .mjs on purpose: scripts and servers must
// never import .ts (M1-PLAN 2.0).
//
// Everything here is STATELESS (M1-PLAN D11): a response depends only on the request and on "now".
// Fault injection is done per test with page.route() or with the dev panel, never with server state.
//
//  - harness fixtures (4 events, all clearly marked as test data)
//  - BootConfig builder + injection into the harness pages
//  - the mock of GET wg-live/v1/{events, events/:slug, playback} (M1-PLAN section 5 and 5.1)
//  - /demo/* file serving (Range support)

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

/** @typedef {import('../src/types.ts').BootConfig} BootConfig */
/** @typedef {import('../src/types.ts').PublicEvent} PublicEvent */
/** @typedef {import('../src/types.ts').PlaybackSource} PlaybackSource */
/** @typedef {import('../src/types.ts').ListeningMode} ListeningMode */
/** @typedef {import('../src/types.ts').LiveView} LiveView */
/** @typedef {import('../src/types.ts').SiteLinks} SiteLinks */
/** @typedef {import('../src/types.ts').CompatibilityRow} CompatibilityRow */

export const ROOT = resolve(import.meta.dirname, '..');
// tests/fixtures/media holds the self-generated E-AC-3 test clip (tests/e2e/unsupported-audio.spec.ts); the harness only.
const DEMO_DIRS = [resolve(ROOT, 'plugin/wg-live/assets/demo'), resolve(ROOT, 'dev/assets'), resolve(ROOT, 'tests/fixtures/media')];

/** The pretty-permalink REST root, as rest_url('wg-live/v1/') prints it. */
export const REST_ROOT = '/wp-json/wg-live/v1/';
/** The plain-permalink form. */
export const PLAIN_REST_ROOT = '/index.php?rest_route=/wg-live/v1/';
/** Path prefix that puts the mock REST into "deployment mode disabled" (M1-PLAN D16). */
export const DISABLED_PREFIX = '/disabled';

/** Per-mode demo files for audio events (M1-PLAN D7). */
export const DEMO_FILES = /** @type {const} */ ({ binaural: '/demo/demo-tone-1.mp3', atmos: '/demo/demo-tone-2.mp3' });
export const DEMO_MIME = 'audio/mpeg';
/** Per-mode demo files for video events, the default media kind (M1-PLAN D7). */
export const DEMO_VIDEO_FILES = /** @type {const} */ ({ binaural: '/demo/demo-video-1.mp4', atmos: '/demo/demo-video-2.mp4' });
export const DEMO_VIDEO_MIME = 'video/mp4';

/* ------------------------------------------------------------------ */
/* Local Atmos test hook (dev only, never shipped)                     */
/* ------------------------------------------------------------------ */

/** Fixed URL under which the hook serves the file (docs/implementation/ATMOS-LOCAL-TEST.md). */
export const LOCAL_ATMOS_URL = '/demo/local-atmos.mp4';
export const LOCAL_ATMOS_DEFAULT_TYPE = 'video/mp4; codecs="avc1.640028, ec-3"';
/** The harness event whose ATMOS descriptor the hook replaces. */
const LOCAL_ATMOS_EVENT_SLUG = 'demo-live-binaural-atmos';

/**
 * `WG_DEV_ATMOS_FILE` points to an existing file -> the live demo event's ATMOS mode plays that file, streamed
 * with Range support from where it is (never read whole, never copied). `WG_DEV_ATMOS_TYPE` sets the MIME type
 * the descriptor reports (default: H.264 + E-AC-3 with codecs, so canPlayType can judge it). Unset or not a
 * file -> null and the harness behaves exactly as before.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ file: string, mimeType: string } | null}
 */
export function localAtmosHook(env = process.env) {
  const file = env.WG_DEV_ATMOS_FILE;
  if (!file) return null;
  try {
    if (!statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return { file: resolve(file), mimeType: env.WG_DEV_ATMOS_TYPE || LOCAL_ATMOS_DEFAULT_TYPE };
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const POSTER = {
  url: '/demo/poster-demo.svg',
  width: 1200,
  height: 675,
  alt: '介面示範用海報（非實際活動）',
  srcset: null,
  sizes: null,
};

/** A 1:1 poster: cards crop it to 16:9 with object-fit: cover (HYBRID.md placeholder posters). */
const POSTER_SQUARE = {
  url: '/demo/poster-demo-square.svg',
  width: 1200,
  height: 1200,
  alt: '介面示範用海報（非實際活動，1:1）',
  srcset: null,
  sizes: null,
};

/**
 * Harness events. Start times are relative to `now`. The first three are demo events; the fourth
 * (`pending-source-live`) is a NON-demo event whose source is not configured, to exercise the
 * 「播放來源尚未開放」 gate and the server-side "entitlement unavailable" answer.
 * @param {number} [now]
 * @returns {PublicEvent[]}
 */
export function harnessEvents(now = Date.now()) {
  /** @type {PublicEvent} */
  const live = {
    id: 9001,
    slug: 'demo-live-binaural-atmos',
    title: '【介面示範】錄音室現場音樂會 Live',
    performers: ['示範樂手 A', '示範樂手 B'],
    description: '這是介面示範活動，用來確認播放流程與版面。\n內容不是實際演出，也不是真實售票活動。',
    startsAt: iso(now - 20 * MINUTE),
    displayTimezone: 'Asia/Taipei',
    status: 'live',
    posterUrl: POSTER.url,
    mediaKind: 'video',
    availableModes: ['binaural', 'atmos'],
    programme: ['示範曲目 一', '示範曲目 二', '示範曲目 三'],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: POSTER,
    sourceKind: 'demo',
  };
  /** @type {PublicEvent} */
  const scheduled = {
    id: 9002,
    slug: 'demo-scheduled',
    title: '【介面示範】即將開始的音樂會',
    performers: ['示範樂手 C'],
    description: '這是介面示範活動，演出時間尚未到。\n用來確認「尚未開始」狀態與倒數顯示。',
    startsAt: iso(now + 3 * DAY),
    displayTimezone: 'Asia/Taipei',
    status: 'scheduled',
    posterUrl: POSTER_SQUARE.url,
    mediaKind: 'video',
    availableModes: ['binaural', 'atmos'],
    programme: ['示範曲目 四', '示範曲目 五'],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: POSTER_SQUARE,
    sourceKind: 'demo',
  };
  /** @type {PublicEvent} */
  const ended = {
    id: 9003,
    slug: 'demo-ended',
    title: '【介面示範】已結束的音樂會',
    performers: ['示範樂手 D', '示範樂手 E'],
    description: '這是介面示範活動，演出已經結束。\n用來確認「已結束」狀態。',
    startsAt: iso(now - 7 * DAY),
    displayTimezone: 'Asia/Taipei',
    status: 'ended',
    posterUrl: null,
    mediaKind: 'video',
    availableModes: ['binaural'],
    programme: ['示範曲目 六'],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: null,
    sourceKind: 'demo',
  };
  /** @type {PublicEvent} */
  const pending = {
    id: 9004,
    slug: 'pending-source-live',
    title: '【測試資料】播放來源尚未設定的活動',
    performers: ['測試用表演者'],
    description: '這是開發測試資料，不是實際活動。\n此活動不是示範活動，且尚未設定播放來源。',
    startsAt: iso(now - 5 * MINUTE),
    displayTimezone: 'Asia/Taipei',
    status: 'live',
    posterUrl: null,
    mediaKind: 'video',
    availableModes: ['binaural', 'atmos'],
    programme: [],
    productUrl: 'https://example.com/shop/pending-source-live',
    replayAvailable: false,
    isDemo: false,
    poster: null,
    sourceKind: 'not_configured',
  };
  return [live, scheduled, ended, pending];
}

/** @type {CompatibilityRow[]} */
const COMPAT_ROWS = [
  {
    device: 'iPhone / iPad',
    os: 'iOS / iPadOS',
    browser: 'Safari',
    outputPath: '耳機',
    sourceFormat: '示範音訊',
    status: 'pending',
    testedAt: null,
    notes: '尚待測試',
  },
  {
    device: 'Mac',
    os: 'macOS',
    browser: 'Safari',
    outputPath: 'AirPlay / 家庭劇院',
    sourceFormat: '示範音訊',
    status: 'pending',
    testedAt: null,
    notes: '尚待測試',
  },
];

/* ------------------------------------------------------------------ */
/* Harness options and BootConfig                                      */
/* ------------------------------------------------------------------ */

/**
 * Per-page variants, selected with query parameters on the harness page URL:
 *   ?harness=disabled   deployment mode `disabled` (D16): empty events, REST answers like the kill switch
 *   ?harness=plain      REST root in the plain-permalink form (?rest_route=)
 *   ?harness=nodev      devTools: false (what production sends)
 *   ?featured=<slug>    BootConfig.featuredEventSlug      ?heading=h1|h2    BootConfig.heading
 *   ?fixed=<slug>       BootConfig.fixedEventSlug (the shortcode `event` attribute)
 *   ?view=events|player|help   only on the stress pages (dev/stress.html): which view the page hosts
 * `harness` may hold several comma-separated values.
 * @typedef {{
 *   disabled: boolean, plain: boolean, devTools: boolean,
 *   featured: string | null, heading: 'h1' | 'h2', fixed: string | null,
 *   pageBase: '/dev/' | '/dev/dist/', stressView: LiveView,
 * }} HarnessOptions
 */

/** `?view=` of the stress pages: name used in the URL -> LiveView. */
const STRESS_VIEWS = new Map(/** @type {[string, LiveView][]} */ ([['events', 'events'], ['player', 'player'], ['help', 'help']]));

/**
 * @param {string} search e.g. "?harness=disabled,plain&featured=demo-scheduled"
 * @param {{ pageBase?: '/dev/' | '/dev/dist/' }} [defaults]
 * @returns {HarnessOptions}
 */
export function parseHarnessOptions(search, defaults = {}) {
  const params = new URLSearchParams(search);
  const flags = new Set((params.get('harness') ?? '').split(',').map((s) => s.trim()));
  const slug = (/** @type {string | null} */ v) => (v && SLUG_RE.test(v) && v.length <= 100 ? v : null);
  return {
    disabled: flags.has('disabled'),
    plain: flags.has('plain'),
    devTools: !flags.has('nodev'),
    featured: slug(params.get('featured')),
    heading: params.get('heading') === 'h1' ? 'h1' : 'h2',
    fixed: slug(params.get('fixed')),
    pageBase: defaults.pageBase ?? '/dev/',
    stressView: STRESS_VIEWS.get(params.get('view') ?? '') ?? 'events',
  };
}

/** @param {Pick<HarnessOptions, 'disabled' | 'plain'>} options */
export function restRootFor(options) {
  const prefix = options.disabled ? DISABLED_PREFIX : '';
  return options.plain ? `${prefix}${PLAIN_REST_ROOT}` : `${prefix}${REST_ROOT}`;
}

/** @param {'/dev/' | '/dev/dist/'} pageBase @returns {SiteLinks} */
export function harnessLinks(pageBase) {
  return {
    home: '/dev/stub.html?page=home',
    events: `${pageBase}index.html`,
    player: `${pageBase}listen.html`,
    help: `${pageBase}help.html`,
    account: '/dev/stub.html?page=account',
    store: '/dev/stub.html?page=store',
    contact: '/dev/stub.html?page=contact',
  };
}

/** Kept for importers of the previous harness: links of the Vite dev pages. */
export const HARNESS_LINKS = harnessLinks('/dev/');

/** @type {HarnessOptions} */
export const DEFAULT_OPTIONS = {
  disabled: false,
  plain: false,
  devTools: true,
  featured: null,
  heading: 'h2',
  fixed: null,
  pageBase: '/dev/',
  stressView: 'events',
};

/**
 * @param {LiveView} view
 * @param {number} [now]
 * @param {Partial<HarnessOptions>} [overrides]
 * @returns {BootConfig}
 */
export function buildBootConfig(view, now = Date.now(), overrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const events = options.disabled ? [] : harnessEvents(now);
  const featured = options.featured && events.some((e) => e.slug === options.featured) ? options.featured : null;
  const fixed = options.fixed && events.some((e) => e.slug === options.fixed) ? options.fixed : null;
  return {
    schema: 1,
    pluginVersion: '0.0.0-dev',
    view,
    deploymentMode: options.disabled ? 'disabled' : 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: restRootFor(options), nonce: null, nonceUrl: '' },
    assets: { hls: null },
    links: harnessLinks(options.pageBase),
    fixedEventSlug: options.disabled ? null : fixed,
    featuredEventSlug: options.disabled ? null : featured,
    heading: options.heading,
    events,
    help: {
      faq: [
        { question: '【介面示範】需要什麼設備？', answer: '這是示範內容。\n實際說明會由後台設定。' },
        { question: '【介面示範】聽不到聲音怎麼辦？', answer: '這是示範內容。' },
      ],
      compatibility: COMPAT_ROWS,
      supportNote: '這是介面示範用的客服說明。',
    },
    devTools: options.devTools,
  };
}

/**
 * JSON safe to embed in <script type="application/json"> (mirrors PHP JSON_HEX_TAG | JSON_HEX_AMP).
 * @param {BootConfig} config
 */
export function encodeConfig(config) {
  return JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(String.fromCharCode(0x2028), '\\' + 'u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\' + 'u2029');
}

export const CONFIG_TOKEN = /__WG_LIVE_CONFIG:(events|player|help)__/g;

/**
 * @param {string} html page with __WG_LIVE_CONFIG:<view>__ tokens
 * @param {number} [now]
 * @param {Partial<HarnessOptions>} [options]
 */
export function injectConfig(html, now = Date.now(), options = {}) {
  // The stress pages host one view, chosen with ?view= (default events).
  const stressView = options.stressView ?? DEFAULT_OPTIONS.stressView;
  const page = html.replaceAll('{{stress-view}}', stressView);
  return page.replace(CONFIG_TOKEN, (_m, /** @type {LiveView} */ view) => encodeConfig(buildBootConfig(view, now, options)));
}

/* ------------------------------------------------------------------ */
/* Realistic site chrome (dev/site-mock.html)                          */
/* ------------------------------------------------------------------ */

const SITE_MOCK_FILE = resolve(ROOT, 'dev/site-mock.html');
const SITE_MOCK_TOKEN = /<!--WG_SITE_MOCK:(head|header|footer)((?:\s+[a-z]+=[a-z-]+)*)\s*-->/g;

/**
 * The three snippets of dev/site-mock.html, keyed by name (read on every call: edits show on reload).
 * @returns {Map<string, string>}
 */
function readSiteMockSnippets() {
  const source = readFileSync(SITE_MOCK_FILE, 'utf8');
  const out = new Map();
  for (const m of source.matchAll(/<!--wgm:begin (\w+)-->([\s\S]*?)<!--wgm:end \1-->/g)) out.set(String(m[1]), String(m[2]).trim());
  return out;
}

/**
 * Replace <!--WG_SITE_MOCK:head|header|footer [current=<key>]--> with the realistic site chrome.
 * {{base}} becomes the page base ("/dev/" or "/dev/dist/"); {{aria:KEY}} becomes aria-current="page" for the
 * page named by current=KEY, else nothing; {{assets}} becomes data-assets="live" for assets=live. Pages without a token are returned untouched.
 * @param {string} html
 * @param {'/dev/' | '/dev/dist/'} [pageBase]
 */
export function injectSiteMock(html, pageBase = '/dev/') {
  if (!html.includes('<!--WG_SITE_MOCK:')) return html;
  const snippets = readSiteMockSnippets();
  return html.replace(SITE_MOCK_TOKEN, (_m, /** @type {string} */ name, /** @type {string} */ attrs) => {
    const current = /current=([a-z-]+)/.exec(attrs)?.[1] ?? '';
    return (snippets.get(name) ?? '')
      .replaceAll('{{base}}', pageBase)
      .replaceAll('{{assets}}', /assets=live/.test(attrs) ? ' data-assets="live"' : '')
      .replace(/\{\{aria:([a-z-]+)\}\}/g, (_a, /** @type {string} */ key) => (key === current ? 'aria-current="page"' : ''));
  });
}

/* ------------------------------------------------------------------ */
/* Mock REST (M1-PLAN sections 5 and 5.1)                              */
/* ------------------------------------------------------------------ */

/**
 * Mirrors Entitlement::check (M1-PLAN D6): `entitled` only for a public demo event with a demo
 * source, otherwise `unavailable`. The harness has no user, so guest / not_entitled never occur.
 * @param {PublicEvent} event
 * @returns {'entitled' | 'unavailable'}
 */
export function entitlementFor(event) {
  return event.isDemo && event.sourceKind === 'demo' ? 'entitled' : 'unavailable';
}

/**
 * Mirrors Playback_Provider::resolve in the order of M1-PLAN section 5.1.
 * @param {{ disabled: boolean, event: PublicEvent | undefined, mode: ListeningMode, env?: Record<string, string | undefined> }} input
 * @returns {PlaybackSource}
 */
export function resolvePlayback({ disabled, event, mode, env = process.env }) {
  if (disabled) return { kind: 'not_ready', reason: 'disabled' }; // 1
  if (!event) return { kind: 'not_ready', reason: 'event_not_found' }; // 2
  if (!event.availableModes.includes(mode)) return { kind: 'not_ready', reason: 'mode_unavailable' }; // 3
  if (entitlementFor(event) !== 'entitled') return { kind: 'not_ready', reason: 'entitlement_unavailable' }; // 4
  if (!(event.isDemo && event.sourceKind === 'demo')) return { kind: 'not_ready', reason: 'source_not_configured' }; // 5
  if (!event.isDemo && event.status !== 'live' && event.status !== 'intermission') {
    return { kind: 'not_ready', reason: 'event_not_playable' }; // 6 (demo events skip it)
  }
  // 7a: dev-only local Atmos file for the live demo event (hook above; unset = nothing changes).
  if (mode === 'atmos' && event.slug === LOCAL_ATMOS_EVENT_SLUG) {
    const local = localAtmosHook(env);
    if (local) return { kind: 'demo', url: LOCAL_ATMOS_URL, mimeType: local.mimeType };
  }
  // 7: the bundled demo file of the event's media kind (video is the default, like the PHP provider).
  if (event.mediaKind === 'audio') return { kind: 'demo', url: DEMO_FILES[mode], mimeType: DEMO_MIME };
  return { kind: 'demo', url: DEMO_VIDEO_FILES[mode], mimeType: DEMO_VIDEO_MIME };
}

/**
 * @typedef {{ status: number, headers: Record<string, string>, body: unknown }} RestResult
 */

/** @param {number} status @param {string} code @param {string} message @returns {RestResult} */
function restError(status, code, message) {
  return { status, headers: { 'Cache-Control': 'no-store' }, body: { code, message, data: { status } } };
}

/** @param {unknown} body @returns {RestResult} */
function ok(body) {
  return { status: 200, headers: { 'Cache-Control': 'no-store' }, body };
}

const NO_ROUTE = () => restError(404, 'rest_no_route', 'No route was found matching the URL and request method.');

/**
 * Where does this URL point in the wg-live REST API? Handles the pretty form
 * (/wp-json/wg-live/v1/<route>) and the plain form (/index.php?rest_route=/wg-live/v1/<route>),
 * each with an optional /disabled prefix. Returns null when the URL is not a REST URL at all.
 * @param {string} pathname
 * @param {URLSearchParams} searchParams
 * @returns {{ route: string, disabled: boolean } | null}
 */
export function matchRestUrl(pathname, searchParams) {
  let path = pathname;
  let disabled = false;
  if (path === DISABLED_PREFIX || path.startsWith(`${DISABLED_PREFIX}/`)) {
    disabled = true;
    path = path.slice(DISABLED_PREFIX.length) || '/';
  }
  if (path.startsWith(REST_ROOT)) return { route: path.slice(REST_ROOT.length).replace(/\/+$/, ''), disabled };
  if (path === '/index.php' || path === '/') {
    const rr = searchParams.get('rest_route');
    if (rr !== null && rr.startsWith('/wg-live/v1/')) {
      return { route: rr.slice('/wg-live/v1/'.length).replace(/\/+$/, ''), disabled };
    }
  }
  return null;
}

/**
 * Handle one REST request. Stateless.
 * @param {{ method: string, route: string, searchParams: URLSearchParams, disabled: boolean, now?: number }} req
 * @returns {RestResult}
 */
export function handleRest({ method, route, searchParams, disabled, now = Date.now() }) {
  if (method !== 'GET' && method !== 'HEAD') return restError(405, 'rest_no_route', 'No route was found matching the URL and request method.');
  const events = disabled ? [] : harnessEvents(now); // D16: nothing is public while disabled

  if (route === 'events') return ok({ events });

  const slugMatch = /^events\/(.+)$/.exec(route);
  if (slugMatch) {
    const slug = slugMatch[1] ?? '';
    if (!SLUG_RE.test(slug) || slug.length > 100) return NO_ROUTE();
    const event = events.find((e) => e.slug === slug);
    return event ? ok({ event }) : restError(404, 'wg_live_not_found', 'Event not found.');
  }

  if (route === 'playback') {
    const eventParam = searchParams.get('event') ?? '';
    const mode = searchParams.get('mode');
    if (!/^\d+$/.test(eventParam)) return restError(400, 'rest_invalid_param', 'Invalid parameter(s): event');
    if (mode !== 'binaural' && mode !== 'atmos') return restError(400, 'rest_invalid_param', 'Invalid parameter(s): mode');
    // `events` is empty while disabled, but the answer for disabled is decided first (5.1 step 1).
    const event = harnessEvents(now).find((e) => e.id === Number(eventParam));
    return ok(resolvePlayback({ disabled, event, mode }));
  }

  return NO_ROUTE();
}

/**
 * Node http adapter for handleRest.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ route: string, disabled: boolean }} match
 * @param {URL} url
 */
export function sendRest(req, res, match, url) {
  const result = handleRest({ method: req.method ?? 'GET', route: match.route, searchParams: url.searchParams, disabled: match.disabled });
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result.body));
}

/* ------------------------------------------------------------------ */
/* /demo/* files                                                       */
/* ------------------------------------------------------------------ */

/** @type {Record<string, string>} */
export const MIME = {
  '.mp3': DEMO_MIME,
  '.mp4': DEMO_VIDEO_MIME,
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve a file with Range support (media elements need it). `Cache-Control: no-store`.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} file absolute path (already validated by the caller)
 * @param {string} [contentType] overrides the type derived from the extension
 */
export function sendFile(req, res, file, contentType) {
  const size = statSync(file).size;
  res.setHeader('Content-Type', contentType ?? MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (!range[1] && range[2]) {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Length', String(size));
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

/**
 * GET /demo/<name>: plugin demo assets first, then dev/assets. Names are flat and validated.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {Record<string, string | undefined>} [env] where the local Atmos hook reads its settings
 */
export function serveDemoFile(req, res, url, env = process.env) {
  let name;
  try {
    name = basename(decodeURIComponent(url.pathname.slice('/demo/'.length)));
  } catch {
    name = '';
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    res.statusCode = 400;
    res.end('Bad file name');
    return;
  }
  if (url.pathname === LOCAL_ATMOS_URL) {
    const local = localAtmosHook(env);
    if (!local) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    sendFile(req, res, local.file, local.mimeType.split(';')[0]?.trim() || DEMO_VIDEO_MIME);
    return;
  }
  const file = DEMO_DIRS.map((d) => resolve(d, name)).find((p) => existsSync(p) && statSync(p).isFile());
  if (!file) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  sendFile(req, res, file);
}
