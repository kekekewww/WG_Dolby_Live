#!/usr/bin/env node
// Stepped, polite load test for pages, static assets and the public events REST routes
// (spec 13.5, M1-PLAN 7.4).
//
// What it does NOT do, by construction:
//   - It never requests /playback, never requests media (mp3, m4a, mp4, m3u8, ts ...) and never opens
//     streams. Every URL passes isAllowedRequest() before it is fetched, including redirect targets.
//   - It never runs without --target AND --approved. The flag means: the site admin has approved
//     this test, in this environment, for this time window.
//   - It is not a proof that 300 viewers can watch an Atmos stream. That is M2 (spec 13.5).
//
// Usage:
//   node scripts/load-test.mjs --target https://staging.example.com --approved \
//        [--approved-by "name"] [--event demo-live] [--steps 5,25,50,100] [--step-seconds 30] \
//        [--think-ms 1000] [--max-rps 100] [--page /live/ ...] [--asset /wp-content/... ...] \
//        [--no-discover] [--dry-run] [--out-dir evidence/test-results]
//
// Exit codes: 0 = finished, 1 = finished but stopped early by a safety rule or a run error,
//             2 = usage error (nothing was requested).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOL_VERSION = 1;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT_DIR = join(REPO_ROOT, 'evidence', 'test-results');
/** Hard ceiling for concurrent virtual users. Page loads only; 300 is the spec 13.5 audience size. */
export const MAX_VUS = 300;
export const DEFAULT_STEPS = [5, 25, 50, 100];
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULTS = {
  stepSeconds: 30,
  cooldownSeconds: 5,
  thinkMs: 1000,
  maxRps: 100,
  timeoutMs: 15000,
  maxRequests: 20000,
  maxAssets: 12,
  abortErrorRate: 0.2,
  abortThrottleRate: 0.05,
  minSamples: 20,
};
const MIN_THINK_MS = 200;

const MEDIA_EXT = /\.(?:mp3|m4a|m4s|m4v|aac|wav|flac|ogg|oga|ogv|opus|webm|mp4|mov|mkv|avi|mpd|m3u8|ts|mts|weba)$/i;
const MEDIA_CONTENT_TYPE = /^(?:audio\/|video\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|octet-stream))/i;
const ASSET_EXT = /\.(?:js|mjs|css|svg|webp|png|jpe?g|gif|avif|ico|woff2?)$/i;
const BLOCKED_SEGMENTS = new Set([
  'wp-admin', 'wp-login.php', 'xmlrpc.php', 'wp-cron.php', 'admin-ajax.php', 'wc-api',
  'cart', 'checkout', 'my-account', 'account', 'basket', 'order-pay', 'order-received', 'wp-signup.php',
]);
const PAGE_QUERY_KEYS = new Set(['wg_event', 'wg_mode', 'page_id', 'p']);
const ASSET_QUERY_KEYS = new Set(['ver', 'v']);
const EVENTS_PATH_RE = /^\/(?:.*\/)?wp-json\/wg-live\/v1\/events(?:\/([^/]+))?\/?$/;
const EVENTS_ROUTE_RE = /^\/wg-live\/v1\/events(?:\/([^/]+))?\/?$/;

/**
 * @typedef {object} LoadTestOptions
 * @property {string} target approved origin
 * @property {string | null} approvedBy
 * @property {string | null} event event slug
 * @property {number[]} steps virtual users per step (ascending)
 * @property {number} stepMs
 * @property {number} cooldownMs
 * @property {number} thinkMs
 * @property {number} maxRps
 * @property {number} timeoutMs
 * @property {number} maxRequests
 * @property {number} maxAssets
 * @property {number} abortErrorRate
 * @property {number} abortThrottleRate
 * @property {number} minSamples
 * @property {string[]} pages
 * @property {string[]} assets
 * @property {boolean} discover
 * @property {boolean} dryRun
 * @property {string} outDir
 */

/** @typedef {Record<string, any>} LoadTestResult */

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// ---------------------------------------------------------------------------------------------
// Argument parsing and the --target / --approved guard
// ---------------------------------------------------------------------------------------------

