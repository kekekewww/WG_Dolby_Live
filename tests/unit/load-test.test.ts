// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_VUS,
  UsageError,
  abortReason,
  buildPlan,
  createRateLimiter,
  extractAssetUrls,
  isAllowedRequest,
  main,
  parseArgs,
  percentile,
  runLoadTest,
  summarize,
  timestamp,
  type LoadTestOptions,
} from '../../scripts/load-test.mjs';

const ORIGIN = 'https://staging.example.com';
const BASE = ['--target', ORIGIN, '--approved'];

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'wg-live-load-'));
  dirs.push(d);
  return d;
}

type Opts = LoadTestOptions;
function opts(extra: string[] = []): Opts {
  return parseArgs([...BASE, ...extra]) as Opts;
}

describe('argument guard', () => {
  it('refuses to run without --target', () => {
    expect(() => parseArgs(['--approved'])).toThrow(/--target .* is required/);
  });

  it('refuses to run without --approved', () => {
    expect(() => parseArgs(['--target', ORIGIN])).toThrow(/--approved is required/);
  });

  it('refuses with no arguments at all', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  it('refuses --approved=false and any other value on the flag', () => {
    expect(() => parseArgs(['--target', ORIGIN, '--approved=false'])).toThrow(/takes no value/);
  });

  it('applies the guard to --dry-run too', () => {
    expect(() => parseArgs(['--dry-run'])).toThrow(/--target/);
  });

  it('accepts target + approved and sets polite defaults', () => {
    const o = opts();
    expect(o.target).toBe(ORIGIN);
    expect(o.steps).toEqual([5, 25, 50, 100]);
    expect(o.thinkMs).toBeGreaterThanOrEqual(200);
    expect(o.maxRps).toBeLessThanOrEqual(100);
    expect(o.discover).toBe(true);
    expect(o.dryRun).toBe(false);
  });

  it('supports --key=value and records --approved-by', () => {
    const o = opts(['--steps=1,2', '--approved-by', 'Studio Admin']);
    expect(o.steps).toEqual([1, 2]);
    expect(o.approvedBy).toBe('Studio Admin');
  });

  it('rejects credentials pasted into --approved-by', () => {
    expect(() => opts(['--approved-by', 'password: hunter2'])).toThrow(/not a credential/);
  });

  it.each([
    ['not a url', /not a valid URL/],
    ['ftp://example.com', /http or https/],
    ['https://user:pw@example.com', /credentials/],
    ['https://example.com/live/', /origin only/],
    ['https://example.com/?x=1', /origin only/],
  ])('rejects target %s', (target, re) => {
    expect(() => parseArgs(['--target', target, '--approved'])).toThrow(re);
  });

  it('normalizes a trailing slash on the target', () => {
    expect(parseArgs(['--target', `${ORIGIN}/`, '--approved'])).toMatchObject({ target: ORIGIN });
  });

  it.each([
    ['5,5', /strictly ascending/],
    ['25,5', /strictly ascending/],
    ['0,5', /outside/],
    [`${MAX_VUS + 1}`, /outside/],
    ['a,b', /whole number/],
    ['', /--steps needs a value|empty/],
    ['1.5', /whole number/],
  ])('rejects --steps %j', (steps, re) => {
    expect(() => opts(['--steps', steps])).toThrow(re);
  });

  it('allows the full 300 as the top step', () => {
    expect(opts(['--steps', '50,300']).steps).toEqual([50, 300]);
  });

  it('rejects unknown options, stray arguments and invalid numbers', () => {
    expect(() => opts(['--concurrency', '5'])).toThrow(/unknown option/);
    expect(() => opts(['stray'])).toThrow(/unexpected argument/);
    expect(() => opts(['--think-ms', '10'])).toThrow(/between 200/);
    expect(() => opts(['--max-rps', '0'])).toThrow(/--max-rps/);
    expect(() => opts(['--step-seconds', '-1'])).toThrow(/--step-seconds/);
    expect(() => opts(['--think-ms'])).toThrow(/needs a value/);
  });

  it('validates --event as a slug', () => {
    expect(opts(['--event', 'demo-live']).event).toBe('demo-live');
    expect(() => opts(['--event', 'Demo_Live'])).toThrow(/valid slug/);
    expect(() => opts(['--event', 'abc\n'])).toThrow(/valid slug/);
  });

  it('returns a help marker without the guard', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true });
  });

  it('main exits 2 and sends no request when the guard fails', async () => {
    const fetchImpl = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['--target', ORIGIN], { fetchImpl })).toBe(2);
    expect(await main([], { fetchImpl })).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('URL filtering', () => {
  const ok = (p: string) => isAllowedRequest(p, ORIGIN);

  it.each([
    ['/', 'page'],
    ['/live/', 'page'],
    ['/live/listen/?wg_event=demo-live', 'page'],
    ['/live/listen/?wg_event=demo-live&wg_mode=atmos', 'page'],
    ['/live/help/', 'page'],
    ['/?page_id=8', 'page'],
    ['/wp-content/plugins/wg-live/assets/dist/wg-live.js?ver=ab12cd34', 'asset'],
    ['/wp-content/plugins/wg-live/assets/dist/wg-live.css?ver=ab12cd34', 'asset'],
    ['/wp-content/plugins/wg-live/assets/dist/wg-live-featured.css', 'asset'],
    ['/wp-content/uploads/2026/10/poster.webp', 'asset'],
    ['/wp-content/uploads/elementor/google-fonts/fonts/notosanstc-400.woff2', 'asset'],
    ['/wp-json/wg-live/v1/events', 'events'],
    ['/wp-json/wg-live/v1/events/', 'events'],
    ['/wp-json/wg-live/v1/events/demo-live', 'events'],
    ['/index.php?rest_route=/wg-live/v1/events', 'events'],
    ['/index.php?rest_route=/wg-live/v1/events/demo-live', 'events'],
    ['/?rest_route=/wg-live/v1/events', 'events'],
    [`${ORIGIN}/live/`, 'page'],
  ])('allows %s as %s', (path, kind) => {
    expect(ok(path)).toMatchObject({ ok: true, kind });
  });

  it.each([
    ['/wp-json/wg-live/v1/playback?event=12&mode=atmos', /playback/],
    ['/index.php?rest_route=/wg-live/v1/playback&event=12&mode=binaural', /playback/],
    ['/wp-json/wg-live/v1/PLAYBACK', /playback/],
    ['/wp-json/wg-live/v1/%70layback?event=1', /playback/],
    ['/wp-content/plugins/wg-live/assets/demo/demo-tone-1.mp3', /media/],
    ['/anything/else.m3u8', /media/],
    ['/seg/0001.ts', /media/],
    ['/clip.mp4?x=1', /media/],
    ['/wp-content/uploads/track.wav', /media/],
    ['/wp-content/plugins/wg-live/assets/demo/poster-demo.svg', /demo media directory/],
  ])('refuses playback and media: %s', (path, re) => {
    const v = ok(path);
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringMatching(re) });
  });

  it.each([
    '/wp-admin/',
    '/wp-admin/admin-ajax.php',
    '/wp-login.php',
    '/xmlrpc.php',
    '/wp-cron.php',
    '/cart/',
    '/checkout/',
    '/my-account/',
    '/shop/?add-to-cart=12',
    '/?wc-ajax=get_refreshed_fragments',
  ])('refuses admin, login and commerce: %s', (path) => {
    expect(ok(path).ok).toBe(false);
  });

  it.each([
    '/wp-json/wp/v2/users',
    '/wp-json/',
    '/wp-json/wg-live/v1/other',
    '/wp-json/wg-live/v1/events/Bad_Slug',
    '/wp-json/wg-live/v1/events/a/b',
    '/wp-json/wg-live/v1/events?foo=1',
    '/index.php?rest_route=/wp/v2/users',
    '/?rest_route=/wg-live/v1/events&extra=1',
  ])('refuses other REST routes: %s', (path) => {
    expect(ok(path).ok).toBe(false);
  });

  it.each([
    '/live/listen/?wg_event=Bad_Slug',
    '/live/listen/?wg_event=abc%0A',
    '/live/listen/?wg_mode=hifi',
    '/live/?debug=1',
    '/live/?paid=true',
    '/?p=abc',
    '/wp-content/plugins/wg-live/assets/dist/wg-live.js?debug=1',
    '/assets/app.js',
    '/readme.txt',
    '/a/../wp-admin/',
  ])('refuses unexpected query, file type or path: %s', (path) => {
    expect(ok(path).ok).toBe(false);
  });

  it('refuses other origins, schemes and credentials', () => {
    expect(ok('https://other.example.com/live/').ok).toBe(false);
    expect(ok('http://staging.example.com/live/').ok).toBe(false);
    expect(ok('//evil.example.com/live/').ok).toBe(false);
    expect(ok('ftp://staging.example.com/').ok).toBe(false);
    expect(ok('https://user:pw@staging.example.com/live/').ok).toBe(false);
    expect(ok('javascript:alert(1)').ok).toBe(false);
  });

  it('buildPlan fails loudly on a refused --page or --asset instead of dropping it', () => {
    expect(() => buildPlan({ ...opts(), pages: ['/wp-json/wg-live/v1/playback?event=1&mode=atmos'] })).toThrow(/refused/);
    expect(() => buildPlan({ ...opts(), pages: ['/wp-content/plugins/wg-live/assets/dist/wg-live.js'] })).toThrow(/expected page/);
    expect(() => buildPlan({ ...opts(), assets: ['/live/'] })).toThrow(/expected asset/);
    expect(() => buildPlan({ ...opts(), assets: ['/x/demo-tone-1.mp3'] })).toThrow(/refused/);
  });

  it('buildPlan default URLs are pages and events only, and include the event when given', () => {
    const plan = buildPlan(opts(['--event', 'demo-live']));
    expect(plan.pages).toEqual([
      `${ORIGIN}/`, `${ORIGIN}/live/`, `${ORIGIN}/live/listen/?wg_event=demo-live`, `${ORIGIN}/live/help/`,
    ]);
    expect(plan.events).toEqual([`${ORIGIN}/wp-json/wg-live/v1/events`, `${ORIGIN}/wp-json/wg-live/v1/events/demo-live`]);
    expect(plan.assets).toEqual([]);
    for (const url of [...plan.pages, ...plan.events]) expect(url.toLowerCase()).not.toContain('playback');
  });

  it('extractAssetUrls keeps allowed assets of the target, wg-live first, capped and deduplicated', () => {
    const html = `
      <link rel="stylesheet" href="/wp-content/themes/astra/style.css?ver=4.1">
      <link rel="stylesheet" href="${ORIGIN}/wp-content/plugins/wg-live/assets/dist/wg-live.css?ver=abc">
      <script src="/wp-content/plugins/wg-live/assets/dist/wg-live.js?ver=abc" defer></script>
      <script src="/wp-content/plugins/wg-live/assets/dist/wg-live.js?ver=abc"></script>
      <script src="https://cdn.other.example/lib.js"></script>
      <link rel="preload" href="/wp-content/plugins/wg-live/assets/demo/demo-tone-1.mp3">
      <a href="/live/">not a tag we read</a>
      <script src='/wp-includes/js/jquery/jquery.min.js?ver=3.7.1&amp;x=1'></script>
      <script src="/wp-json/wg-live/v1/playback?event=1"></script>`;
    const urls = extractAssetUrls(html, `${ORIGIN}/live/`, ORIGIN, 10);
    expect(urls).toEqual([
      `${ORIGIN}/wp-content/plugins/wg-live/assets/dist/wg-live.css?ver=abc`,
      `${ORIGIN}/wp-content/plugins/wg-live/assets/dist/wg-live.js?ver=abc`,
      `${ORIGIN}/wp-content/themes/astra/style.css?ver=4.1`,
    ]);
    expect(extractAssetUrls(html, `${ORIGIN}/live/`, ORIGIN, 1)).toHaveLength(1);
  });
});

