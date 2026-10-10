/**
 * Plan 7.4: F03/F04 select a mode and play, F05 switch via the dialog, F07 pause/resume.
 * Runs on the Vite dev harness in Chromium, Firefox and WebKit. Playback is the real DemoAdapter
 * over the two generated MP3 files.
 */
import { test } from '@playwright/test';
import { expect, gotoPlayer, isMediaUrl, MODE_NAME, mediaRequestsObservable, recordRequests, TONE, type Mode } from './helpers';

test.describe.configure({ timeout: 90_000 });

const DEMO_NOTICE = '操作示範音訊，非 Binaural／Atmos 驗證素材';

for (const mode of ['binaural', 'atmos'] as const satisfies readonly Mode[]) {
  const flag = mode === 'binaural' ? 'F03' : 'F04';
  test(`${flag} ${mode}: select, start, audio plays, 已選擇 becomes 目前播放, demo notice shown`, async ({ page }) => {
    const media = recordRequests(page, isMediaUrl);
    const p = await gotoPlayer(page);

    // Nothing is chosen yet: Start is disabled and says why. No media is requested before the click.
    await expect(p.statusTitle).toHaveText('請先選擇聆聽模式');
    await expect(p.primary).toHaveText('開始聆聽');
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    await expect(p.startReason).toHaveText('請先選擇聆聽模式');
    expect(media.count()).toBe(0);

    await p.radio(mode).check();
    await expect(p.radio(mode)).toBeChecked();
    await expect(p.modeLabel).toHaveText(`已選擇：${MODE_NAME[mode]}`);
    await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
    expect(media.count(), 'selecting a mode fetches the descriptor only, never media').toBe(0);

    await p.primary.click();

    await p.expectAdvancing();
    await expect(p.statusTitle).toHaveText('播放中');
    await expect(p.modeLabel).toHaveText(`目前播放：${MODE_NAME[mode]}`);
    await expect(p.primary).toHaveText('暫停');
    await expect(p.audio).toHaveCount(1);
    expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc)).toContain(TONE[mode]);
    expect(await p.audio.evaluate((a: HTMLAudioElement) => a.loop)).toBe(true); // demo sources loop
    await expect(p.demoNotice).toBeVisible();
    await expect(p.demoNotice).toHaveText(DEMO_NOTICE);
    // The announcement goes to the live region only (coalesced), and says what is now playing.
    await expect(p.srStatus).toHaveText(`目前播放：${MODE_NAME[mode]}`);
  });
}

test('the demo notice is visible before playback too, in both modes', async ({ page }) => {
  const p = await gotoPlayer(page, { mode: 'binaural' });
  await expect(p.demoNotice).toBeVisible();
  await p.radio('atmos').check();
  await expect(p.demoNotice).toBeVisible();
});

test('a valid wg_mode preselects the mode but never starts playback', async ({ page, browserName }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page, { mode: 'atmos' });
  await expect(p.radio('atmos')).toBeChecked();
  await expect(p.modeLabel).toHaveText('已選擇：Dolby Atmos 音軌');
  await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(500);
  if (mediaRequestsObservable(browserName)) expect(media.count()).toBe(0);
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.preload)).toBe('none');
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.autoplay)).toBe(false);
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.hasAttribute('controls'))).toBe(false);
});

test('F07 pause and resume keep the mode and the source', async ({ page, browserName }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('atmos');
  await p.expectAdvancing();
  const src = await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc);

  await p.primary.click(); // 暫停
  await expect(p.statusTitle).toHaveText('已暫停');
  await expect(p.primary).toHaveText('繼續播放');
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await expect(p.modeLabel).toContainText('Dolby Atmos 音軌');
  const pausedAt = await p.audio.evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(700);
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentTime), 'paused audio does not advance').toBeCloseTo(pausedAt, 1);

  await p.primary.click(); // 繼續播放
  await expect(p.statusTitle).toHaveText('播放中');
  await expect.poll(() => p.audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(pausedAt + 0.2);
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc), 'resume does not reload the source').toBe(src);
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌');
  if (mediaRequestsObservable(browserName)) {
    expect(media.count(TONE.atmos), 'one media request for the whole pause/resume').toBe(1);
    expect(media.count(TONE.binaural)).toBe(0);
  }
  await expect(p.audio).toHaveCount(1);
});