const VALUE_FLAGS = new Set([
  'target', 'approved-by', 'event', 'steps', 'step-seconds', 'cooldown-seconds', 'think-ms', 'max-rps',
  'timeout-ms', 'max-requests', 'max-assets', 'page', 'asset', 'out-dir',
]);
const BOOL_FLAGS = new Set(['approved', 'dry-run', 'no-discover', 'help']);
const REPEATABLE = new Set(['page', 'asset']);

export const USAGE = `Stepped load test for pages, static assets and wg-live/v1/events (spec 13.5).

Required:
  --target <origin>        Origin of the approved environment, e.g. https://staging.example.com
  --approved               Confirms the site admin approved this test (environment, time window)

Optional:
  --approved-by <text>     Who approved it (recorded in the JSON, never a credential)
  --event <slug>           Event slug: adds /live/listen/?wg_event=<slug> and events/<slug>
  --steps <list>           Virtual users per step, ascending (default ${DEFAULT_STEPS.join(',')}, max ${MAX_VUS})
  --step-seconds <n>       Seconds per step (default ${DEFAULTS.stepSeconds})
  --cooldown-seconds <n>   Pause between steps (default ${DEFAULTS.cooldownSeconds})
  --think-ms <n>           Mean pause per virtual user between requests (default ${DEFAULTS.thinkMs}, min ${MIN_THINK_MS})
  --max-rps <n>            Global request-rate ceiling (default ${DEFAULTS.maxRps})
  --page <path>            Page path (repeatable). Default: /, /live/, /live/listen/, /live/help/
  --asset <path>           Static asset path (repeatable). Default: discovered from the pages
  --no-discover            Do not read asset URLs from the page HTML
  --dry-run                Print the plan and write nothing; sends no request
  --out-dir <dir>          Where load-<timestamp>.json goes (default <repo>/evidence/test-results)

Never requested: /playback, media files, wp-admin, login, cart, checkout, account, other REST routes.`;

/**
 * Parses argv (without node and script) into validated options. Throws UsageError.
 * The guard: --target and --approved are mandatory, also for --dry-run.
 * @param {readonly string[]} argv
 * @returns {LoadTestOptions | { help: true }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const raw = { page: [], asset: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) {
      throw new UsageError(`unexpected argument "${String(token)}"`);
    }
    const eq = token.indexOf('=');
    const name = token.slice(2, eq === -1 ? undefined : eq);
    const inline = eq === -1 ? null : token.slice(eq + 1);
    if (BOOL_FLAGS.has(name)) {
      if (inline !== null) throw new UsageError(`--${name} takes no value`);
      raw[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new UsageError(`unknown option --${name}`);
    let value = inline;
    if (value === null) {
      value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    }
    if (REPEATABLE.has(name)) raw[name].push(...String(value).split(',').map((s) => s.trim()).filter(Boolean));
    else raw[name] = value;
  }

  if (raw.help) return { help: true };

  if (!raw.target) throw new UsageError('refusing to run: --target <origin> is required');
  if (raw.approved !== true) {
    throw new UsageError('refusing to run: --approved is required (the site admin must approve this test first)');
  }

  const target = parseTarget(String(raw.target));
  const event = raw.event === undefined ? null : String(raw.event);
  if (event !== null && !(event.length <= 100 && SLUG_RE.test(event))) {
    throw new UsageError(`--event "${event}" is not a valid slug (${SLUG_RE.source})`);
  }
  const approvedBy = raw['approved-by'] === undefined ? null : String(raw['approved-by']).trim().slice(0, 120);
  if (approvedBy !== null && /(?:password|passwd|token|secret|api[_-]?key)\s*[:=]/i.test(approvedBy)) {
    throw new UsageError('--approved-by must be a name, not a credential');
  }

  /** @type {LoadTestOptions} */
  const opts = {
    target,
    approvedBy,
    event,
    steps: raw.steps === undefined ? [...DEFAULT_STEPS] : parseSteps(String(raw.steps)),
    stepMs: Math.round(num(raw, 'step-seconds', DEFAULTS.stepSeconds, 1, 600) * 1000),
    cooldownMs: Math.round(num(raw, 'cooldown-seconds', DEFAULTS.cooldownSeconds, 0, 600) * 1000),
    thinkMs: num(raw, 'think-ms', DEFAULTS.thinkMs, MIN_THINK_MS, 60000),
    maxRps: num(raw, 'max-rps', DEFAULTS.maxRps, 1, 1000),
    timeoutMs: num(raw, 'timeout-ms', DEFAULTS.timeoutMs, 1000, 120000),
    maxRequests: Math.round(num(raw, 'max-requests', DEFAULTS.maxRequests, 1, 1_000_000)),
    maxAssets: Math.round(num(raw, 'max-assets', DEFAULTS.maxAssets, 0, 50)),
    abortErrorRate: DEFAULTS.abortErrorRate,
    abortThrottleRate: DEFAULTS.abortThrottleRate,
    minSamples: DEFAULTS.minSamples,
    pages: raw.page,
    assets: raw.asset,
    discover: raw['no-discover'] !== true,
    dryRun: raw['dry-run'] === true,
    outDir: raw['out-dir'] === undefined ? DEFAULT_OUT_DIR : String(raw['out-dir']),
  };
  return opts;
}

