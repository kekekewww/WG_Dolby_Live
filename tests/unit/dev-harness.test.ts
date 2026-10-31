// @vitest-environment node
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_FILES,
  DEMO_VIDEO_FILES,
  buildBootConfig,
  handleRest,
  harnessEvents,
  injectConfig,
  matchRestUrl,
  parseHarnessOptions,
  resolvePlayback,
  restRootFor,
} from '../../dev/harness';
import { createDistServer, distTags } from '../../dev/serve-dist.mjs';
import { restUrl } from '../../src/util/url';

const NOW = Date.UTC(2026, 9, 10, 4, 0, 0);

function rest(route: string, query: Record<string, string> = {}, disabled = false) {
  return handleRest({ method: 'GET', route, searchParams: new URLSearchParams(query), disabled, now: NOW });
}

describe('mock REST (M1-PLAN 5, 5.1)', () => {
  it('is stateless: the same request gives the same answer', () => {
    expect(rest('events')).toEqual(rest('events'));
    expect(rest('playback', { event: '9001', mode: 'atmos' })).toEqual(rest('playback', { event: '9001', mode: 'atmos' }));
  });

  it('lists events, finds one by slug and 404s unknown or malformed slugs', () => {
    const list = rest('events').body as { events: { slug: string }[] };
    expect(list.events.map((e) => e.slug)).toEqual(['demo-live-binaural-atmos', 'demo-scheduled', 'demo-ended', 'pending-source-live']);
    expect(rest('events/demo-scheduled').status).toBe(200);
    expect(rest('events/nope')).toMatchObject({ status: 404, body: { code: 'wg_live_not_found' } });
    expect(rest('events/Bad_Slug')).toMatchObject({ status: 404, body: { code: 'rest_no_route' } });
    expect(handleRest({ method: 'POST', route: 'events', searchParams: new URLSearchParams(), disabled: false })).toMatchObject({ status: 405 });
  });

  it('never puts a source URL into the public event data', () => {
    const json = JSON.stringify(harnessEvents(NOW));
    expect(json).not.toContain('.mp3');
    expect(json).not.toContain('.mp4');
    expect(json).not.toMatch(/"(url|src|source)":\s*"[^"]*demo-tone/);
  });

  it('serves per-mode demo files for video events as video/mp4 (binaural = video 1, atmos = video 2)', () => {
    expect(harnessEvents(NOW).every((e) => e.mediaKind === 'video')).toBe(true);
    expect(rest('playback', { event: '9001', mode: 'binaural' }).body).toEqual({ kind: 'demo', url: '/demo/demo-video-1.mp4', mimeType: 'video/mp4' });
    expect(rest('playback', { event: '9001', mode: 'atmos' }).body).toEqual({ kind: 'demo', url: '/demo/demo-video-2.mp4', mimeType: 'video/mp4' });
    expect(DEMO_VIDEO_FILES.binaural).not.toBe(DEMO_VIDEO_FILES.atmos);
  });

  it('serves per-mode demo files for audio events as audio/mpeg (binaural = tone 1, atmos = tone 2)', () => {
    const [live] = harnessEvents(NOW);
    const audioEvent = { ...(live as NonNullable<typeof live>), mediaKind: 'audio' as const };
    expect(resolvePlayback({ disabled: false, event: audioEvent, mode: 'binaural' })).toEqual({ kind: 'demo', url: '/demo/demo-tone-1.mp3', mimeType: 'audio/mpeg' });
    expect(resolvePlayback({ disabled: false, event: audioEvent, mode: 'atmos' })).toEqual({ kind: 'demo', url: '/demo/demo-tone-2.mp3', mimeType: 'audio/mpeg' });
    expect(DEMO_FILES.binaural).not.toBe(DEMO_FILES.atmos);
  });

  it('follows the resolution order of plan 5.1', () => {
    const body = (route: string, q: Record<string, string>, disabled = false) => rest(route, q, disabled).body;
    expect(body('playback', { event: '9001', mode: 'binaural' }, true)).toEqual({ kind: 'not_ready', reason: 'disabled' }); // 1
    expect(body('playback', { event: '1', mode: 'binaural' })).toEqual({ kind: 'not_ready', reason: 'event_not_found' }); // 2
    expect(body('playback', { event: '9003', mode: 'atmos' })).toEqual({ kind: 'not_ready', reason: 'mode_unavailable' }); // 3
    // 4: the entitlement step runs before the source check; a non-demo event is "unavailable" in M1
    expect(body('playback', { event: '9004', mode: 'binaural' })).toEqual({ kind: 'not_ready', reason: 'entitlement_unavailable' });
    // 6: demo events skip the status check, so an ended demo event still resolves
    expect(body('playback', { event: '9003', mode: 'binaural' })).toMatchObject({ kind: 'demo' });
    const [, , , pending] = harnessEvents(NOW);
    expect(resolvePlayback({ disabled: false, event: pending, mode: 'binaural' })).toEqual({ kind: 'not_ready', reason: 'entitlement_unavailable' });
  });

  it('validates playback params', () => {
    expect(rest('playback', { event: 'x', mode: 'atmos' }).status).toBe(400);
    expect(rest('playback', { event: '9001', mode: 'surround' }).status).toBe(400);
    expect(rest('playback').status).toBe(400);
    expect(rest('nothing').status).toBe(404);
  });

  it('disabled hides everything (plan D16)', () => {
    expect(rest('events', {}, true).body).toEqual({ events: [] });
    expect(rest('events/demo-scheduled', {}, true).status).toBe(404);
  });

  it('understands the pretty, the plain and the disabled URL forms', () => {
    const m = (path: string, q = '') => matchRestUrl(path, new URLSearchParams(q));
    expect(m('/wp-json/wg-live/v1/events')).toEqual({ route: 'events', disabled: false });
    expect(m('/disabled/wp-json/wg-live/v1/playback')).toEqual({ route: 'playback', disabled: true });
    expect(m('/index.php', 'rest_route=/wg-live/v1/events/demo-ended')).toEqual({ route: 'events/demo-ended', disabled: false });
    expect(m('/disabled/index.php', 'rest_route=/wg-live/v1/events')).toEqual({ route: 'events', disabled: true });
    expect(m('/dev/index.html')).toBeNull();
    expect(m('/index.php', 'rest_route=/wp/v2/posts')).toBeNull();
  });

  it('the client URL builder produces URLs the mock understands, in both forms', () => {
    for (const plain of [false, true]) {
      const root = restRootFor({ disabled: false, plain });
      const u = new URL(restUrl(root, 'playback', { event: 9001, mode: 'atmos' }), 'http://localhost');
      const match = matchRestUrl(u.pathname, u.searchParams);
      expect(match, root).toEqual({ route: 'playback', disabled: false });
      expect(u.searchParams.get('event')).toBe('9001');
    }
  });
});

