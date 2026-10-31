/**
 * M2-PLAN B1–B3 and D1: admin-approved stream hosts and player origins, per-event HLS / iframe sources, the
 * stream signer, and /playback for real sources. Changes settings (shared state), so it runs in the *-state
 * projects and restores them afterwards.
 */
import { test, type Page } from '@playwright/test';
import { adminContext, bootConfigs, createEvents, deleteEventsByPrefix, deletePosts, DEV, expect, fetchText, getSettings, rest, setSettingsKeys, TESTS, wp, wpPhp } from './wp';

test.describe.configure({ mode: 'serial' });

const prefix = 'it-hls-state';
const GOOD = 'https://stream.example.test/live/atmos/playlist.m3u8';
const GOOD_BIN = 'https://stream.example.test/live/binaural/playlist.m3u8';
let snapshot: Record<string, unknown> = {};
let eventId = 0;

const meta = (key: string): string => wpPhp<string>(DEV, `return (string) get_post_meta( ${eventId}, '_wg_live_${key}', true );`);

async function saveSource(page: Page, fields: { type?: string; binaural?: string; atmos?: string }): Promise<string> {
  await page.goto(`/wp-admin/post.php?post=${eventId}&action=edit`);
  if (fields.type) await page.locator('#wg-live-source-type').selectOption(fields.type);
  if (fields.binaural !== undefined) await page.locator('#wg-live-source-hls-binaural').fill(fields.binaural);
  if (fields.atmos !== undefined) await page.locator('#wg-live-source-hls-atmos').fill(fields.atmos);
  await Promise.all([page.waitForURL(/post\.php\?post=\d+&action=edit&message=\d+/, { timeout: 120_000 }), page.locator('#publish').click()]);
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
    await saveSource(page, { type: 'hls', binaural: GOOD_BIN, atmos: GOOD });
    expect(meta('source_type')).toBe('hls');
    expect(meta('source_hls_atmos')).toBe(GOOD);
    expect(meta('source_hls_binaural')).toBe(GOOD_BIN);

    const refused = await saveSource(page, { atmos: 'https://elsewhere.example.test/a.m3u8' });
    expect(refused).toContain('串流主機');
    expect(meta('source_hls_atmos')).toBe(GOOD);

    const plain = await saveSource(page, { atmos: 'http://stream.example.test/a.m3u8' });
    expect(plain).toContain('https');
    expect(meta('source_hls_atmos')).toBe(GOOD);
  } finally {
    await ctx.close();
  }
});

test('B1: the playlist URLs never reach REST, the bootstrap or any page', async () => {
  // The event is also the homepage featured card for this check.
  setSettingsKeys(DEV, { deployment_mode: 'live', featured_event: eventId });
  const needles = ['stream.example.test', GOOD, GOOD_BIN];
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