/** @param {string} value */
export function parseTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--target "${value}" is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UsageError('--target must be http or https');
  if (url.username || url.password) throw new UsageError('--target must not contain credentials');
  if (url.search || url.hash) throw new UsageError('--target must be an origin only (no query or fragment)');
  if (url.pathname !== '/' && url.pathname !== '') throw new UsageError('--target must be an origin only (no path); pass paths with --page / --asset');
  return url.origin;
}

/** @param {string} value */
export function parseSteps(value) {
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new UsageError('--steps is empty');
  const steps = parts.map((p) => {
    if (!/^\d+$/.test(p)) throw new UsageError(`--steps entry "${p}" is not a whole number`);
    return Number(p);
  });
  steps.forEach((n, i) => {
    if (n < 1 || n > MAX_VUS) throw new UsageError(`--steps entry ${n} is outside 1..${MAX_VUS}`);
    if (i > 0 && n <= /** @type {number} */ (steps[i - 1])) throw new UsageError('--steps must be strictly ascending');
  });
  return steps;
}

function num(raw, name, fallback, min, max) {
  if (raw[name] === undefined) return fallback;
  const text = String(raw[name]);
  const n = Number(text);
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(n) || n < min || n > max) {
    throw new UsageError(`--${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// URL filtering: what may be requested at all
// ---------------------------------------------------------------------------------------------

/**
 * Decides whether a URL may be requested and what kind of request it is.
 * Pure: no I/O. Everything the tool fetches (including redirect targets) goes through this.
 * @param {string | URL} input absolute URL, or a path (resolved against `origin`)
 * @param {string} origin the approved target origin
 * @returns {{ ok: true, kind: 'page' | 'asset' | 'events', url: string } | { ok: false, reason: string }}
 */
export function isAllowedRequest(input, origin) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input), origin);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'scheme is not http(s)' };
  if (url.origin !== origin) return { ok: false, reason: 'different origin than --target' };
  if (url.username || url.password) return { ok: false, reason: 'URL contains credentials' };

  url.hash = '';
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, reason: 'malformed path encoding' };
  }
  const lowerPath = decodedPath.toLowerCase();
  const query = url.searchParams;
  const routeParam = query.get('rest_route');

  // Playback and media are never requested, wherever the word or the extension appears.
  if (lowerPath.includes('playback') || (routeParam ?? '').toLowerCase().includes('playback') || /playback/i.test(url.search)) {
    return { ok: false, reason: 'playback endpoints are never requested' };
  }
  if (MEDIA_EXT.test(lowerPath)) return { ok: false, reason: 'media files are never requested' };
  if (lowerPath.includes('/assets/demo/')) return { ok: false, reason: 'demo media directory is never requested' };
  if (lowerPath.split('/').some((seg) => seg === '..' || seg === '.')) return { ok: false, reason: 'path traversal segment' };

  const segments = lowerPath.split('/').filter(Boolean);
  if (segments.some((seg) => BLOCKED_SEGMENTS.has(seg))) return { ok: false, reason: 'admin, login or commerce path' };
  for (const key of query.keys()) {
    if (/^(?:add-to-cart|wc-ajax|remove_item|action)$/i.test(key)) return { ok: false, reason: `query "${key}" can change state` };
  }

  // Events REST: pretty permalinks or ?rest_route=
  const eventsMatch = EVENTS_PATH_RE.exec(decodedPath);
  if (eventsMatch && [...query.keys()].length === 0) {
    return eventsSlugOk(eventsMatch[1], url);
  }
  if (routeParam !== null && /\/index\.php$|^\/?$/.test(lowerPath)) {
    const m = EVENTS_ROUTE_RE.exec(routeParam);
    if (m && [...query.keys()].every((k) => k === 'rest_route')) return eventsSlugOk(m[1], url);
    return { ok: false, reason: 'only the wg-live/v1/events routes may be requested through REST' };
  }
  if (segments.includes('wp-json')) return { ok: false, reason: 'only the wg-live/v1/events routes may be requested through REST' };

  // Static assets: extension allowlist under wp-content / wp-includes, only ?ver
  const lastSegment = segments[segments.length - 1] ?? '';
  if (ASSET_EXT.test(lastSegment)) {
    if (segments[0] !== 'wp-content' && segments[0] !== 'wp-includes') return { ok: false, reason: 'static assets must live under wp-content or wp-includes' };
    for (const key of query.keys()) if (!ASSET_QUERY_KEYS.has(key)) return { ok: false, reason: `asset query "${key}" is not allowed (only ver)` };
    return { ok: true, kind: 'asset', url: url.href };
  }

  // Pages: no file extension in the last segment, tightly limited query
  if (lastSegment.includes('.')) return { ok: false, reason: 'unsupported file type' };
  for (const [key, value] of query) {
    if (!PAGE_QUERY_KEYS.has(key)) return { ok: false, reason: `page query "${key}" is not allowed` };
    if (key === 'wg_event' && !(value.length <= 100 && SLUG_RE.test(value))) return { ok: false, reason: 'wg_event is not a valid slug' };
    if (key === 'wg_mode' && value !== 'binaural' && value !== 'atmos') return { ok: false, reason: 'wg_mode must be binaural or atmos' };
    if ((key === 'page_id' || key === 'p') && !/^\d{1,10}$/.test(value)) return { ok: false, reason: `${key} must be a number` };
  }
  return { ok: true, kind: 'page', url: url.href };
}

function eventsSlugOk(slug, url) {
  if (slug !== undefined && !(slug.length <= 100 && SLUG_RE.test(slug))) return { ok: false, reason: 'event slug is not valid' };
  return { ok: true, kind: 'events', url: url.href };
}

/**
 * Asset URLs found in page HTML (script src, link href), filtered to allowed assets of the target,
 * wg-live files first, de-duplicated, capped.
 * @param {string} html
 * @param {string} pageUrl
 * @param {string} origin
 * @param {number} limit
 */
export function extractAssetUrls(html, pageUrl, origin, limit) {
  const found = new Set();
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/&amp;/g, '&').replace(/&#0?38;/g, '&').trim();
    if (!raw) continue;
    let abs;
    try {
      abs = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    const verdict = isAllowedRequest(abs, origin);
    if (verdict.ok && verdict.kind === 'asset') found.add(verdict.url);
  }
  const ours = [...found].filter((u) => u.includes('/wg-live'));
  const others = [...found].filter((u) => !u.includes('/wg-live'));
  return [...ours, ...others].slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

/**
 * The URLs the run will use. User-supplied URLs that are refused raise a UsageError instead of being
 * skipped silently, so a typo cannot quietly shrink the test.
 * @param {{ target: string, event: string | null, pages: string[], assets: string[] }} opts
 */
export function buildPlan(opts) {
  const pagePaths = opts.pages.length > 0
    ? opts.pages
    : ['/', '/live/', opts.event ? `/live/listen/?wg_event=${opts.event}` : '/live/listen/', '/live/help/'];
  const eventPaths = ['/wp-json/wg-live/v1/events'];
  if (opts.event) eventPaths.push(`/wp-json/wg-live/v1/events/${opts.event}`);

  const pick = (paths, want, flag) => paths.map((p) => {
    const v = isAllowedRequest(p, opts.target);
    if (!v.ok) throw new UsageError(`${flag} "${p}" refused: ${v.reason}`);
    if (v.kind !== want) throw new UsageError(`${flag} "${p}" is a ${v.kind} URL, expected ${want}`);
    return v.url;
  });
  return {
    pages: pick(pagePaths, 'page', '--page'),
    assets: pick(opts.assets, 'asset', '--asset'),
    events: pick(eventPaths, 'events', 'events'),
  };
}

// ---------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------

/**
 * Nearest-rank percentile on an ascending array.
 * @param {number[]} sorted
 * @param {number} p 0..100
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * @typedef {{ kind: string, status: number, ms: number, bytes: number, error?: string }} Sample
 * status 0 means no HTTP response (network error, timeout, refused).
 */

/** @param {Sample[]} samples */
export function summarize(samples) {
  const statusCodes = {};
  let errors = 0;
  let bytes = 0;
  const latencies = [];
  for (const s of samples) {
    const key = s.status === 0 ? 'error' : String(s.status);
    statusCodes[key] = (statusCodes[key] ?? 0) + 1;
    bytes += s.bytes;
    if (s.status === 0 || s.status >= 500) errors++;
    if (s.status !== 0) latencies.push(s.ms);
  }
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);
  const r = (n) => (n === null ? null : Math.round(n * 10) / 10);
  return {
    requests: samples.length,
    errors,
    errorRate: samples.length ? Math.round((errors / samples.length) * 10000) / 10000 : 0,
    statusCodes: Object.fromEntries(Object.entries(statusCodes).sort(([a], [b]) => a.localeCompare(b))),
    bytes,
    latencyMs: {
      min: r(latencies[0] ?? null),
      mean: r(latencies.length ? sum / latencies.length : null),
      p50: r(percentile(latencies, 50)),
      p90: r(percentile(latencies, 90)),
      p95: r(percentile(latencies, 95)),
      p99: r(percentile(latencies, 99)),
      max: r(latencies[latencies.length - 1] ?? null),
    },
  };
}

/** @param {Sample[]} samples */
function summarizeByKind(samples) {
  const out = {};
  for (const kind of ['page', 'asset', 'events']) {
    const subset = samples.filter((s) => s.kind === kind);
    if (subset.length) out[kind] = summarize(subset);
  }
  return out;
}

/**
 * Safety rule evaluated while a step runs. Returns a reason string or null.
 * @param {Sample[]} stepSamples
 * @param {{ abortErrorRate: number, abortThrottleRate: number, minSamples: number }} limits
 */
export function abortReason(stepSamples, limits) {
  if (stepSamples.length < limits.minSamples) return null;
  const errors = stepSamples.filter((s) => s.status === 0 || s.status >= 500).length;
  if (errors / stepSamples.length >= limits.abortErrorRate) {
    return `error rate ${(100 * errors / stepSamples.length).toFixed(1)}% (network errors, timeouts, 5xx) reached the ${limits.abortErrorRate * 100}% limit`;
  }
  const throttled = stepSamples.filter((s) => s.status === 429 || s.status === 503).length;
  if (throttled / stepSamples.length >= limits.abortThrottleRate) {
    return `${(100 * throttled / stepSamples.length).toFixed(1)}% of responses were 429/503; the server is pushing back`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 3;

/**
 * One GET, following same-origin, allowed redirects only. Never throws.
 * @returns {Promise<Sample & { mediaResponse?: boolean, html?: string }>}
 */
export async function requestOnce(url, kind, ctx, wantBody = false) {
  const started = performance.now();
  let current = url;
  let bytes = 0;
  let lastStatus = 0;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const verdict = isAllowedRequest(current, ctx.origin);
      if (!verdict.ok) {
        // A redirect pointing somewhere we may not go is reported as the 3xx it was, not followed.
        return { kind, status: lastStatus, ms: performance.now() - started, bytes, error: `refused: ${verdict.reason}` };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
      let res;
      try {
        res = await ctx.fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': `wg-live-load-test/${TOOL_VERSION} (approved test)`, accept: '*/*' },
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (MEDIA_CONTENT_TYPE.test(contentType)) {
          await res.body?.cancel?.();
          return { kind, status: res.status, ms: performance.now() - started, bytes, error: 'media response refused', mediaResponse: true };
        }
        lastStatus = res.status;
        if (REDIRECT.has(res.status) && hop < MAX_HOPS) {
          const location = res.headers.get('location');
          await res.body?.cancel?.();
          if (location) {
            current = new URL(location, current).href;
            continue;
          }
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        bytes += buf.length;
        const sample = { kind, status: res.status, ms: performance.now() - started, bytes };
        if (wantBody && res.status === 200 && /html/i.test(contentType)) sample.html = new TextDecoder().decode(buf);
        return sample;
      } finally {
        clearTimeout(timer);
      }
    }
    return { kind, status: 0, ms: performance.now() - started, bytes, error: 'too many redirects' };
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : 'Error';
    return { kind, status: 0, ms: performance.now() - started, bytes, error: name === 'AbortError' ? 'timeout' : name };
  }
}

/** Shared request-rate ceiling: hands out evenly spaced slots. */
export function createRateLimiter(maxRps, now, sleep) {
  const gap = 1000 / maxRps;
  let next = 0;
  return {
    async take() {
      const t = now();
      const slot = Math.max(next, t);
      next = slot + gap;
      if (slot > t) await sleep(slot - t);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

/**
 * @param {LoadTestOptions} opts parsed options (not the help marker)
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>,
 *           random?: () => number, log?: (line: string) => void, clock?: () => Date }} [deps]
 * @returns {Promise<{ result: LoadTestResult, file: string | null, exitCode: number }>}
 */
export async function runLoadTest(opts, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const log = deps.log ?? ((line) => console.log(line));
  const clock = deps.clock ?? (() => new Date());

  const plan = buildPlan(opts);
  const ctx = { origin: opts.target, timeoutMs: opts.timeoutMs, fetchImpl };
  const startedAt = clock();

  /** @type {string[]} */
  const notes = [];
  let abortedReason = null;

  // Discovery: read each page once (counted separately, not part of the step statistics).
  const discovery = { requests: 0, errors: 0 };
  const assets = [...plan.assets];
  if (!opts.dryRun && opts.discover && opts.assets.length === 0 && opts.maxAssets > 0) {
    const discovered = [];
    for (const page of plan.pages) {
      const sample = await requestOnce(page, 'page', ctx, true);
      discovery.requests++;
      if (sample.mediaResponse) {
        abortedReason = `media response from ${page}; run stopped before the steps`;
        break;
      }
      if (sample.status === 0 || sample.status >= 500) discovery.errors++;
      if (sample.html) discovered.push(...extractAssetUrls(sample.html, page, opts.target, opts.maxAssets));
      await sleep(opts.thinkMs);
    }
    const unique = [...new Set(discovered)];
    const ours = unique.filter((u) => u.includes('/wg-live'));
    assets.push(...[...ours, ...unique.filter((u) => !u.includes('/wg-live'))].slice(0, opts.maxAssets));
    if (assets.length === 0) notes.push('No static assets were discovered or given; the run covers pages and events only.');
  }

  /** @type {{ kind: 'page'|'asset'|'events', weight: number, urls: string[] }[]} */
  const mix = [
    { kind: 'page', weight: 3, urls: plan.pages },
    { kind: 'asset', weight: 4, urls: assets },
    { kind: 'events', weight: 3, urls: plan.events },
  ].filter((m) => m.urls.length > 0);
  const totalWeight = mix.reduce((a, m) => a + m.weight, 0);
  const pickTarget = () => {
    let r = random() * totalWeight;
    for (const m of mix) {
      r -= m.weight;
      if (r < 0) return { kind: m.kind, url: /** @type {string} */ (m.urls[Math.floor(random() * m.urls.length)]) };
    }
    const last = /** @type {{ kind: 'page'|'asset'|'events', urls: string[] }} */ (mix[mix.length - 1]);
    return { kind: last.kind, url: /** @type {string} */ (last.urls[0]) };
  };

  const header = {
    tool: 'wg-live load-test',
    toolVersion: TOOL_VERSION,
    spec: '13.5',
    startedAt: startedAt.toISOString(),
    target: opts.target,
    approved: true,
    approvedBy: opts.approvedBy,
    node: process.version,
    config: {
      steps: opts.steps, stepSeconds: opts.stepMs / 1000, cooldownSeconds: opts.cooldownMs / 1000,
      thinkMs: opts.thinkMs, maxRps: opts.maxRps, timeoutMs: opts.timeoutMs, maxRequests: opts.maxRequests,
      abortErrorRate: opts.abortErrorRate, abortThrottleRate: opts.abortThrottleRate,
    },
    plan: {
      pages: plan.pages.map((u) => pathOf(u)),
      assets: assets.map((u) => pathOf(u)),
      events: plan.events.map((u) => pathOf(u)),
    },
    scopeNote: 'Covers pages, static assets and wg-live/v1/events only. Never requests /playback or media. '
      + 'A successful run does not show that 300 viewers can stream Atmos or Binaural audio (M2, spec 13.5).',
  };

  if (opts.dryRun) {
    log('Dry run: no request was sent.');
    log(JSON.stringify({ ...header, dryRun: true }, null, 2));
    return { result: { ...header, dryRun: true, steps: [], totals: null, notes }, file: null, exitCode: 0 };
  }

  log(`Target ${opts.target}  steps ${opts.steps.join(' > ')} VUs  ${opts.stepMs / 1000}s each  max ${opts.maxRps} req/s`);

  const limiter = createRateLimiter(opts.maxRps, now, sleep);
  /** @type {Sample[]} */
  const allSamples = [];
  const stepResults = [];
  let issued = 0;

  if (abortedReason === null) {
    for (let si = 0; si < opts.steps.length; si++) {
      const vus = /** @type {number} */ (opts.steps[si]);
      const stepSamples = [];
      const stepStart = now();
      const deadline = stepStart + opts.stepMs;
      const state = { stop: false };
      const stagger = Math.min(2000, opts.stepMs * 0.1);

      const worker = async (index) => {
        await sleep((stagger * index) / vus);
        while (!state.stop && now() < deadline) {
          await limiter.take();
          if (state.stop || now() >= deadline) break;
          // Checked after the limiter wait, with no await before issued++: workers that queued while the
          // count was below the cap must not each send one more request.
          if (issued >= opts.maxRequests) {
            abortedReason ??= `reached --max-requests ${opts.maxRequests}`;
            state.stop = true;
            break;
          }
          issued++;
          const target = pickTarget();
          const sample = await requestOnce(target.url, target.kind, ctx);
          stepSamples.push(sample);
          allSamples.push(sample);
          if (sample.mediaResponse) {
            abortedReason ??= `media response from ${pathOf(target.url)}; the run was stopped`;
            state.stop = true;
            break;
          }
          const reason = abortReason(stepSamples, opts);
          if (reason) {
            abortedReason ??= `step ${si + 1} (${vus} VUs): ${reason}`;
            state.stop = true;
            break;
          }
          await sleep(opts.thinkMs * (0.5 + random()));
        }
      };
      await Promise.all(Array.from({ length: vus }, (_, i) => worker(i)));

      const elapsed = Math.max(1, now() - stepStart) / 1000;
      const summary = summarize(stepSamples);
      stepResults.push({
        step: si + 1, virtualUsers: vus, seconds: Math.round(elapsed * 10) / 10,
        requestsPerSecond: Math.round((stepSamples.length / elapsed) * 10) / 10,
        ...summary, byKind: summarizeByKind(stepSamples),
      });
      log(`step ${si + 1}: ${vus} VUs  ${summary.requests} req  ${summary.errors} errors  p50 ${summary.latencyMs.p50 ?? '-'} ms  p95 ${summary.latencyMs.p95 ?? '-'} ms  ${JSON.stringify(summary.statusCodes)}`);
      if (abortedReason) {
        log(`STOPPED: ${abortedReason}`);
        break;
      }
      if (si < opts.steps.length - 1 && opts.cooldownMs > 0) await sleep(opts.cooldownMs);
    }
  } else {
    log(`STOPPED: ${abortedReason}`);
  }

  const finishedAt = clock();
  const result = {
    ...header,
    finishedAt: finishedAt.toISOString(),
    completedAllSteps: abortedReason === null,
    abortedReason,
    discovery,
    steps: stepResults,
    totals: { ...summarize(allSamples), byKind: summarizeByKind(allSamples) },
    notes,
  };

  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `load-${timestamp(startedAt)}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  log(`Wrote ${file}`);
  return { result, file, exitCode: abortedReason === null ? 0 : 1 };
}

function pathOf(href) {
  const u = new URL(href);
  return `${u.pathname}${u.search}`;
}

/** 20261010T103000Z */
export function timestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * @param {readonly string[]} argv
 * @param {Parameters<typeof runLoadTest>[1]} [deps]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps) {
  const log = deps?.log ?? ((line) => console.log(line));
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`load-test: ${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
  if ('help' in opts) {
    log(USAGE);
    return 0;
  }
  try {
    return (await runLoadTest(opts, deps)).exitCode;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`load-test: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
