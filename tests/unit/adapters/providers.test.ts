import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderError,
  createBootstrapEventProvider,
  createRestEventProvider,
  createLiveEntitlementProvider,
  createRestEntitlementProvider,
  createRestPlaybackProvider,
  createRestSession,
  parsePlaybackSource,
} from '../../../src/adapters/providers';
import { createEntitlementPlaceholder } from '../../../src/adapters/entitlement-placeholder';
import { demoEvents } from '../../../src/fixtures/demo-events';
import type { PublicEvent } from '../../../src/types';

const PRETTY = 'https://sounds.example.test/wp-json/wg-live/v1/';
const PLAIN = 'https://sounds.example.test/index.php?rest_route=/wg-live/v1/';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const events = demoEvents(NOW);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

describe('createBootstrapEventProvider', () => {
  it('lists and gets from the given events without any request', async () => {
    const provider = createBootstrapEventProvider(events);
    await expect(provider.list()).resolves.toEqual(events);
    await expect(provider.get(events[0]!.slug)).resolves.toEqual(events[0]);
    await expect(provider.get('no-such-event')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a copy of the list so callers cannot reorder the snapshot', async () => {
    const provider = createBootstrapEventProvider(events);
    const first = await provider.list();
    first.reverse();
    const second = await provider.list();
    expect(second[0]).toEqual(events[0]);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const provider = createBootstrapEventProvider(events);
    const ctl = new AbortController();
    ctl.abort();
    await expect(provider.list(ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.get('x', ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createRestEventProvider: URLs', () => {
  it.each([
    ['pretty', PRETTY, 'https://sounds.example.test/wp-json/wg-live/v1/events'],
    ['plain', PLAIN, 'https://sounds.example.test/index.php?rest_route=/wg-live/v1/events'],
  ])('list() builds the %s URL through restUrl', async (_name, root, expected) => {
    fetchMock.mockResolvedValue(json({ events }));
    await createRestEventProvider(root).list();
    expect(lastCall().url).toBe(expected);
  });

  it.each([
    ['pretty', PRETTY, 'https://sounds.example.test/wp-json/wg-live/v1/events/demo-live-binaural-atmos'],
    ['plain', PLAIN, 'https://sounds.example.test/index.php?rest_route=/wg-live/v1/events/demo-live-binaural-atmos'],
  ])('get() builds the %s URL through restUrl', async (_name, root, expected) => {
    fetchMock.mockResolvedValue(json({ event: events[0] }));
    await createRestEventProvider(root).get('demo-live-binaural-atmos');
    expect(lastCall().url).toBe(expected);
  });

  it('sends a same-origin GET with Accept: application/json and the abort signal', async () => {
    fetchMock.mockResolvedValue(json({ events }));
    const ctl = new AbortController();
    await createRestEventProvider(PRETTY).list(ctl.signal);
    const { init } = lastCall();
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.signal).toBe(ctl.signal);
  });
});

describe('createRestEventProvider: list()', () => {
  it('returns validated events and drops invalid ones', async () => {
    const bad = [
      { ...events[0], slug: 'Bad Slug' },
      { ...events[0], id: -3, slug: 'neg-id' },
      { ...events[0], slug: 'bad-status', status: 'teleported' },
      { ...events[0], slug: 'bad-date', startsAt: 'not a date' },
      'a string',
      null,
      42,
    ];
    fetchMock.mockResolvedValue(json({ events: [events[0], ...bad, events[1]] }));
    const list = await createRestEventProvider(PRETTY).list();
    expect(list.map((e) => e.slug)).toEqual([events[0]!.slug, events[1]!.slug]);
  });

  it('drops unknown fields and sanitises unsafe URLs', async () => {
    const dirty = {
      ...events[0],
      posterUrl: 'javascript:alert(1)',
      productUrl: 'data:text/html,hi',
      sourceUrl: 'https://private.example/stream.m3u8',
      secret: 'x',
    };
    fetchMock.mockResolvedValue(json({ events: [dirty] }));
    const [event] = await createRestEventProvider(PRETTY).list();
    expect(event).toBeDefined();
    expect(event!.posterUrl).toBeNull();
    expect(event!.productUrl).toBeNull();
    expect(Object.keys(event!)).not.toContain('sourceUrl');
    expect(Object.keys(event!)).not.toContain('secret');
  });

  it('accepts an empty list', async () => {
    fetchMock.mockResolvedValue(json({ events: [] }));
    await expect(createRestEventProvider(PRETTY).list()).resolves.toEqual([]);
  });

  it.each([
    ['an array', []],
    ['no events key', { items: [] }],
    ['events not an array', { events: 'nope' }],
    ['null', null],
    ['a string', 'hello'],
  ])('rejects a malformed payload (%s) with invalid_response', async (_name, body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(createRestEventProvider(PRETTY).list()).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'invalid_response',
    });
  });

  it('rejects an HTML/non-JSON 200 with invalid_response', async () => {
    fetchMock.mockResolvedValue(new Response('<html>cache plugin page</html>', { status: 200 }));
    await expect(createRestEventProvider(PRETTY).list()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([404, 500, 503, 403])('a %i response throws a typed http error', async (status) => {
    fetchMock.mockResolvedValue(json({ code: 'x' }, status));
    const error = await createRestEventProvider(PRETTY).list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'http', status });
  });

  it('a rejected fetch throws a typed network error without leaking the URL', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch https://sounds.example.test/wp-json/wg-live/v1/events'));
    const error = (await createRestEventProvider(PRETTY).list().catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe('network');
    expect(error.message).not.toContain('sounds.example.test');
    expect(error.message).not.toContain('http');
  });

  it('abort: an already aborted signal rejects with AbortError before any request', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(createRestEventProvider(PRETTY).list(ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('abort: a fetch aborted in flight rejects with AbortError, not ProviderError', async () => {
    const ctl = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = createRestEventProvider(PRETTY).list(ctl.signal);
    ctl.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('abort: an abort while the body is being read rejects with AbortError', async () => {
    const ctl = new AbortController();
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: () => {
        ctl.abort();
        return Promise.resolve('{"events":[]}');
      },
    });
    await expect(createRestEventProvider(PRETTY).list(ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createRestEventProvider: get()', () => {
  it('returns the validated event', async () => {
    fetchMock.mockResolvedValue(json({ event: events[0] }));
    await expect(createRestEventProvider(PRETTY).get(events[0]!.slug)).resolves.toEqual(events[0]);
  });

  it('404 wg_live_not_found -> null', async () => {
    fetchMock.mockResolvedValue(json({ code: 'wg_live_not_found', message: 'x', data: { status: 404 } }, 404));
    await expect(createRestEventProvider(PRETTY).get('gone-event')).resolves.toBeNull();
  });

  it('404 with an unparseable body -> null', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(createRestEventProvider(PRETTY).get('gone-event')).resolves.toBeNull();
  });

  it('404 rest_no_route (plugin route missing) is an error, not "no such event"', async () => {
    fetchMock.mockResolvedValue(json({ code: 'rest_no_route', message: 'x' }, 404));
    await expect(createRestEventProvider(PRETTY).get('gone-event')).rejects.toMatchObject({ code: 'http', status: 404 });
  });

  it('other http errors throw', async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(createRestEventProvider(PRETTY).get('x-event')).rejects.toMatchObject({ code: 'http', status: 500 });
  });

  it('rejects an answer for a different event than the one requested', async () => {
    fetchMock.mockResolvedValue(json({ event: events[1] }));
    await expect(createRestEventProvider(PRETTY).get(events[0]!.slug)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([{ event: { ...demoEvents(NOW)[0], status: 'bogus' } }, { event: null }, {}, [], 'x'])(
    'rejects a malformed event payload %#',
    async (body) => {
      fetchMock.mockResolvedValue(json(body));
      await expect(createRestEventProvider(PRETTY).get(events[0]!.slug)).rejects.toMatchObject({ code: 'invalid_response' });
    },
  );

  it('refuses an invalid slug without a request (no path injection)', async () => {
    const provider = createRestEventProvider(PRETTY);
    for (const slug of ['../playback', 'A-B', '', 'a/b', 'abc\n', 'x?y=1']) {
      await expect(provider.get(slug)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('network error and abort behave like list()', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(createRestEventProvider(PRETTY).get('some-event')).rejects.toMatchObject({ code: 'network' });
    const ctl = new AbortController();
    ctl.abort();
    await expect(createRestEventProvider(PRETTY).get('some-event', ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createRestEventProvider: fallback', () => {
  it('serves the fallback only when there is no REST root at all', async () => {
    const provider = createRestEventProvider('', events);
    await expect(provider.list()).resolves.toEqual(events);
    await expect(provider.get(events[1]!.slug)).resolves.toEqual(events[1]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never serves the fallback after a failed request (stale data must not revert a status)', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const provider = createRestEventProvider(PRETTY, events);
    await expect(provider.list()).rejects.toMatchObject({ code: 'network' });
    await expect(provider.get(events[0]!.slug)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('createRestPlaybackProvider', () => {
  const demoBody = { kind: 'demo', url: 'https://sounds.example.test/wp-content/plugins/wg-live/assets/demo/demo-tone-1.mp3', mimeType: 'audio/mpeg' };

  it.each([
    ['pretty', PRETTY, 'https://sounds.example.test/wp-json/wg-live/v1/playback?event=9001&mode=binaural'],
    ['plain', PLAIN, 'https://sounds.example.test/index.php?rest_route=/wg-live/v1/playback&event=9001&mode=binaural'],
  ])('builds the %s URL and sends no-store', async (_name, root, expected) => {
    fetchMock.mockResolvedValue(json(demoBody));
    await createRestPlaybackProvider(root).resolve(9001, 'binaural');
    const { url, init } = lastCall();
    expect(url).toBe(expected);
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('GET');
  });

  it('returns a validated demo source', async () => {
    fetchMock.mockResolvedValue(json({ ...demoBody, extra: 'dropped' }));
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'atmos')).resolves.toEqual(demoBody);
  });

  it('resolves a same-origin relative demo url against this origin', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'demo', url: '/demo/demo-tone-2.mp3', mimeType: 'audio/mpeg' }));
    const source = await createRestPlaybackProvider(PRETTY).resolve(9001, 'atmos');
    expect(source).toEqual({ kind: 'demo', url: `${window.location.origin}/demo/demo-tone-2.mp3`, mimeType: 'audio/mpeg' });
  });

  it.each(['disabled', 'event_not_found', 'mode_unavailable', 'not_entitled', 'entitlement_unavailable', 'source_not_configured', 'event_not_playable'])(
    'passes through not_ready/%s',
    async (reason) => {
      fetchMock.mockResolvedValue(json({ kind: 'not_ready', reason }));
      await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural')).resolves.toEqual({ kind: 'not_ready', reason });
    },
  );

  it('an unknown not_ready reason becomes source_not_configured', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'not_ready', reason: 'because' }));
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural')).resolves.toEqual({
      kind: 'not_ready',
      reason: 'source_not_configured',
    });
  });

  const NOT_CONFIGURED = { kind: 'not_ready', reason: 'source_not_configured' };

  it.each([
    ['javascript url', { kind: 'demo', url: 'javascript:alert(1)', mimeType: 'audio/mpeg' }],
    ['data url', { kind: 'demo', url: 'data:audio/mpeg;base64,AAAA', mimeType: 'audio/mpeg' }],
    ['blob url', { kind: 'demo', url: 'blob:https://x/1', mimeType: 'audio/mpeg' }],
    ['mailto url', { kind: 'demo', url: 'mailto:a@b.test', mimeType: 'audio/mpeg' }],
    ['credentials in url', { kind: 'demo', url: 'https://u:p@x.test/a.mp3', mimeType: 'audio/mpeg' }],
    ['missing url', { kind: 'demo', mimeType: 'audio/mpeg' }],
    ['non-string url', { kind: 'demo', url: 42, mimeType: 'audio/mpeg' }],
    ['empty url', { kind: 'demo', url: '', mimeType: 'audio/mpeg' }],
    ['missing mimeType', { kind: 'demo', url: 'https://x.test/a.mp3' }],
    ['text mimeType', { kind: 'demo', url: 'https://x.test/a.mp3', mimeType: 'text/html' }],
    ['malformed mimeType', { kind: 'demo', url: 'https://x.test/a.mp3', mimeType: 'audio/<script>' }],
    ['giant mimeType', { kind: 'demo', url: 'https://x.test/a.mp3', mimeType: `audio/${'a'.repeat(500)}` }],
    ['unknown kind', { kind: 'dash', url: 'https://x.test/a.mpd' }],
    ['hls with a javascript url', { kind: 'hls', url: 'javascript:alert(1)', mode: 'binaural' }],
    ['hls with credentials in the url', { kind: 'hls', url: 'https://u:p@x.test/live.m3u8', mode: 'binaural' }],
    ['hls without a mode', { kind: 'hls', url: 'https://x.test/live.m3u8' }],
    ['hls with an unknown mode', { kind: 'hls', url: 'https://x.test/live.m3u8', mode: 'surround' }],
    ['iframe (until M2-PLAN D2)', { kind: 'iframe', url: 'https://x.test/p', allowedOrigin: 'https://x.test' }],
    ['no kind', { url: 'https://x.test/a.mp3' }],
    ['array', []],
    ['null', null],
    ['string', 'demo'],
  ])('unknown shape (%s) -> not_ready/source_not_configured', async (_name, body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural')).resolves.toEqual(NOT_CONFIGURED);
  });

  it('accepts a signed hls playlist for a known mode (M2-PLAN C3), the URL made absolute', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'hls', url: 'https://cdn.example.test/live/atmos/index.m3u8?token=abc', mode: 'atmos' }));
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'atmos')).resolves.toEqual({ kind: 'hls', url: 'https://cdn.example.test/live/atmos/index.m3u8?token=abc', mode: 'atmos' });
    expect(parsePlaybackSource({ kind: 'hls', url: '/hls/binaural/index.m3u8', mode: 'binaural' })).toEqual({ kind: 'hls', url: `${window.location.origin}/hls/binaural/index.m3u8`, mode: 'binaural' });
  });

  it('accepts a mime type with a codecs parameter', () => {
    const source = parsePlaybackSource({ kind: 'demo', url: 'https://x.test/a.m4a', mimeType: 'audio/mp4; codecs="mp4a.40.2"' });
    expect(source).toMatchObject({ kind: 'demo', mimeType: 'audio/mp4; codecs="mp4a.40.2"' });
  });

  it('a non-JSON 200 resolves to not configured (no source is ever invented)', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200 }));
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural')).resolves.toEqual(NOT_CONFIGURED);
  });

  it.each([400, 403, 404, 500])('a %i response throws a typed http error', async (status) => {
    fetchMock.mockResolvedValue(json({ code: 'x' }, status));
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural')).rejects.toMatchObject({ code: 'http', status });
  });

  it('a network failure throws a typed network error with no URL in the message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = (await createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural').catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe('network');
    expect(error.message).not.toMatch(/sounds\.example|wp-json|playback/);
  });

  it('abort rejects with AbortError', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(createRestPlaybackProvider(PRETTY).resolve(9001, 'binaural', ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects impossible arguments without a request', async () => {
    const provider = createRestPlaybackProvider(PRETTY);
    await expect(provider.resolve(0, 'binaural')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(provider.resolve(1.5, 'binaural')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(provider.resolve(-1, 'binaural')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(provider.resolve(1, 'stereo' as never)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without a REST root nothing is resolved', async () => {
    await expect(createRestPlaybackProvider('').resolve(9001, 'binaural')).resolves.toEqual(NOT_CONFIGURED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs anything, so no URL can reach the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    fetchMock.mockResolvedValueOnce(json(demoBody));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(json({ code: 'x' }, 500));
    const provider = createRestPlaybackProvider(PRETTY);
    await provider.resolve(9001, 'binaural');
    await provider.resolve(9001, 'binaural').catch(() => undefined);
    await provider.resolve(9001, 'binaural').catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('types', () => {
  it('REST providers satisfy the contract interfaces', () => {
    const list: PublicEvent[] = events;
    expect(typeof createBootstrapEventProvider(list).list).toBe('function');
  });
});

/* ---------------- M2-PLAN A3: REST entitlement with the wp_rest nonce ---------------- */
describe('M2 REST entitlement and nonce', () => {
  const ROOT = 'https://sounds.example.com/wp-json/wg-live/v1/';
  const NONCE_URL = 'https://sounds.example.com/wp-admin/admin-ajax.php?action=rest-nonce';
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const badNonce = () => json({ code: 'rest_cookie_invalid_nonce', message: 'Cookie check failed' }, 403);
  const headerOf = (call: unknown[]): string | null => new Headers((call[1] as RequestInit | undefined)?.headers).get('X-WP-Nonce');

  it('sends X-WP-Nonce when logged in and no nonce header for guests', async () => {
    fetchMock.mockResolvedValue(json({ status: 'entitled' }));
    await createRestEntitlementProvider(ROOT, createRestSession({ root: ROOT, nonce: '0a1b2c3d4e', nonceUrl: NONCE_URL })).get(7);
    expect(headerOf(fetchMock.mock.calls[0] as unknown[])).toBe('0a1b2c3d4e');
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(json({ status: 'guest' }));
    expect(await createRestEntitlementProvider(ROOT, createRestSession({ root: ROOT, nonce: null, nonceUrl: NONCE_URL })).get(7)).toEqual({ status: 'guest' });
    expect(headerOf(fetchMock.mock.calls[0] as unknown[])).toBeNull();
  });

  it('an expired nonce is refreshed from nonceUrl once and the request retried', async () => {
    fetchMock.mockResolvedValueOnce(badNonce()).mockResolvedValueOnce(new Response('9f8e7d6c5b', { status: 200 })).mockResolvedValueOnce(json({ status: 'entitled' }));
    const result = await createRestEntitlementProvider(ROOT, createRestSession({ root: ROOT, nonce: '0a1b2c3d4e', nonceUrl: NONCE_URL })).get(7);
    expect(result).toEqual({ status: 'entitled' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(NONCE_URL);
    expect(headerOf(fetchMock.mock.calls[2] as unknown[])).toBe('9f8e7d6c5b');
  });

  it('a nonce that stays invalid is unavailable/session_expired, never not_entitled', async () => {
    fetchMock.mockResolvedValueOnce(badNonce()).mockResolvedValueOnce(new Response('0', { status: 400 })).mockResolvedValue(badNonce());
    const result = await createRestEntitlementProvider(ROOT, createRestSession({ root: ROOT, nonce: '0a1b2c3d4e', nonceUrl: NONCE_URL })).get(7);
    expect(result).toEqual({ status: 'unavailable', reason: 'session_expired' });
  });

  it('network failures, other HTTP errors and unknown statuses are unavailable', async () => {
    const provider = createRestEntitlementProvider(ROOT, createRestSession({ root: ROOT, nonce: null, nonceUrl: NONCE_URL }));
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await provider.get(7)).toEqual({ status: 'unavailable', reason: 'network' });
    fetchMock.mockResolvedValueOnce(json({}, 500));
    expect(await provider.get(7)).toEqual({ status: 'unavailable', reason: 'http' });
    fetchMock.mockResolvedValueOnce(json({ status: 'owner' }));
    expect(await provider.get(7)).toEqual({ status: 'unavailable', reason: 'invalid_response' });
  });

  it('in live mode demo events keep the placeholder rule and never call the entitlement endpoint', async () => {
    const demo = demoEvents().find((e) => e.isDemo) as PublicEvent;
    const real: PublicEvent = { ...demo, id: 4242, slug: 'real-concert', isDemo: false };
    fetchMock.mockResolvedValue(json({ status: 'not_entitled' }));
    const provider = createLiveEntitlementProvider(
      createEntitlementPlaceholder([demo, real]),
      createRestEntitlementProvider(ROOT, createRestSession({ root: ROOT, nonce: null, nonceUrl: NONCE_URL })),
      [demo, real],
    );
    await provider.get(demo.id);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('entitlement'))).toBe(false);
    expect(await provider.get(real.id)).toEqual({ status: 'not_entitled' });
  });

  it('the playback request carries the nonce too', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'not_ready', reason: 'not_entitled' }));
    await createRestPlaybackProvider(ROOT, createRestSession({ root: ROOT, nonce: '0a1b2c3d4e', nonceUrl: NONCE_URL })).resolve(7, 'binaural');
    expect(headerOf(fetchMock.mock.calls[0] as unknown[])).toBe('0a1b2c3d4e');
  });
});
