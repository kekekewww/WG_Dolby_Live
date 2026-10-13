/**
 * Video is the default media kind: every concert is streamed with video, and the M1 demo plays a real clip
 * (demo-video-1.mp4 binaural, demo-video-2.mp4 atmos, H.264 + AAC 960x540). Runs on the Vite dev harness in
 * Chromium, Firefox and WebKit; the built bundle has its own run in video.dist.spec.ts.
 *
 * What the DemoAdapter proves here is the UI flow only: the clips are labelled 操作示範影片 and the status panel keeps
 * 操作示範音訊，非 Binaural／Atmos 驗證素材 (CLAUDE.md, spec 5.2) in both modes.
 */
import { test } from '@playwright/test';
import { asAudioEvent, DEMO_MEDIA, expect, gotoPlayer, isMediaUrl, mediaRequestsObservable, mediaStats, MODE_NAME, recordRequests, trackMediaElements, TONE, watchErrors } from './helpers';

test.describe.configure({ timeout: 90_000 });

const DEMO_NOTICE = '操作示範音訊，非 Binaural／Atmos 驗證素材';

test('the live demo event renders exactly one <video playsinline> in the stage and no <audio>', async ({ page }) => {
  const errors = watchErrors(page);
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await expect(p.view).toHaveAttribute('data-media-kind', 'video');
  await expect(p.root.locator('.wg-live__stage video')).toHaveCount(1);
  await expect(p.root.locator('audio')).toHaveCount(0);
  await expect(p.media).toHaveCount(1);
  const attrs = await p.media.evaluate((v: HTMLMediaElement) => ({
    tag: v.tagName,
    playsinline: v.hasAttribute('playsinline'),
    preload: v.getAttribute('preload'),
    autoplay: v.autoplay,
    controls: v.hasAttribute('controls'),
    src: v.hasAttribute('src'),
    sources: v.querySelectorAll('source').length,
    poster: v.getAttribute('poster'),
    paused: v.paused,
  }));
  expect(attrs).toMatchObject({ tag: 'VIDEO', playsinline: true, preload: 'none', autoplay: false, controls: false, src: false, sources: 0, paused: true });
  expect(attrs.poster, 'the demo poster is the video poster').toMatch(/poster/);
  // The 16:9 stage is the hero and holds the one element.
  const ratio = await p.root.locator('.wg-live__stage').evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  expect(ratio).toBeGreaterThan(1.7);
  expect(ratio).toBeLessThan(1.85);
  // Nothing is requested before the user presses Start.
  expect(media.count()).toBe(0);
  expect(errors).toEqual([]);
});