describe('BootConfig', () => {
  it('fills every field of src/types.ts BootConfig, including featuredEventSlug and heading', () => {
    const c = buildBootConfig('player', NOW);
    expect(Object.keys(c).sort()).toEqual(
      ['schema', 'pluginVersion', 'view', 'deploymentMode', 'timezone', 'rest', 'assets', 'links', 'fixedEventSlug', 'featuredEventSlug', 'heading', 'events', 'help', 'devTools'].sort(),
    );
    expect(c).toMatchObject({ deploymentMode: 'demo', featuredEventSlug: null, heading: 'h2', devTools: true });
  });

  it('variants: disabled, plain, nodev, featured, heading, fixed', () => {
    const o = parseHarnessOptions('?harness=disabled,plain,nodev&featured=demo-scheduled&heading=h1&fixed=demo-ended');
    expect(o).toMatchObject({ disabled: true, plain: true, devTools: false, featured: 'demo-scheduled', heading: 'h1', fixed: 'demo-ended' });
    const disabled = buildBootConfig('events', NOW, o);
    expect(disabled).toMatchObject({ deploymentMode: 'disabled', events: [], fixedEventSlug: null, featuredEventSlug: null, devTools: false });
    expect(disabled.rest.root).toBe('/disabled/index.php?rest_route=/wg-live/v1/');

    const enabled = buildBootConfig('events', NOW, parseHarnessOptions('?featured=demo-scheduled&fixed=demo-ended&heading=h1'));
    expect(enabled).toMatchObject({ featuredEventSlug: 'demo-scheduled', fixedEventSlug: 'demo-ended', heading: 'h1' });
    // unknown or malformed slugs are dropped
    expect(buildBootConfig('events', NOW, parseHarnessOptions('?featured=nope')).featuredEventSlug).toBeNull();
    expect(parseHarnessOptions('?featured=Bad%20Slug').featured).toBeNull();
  });

  it('injects HTML-safe JSON into the page tokens', () => {
    const html = injectConfig('<script>__WG_LIVE_CONFIG:help__</script>', NOW);
    expect(html).not.toContain('__WG_LIVE_CONFIG');
    expect(html.slice(8, -9)).not.toMatch(/[<>&]/);
  });
});

