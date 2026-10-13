/**
 * Plan 7.4 F06: rapid clicks on Start and on the switch flow never yield two media elements or two
 * audible sources. Every media element that ever plays is tracked (including detached ones).
 */
import { test } from '@playwright/test';
import { expect, gotoPlayer, isMediaUrl, mediaRequestsObservable, mediaStats, recordRequests, DEMO_MEDIA, trackMediaElements, watchErrors } from './helpers';

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await trackMediaElements(page);
});

test('F06 ten synchronous clicks on 開始聆聽 start exactly one stream', async ({ page, browserName }) => {
  const errors = watchErrors(page);
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.choose('binaural');
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.wg-live__play');
    if (!button) throw new Error('no start button');
    for (let i = 0; i < 10; i++) button.click();
  });
  await p.expectAdvancing();
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  const stats = await mediaStats(page);
  expect(stats).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
  if (mediaRequestsObservable(browserName)) expect(media.count(DEMO_MEDIA.binaural)).toBe(1);
  expect(errors).toEqual([]);
});

test('F06 double and triple clicks with the real mouse', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.choose('atmos');
  await p.primary.click({ clickCount: 3, delay: 20 });
  await p.expectAdvancing();
  expect(await mediaStats(page)).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
});

test('F06 changing the mode quickly before Start plays the last choice only', async ({ page, browserName }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.choose('atmos');
  await p.choose('binaural');
  await p.choose('atmos');
  await p.choose('binaural');
  await p.primary.click();
  await p.expectAdvancing();
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(DEMO_MEDIA.binaural);
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  if (mediaRequestsObservable(browserName)) expect(media.count(DEMO_MEDIA.atmos), 'selecting never loads media').toBe(0);
  expect(await mediaStats(page)).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
});

test('F06 switch: confirming repeatedly in one tick switches once; the trigger ignores clicks while switching', async ({ page, browserName }) => {
  const errors = watchErrors(page);
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();

  await page.evaluate(() => {
    const trigger = document.querySelector<HTMLButtonElement>('.wg-live__modebar .wg-live__switch');
    if (!trigger) throw new Error('no switch button');
    trigger.click(); // opens the dialog
    const confirm = document.querySelector<HTMLButtonElement>('.wg-live__dialog-confirm');
    if (!confirm) throw new Error('no confirm button');
    for (let i = 0; i < 6; i++) confirm.click(); // only the first counts; the dialog closes
    // The status is `switching` now: the trigger is aria-disabled and must ignore further clicks.
    for (let i = 0; i < 6; i++) trigger.click();
  });

  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌', { timeout: 20_000 });
  await p.expectAdvancing(0.2);
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(DEMO_MEDIA.atmos);
  await expect(p.dialog).toBeHidden();
  const stats = await mediaStats(page);
  expect(stats.inDom).toBe(1);
  expect(stats.everPlayed, 'the same element carries both sources').toBe(1);
  expect(stats.audibleNow).toBe(1);
  if (mediaRequestsObservable(browserName)) {
    expect(media.count(DEMO_MEDIA.atmos), 'one request for the new source').toBe(1);
    expect(media.count(DEMO_MEDIA.binaural)).toBe(1);
  }
  expect(errors).toEqual([]);
});

test('F06 back-to-back switches never leave two audible sources', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  // Three switch flows fired without waiting; the ones that arrive during `switching` are ignored.
  await page.evaluate(() => {
    const trigger = document.querySelector<HTMLButtonElement>('.wg-live__modebar .wg-live__switch');
    const confirm = document.querySelector<HTMLButtonElement>('.wg-live__dialog-confirm');
    if (!trigger || !confirm) throw new Error('controls missing');
    for (let i = 0; i < 3; i++) {
      trigger.click();
      confirm.click();
    }
  });
  await expect.poll(() => p.view.getAttribute('data-status'), { timeout: 20_000 }).toBe('playing');
  await expect(p.modeLabel).toHaveText(/^目前播放：/);
  const label = (await p.modeLabel.textContent()) ?? '';
  const src = await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc);
  expect(label.includes('Atmos') ? src.includes(DEMO_MEDIA.atmos) : src.includes(DEMO_MEDIA.binaural), `label "${label}" must match src ${src}`).toBe(true);
  const stats = await mediaStats(page);
  expect(stats).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
});

test('F06 hammering pause/resume ends in a consistent state with one element', async ({ page }) => {
  const errors = watchErrors(page);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.wg-live__play');
    if (!button) throw new Error('no primary button');
    for (let i = 0; i < 11; i++) button.click();
  });
  // Settles as playing or paused (never stuck in loading), and the element agrees with the UI.
  await expect.poll(() => p.view.getAttribute('data-status'), { timeout: 15_000 }).toMatch(/^(playing|paused)$/);
  const status = await p.view.getAttribute('data-status');
  await page.waitForTimeout(500);
  const paused = await p.media.evaluate((a: HTMLMediaElement) => a.paused);
  expect(await p.view.getAttribute('data-status')).toBe(status);
  expect(paused).toBe(status === 'paused');
  const stats = await mediaStats(page);
  expect(stats.inDom).toBe(1);
  expect(stats.everPlayed).toBe(1);
  expect(errors).toEqual([]);
});

test('F06 Start pressed again while playing does nothing (the button is Pause)', async ({ page, browserName }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await expect(p.primary).toHaveText('暫停');
  expect(await mediaStats(page)).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
  if (mediaRequestsObservable(browserName)) expect(media.count(DEMO_MEDIA.binaural)).toBe(1);
});
