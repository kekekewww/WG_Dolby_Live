/**
 * M2-PLAN B1–B3 and D1: admin-approved stream hosts and player origins, per-event HLS / iframe sources, the
 * stream signer, and /playback for real sources. Changes settings (shared state), so it runs in the *-state
 * projects and restores them afterwards.
 */
import { randomUUID } from 'node:crypto';
import { test, type Browser, type Page } from '@playwright/test';
import { adminContext, bootConfigs, clickPublish, createEvents, deleteEventsByPrefix, deletePosts, deleteUsersByLoginPrefix, DEV, expect, fetchText, fillLoginForm, getSettings, rest, setSettingsKeys, TESTS, wp, wpPhp, type WpEnv } from './wp';

test.describe.configure({ mode: 'serial' });

const prefix = 'it-hls-state';
const GOOD = 'https://stream.example.test/live/atmos/playlist.m3u8';
let snapshot: Record<string, unknown> = {};
let eventId = 0;

const meta = (key: string): string => wpPhp<string>(DEV, `return (string) get_post_meta( ${eventId}, '_wg_live_${key}', true );`);

async function saveSource(page: Page, fields: { type?: string; atmos?: string; kind?: 'hls' | 'iframe' }): Promise<string> {
  const kind = fields.kind ?? 'hls';
  await page.goto(`/wp-admin/post.php?post=${eventId}&action=edit`);
  if (fields.type) await page.locator('#wg-live-source-type').selectOption(fields.type);
  if (fields.atmos !== undefined) await page.locator(`#wg-live-source-${kind}-atmos`).fill(fields.atmos);
  await Promise.all([page.waitForURL(/post\.php\?post=\d+&action=edit&message=\d+/, { timeout: 120_000 }), clickPublish(page)]);
  return (await page.locator('#wpbody-content .notice').allTextContents()).join(' | ');
}

test.beforeAll(() => {
  snapshot = getSettings(DEV);
  deleteEventsByPrefix(DEV, prefix);
  eventId = createEvents(DEV, [{ slug: `${prefix}-concert`, title: `${prefix} concert`, meta: { is_demo: '0', source_type: 'not_configured', status: 'live' } }])[`${prefix}-concert`] ?? 0;
});

test.afterAll(() => {
  setSettingsKeys(DEV, { deployment_mode: snapshot.deployment_mode, featured_event: snapshot.featured_event, stream_hosts: snapshot.stream_hosts ?? [], player_origins: snapshot.player_origins ?? [] });
  deletePosts(DEV, [eventId]);
  deleteEventsByPrefix(DEV, prefix);
});

test('B1: stream hosts keep only valid lowercase hostnames', () => {
  setSettingsKeys(DEV, { stream_hosts: ['Stream.Example.TEST', 'https://bad.example/x', '', 'a b', 'ok.example.org'] });
  expect(wpPhp<string[]>(DEV, 'return WG_Live\\Settings::stream_hosts();')).toEqual(['stream.example.test', 'ok.example.org']);
});

test('B1: an allowlisted https playlist is stored; another host or plain http on a real host is refused', async ({ browser }) => {
  setSettingsKeys(DEV, { stream_hosts: ['stream.example.test'] });
  const ctx = await adminContext(browser, DEV);
  try {
    const page = await ctx.newPage();
    // One Atmos stream per concert: the admin form has no Binaural source fields.
    await expect(page.locator('#wg-live-source-hls-binaural, #wg-live-source-iframe-binaural')).toHaveCount(0);
    await saveSource(page, { type: 'hls', atmos: GOOD });
    expect(meta('source_type')).toBe('hls');
    expect(meta('source_hls_atmos')).toBe(GOOD);
    expect(meta('source_hls_binaural')).toBe('');

    const refused = await saveSource(page, { atmos: 'https://elsewhere.example.test/a.m3u8' });
    expect(refused).toContain('串流主機');
    expect(meta('source_hls_atmos')).toBe(GOOD);
    // A second save that does not touch the type keeps hls (the editor shows the stored type).
    await expect(page.locator('#wg-live-source-type')).toHaveValue('hls');
    expect(meta('source_type')).toBe('hls');

    const plain = await saveSource(page, { atmos: 'http://stream.example.test/a.m3u8' });
    expect(plain).toContain('https');
    expect(meta('source_hls_atmos')).toBe(GOOD);
  } finally {
    await ctx.close();
  }
});