test('Start plays a real picture: currentTime advances, videoWidth is 960, binaural = demo-video-1.mp4', async ({ page, browserName }) => {
  const errors = watchErrors(page);
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  const info = await p.media.evaluate((v: HTMLVideoElement) => ({
    width: v.videoWidth,
    height: v.videoHeight,
    src: v.currentSrc,
    paused: v.paused,
    muted: v.muted,
    duration: v.duration,
    // Draw the current frame to a small canvas (same origin, so it is not tainted): a decoded picture has several colours.
    colours: (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 54;
      const ctx = canvas.getContext('2d');
      if (!ctx) return -1;
      ctx.drawImage(v, 0, 0, 96, 54);
      const data = ctx.getImageData(0, 0, 96, 54).data;
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
      return seen.size;
    })(),
  }));
  if (browserName === 'webkit') {
    // Playwright's WebKit reports the element's layout size as videoWidth (it follows the stage, not the file), so
    // only the picture's existence and 16:9 shape are asserted there; Chromium and Firefox give the file's own size.
    expect(info.width).toBeGreaterThan(0);
    expect(info.width / info.height).toBeGreaterThan(1.7);
    expect(info.width / info.height).toBeLessThan(1.85);
  } else {
    expect(info.width, 'a real 960-wide picture is decoded').toBe(960);
    expect(info.height).toBe(540);
  }
  expect(info.colours, 'the current frame is a real picture, not a blank surface').toBeGreaterThan(3);
  expect(info.paused).toBe(false);
  expect(info.src).toMatch(/\/demo\/demo-video-1\.mp4(?:\?ver=.+)?$/);
  expect(info.duration).toBeGreaterThan(20);
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  await expect(p.statusTitle).toHaveText('播放中');
  await expect(p.demoNotice).toHaveText(DEMO_NOTICE);
  await expect(p.media).toHaveCount(1);
  if (mediaRequestsObservable(browserName)) {
    expect(media.count(DEMO_MEDIA.binaural), 'the binaural clip was requested').toBeGreaterThanOrEqual(1);
    expect(media.count(DEMO_MEDIA.atmos)).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('a confirmed switch to atmos plays demo-video-2.mp4 in the same single <video>; 目前播放 follows only after the new source plays', async ({ page, browserName }) => {
  await trackMediaElements(page);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await p.media.evaluate((v: HTMLMediaElement) => {
    (v as unknown as { __wgSame: boolean }).__wgSame = true;
  });
  expect(await p.media.evaluate((v: HTMLMediaElement) => v.currentSrc)).toContain(DEMO_MEDIA.binaural);

  // Record every change of the 目前播放 label together with what the element was doing at that moment.
  await page.evaluate(() => {
    const w = window as unknown as { __labels: Array<{ text: string; src: string; paused: boolean; ready: number }> };
    w.__labels = [];
    const label = document.querySelector('.wg-live__mode-label') as HTMLElement;
    const video = document.querySelector('.wg-live__stage video') as HTMLVideoElement;
    new MutationObserver(() => {
      w.__labels.push({ text: label.textContent ?? '', src: video.currentSrc, paused: video.paused, ready: video.readyState });
    }).observe(label, { childList: true, characterData: true, subtree: true });
  });

  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  await expect(p.modeLabel).toHaveText(`目前播放：${MODE_NAME.atmos}`, { timeout: 15_000 });
  await p.expectAdvancing(0.2);

  const labels = await page.evaluate(() => (window as unknown as { __labels: Array<{ text: string; src: string; paused: boolean; ready: number }> }).__labels);
  const nowPlayingAtmos = `目前播放：${MODE_NAME.atmos}`;
  const atmosFirst = labels.find((l) => l.text === nowPlayingAtmos);
  expect(atmosFirst, `label changes: ${JSON.stringify(labels)}`).toBeDefined();
  // While the switch is in flight the label may say something else (e.g. a switching text), never 目前播放 of the new mode.
  expect(atmosFirst?.src, 'the label said Atmos only once the element was on the new source').toContain(DEMO_MEDIA.atmos);
  expect(atmosFirst?.paused).toBe(false);
  expect(atmosFirst?.ready, 'and the new source had data').toBeGreaterThanOrEqual(2);
  for (const l of labels.filter((x) => x.text === `目前播放：${MODE_NAME.binaural}`)) expect(l.src, 'the Binaural label never sits on the atmos clip').not.toContain(DEMO_MEDIA.atmos);

  expect(await p.media.evaluate((v: HTMLMediaElement) => v.currentSrc)).toContain(DEMO_MEDIA.atmos);
  if (browserName !== 'webkit') expect(await p.media.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(960);
  expect(await p.media.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await expect(p.media, 'still exactly one media element').toHaveCount(1);
  expect(await p.media.evaluate((v: HTMLMediaElement) => (v as unknown as { __wgSame?: boolean }).__wgSame), 'the same element, never rebuilt').toBe(true);
  const stats = await mediaStats(page);
  expect(stats.inDom).toBe(1);
  expect(stats.audibleNow, 'only one media element plays').toBeLessThanOrEqual(1);
  await expect(p.demoNotice, 'the demo notice stays in the other mode').toHaveText(DEMO_NOTICE);
});

test('the demo notice is shown in both modes, before and during playback', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.radio('binaural').check();
  await expect(p.demoNotice).toHaveText(DEMO_NOTICE);
  await p.radio('atmos').check();
  await expect(p.demoNotice).toHaveText(DEMO_NOTICE);
  await p.primary.click();
  await p.expectAdvancing();
  await expect(p.demoNotice).toHaveText(DEMO_NOTICE);
  await expect(p.modeLabel).toHaveText(`目前播放：${MODE_NAME.atmos}`);
  expect(await p.media.evaluate((v: HTMLMediaElement) => v.currentSrc)).toContain(DEMO_MEDIA.atmos);
});

test('the fullscreen button shows while a video plays and never for an audio event', async ({ page, browserName }) => {
  const p = await gotoPlayer(page);
  const fullscreen = p.root.locator('.wg-live__fullscreen');
  await expect(fullscreen).toBeHidden(); // nothing engaged yet
  await p.start('binaural');
  await p.expectAdvancing();
  // Feature detection decides (never the browser name): Chromium and Firefox always offer it; Playwright's WebKit may not.
  const supported = await p.media.evaluate(
    (v: HTMLVideoElement) =>
      document.fullscreenEnabled !== false && (typeof v.requestFullscreen === 'function' || typeof (v as unknown as { webkitEnterFullscreen?: unknown }).webkitEnterFullscreen === 'function'),
  );
  if (browserName !== 'webkit') expect(supported).toBe(true);
  if (supported) await expect(fullscreen).toBeVisible();
  else await expect(fullscreen).toBeHidden();
});

test('an event overridden to audio gets an <audio>, the cover art and no fullscreen button', async ({ page }) => {
  await asAudioEvent(page);
  const media = recordRequests(page, isMediaUrl);
  const p = await gotoPlayer(page);
  await expect(p.view).toHaveAttribute('data-media-kind', 'audio');
  await expect(p.root.locator('audio')).toHaveCount(1);
  await expect(p.root.locator('video')).toHaveCount(0);
  await expect(p.root.locator('.wg-live__stage-art')).toHaveCount(1);
  await p.start('binaural');
  await p.expectAdvancing();
  expect(await p.media.evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(TONE.binaural);
  await expect(p.root.locator('.wg-live__fullscreen')).toBeHidden();
  await expect(p.demoNotice).toHaveText(DEMO_NOTICE);
  expect(media.count(DEMO_MEDIA.binaural), 'an audio event never requests the video clip').toBe(0);
});