describe('dist server (dev/serve-dist.mjs)', () => {
  const built = existsSync(join(import.meta.dirname, '..', '..', 'plugin', 'wg-live', 'assets', 'dist', 'build-info.json'));
  const server = createDistServer();
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    // Several tests read only the status of a fetch and leave the body unread, which keeps the socket open;
    // close() alone then waits for the garbage collector. Drop the open connections first.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('distTags builds <link> and <script defer> from build-info.json names, versioned by hash', () => {
    const tags = distTags({
      files: {
        'wg-live.js': { sha256: 'a'.repeat(64) },
        'wg-live.css': { sha256: 'b'.repeat(64) },
        'wg-live-featured.css': { sha256: 'c'.repeat(64) },
      },
    });
    expect(tags.js).toBe('<script defer src="/dist/wg-live.js?ver=aaaaaaaaaaaa" id="wg-live-js"></script>');
    expect(tags.css).toContain('<link rel="stylesheet" id="wg-live-css" href="/dist/wg-live.css?ver=bbbbbbbbbbbb"');
    expect(tags.featuredCss).toContain('/dist/wg-live-featured.css?ver=cccccccccccc');
    expect(tags.css).not.toContain('featured');
  });

  it.skipIf(!built)('serves the pages with the built files, config and mock REST', async () => {
    const page = await fetch(`${base}/dev/dist/listen.html?harness=disabled`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toMatch(/<link rel="stylesheet" id="wg-live-css" href="\/dist\/wg-live\.css\?ver=[0-9a-f]{12}"/);
    expect(html).toMatch(/<script defer src="\/dist\/wg-live\.js\?ver=[0-9a-f]{12}"/);
    expect(html).not.toContain('/src/main.ts');
    expect(html).toContain('"deploymentMode":"disabled"');

    const home = await (await fetch(`${base}/dev/dist/home.html`)).text();
    expect(home).toContain('wg-live-featured.css');
    // No script of ours: the only <script> is the site mock's chrome script (dev/site-mock.js).
    expect(home).not.toMatch(/<script(?![^>]*data-site-mock)/);
    expect(home).not.toContain('wg-live.js');

    for (const name of ['wg-live.js', 'wg-live.css', 'wg-live-featured.css', 'build-info.json']) {
      expect((await fetch(`${base}/dist/${name}`)).status, name).toBe(200);
    }
    expect((await fetch(`${base}/dist/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/dist/wg-live.js.map`)).status).toBe(404);

    const events = (await (await fetch(`${base}/wp-json/wg-live/v1/events`)).json()) as { events: unknown[] };
    expect(events.events.length).toBe(4);
    const plain = await fetch(`${base}/index.php?rest_route=/wg-live/v1/events/demo-ended`);
    expect(plain.status).toBe(200);
  });

  it.skipIf(!existsSync(join(import.meta.dirname, '..', '..', 'plugin', 'wg-live', 'assets', 'demo', 'demo-tone-1.mp3')))(
    'serves the demo MP3 and MP4 files with Range support',
    async () => {
      for (const name of ['demo-tone-1.mp3', 'demo-tone-2.mp3']) {
        const res = await fetch(`${base}/demo/${name}`, { headers: { Range: 'bytes=0-99' } });
        expect(res.status).toBe(206);
        expect(res.headers.get('content-type')).toBe('audio/mpeg');
        expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
      }
      for (const name of ['demo-video-1.mp4', 'demo-video-2.mp4']) {
        const res = await fetch(`${base}/demo/${name}`, { headers: { Range: 'bytes=0-99' } });
        expect(res.status).toBe(206);
        expect(res.headers.get('content-type')).toBe('video/mp4');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
        expect((await res.arrayBuffer()).byteLength).toBe(100);
        // Safari asks for a small first range, then an open-ended one; a suffix range reads the moov atom at the end.
        expect((await fetch(`${base}/demo/${name}`, { headers: { Range: 'bytes=100-' } })).status).toBe(206);
        const suffix = await fetch(`${base}/demo/${name}`, { headers: { Range: 'bytes=-50' } });
        expect(suffix.status).toBe(206);
        expect((await suffix.arrayBuffer()).byteLength).toBe(50);
        expect((await fetch(`${base}/demo/${name}`, { headers: { Range: 'bytes=99999999-' } })).status).toBe(416);
        expect((await fetch(`${base}/demo/${name}`)).status).toBe(200);
      }
      expect((await fetch(`${base}/demo/..%2f..%2fpackage.json`)).status).toBe(404); // only the flat file name is used
      expect((await fetch(`${base}/demo/demo-tone.m4a`)).status).toBe(404);
    },
  );
});

describe('harness-only poster (the 1:1 poster is not a plugin runtime file)', () => {
  const repo = join(import.meta.dirname, '..', '..');
  it('lives in dev/assets, which the harness serves, and is not shipped in the plugin', () => {
    expect(existsSync(join(repo, 'dev', 'assets', 'poster-demo-square.svg'))).toBe(true);
    expect(existsSync(join(repo, 'plugin', 'wg-live', 'assets', 'demo', 'poster-demo-square.svg'))).toBe(false);
  });
});