test('B1: plain http only for a local fixture (loopback or the site host) on a local site, never on production', () => {
  const hosts = ['localhost', '127.0.0.1', 'stream.example.test'];
  const before = getSettings(TESTS).stream_hosts ?? [];
  setSettingsKeys(DEV, { stream_hosts: hosts });
  setSettingsKeys(TESTS, { stream_hosts: hosts });
  try {
    const err = (env: WpEnv, url: string): string => wpPhp<string>(env, `return WG_Live\\Events::stream_url_error( '${url}' );`);
    expect(err(DEV, 'http://localhost:8888/hls/index.m3u8')).toBe('');
    expect(err(DEV, 'http://127.0.0.1:5185/hls/index.m3u8')).toBe('');
    expect(err(DEV, 'http://stream.example.test/a.m3u8')).toContain('https');
    expect(err(TESTS, 'http://localhost:8889/hls/index.m3u8')).toContain('https');
    expect(err(TESTS, 'https://stream.example.test/a.m3u8')).toBe('');
    // Review I1: URLs that PHP and browsers parse differently (backslash, userinfo) or with blanks never pass.
    expect(err(DEV, 'https://evil\\\\@stream.example.test/a.m3u8')).not.toBe('');
    expect(err(DEV, 'https://u:p@stream.example.test/a.m3u8')).not.toBe('');
    expect(err(DEV, 'https://stream.example.test/a b.m3u8')).not.toBe('');
    expect(wpPhp<string>(DEV, "return WG_Live\\Events::player_url_error( 'https://evil\\\\@player.example.test/embed' );")).not.toBe('');
  } finally {
    setSettingsKeys(TESTS, { stream_hosts: before });
  }
});

test('B1: the playlist URLs never reach REST, the bootstrap or any page', async () => {
  // The event is also the homepage featured card for this check.
  setSettingsKeys(DEV, { deployment_mode: 'live', featured_event: eventId });
  const needles = ['stream.example.test', GOOD];
  const home = (await fetchText(DEV, '/')).text;
  expect(home).toContain('wg-live-featured--event');
  const bodies = [
    (await rest(DEV, 'events')).text,
    (await rest(DEV, `events/${prefix}-concert`)).text,
    (await fetchText(DEV, '/live/')).text,
    (await fetchText(DEV, `/live/listen/?wg_event=${prefix}-concert`)).text,
    home,
  ];
  for (const body of bodies) for (const n of needles) expect(body).not.toContain(n);
  expect(bootConfigs((await fetchText(DEV, `/live/listen/?wg_event=${prefix}-concert`)).text).length).toBeGreaterThan(0);
});

test('C1: the bootstrap names the versioned hls.js file, which is served but not enqueued', async () => {
  const html = (await fetchText(DEV, `/live/listen/?wg_event=${prefix}-concert`)).text;
  const hls = bootConfigs(html)[0]?.assets?.hls as string;
  expect(hls).toMatch(/\/wp-content\/plugins\/wg-live\/assets\/dist\/wg-live-hls\.js\?ver=[0-9a-f]{12}$/);
  expect(html).not.toMatch(/<script[^>]+wg-live-hls\.js/);
  const file = await fetch(hls);
  expect(file.status).toBe(200);
  expect(await file.text()).toContain('window.WGLiveHls=module.exports');
});

const SIGNER = 'return ( $s = WG_Live\\Stream_Signers::current() ) ? get_class( $s ) : null;';

test('B2: a local environment signs nothing (unsigned signer); production without a signer gets none', () => {
  expect(wpPhp<string | null>(DEV, SIGNER)).toBe('WG_Live\\Unsigned_Signer');
  expect(wpPhp<string | null>(TESTS, SIGNER)).toBeNull();
  // The documented escape hatch (decision D4), set for this one request only.
  expect(wpPhp<string | null>(TESTS, `define( 'WG_LIVE_ALLOW_UNSIGNED_STREAMS', true ); ${SIGNER}`)).toBe('WG_Live\\Unsigned_Signer');
  // Anything but the boolean true keeps the guard closed.
  expect(wpPhp<string | null>(TESTS, `define( 'WG_LIVE_ALLOW_UNSIGNED_STREAMS', '1' ); ${SIGNER}`)).toBeNull();
  // The unsigned signer hands the URL back unchanged.
  expect(wpPhp<string>(DEV, `return ( new WG_Live\\Unsigned_Signer() )->sign( '${GOOD}', time() + 60 );`)).toBe(GOOD);
});

