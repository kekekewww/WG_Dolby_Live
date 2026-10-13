/**
 * harness-dist (Chromium): the BUILT bundle plays the demo VIDEO (the default media kind): one <video playsinline>
 * in the 16:9 stage, a real 960x540 picture, demo-video-1.mp4 for binaural and demo-video-2.mp4 after a switch.
 * The dist server is the allowlist server of dev/serve-dist.mjs, so this also proves it serves the two mp4 files
 * with range support (a <video> seeks with Range requests).
 */
import { test } from '@playwright/test';
import { DEMO_MEDIA, expect, gotoPlayer, isMediaUrl, recordRequests, watchErrors } from './helpers';

test.describe.configure({ timeout: 90_000 });

test('the built bundle renders one <video> and plays the binaural clip with a real picture', async ({ page }) => {
  const errors = watchErrors(page);
  const p = await gotoPlayer(page, { base: 'dist' });
  await expect(p.view).toHaveAttribute('data-media-kind', 'video');
  await expect(p.root.locator('.wg-live__stage video')).toHaveCount(1);
  await expect(p.root.locator('audio')).toHaveCount(0);
  expect(await p.media.evaluate((v: HTMLMediaElement) => v.hasAttribute('playsinline'))).toBe(true);

  await p.start('binaural');
  await p.expectAdvancing();
  const info = await p.media.evaluate((v: HTMLVideoElement) => ({ width: v.videoWidth, height: v.videoHeight, src: v.currentSrc }));
  expect(info.width).toBe(960);
  expect(info.height).toBe(540);
  expect(info.src).toMatch(/\/demo\/demo-video-1\.mp4(?:\?ver=.+)?$/);
  await expect(p.demoNotice).toHaveText('操作示範音訊，非 Binaural／Atmos 驗證素材');
  expect(errors).toEqual([]);
});

test('the built bundle switches to the atmos clip in the same element and serves the mp4 with Range', async ({ page }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page, { base: 'dist' });
  await p.start('binaural');
  await p.expectAdvancing();
  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌', { timeout: 20_000 });
  await p.expectAdvancing(0.2);
  expect(await p.media.evaluate((v: HTMLMediaElement) => v.currentSrc)).toContain(DEMO_MEDIA.atmos);
  await expect(p.media).toHaveCount(1);
  expect(media.count(DEMO_MEDIA.atmos)).toBeGreaterThanOrEqual(1);

  // A range request for the clip answers 206 with the right type (Safari asks for ranges first).
  const res = await page.request.get(`/demo/${DEMO_MEDIA.binaural}`, { headers: { Range: 'bytes=0-1' } });
  expect(res.status()).toBe(206);
  expect(res.headers()['content-type']).toBe('video/mp4');
  expect(res.headers()['content-range']).toMatch(/^bytes 0-1\/\d+$/);
});