describe('statistics', () => {
  it('percentile uses nearest rank', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 90)).toBe(90);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile(v, 0)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });

  it('summarize counts status codes, errors and latency percentiles', () => {
    const s = summarize([
      { kind: 'page', status: 200, ms: 100, bytes: 10 },
      { kind: 'page', status: 200, ms: 200, bytes: 10 },
      { kind: 'asset', status: 304, ms: 50, bytes: 0 },
      { kind: 'events', status: 404, ms: 70, bytes: 5 },
      { kind: 'events', status: 503, ms: 900, bytes: 0 },
      { kind: 'page', status: 0, ms: 15000, bytes: 0, error: 'timeout' },
    ]);
    expect(s.requests).toBe(6);
    expect(s.errors).toBe(2);
    expect(s.statusCodes).toEqual({ '200': 2, '304': 1, '404': 1, '503': 1, error: 1 });
    expect(s.latencyMs.min).toBe(50);
    expect(s.latencyMs.max).toBe(900);
    expect(s.latencyMs.p50).toBe(100);
    expect(s.bytes).toBe(25);
  });

  it('summarize of nothing is all null, not NaN', () => {
    expect(summarize([]).latencyMs).toEqual({ min: null, mean: null, p50: null, p90: null, p95: null, p99: null, max: null });
  });

  it('abortReason needs enough samples and reacts to errors and throttling', () => {
    const limits = { abortErrorRate: 0.2, abortThrottleRate: 0.05, minSamples: 20 };
    const mk = (status: number, n: number) => Array.from({ length: n }, () => ({ kind: 'page', status, ms: 1, bytes: 0 }));
    expect(abortReason(mk(500, 19), limits)).toBeNull();
    expect(abortReason([...mk(200, 15), ...mk(500, 5)], limits)).toMatch(/error rate/);
    expect(abortReason([...mk(200, 19), ...mk(429, 1)], limits)).toMatch(/429\/503/);
    expect(abortReason(mk(200, 30), limits)).toBeNull();
    expect(abortReason(mk(404, 30), limits)).toBeNull();
  });

  it('timestamp is a filename-safe UTC stamp', () => {
    expect(timestamp(new Date('2026-10-10T10:30:05.123Z'))).toBe('20261010T103005Z');
  });

  it('rate limiter spaces requests by 1000/maxRps', async () => {
    let t = 0;
    const slept: number[] = [];
    const limiter = createRateLimiter(10, () => t, async (ms: number) => { slept.push(ms); t += ms; });
    await limiter.take();
    await limiter.take();
    await limiter.take();
    expect(slept).toEqual([100, 100]);
  });
});