test('B2: the token lifetime covers the show plus 30 minutes (Review Focus 5)', () => {
  expect(wpPhp<number>(DEV, `return WG_Live\\Stream_Signers::ttl( ${eventId} );`)).toBeGreaterThanOrEqual(4 * 3600 + 30 * 60);
  expect(wpPhp<number>(DEV, `define( 'WG_LIVE_TOKEN_TTL', 6 * HOUR_IN_SECONDS ); return WG_Live\\Stream_Signers::ttl( ${eventId} );`)).toBe(6 * 3600 + 30 * 60);
});

test('B2: deploy info says whether a signer is configured and never prints a secret', async ({ browser }) => {
  const secret = 'it-secret-do-not-print-7f3a';
  wp(DEV, ['config', 'set', 'WG_LIVE_WOWZA_SECRET', secret, '--type=constant']);
  const ctx = await adminContext(browser, DEV);
  try {
    const page = await ctx.newPage();
    await page.goto('/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-deploy');
    const html = await page.content();
    expect(html).toContain('串流簽章');
    expect(html).not.toContain(secret);
    await expect(page.locator('tr', { hasText: '串流簽章' })).toContainText('未設定');
  } finally {
    await ctx.close();
    wp(DEV, ['config', 'delete', 'WG_LIVE_WOWZA_SECRET', '--type=constant']);
  }
});

/* B3: /playback for hls sources ------------------------------------------------------------------ */

interface Shop { product: number; order: number; user: { login: string; password: string; id: number } }

/** A customer with a completed order for a fresh ticket product. */
function shop(env: WpEnv): Shop {
  const login = `${prefix}-buyer-${randomUUID().slice(0, 6)}`;
  const password = randomUUID();
  const id = wpPhp<number>(env, `return wp_insert_user( array( 'user_login' => '${login}', 'user_pass' => '${password}', 'user_email' => '${login}@example.invalid', 'role' => 'customer' ) );`);
  const product = wpPhp<number>(env, `$p = new WC_Product_Simple(); $p->set_name( '${prefix} ticket' ); $p->set_regular_price( '100' ); $p->set_status( 'publish' ); return $p->save();`);
  const order = wpPhp<number>(env, `$o = wc_create_order( array( 'customer_id' => ${id} ) ); $o->add_product( wc_get_product( ${product} ), 1 ); $o->calculate_totals(); $o->set_status( 'completed' ); $o->save(); return $o->get_id();`);
  return { product, order, user: { login, password, id } };
}

function unshop(env: WpEnv, s: Shop | undefined): void {
  if (!s) return;
  wpPhp(env, `$o = wc_get_order( ${s.order} ); if ( $o ) { $o->delete( true ); } $p = wc_get_product( ${s.product} ); if ( $p ) { $p->delete( true ); } return true;`);
}

function setMeta(env: WpEnv, id: number, m: Record<string, unknown>): void {
  wpPhp(env, `foreach ( json_decode( '${JSON.stringify(m)}', true ) as $k => $v ) { update_post_meta( ${id}, '_wg_live_' . $k, $v ); } return true;`);
}

const HLS_EVENT = (product: number): Record<string, unknown> => ({
  source_type: 'hls',
  source_hls_atmos: GOOD,
  product_id: product,
  status: 'live',
  available_modes: ['atmos'],
});

let devShop: Shop | undefined;
let testsShop: Shop | undefined;
let testsSnapshot: Record<string, unknown> = {};
let testsEvent = 0;
let buyer: { page: Page; close: () => Promise<void> } | undefined;

