/**
 * Plan 7.4 F08: network failure. Bounded automatic retries (2 s, 5 s, 10 s), then `failed` with a
 * manual retry; a failed switch keeps the last good mode and offers to reload it, and never changes
 * the track silently (plan 6.5, 6.6).
 *
 * Time: the waits are driven with page.clock (runFor) so the whole retry ladder takes seconds.
 * The failing media request is a real one in every browser: the playback descriptor is rewritten to
 * point at a missing file (404), because WebKit media requests cannot be intercepted by page.route.
 * Chromium and Firefox additionally get the literal "route abort on the media URL" variant.
 */
import { test, type Page } from '@playwright/test';
import { breakModeUrl, EXPECTED_LOAD_FAILURES, expect, gotoPlayer, isMediaUrl, mediaRequestsObservable, recordRequests, DEMO_MEDIA, watchErrors, type Player } from './helpers';

test.describe.configure({ timeout: 120_000 });

const RECONNECTING = '連線暫時中斷，正在重新連線';
const MISSING = 'missing-video.mp4';

/** Run the three automatic retries (after 2 s, 5 s and 10 s) on the fake clock. */
async function runRetryLadder(page: Page, p: Player): Promise<void> {
  for (const delay of [2_000, 5_000, 10_000]) {
    await expect(p.view).toHaveAttribute('data-status', /^(reconnecting|switching)$/);
    await page.waitForTimeout(400); // the failing request of this attempt settles in real time
    await page.clock.runFor(delay + 50);
  }
  await expect(p.view).toHaveAttribute('data-status', 'failed');
}

test('F08 a media URL that fails: reconnecting, 3 bounded retries, then failed with a manual retry', async ({ page, browserName }) => {
  await page.clock.install();
  const errors = watchErrors(page, EXPECTED_LOAD_FAILURES);
  await breakModeUrl(page, 'binaural');
  const media = recordRequests(page, (u) => u.includes(MISSING));
  const p = await gotoPlayer(page);
  await p.start('binaural');

  // First failure: reconnecting copy, announced, the label does not claim playback.
  await expect(p.view).toHaveAttribute('data-status', 'reconnecting');
  await expect(p.statusTitle).toHaveText(RECONNECTING);
  await expect(p.modeLabel).toHaveText('已選擇：Binaural');
  await expect(p.srStatus).toHaveText(RECONNECTING);
  await expect(p.demoNotice).toBeVisible();
  await expect(p.primary, 'pause stays available while reconnecting').toHaveText('暫停');

  await runRetryLadder(page, p);

  // Terminal state: a generic public code (no URL), 重試 available, no overlapping elements.
  await expect(p.errorCode).toHaveText('錯誤代碼：E-NET-01');
  await expect(p.errorCode).not.toContainText('http');
  await expect(p.action('重試')).toBeVisible();
  await expect(p.srStatus).toHaveText('無法播放，請重試');
  await expect(p.media).toHaveCount(1);
  await expect(p.modeLabel).toHaveText('已選擇：Binaural');
  if (mediaRequestsObservable(browserName)) {
    // 1 initial attempt + exactly 3 automatic retries, and nothing after that.
    await expect.poll(() => media.count()).toBe(4);
    await page.clock.runFor(60_000);
    await page.waitForTimeout(500);
    expect(media.count(), 'no request after the retries are used up').toBe(4);
  } else {
    await page.clock.runFor(60_000);
  }
  await expect(p.view).toHaveAttribute('data-status', 'failed');
  expect(errors).toEqual([]);
});

test('F08 the final failure says it cannot play (not "reconnecting") and keeps the code private', async ({ page }) => {
  await page.clock.install();
  await breakModeUrl(page, 'atmos');
  const p = await gotoPlayer(page);
  await p.start('atmos');
  await runRetryLadder(page, p);
  await expect(p.statusTitle, 'help page: 重試後仍無法播放時，會顯示「無法播放，請重試」').toHaveText('無法播放，請重試');
  await expect(p.errorCode).toHaveText('錯誤代碼：E-NET-01');
  await expect(p.srStatus).toContainText('無法播放，請重試');
});

test('F08 a failed Atmos start offers 改用耳機 Binaural and never switches silently', async ({ page }) => {
  await page.clock.install();
  await breakModeUrl(page, 'atmos');
  const p = await gotoPlayer(page);
  await p.start('atmos');
  await runRetryLadder(page, p);

  await expect(p.action('重試')).toBeVisible();
  await expect(p.action('改用耳機 Binaural')).toBeVisible();
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.hasAttribute('src')), 'the broken source is released').toBe(false);
  await expect(p.modeLabel, 'still the chosen mode, not changed by the failure').toHaveText('已選擇：Dolby Atmos 音軌');
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);

  // The explicit click on the fallback is the only thing that changes the track.
  await p.action('改用耳機 Binaural').click();
  await p.expectAdvancing(0.2);
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(DEMO_MEDIA.binaural);
  await expect(p.media).toHaveCount(1);
});