/** A fake site: pages with asset tags, assets, the events route. Records every requested URL. */
function fakeSite(overrides: Record<string, () => Response> = {}) {
  const seen: string[] = [];
  const html = `<html><head>
    <link rel="stylesheet" href="/wp-content/plugins/wg-live/assets/dist/wg-live.css?ver=h1">
    <script src="/wp-content/plugins/wg-live/assets/dist/wg-live.js?ver=h2" defer></script></head><body>ok</body></html>`;
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(`${url.pathname}${url.search}`);
    const key = `${url.pathname}${url.search}`;
    const over = overrides[key];
    if (over) return over();
    if (url.pathname.endsWith('.js')) return new Response('var a=1;', { status: 200, headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.endsWith('.css')) return new Response('.wg-live{}', { status: 200, headers: { 'content-type': 'text/css' } });
    if (url.pathname.includes('/wg-live/v1/events')) return new Response('{"events":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen, raw: fetchImpl };
}

function fastOpts(outDir: string, extra: string[] = []): Opts {
  const o = opts(['--steps', '2,4', '--out-dir', outDir, '--event', 'demo-live', ...extra]);
  // Programmatic shortcut: sub-second steps (the CLI minimum is one second).
  return { ...o, stepMs: 120, cooldownMs: 0, thinkMs: 5, maxRps: 1000 };
}

describe('run', () => {
  // Wall-clock steps made these tests flaky on a busy machine: a 120 ms step could end before a worker
  // picked the URL under test. Each now() call is one tick instead, and sleeps return at once, so a step
  // always covers the same number of iterations.
  const noSleepDeps = (site: ReturnType<typeof fakeSite>, random?: () => number) => {
    let tick = 0;
    return {
      fetchImpl: site.fetchImpl,
      log: () => undefined,
      now: () => tick++,
      sleep: async () => undefined,
      ...(random ? { random } : {}),
    };
  };

  it('runs the steps, only requests allowed URLs, and writes load-<timestamp>.json', async () => {
    const dir = tmp();
    const site = fakeSite();
    const { result, file, exitCode } = await runLoadTest(fastOpts(dir), {
      ...noSleepDeps(site),
      clock: () => new Date('2026-10-10T10:30:05Z'),
    });

    expect(exitCode).toBe(0);
    expect(file).toBe(join(dir, 'load-20261010T103005Z.json'));
    expect(readdirSync(dir)).toEqual(['load-20261010T103005Z.json']);

    expect(site.seen.length).toBeGreaterThan(10);
    for (const seen of site.seen) {
      expect(seen.toLowerCase()).not.toContain('playback');
      expect(seen).not.toMatch(/\.(mp3|m4a|mp4|m3u8|ts)(\?|$)/);
      expect(isAllowedRequest(seen, ORIGIN).ok).toBe(true);
    }
    expect(new Set(site.seen)).toContain('/wp-json/wg-live/v1/events');
    expect(new Set(site.seen)).toContain('/wp-content/plugins/wg-live/assets/dist/wg-live.js?ver=h2');

    const disk = JSON.parse(readFileSync(file as string, 'utf8'));
    expect(disk.approved).toBe(true);
    expect(disk.target).toBe(ORIGIN);
    expect(disk.completedAllSteps).toBe(true);
    expect(disk.steps.map((s: { virtualUsers: number }) => s.virtualUsers)).toEqual([2, 4]);
    expect(disk.totals.requests).toBe(result.totals?.requests);
    expect(disk.totals.statusCodes['200']).toBe(disk.totals.requests);
    expect(disk.totals.latencyMs.p95).toEqual(expect.any(Number));
    expect(Object.keys(disk.totals.byKind).sort()).toEqual(['asset', 'events', 'page']);
    expect(disk.plan.assets).toHaveLength(2);
    expect(JSON.stringify(disk.plan)).not.toMatch(/playback|mp3/i);
    expect(disk.scopeNote).toMatch(/Never requests \/playback/);
  });

  it('dry run sends nothing and writes nothing', async () => {
    const dir = tmp();
    const site = fakeSite();
    const { file, result, exitCode } = await runLoadTest({ ...fastOpts(dir), dryRun: true }, noSleepDeps(site));
    expect(site.raw).not.toHaveBeenCalled();
    expect(file).toBeNull();
    expect(exitCode).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(existsSync(join(dir, 'x'))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stops the ramp when the server errors out and still writes the record', async () => {
    const dir = tmp();
    const failing = fakeSite({
      '/wp-json/wg-live/v1/events': () => new Response('x', { status: 500 }),
      '/wp-json/wg-live/v1/events/demo-live': () => new Response('x', { status: 500 }),
      '/': () => new Response('x', { status: 503 }),
      '/live/': () => new Response('x', { status: 503 }),
      '/live/help/': () => new Response('x', { status: 503 }),
      '/live/listen/?wg_event=demo-live': () => new Response('x', { status: 503 }),
    });
    const { result, exitCode, file } = await runLoadTest(
      { ...fastOpts(dir), steps: [25, 50], stepMs: 400, discover: false, assets: [] },
      noSleepDeps(failing),
    );
    expect(exitCode).toBe(1);
    expect(result.completedAllSteps).toBe(false);
    expect(result.abortedReason).toMatch(/step 1/);
    expect(result.steps).toHaveLength(1);
    expect(existsSync(file as string)).toBe(true);
  });

  it('stops immediately if any response turns out to be media', async () => {
    const dir = tmp();
    const site = fakeSite({
      '/live/': () => new Response('ID3', { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    });
    const { result, exitCode } = await runLoadTest(fastOpts(dir), noSleepDeps(site));
    expect(exitCode).toBe(1);
    expect(result.abortedReason).toMatch(/media response/);
  });

  it('does not follow a redirect to another origin or to a playback URL', async () => {
    const dir = tmp();
    const site = fakeSite({
      '/live/': () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } }),
      '/live/help/': () => new Response(null, { status: 301, headers: { location: '/wp-json/wg-live/v1/playback?event=1&mode=atmos' } }),
    });
    // One VU draws kind, page index, think time per request: alternate /live/ (index 1) and /live/help/ (index 3).
    const draws = [0.1, 0.3, 0.5, 0.1, 0.9, 0.5];
    let n = 0;
    const random = () => draws[n++ % draws.length] as number;
    const { result } = await runLoadTest({ ...fastOpts(dir), steps: [1], discover: false }, noSleepDeps(site, random));
    expect(site.seen.some((u) => u.includes('playback'))).toBe(false);
    expect(site.raw.mock.calls.map(([u]) => String(u)).filter((u) => !u.startsWith(`${ORIGIN}/`))).toEqual([]);
    expect(result.totals?.statusCodes['302'] ?? 0).toBeGreaterThan(0);
    expect(result.totals?.statusCodes['301'] ?? 0).toBeGreaterThan(0);
    expect(result.totals?.statusCodes.error ?? 0).toBe(0);
  });

  it('follows a same-origin redirect (trailing slash)', async () => {
    const dir = tmp();
    const site = fakeSite({
      '/live/': () => new Response(null, { status: 301, headers: { location: '/live/help/' } }),
    });
    const { result } = await runLoadTest({ ...fastOpts(dir), steps: [2], discover: false }, noSleepDeps(site));
    expect(result.totals?.statusCodes['301'] ?? 0).toBe(0);
    expect(result.totals?.statusCodes['200']).toBeGreaterThan(0);
  });

  it('respects --max-requests', async () => {
    const dir = tmp();
    const site = fakeSite();
    const { result, exitCode } = await runLoadTest({ ...fastOpts(dir), maxRequests: 7, discover: false, stepMs: 400 }, noSleepDeps(site));
    expect(result.totals?.requests).toBe(7);
    expect(result.abortedReason).toMatch(/max-requests/);
    expect(exitCode).toBe(1);
  });

  it('never exceeds --max-requests when many VUs wait on the rate limiter at once', async () => {
    const dir = tmp();
    const site = fakeSite();
    const { result } = await runLoadTest({ ...fastOpts(dir), steps: [25], maxRequests: 7, discover: false }, noSleepDeps(site));
    expect(result.totals?.requests).toBe(7);
    expect(site.raw).toHaveBeenCalledTimes(7);
  });

  it('main prints help and exits 0 without requests', async () => {
    const fetchImpl = vi.fn();
    const lines: string[] = [];
    expect(await main(['--help'], { fetchImpl, log: (l: string) => lines.push(l) })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/--target/);
  });

  it('main returns 2 for a refused --page without sending anything', async () => {
    const fetchImpl = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await main([...BASE, '--page', '/wp-json/wg-live/v1/playback?event=1&mode=atmos', '--dry-run'], { fetchImpl, log: () => undefined });
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