/** GET /playback as the logged-in buyer, with the bootstrap nonce, from inside the page. */
async function buyerPlayback(browser: Browser, mode: string): Promise<{ status: number; text: string; cache: string | null; json: Record<string, unknown> }> {
  if (!buyer) {
    const ctx = await browser.newContext({ baseURL: DEV.baseURL });
    const page = await ctx.newPage();
    await page.goto('/wp-login.php');
    await fillLoginForm(page, devShop!.user.login, devShop!.user.password);
    await page.locator('#wp-submit').click();
    await page.waitForURL(/wp-admin|my-account/);
    buyer = { page, close: () => ctx.close() };
  }
  await buyer.page.goto(`/live/listen/?wg_event=${prefix}-concert`);
  const nonce = bootConfigs(await buyer.page.content())[0]?.rest?.nonce as string;
  expect(nonce).toBeTruthy();
  const r = await buyer.page.evaluate(
    async ([eid, m, n]) => {
      const res = await fetch(`/wp-json/wg-live/v1/playback?event=${eid}&mode=${m}`, { credentials: 'same-origin', headers: { 'X-WP-Nonce': n as string } });
      return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control') };
    },
    [eventId, mode, nonce] as const,
  );
  return { ...r, json: JSON.parse(r.text) as Record<string, unknown> };
}

test.describe('B3', () => {
  test.beforeAll(() => {
    devShop = shop(DEV);
    setSettingsKeys(DEV, { deployment_mode: 'live', stream_hosts: ['stream.example.test'] });
    setMeta(DEV, eventId, HLS_EVENT(devShop.product));
  });

  test.afterAll(async () => {
    await buyer?.close();
    unshop(DEV, devShop);
    deleteUsersByLoginPrefix(DEV, `${prefix}-`);
    if (testsEvent) {
      setSettingsKeys(TESTS, { deployment_mode: testsSnapshot.deployment_mode, stream_hosts: testsSnapshot.stream_hosts ?? [] });
      deletePosts(TESTS, [testsEvent]);
      unshop(TESTS, testsShop);
      deleteUsersByLoginPrefix(TESTS, `${prefix}-`);
    }
  });

  test('B3: the public event says hls (never a URL) only in live mode', async () => {
    const live = await rest(DEV, `events/${prefix}-concert`);
    expect(live.json.event.sourceKind).toBe('hls');
    expect(live.text).not.toContain('stream.example.test');
    setSettingsKeys(DEV, { deployment_mode: 'demo' });
    expect((await rest(DEV, `events/${prefix}-concert`)).json.event.sourceKind).toBe('not_configured');
    setSettingsKeys(DEV, { deployment_mode: 'live' });
  });

  test('B3: a guest gets not_entitled and the answer holds no URL', async () => {
    const { json, text, headers } = await rest(DEV, `playback?event=${eventId}&mode=atmos`);
    expect(json).toEqual({ kind: 'not_ready', reason: 'not_entitled' });
    expect(text).not.toMatch(/http/);
    expect(headers.get('cache-control')).toMatch(/no-store/);
  });

  test('B3: a buyer gets the Atmos playlist, never cached; binaural is not offered and yields no URL', async ({ browser }) => {
    const atmos = await buyerPlayback(browser, 'atmos');
    expect(atmos.status).toBe(200);
    expect(atmos.json).toEqual({ kind: 'hls', url: GOOD, mode: 'atmos' });
    expect(atmos.cache).toMatch(/no-store/);
    expect(atmos.cache).toMatch(/private/);
    const bin = await buyerPlayback(browser, 'binaural');
    expect(bin.json).toEqual({ kind: 'not_ready', reason: 'mode_unavailable' });
    expect(bin.text).not.toMatch(/http/);
  });

  test('B3: only live and intermission play; doors_open is event_not_playable', async ({ browser }) => {
    setMeta(DEV, eventId, { status: 'doors_open' });
    expect((await buyerPlayback(browser, 'atmos')).json).toEqual({ kind: 'not_ready', reason: 'event_not_playable' });
    setMeta(DEV, eventId, { status: 'intermission' });
    expect((await buyerPlayback(browser, 'atmos')).json).toMatchObject({ kind: 'hls', mode: 'atmos' });
    setMeta(DEV, eventId, { status: 'live' });
  });

  test('B3: an event with 開放聆聽 off (or only a legacy binaural value) is mode_unavailable; a missing playlist is source_not_configured', async ({ browser }) => {
    setMeta(DEV, eventId, { available_modes: ['binaural'] });
    expect((await buyerPlayback(browser, 'atmos')).json).toEqual({ kind: 'not_ready', reason: 'mode_unavailable' });
    setMeta(DEV, eventId, { available_modes: [] });
    expect((await buyerPlayback(browser, 'atmos')).json).toEqual({ kind: 'not_ready', reason: 'mode_unavailable' });
    setMeta(DEV, eventId, { available_modes: ['atmos'], source_hls_atmos: '' });
    expect((await buyerPlayback(browser, 'atmos')).json).toEqual({ kind: 'not_ready', reason: 'source_not_configured' });
    setMeta(DEV, eventId, { source_hls_atmos: GOOD });
  });

  test('B3: a host taken off the allowlist after saving stops resolving', async ({ browser }) => {
    setSettingsKeys(DEV, { stream_hosts: ['ok.example.org'] });
    const r = await buyerPlayback(browser, 'atmos');
    expect(r.json).toEqual({ kind: 'not_ready', reason: 'source_not_configured' });
    expect(r.text).not.toMatch(/http/);
    setSettingsKeys(DEV, { stream_hosts: ['stream.example.test'] });
  });

  test('B3: production without a signer is source_not_configured; the escape hatch hands out the URL', () => {
    testsSnapshot = getSettings(TESTS);
    testsShop = shop(TESTS);
    deleteEventsByPrefix(TESTS, prefix);
    testsEvent = createEvents(TESTS, [{ slug: `${prefix}-prod`, title: `${prefix} prod`, meta: { is_demo: '0', ...HLS_EVENT(testsShop.product) } }])[`${prefix}-prod`] ?? 0;
    setSettingsKeys(TESTS, { deployment_mode: 'live', stream_hosts: ['stream.example.test'] });
    const resolve = `return WG_Live\\Playback_Provider::resolve( ${testsEvent}, 'atmos', ${testsShop.user.id} );`;
    expect(wpPhp(TESTS, `return WG_Live\\Entitlement::check( ${testsEvent}, ${testsShop.user.id} );`)).toEqual({ status: 'entitled', reason: 'ticket' });
    expect(wpPhp(TESTS, resolve)).toEqual({ kind: 'not_ready', reason: 'source_not_configured' });
    expect(wpPhp(TESTS, `define( 'WG_LIVE_ALLOW_UNSIGNED_STREAMS', true ); ${resolve}`)).toEqual({ kind: 'hls', url: GOOD, mode: 'atmos' });
  });
});

