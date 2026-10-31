/**
 * M2-PLAN C4: a real (hls) event end to end on the Vite dev harness (?harness=hls), playing the local fixture made by
 * `npm run demo:hls` (tests/.fixtures/hls: AAC stereo for Binaural, E-AC-3 5.1 for "Atmos" -- not Dolby Atmos).
 *
 * The harness answers /entitlement and /playback for the event `hls-fixture-live` as for a buyer, in deployment mode
 * live, and serves the plugin's own hls.js file (wg-live-hls.js) under /hls-lib/.
 *
 * Playwright WebKit is not Safari: there the path is recorded as an annotation, never asserted as Safari behaviour.
 * Edge (channel msedge) is an optional project (WG_E2E_EDGE=1): there Atmos must play with E-AC-3 decoded.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page } from '@playwright/test';
import { expect, gotoPlayer, recordRequests, watchErrors, type Player } from './helpers';

test.describe.configure({ timeout: 90_000 });

const SLUG = 'hls-fixture-live';
const UNSUPPORTED = '目前環境無法播放這個音訊版本';
const DEMO_NOTICE = '操作示範音訊，非 Binaural／Atmos 驗證素材';
const isPlaylist = (mode: 'binaural' | 'atmos') => (url: string): boolean => url.includes(`/hls/${mode}/`);

test.beforeAll(() => {
  expect(existsSync(resolve(import.meta.dirname, '..', '.fixtures', 'hls', 'binaural', 'index.m3u8')), 'run `npm run demo:hls` first').toBe(true);
});

async function open(page: Page): Promise<Player> {
  return gotoPlayer(page, { event: SLUG, harness: 'hls' });
}

/** What this engine says about the two decisions the adapter makes (recorded, never browser-sniffed). */
function probe(page: Page): Promise<{ native: string; mse: boolean; mms: boolean; ec3: boolean | null }> {
  return page.evaluate(() => {
    const v = document.createElement('video');
    const w = window as unknown as { MediaSource?: { isTypeSupported(t: string): boolean }; ManagedMediaSource?: { isTypeSupported(t: string): boolean } };
    const ms = w.ManagedMediaSource ?? w.MediaSource;
    return {
      native: v.canPlayType('application/vnd.apple.mpegurl'),
      mse: 'MediaSource' in window,
      mms: 'ManagedMediaSource' in window,
      ec3: ms ? ms.isTypeSupported('audio/mp4; codecs="ec-3"') : null,
    };
  });
}

function hlsCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __wgLiveHlsCount?: number }).__wgLiveHlsCount ?? 0);
}

test('the page is a real event: no demo labels, and no playlist is requested before Start', async ({ page }) => {
  const playlists = recordRequests(page, (u) => u.includes('/hls/'));
  const p = await open(page);
  await expect(p.title).toContainText('HLS');
  await expect(p.demoNotice).toBeHidden();
  const visibleText = await p.root.innerText();
  expect(visibleText).not.toContain(DEMO_NOTICE);
  expect(visibleText).not.toContain('介面示範');
  await p.choose('binaural');
  expect(playlists.count()).toBe(0);
});

test('Binaural plays through HLS: currentTime advances and audio is decoded', async ({ page, browserName }) => {
  const errors = watchErrors(page);
  const p = await open(page);
  const env = await probe(page);
  test.info().annotations.push({ type: 'hls-path', description: `${browserName}: ${JSON.stringify(env)}` });
  test.skip(browserName === 'webkit' && !env.mse && env.native === '', 'Playwright WebKit here has neither MSE nor native HLS (recorded, not Safari)');
  await p.start('binaural');
  await p.expectAdvancing(1);
  await expect(p.view).toHaveAttribute('data-status', 'playing');
  await expect(p.modeLabel).toContainText('Binaural');
  const decoded = await p.media.evaluate((v) => (v as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? null);
  if (decoded !== null) expect(decoded, 'audio bytes decoded (Chromium counter)').toBeGreaterThan(0);
  await expect(p.demoNotice).toBeHidden();
  expect(errors).toEqual([]);
});

test('Atmos without E-AC-3: 目前環境無法播放這個音訊版本 before any request for the atmos playlist (Review Focus 4)', async ({ page, browserName }) => {
  const p = await open(page);
  const env = await probe(page);
  test.info().annotations.push({ type: 'hls-path', description: `${browserName}: ${JSON.stringify(env)}` });
  test.skip(env.ec3 === true || (env.native !== '' && env.mms), 'this engine reports E-AC-3 support (Edge, Safari): covered by the Edge project');
  const atmos = recordRequests(page, isPlaylist('atmos'));
  await p.start('atmos');
  await expect(p.view).toHaveAttribute('data-status', 'failed');
  await expect(p.statusTitle).toHaveText(UNSUPPORTED);
  await expect(p.action('改用耳機 Binaural')).toBeVisible();
  await expect(p.radio('binaural')).toBeEnabled();
  expect(atmos.count(), 'no atmos playlist or segment was requested').toBe(0);
});

test('Binaural → Atmos → Binaural leaves one <video> and at most one hls.js instance', async ({ page, browserName }) => {
  const p = await open(page);
  const env = await probe(page);
  test.skip(browserName === 'webkit' && !env.mse && env.native === '', 'Playwright WebKit here has neither MSE nor native HLS');
  await p.start('binaural');
  await p.expectAdvancing(0.5);

  // → Atmos: plays where E-AC-3 decodes, else the honest unsupported state.
  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  await expect(p.view).toHaveAttribute('data-status', /^(playing|failed)$/, { timeout: 20_000 });
  await expect(p.media).toHaveCount(1);
  expect(await hlsCount(page)).toBeLessThanOrEqual(1);

  // → Binaural again.
  if ((await p.view.getAttribute('data-status')) === 'failed') {
    await p.action('改用耳機 Binaural').click();
  } else {
    await p.switchButton.click();
    await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  }
  await expect(p.view).toHaveAttribute('data-status', 'playing', { timeout: 20_000 });
  await p.expectAdvancing(0.5);
  await expect(p.modeLabel).toContainText('Binaural');
  await expect(page.locator('video')).toHaveCount(1);
  expect(await hlsCount(page)).toBe(env.native !== '' && env.mms ? 0 : 1);
});

test('Edge: Atmos plays with E-AC-3 decoded (msedge project only)', async ({ page }, info) => {
  test.skip(info.project.name !== 'harness-dev-msedge', 'Edge only (WG_E2E_EDGE=1 --project=harness-dev-msedge)');
  const p = await open(page);
  expect((await probe(page)).ec3).toBe(true);
  await p.start('atmos');
  await p.expectAdvancing(1);
  await expect(p.modeLabel).toContainText('Dolby Atmos 音軌');
  const decoded = await p.media.evaluate((v) => (v as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0);
  expect(decoded).toBeGreaterThan(0);
});
