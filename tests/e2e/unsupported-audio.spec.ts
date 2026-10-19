/**
 * A source whose audio codec the browser cannot decode (E-AC-3, the codec of a Dolby Atmos file) must end in the
 * spec 6 「不支援來源」 state, not in a silent picture and not in an endless retry. Chrome, Brave, Firefox and
 * Playwright's Chromium/Firefox cannot decode E-AC-3 (canPlayType ""), Edge and WebKit can; each test decides what to
 * expect by feature detection, never by browser name (CLAUDE.md).
 *
 * The clip is tests/fixtures/media/eac3-test.mp4 (self-generated, H.264 + E-AC-3 5.1, served by the harness under
 * /demo/eac3-test.mp4). Two descriptors reach it:
 *   - with codecs in the mimeType: the adapter's canPlayType check refuses it before anything loads;
 *   - with a bare video/mp4: canPlayType says "maybe", the picture plays without sound and the adapter's
 *     silent-audio guard (webkitAudioDecodedByteCount / mozHasAudio, after 1.5 s of playback) reports it.
 * Mode actions: for an Atmos failure the mode switch is 改用耳機 Binaural (spec 5.4); the help link is 聆聽說明.
 */
import { test, type Page } from '@playwright/test';
import { DEMO_MEDIA, expect, gotoPlayer, mediaRequestsObservable, recordRequests, type Player } from './helpers';

test.describe.configure({ timeout: 120_000 });

const UNSUPPORTED = '目前環境無法播放這個音訊版本';
const CLIP = 'eac3-test.mp4';
const WITH_CODECS = 'video/mp4; codecs="avc1.42E01E, ec-3"';
const BARE = 'video/mp4';

/** Point the ATMOS descriptor at the E-AC-3 clip. */
async function routeAtmosToClip(page: Page, mimeType: string): Promise<void> {
  await page.route(/wg-live\/v1\/playback.*mode=atmos/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ kind: 'demo', url: `/demo/${CLIP}`, mimeType }),
    });
  });
}

/** Can this engine decode E-AC-3 in MP4? Feature detection, the same call the adapter makes. */
function decodesEac3(page: Page): Promise<boolean> {
  return page.evaluate((type) => document.createElement('video').canPlayType(type) !== '', WITH_CODECS);
}

async function expectUnsupportedState(p: Player): Promise<void> {
  await expect(p.view).toHaveAttribute('data-status', 'failed');
  await expect(p.statusTitle).toHaveText(UNSUPPORTED);
  await expect(p.errorCode).toHaveText('錯誤代碼：E-SRC-01');
  await expect(p.errorCode).not.toContainText('http');
  // The way out (spec 6): switch mode (for Atmos: 改用耳機 Binaural, spec 5.4) and the help link.
  await expect(p.action('改用耳機 Binaural')).toBeVisible();
  await expect(p.root.locator('.wg-live__status-actions').getByRole('link', { name: '聆聽說明' })).toBeVisible();
  await expect(p.action('重試'), 'an unsupported source is never retried').toBeHidden();
  await expect(p.media).toHaveCount(1);
  expect(await p.media.evaluate((m: HTMLMediaElement) => m.paused), 'nothing keeps playing').toBe(true);
  expect(await p.media.evaluate((m: HTMLMediaElement) => m.hasAttribute('src')), 'the source is released').toBe(false);
}

for (const [label, mimeType] of [
  ['with codecs in the mimeType', WITH_CODECS],
  ['with a bare video/mp4', BARE],
] as const) {
  test(`E-AC-3 clip ${label}: unsupported here, or plays where the engine decodes it`, async ({ page, browserName }) => {
    await routeAtmosToClip(page, mimeType);
    const clip = recordRequests(page, (u) => u.includes(CLIP));
    const p = await gotoPlayer(page);
    const supported = await decodesEac3(page);
    await p.start('atmos');

    if (supported) {
      // Past the guard's 1.5 s: an engine whose decode counters do not count (WebKit) must not be judged silent.
      await expect.poll(() => p.media.evaluate((m: HTMLMediaElement) => m.currentTime), { timeout: 20_000 }).toBeGreaterThan(1.8);
      await page.waitForTimeout(600);
      await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
      expect(await p.media.evaluate((m: HTMLMediaElement) => m.currentSrc)).toContain(CLIP);
      await expect(p.view).toHaveAttribute('data-status', 'playing');
      return;
    }

    await expectUnsupportedState(p);
    // No endless retry: nothing changes and (where requests are observable) nothing is requested again.
    const requests = clip.count();
    await page.waitForTimeout(3_500);
    await expect(p.view).toHaveAttribute('data-status', 'failed');
    if (mediaRequestsObservable(browserName)) expect(clip.count(), 'no request after the failure').toBe(requests);
    await expect(p.modeLabel, 'the failed mode is never claimed as playing').not.toContainText('目前播放');

    // The explicit fallback is the only thing that changes the track, and it plays.
    await p.action('改用耳機 Binaural').click();
    await p.expectAdvancing(0.2);
    await expect(p.modeLabel).toHaveText('目前播放：Binaural');
    expect(await p.media.evaluate((m: HTMLMediaElement) => m.currentSrc)).toContain(DEMO_MEDIA.binaural);
    await expect(p.media).toHaveCount(1);
  });
}

test('a switch to the E-AC-3 clip fails the same way and keeps Binaural as the last good mode', async ({ page }) => {
  // The bare type is the harder path: the picture starts, so the state passes through `playing` before the guard.
  await routeAtmosToClip(page, BARE);
  const p = await gotoPlayer(page);
  const supported = await decodesEac3(page);
  await p.start('binaural');
  await p.expectAdvancing();

  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();

  if (supported) {
    await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
    return;
  }

  await expectUnsupportedState(p);
  await expect(p.statusDetail).toContainText('切換失敗，仍保留原模式：Binaural');
  await expect(p.action('重新載入Binaural')).toBeVisible();
  await expect(p.modeLabel, 'nothing is claimed as playing').not.toContainText('目前播放');

  await p.action('重新載入Binaural').click();
  await p.expectAdvancing(0.2);
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
});