/* D1: provider player (iframe) sources ------------------------------------------------------------ */

const PLAYER = 'https://player.example.test';
const P_ATM = `${PLAYER}/embed/live?track=atmos`;

/** Events::frame_block_warning() with the HEAD response replaced (no outside network in the test). */
function frameWarning(headers: Record<string, string> | 'error'): string {
  const php = headers === 'error'
    ? "new WP_Error( 'http_request_failed', 'x' )"
    : `array( 'headers' => json_decode( '${JSON.stringify(headers).replace(/'/g, "\\'")}', true ), 'response' => array( 'code' => 200, 'message' => 'OK' ), 'body' => '', 'cookies' => array(), 'filename' => null )`;
  return wpPhp<string>(DEV, `add_filter( 'pre_http_request', function () { return ${php}; } ); return WG_Live\\Events::frame_block_warning( '${P_ATM}' );`);
}

test.describe('D1', () => {
  test.beforeAll(() => {
    buyer = undefined;
    devShop = shop(DEV);
    setSettingsKeys(DEV, { deployment_mode: 'live', stream_hosts: ['stream.example.test'], player_origins: [PLAYER] });
    setMeta(DEV, eventId, HLS_EVENT(devShop.product));
  });

  test.afterAll(async () => {
    await buyer?.close();
    buyer = undefined;
    unshop(DEV, devShop);
    deleteUsersByLoginPrefix(DEV, `${prefix}-`);
  });

  test('D1: player origins keep only https origins (scheme, host, port)', () => {
    setSettingsKeys(DEV, { player_origins: ['HTTPS://Player.Example.TEST/', 'http://plain.example.test', 'https://x.example.test/embed', 'nope', 'https://ok.example.org:8443', 'https://ok.example.org:443'] });
    expect(wpPhp<string[]>(DEV, 'return WG_Live\\Settings::player_origins();')).toEqual(['https://player.example.test', 'https://ok.example.org:8443', 'https://ok.example.org']);
    setSettingsKeys(DEV, { player_origins: [PLAYER] });
  });

  test('D1: an iframe player page on an approved origin is stored; another origin or plain http is refused', async ({ browser }) => {
    const ctx = await adminContext(browser, DEV);
    try {
      const page = await ctx.newPage();
      await saveSource(page, { type: 'iframe', kind: 'iframe', atmos: P_ATM });
      expect(meta('source_type')).toBe('iframe');
      expect(meta('source_iframe_binaural')).toBe('');
      expect(meta('source_iframe_atmos')).toBe(P_ATM);
      await expect(page.locator('#wg-live-source-type')).toHaveValue('iframe');

      const other = await saveSource(page, { kind: 'iframe', atmos: 'https://evil.example.test/embed' });
      expect(other).toContain('播放器網域');
      expect(meta('source_iframe_atmos')).toBe(P_ATM);

      const plain = await saveSource(page, { kind: 'iframe', atmos: 'http://player.example.test/embed' });
      expect(plain).toContain('https');
      expect(meta('source_iframe_atmos')).toBe(P_ATM);
      // The hls playlist stays stored, but an iframe event never resolves it.
      expect(meta('source_hls_atmos')).toBe(GOOD);
    } finally {
      await ctx.close();
    }
  });

  test('D1: a buyer gets the player page with its origin; the hls URLs are ignored; binaural is not offered', async ({ browser }) => {
    const atmos = await buyerPlayback(browser, 'atmos');
    expect(atmos.json).toEqual({ kind: 'iframe', url: P_ATM, allowedOrigin: PLAYER });
    expect(atmos.cache).toMatch(/no-store/);
    expect(atmos.text).not.toContain('stream.example.test');
    const bin = await buyerPlayback(browser, 'binaural');
    expect(bin.json).toEqual({ kind: 'not_ready', reason: 'mode_unavailable' });
    expect(bin.text).not.toMatch(/http/);
  });

  test('D1: a guest gets not_entitled and no URL; an origin taken off the list stops resolving', async ({ browser }) => {
    const guest = await rest(DEV, `playback?event=${eventId}&mode=atmos`);
    expect(guest.json).toEqual({ kind: 'not_ready', reason: 'not_entitled' });
    expect(guest.text).not.toMatch(/http/);
    setSettingsKeys(DEV, { player_origins: ['https://other.example.test'] });
    expect((await buyerPlayback(browser, 'atmos')).json).toEqual({ kind: 'not_ready', reason: 'source_not_configured' });
    setSettingsKeys(DEV, { player_origins: [PLAYER] });
  });

  test('D1: the public event says iframe in live mode and no player URL reaches any page', async () => {
    const one = await rest(DEV, `events/${prefix}-concert`);
    expect(one.json.event.sourceKind).toBe('iframe');
    const bodies = [one.text, (await rest(DEV, 'events')).text, (await fetchText(DEV, `/live/listen/?wg_event=${prefix}-concert`)).text, (await fetchText(DEV, '/live/')).text];
    for (const body of bodies) for (const n of ['player.example.test', P_ATM]) expect(body).not.toContain(n);
  });

  test('D1: a player page that forbids framing gets a warning, which never blocks the save', () => {
    const blocked = '此播放器頁面不允許被嵌入本站，請聯絡串流服務商';
    expect(frameWarning({ 'x-frame-options': 'DENY' })).toContain(blocked);
    expect(frameWarning({ 'x-frame-options': 'SAMEORIGIN' })).toContain(blocked);
    expect(frameWarning({ 'content-security-policy': "frame-ancestors 'none'" })).toContain(blocked);
    expect(frameWarning({ 'content-security-policy': "frame-ancestors 'self'" })).toContain(blocked);
    expect(frameWarning({ 'content-security-policy': 'frame-ancestors http://localhost:8888 https://sounds.example.test' })).toBe('');
    expect(frameWarning({ 'content-security-policy': 'frame-ancestors *' })).toBe('');
    expect(frameWarning({})).toBe('');
    expect(frameWarning('error')).toBe('');
  });
});
