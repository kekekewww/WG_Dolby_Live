/**
 * M2-PLAN B1–B3 and D1: admin-approved stream hosts and player origins, per-event HLS / iframe sources, the
 * stream signer, and /playback for real sources. Changes settings (shared state), so it runs in the *-state
 * projects and restores them afterwards.
 */
import { test, type Page } from '@playwright/test';
import { adminContext, bootConfigs, createEvents, deleteEventsByPrefix, deletePosts, DEV, expect, fetchText, getSettings, rest, setSettingsKeys, wpPhp } from './wp';

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
