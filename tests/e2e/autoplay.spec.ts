/**
 * Plan 7.4 F09: autoplay blocked. The first HTMLMediaElement.play() rejects with NotAllowedError (a
 * browser that refuses it); the UI says 請點擊開始聆聽, never retries by itself, and one more click
 * resumes the already loaded source without a new descriptor request.
 */
import { test } from '@playwright/test';
import { blockFirstPlay, expect, gotoPlayer, isMediaUrl, mediaRequestsObservable, recordRequests, DEMO_MEDIA, watchErrors } from './helpers';

test.describe.configure({ timeout: 90_000 });

test('F09 a blocked play() shows 請點擊開始聆聽 and one click resumes', async ({ page, browserName }) => {
  await blockFirstPlay(page);
  const errors = watchErrors(page);
  const descriptors = recordRequests(page, (u) => /wg-live\/v1\/playback/.test(u));
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('binaural');

  await expect(p.statusTitle).toHaveText('請點擊開始聆聽');
  await expect(p.view).toHaveAttribute('data-status', 'paused');
  await expect(p.primary).toHaveText('開始聆聽');
  await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
  await expect(p.errorCode).toHaveText('錯誤代碼：E-PLY-01');
  await expect(p.modeLabel).toHaveText('已選擇：Binaural'); // never 目前播放 for audio that is not playing
  // Announced at once (urgent), not coalesced.
  await expect(p.srStatus).toHaveText('請點擊開始聆聽');
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);

  // No automatic retry follows a user-gesture problem.
  await page.waitForTimeout(2600);
  await expect(p.statusTitle).toHaveText('請點擊開始聆聽');
  expect(descriptors.count(), 'one descriptor fetch (the prefetch), none after the block').toBe(1);

  await p.primary.click();
  await p.expectAdvancing();
  await expect(p.statusTitle).toHaveText('播放中');
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  await expect(p.errorCode).toBeHidden();
  expect(descriptors.count(), 'resume calls play() on the loaded element; it does not resolve again').toBe(1);
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(DEMO_MEDIA.binaural);
  if (mediaRequestsObservable(browserName)) expect(media.count(DEMO_MEDIA.binaural)).toBe(1);
  await expect(p.media).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('F09 the dev-panel play_blocked fault behaves the same way', async ({ page }) => {
  const p = await gotoPlayer(page);
  const { fault } = await p.openDevPanel();
  await fault.selectOption({ label: '播放被瀏覽器阻擋' });
  await p.start('atmos');
  await expect(p.statusTitle).toHaveText('請點擊開始聆聽');
  await expect(p.primary).toHaveText('開始聆聽');
  await p.primary.click();
  await p.expectAdvancing();
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
});

test('F09 blocked play() while switching keeps the page consistent (one element, no overlap)', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  // From now on the next play() is refused once (the switch's play()).
  await page.evaluate(() => {
    const orig = HTMLMediaElement.prototype.play;
    let blocked = false;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!blocked) {
        blocked = true;
        return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      }
      return orig.call(this);
    };
  });
  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  await expect(p.statusTitle).toHaveText('請點擊開始聆聽');
  await p.primary.click();
  await p.expectAdvancing(0.2);
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
  await expect(p.media).toHaveCount(1);
});