test('F08 manual 重試 after the retries are used up starts a fresh bounded attempt', async ({ page, browserName }) => {
  await page.clock.install();
  await breakModeUrl(page, 'binaural');
  const media = recordRequests(page, (u) => u.includes(MISSING));
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await runRetryLadder(page, p);
  const before = media.count();

  await p.action('重試').click();
  await expect(p.view).toHaveAttribute('data-status', /^(loading|reconnecting)$/);
  await runRetryLadder(page, p);
  if (mediaRequestsObservable(browserName)) {
    await expect.poll(() => media.count()).toBe(before + 4);
  }
});

test('F08 a failed switch keeps the last good mode and offers 重新載入 Binaural (the old mode comes back on request)', async ({ page }) => {
  await page.clock.install();
  await breakModeUrl(page, 'atmos');
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();

  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  await expect(p.view).toHaveAttribute('data-status', /^(switching|failed)$/);
  await runRetryLadder(page, p);

  await expect(p.statusDetail).toContainText('切換失敗，仍保留原模式：Binaural');
  // The code is shown once, as the small print under the actions, not repeated in the detail line.
  await expect(p.errorCode).toHaveText('錯誤代碼：E-NET-01');
  await expect(p.statusDetail).not.toContainText('E-NET-01');
  await expect(p.action('重新載入Binaural')).toBeVisible();
  await expect(p.action('改用耳機 Binaural')).toBeVisible();
  await expect(p.srStatus).toContainText('切換失敗，仍保留原模式：Binaural');
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused), 'nothing plays after the failed switch').toBe(true);
  await expect(p.media).toHaveCount(1);

  await p.action('重新載入Binaural').click();
  await p.expectAdvancing(0.2);
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(DEMO_MEDIA.binaural);
  await expect(p.action('重新載入Binaural')).toBeHidden();
});

test('F08 dev panel network fault: the first attempt fails, the automatic retry after 2 s plays (real time)', async ({ page }) => {
  const p = await gotoPlayer(page);
  const { fault } = await p.openDevPanel();
  await fault.selectOption({ label: '網路中斷' });
  await p.start('binaural');
  await expect(p.statusTitle).toHaveText(RECONNECTING);
  await expect(p.view).toHaveAttribute('data-status', 'reconnecting');
  await p.expectAdvancing(0.2); // the 2 s retry succeeds because the fault is one-shot
  await expect(p.statusTitle).toHaveText('播放中');
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  await expect(p.media).toHaveCount(1);
});

test('F08 dev panel decode / unsupported faults fail at once without retries', async ({ page }) => {
  for (const [option, code] of [
    ['解碼失敗', 'E-DEC-01'],
    ['不支援的來源', 'E-SRC-01'],
  ] as const) {
    const p = await gotoPlayer(page);
    const { fault } = await p.openDevPanel();
    await fault.selectOption({ label: option });
    await p.start('binaural');
    await expect(p.view).toHaveAttribute('data-status', 'failed');
    await expect(p.statusTitle).toHaveText('目前環境無法播放這個音訊版本');
    await expect(p.errorCode).toHaveText(`錯誤代碼：${code}`);
    await expect(p.srStatus).toContainText('播放失敗');
    await page.reload();
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
  }
});

test.describe('route abort on the media URL (Chromium and Firefox)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'WebKit media requests are not interceptable by page.route');

  test('F08 aborting the media URL: reconnecting, bounded retries, failed; unrouting and 重試 recovers', async ({ page }) => {
    await page.clock.install();
    const errors = watchErrors(page, EXPECTED_LOAD_FAILURES);
    let aborted = 0;
    await page.route(/\/demo\/demo-video-1\.mp4/, async (route) => {
      aborted += 1;
      await route.abort('failed');
    });
    const media = recordRequests(page, isMediaUrl);
    const p = await gotoPlayer(page);
    await p.start('binaural');

    await expect(p.view).toHaveAttribute('data-status', 'reconnecting');
    await expect(p.statusTitle).toHaveText(RECONNECTING);
    await runRetryLadder(page, p);
    expect(aborted, '1 attempt + 3 retries').toBe(4);
    expect(media.count(DEMO_MEDIA.atmos)).toBe(0);
    await expect(p.errorCode).toHaveText('錯誤代碼：E-NET-01');

    // The network comes back: 重試 plays the same mode, from the start.
    await page.unroute(/\/demo\/demo-video-1\.mp4/);
    await p.action('重試').click();
    await p.expectAdvancing(0.2);
    await expect(p.modeLabel).toHaveText('目前播放：Binaural');
    await expect(p.media).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('F08 the network returns during the ladder: the retry plays and the budget does not leak', async ({ page }) => {
    await page.clock.install();
    let failures = 0;
    await page.route(/\/demo\/demo-video-2\.mp4/, async (route) => {
      failures += 1;
      if (failures <= 2) await route.abort('connectionreset');
      else await route.continue();
    });
    const p = await gotoPlayer(page);
    await p.start('atmos');
    await expect(p.view).toHaveAttribute('data-status', 'reconnecting');
    await page.waitForTimeout(400);
    await page.clock.runFor(2_050); // retry 1 fails too
    await page.waitForTimeout(400);
    await page.clock.runFor(5_050); // retry 2 succeeds
    await expect(p.view).toHaveAttribute('data-status', 'playing');
    await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
    expect(failures).toBe(3);
  });
});