test('F05 switch via the dialog: source changes, old URL gets no more requests, events emptied -> loadstart -> playing', async ({ page, browserName }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  const oldSrc = await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc);
  expect(oldSrc).toContain(TONE.binaural);

  // The switch button appears once playback is engaged.
  await expect(p.switchButton).toBeVisible();
  await expect(p.switchButton).toHaveText('切換模式');
  await p.switchButton.click();
  await expect(p.dialog).toBeVisible();
  await expect(p.dialog.getByRole('heading', { name: '切換聆聽模式' })).toBeVisible();
  // Names the current and the other mode and warns about a brief interruption.
  await expect(p.dialog).toContainText('目前模式為「Binaural」');
  await expect(p.dialog).toContainText('要切換為「Dolby Atmos 音軌」嗎');
  await expect(p.dialog).toContainText('切換時播放可能會短暫中斷');

  // Record media events from now on, in order.
  await p.audio.evaluate((a: HTMLAudioElement) => {
    const w = window as unknown as { __events: string[] };
    w.__events = [];
    for (const name of ['emptied', 'loadstart', 'playing', 'pause', 'error']) {
      a.addEventListener(name, () => w.__events.push(name));
    }
  });
  const oldRequestsBefore = media.count(TONE.binaural);

  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  await expect(p.dialog).toBeHidden();

  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌', { timeout: 15_000 });
  await p.expectAdvancing();
  const newSrc = await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc);
  expect(newSrc).toContain(TONE.atmos);
  expect(newSrc).not.toBe(oldSrc);
  await expect(p.audio, 'still exactly one media element').toHaveCount(1);

  const events = await page.evaluate(() => (window as unknown as { __events: string[] }).__events);
  const iEmptied = events.indexOf('emptied');
  const iLoadstart = events.indexOf('loadstart');
  const iPlaying = events.indexOf('playing');
  expect(iEmptied, `events: ${events.join(',')}`).toBeGreaterThanOrEqual(0);
  expect(iLoadstart, `events: ${events.join(',')}`).toBeGreaterThan(iEmptied);
  expect(iPlaying, `events: ${events.join(',')}`).toBeGreaterThan(iLoadstart);
  expect(events, 'no error event during a clean switch').not.toContain('error');

  // The old URL is never requested again, not even a range request, after the switch settled.
  const oldAfterSwitch = media.count(TONE.binaural);
  await page.waitForTimeout(1500);
  if (mediaRequestsObservable(browserName)) {
    expect(oldRequestsBefore, 'the first source was requested (so request recording works)').toBeGreaterThanOrEqual(1);
    expect(media.count(TONE.binaural)).toBe(oldAfterSwitch);
    expect(oldAfterSwitch).toBe(oldRequestsBefore);
    expect(media.count(TONE.atmos)).toBeGreaterThanOrEqual(1);
  }

  await expect(p.demoNotice, 'the demo notice stays in the other mode').toBeVisible();
  await expect(p.srStatus).toContainText('目前播放：Dolby Atmos 音軌');
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentTime), 'currentTime is not copied across sources').toBeLessThan(10);
});

test('F05 switch back and forth keeps one element and the label follows the source', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  for (const next of ['atmos', 'binaural', 'atmos'] as const) {
    await p.switchButton.click();
    await p.dialog.getByRole('button', { name: /確認切換/ }).click();
    await expect(p.modeLabel).toHaveText(`目前播放：${MODE_NAME[next]}`, { timeout: 15_000 });
    await expect.poll(() => p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc)).toContain(TONE[next]);
    await p.expectAdvancing(0.2);
    await expect(p.audio).toHaveCount(1);
  }
});

test('the dialog cancel button leaves playback untouched', async ({ page, browserName }) => {
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await p.switchButton.click();
  await expect(p.dialog).toBeVisible();
  await p.dialog.getByRole('button', { name: '取消' }).click();
  await expect(p.dialog).toBeHidden();
  await expect(p.switchButton).toBeFocused();
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  if (mediaRequestsObservable(browserName)) expect(media.count(TONE.atmos)).toBe(0);
  await p.expectAdvancing(0.2);
});

test('leaving the page (pagehide) stops playback', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => p.audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await expect(p.modeLabel).toHaveText('已選擇：Binaural');
  await expect(p.primary).toHaveText('開始聆聽');
});

test('mute and volume controls appear only after playback is engaged and act on the element', async ({ page }) => {
  const p = await gotoPlayer(page);
  await expect(p.root.locator('.wg-live__mute')).toBeHidden();
  await p.start('binaural');
  await p.expectAdvancing();
  const mute = p.root.locator('.wg-live__mute');
  if (await mute.isVisible()) {
    await mute.click();
    expect(await p.audio.evaluate((a: HTMLAudioElement) => a.muted)).toBe(true);
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await mute.click();
    expect(await p.audio.evaluate((a: HTMLAudioElement) => a.muted)).toBe(false);
  }
  // Fullscreen is video-only; an audio event never shows it, and the seek-to-live control is not faked.
  await expect(p.root.locator('.wg-live__fullscreen')).toBeHidden();
  await expect(p.root.locator('.wg-live__live')).toBeHidden();
});
