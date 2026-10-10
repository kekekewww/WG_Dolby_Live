/**
 * Boot and lifecycle on the Vite dev harness (plan 3.2, 6.8): mounting is idempotent, an Elementor-style
 * re-render replaces the instance without leaking a media element or listener, a second copy of the
 * bundle does not mount over the first, and the mounted markup matches the PHP contract (plan 3.1).
 *
 * The dev harness has no `window.WGLive` (Vite serves the ES module); the same module instance is
 * reached with a dynamic import of /src/main.ts. The built bundle's `WGLive` global is covered by
 * bundle.dist.spec.ts.
 */
import { test } from '@playwright/test';
import { expect, gotoPlayer, gotoView, isRestUrl, mediaStats, recordRequests, trackMediaElements, watchErrors } from './helpers';

test.describe.configure({ timeout: 90_000 });

// Evaluated in the page (Vite serves it); a variable keeps TypeScript from resolving the path on disk.
const MAIN_MODULE = '/src/main.ts';

test('the mounted container follows the plan 3.1 contract', async ({ page }) => {
  await gotoView(page, 'listen', { event: 'demo-live-binaural-atmos' });
  const root = page.locator('.wg-live');
  await expect(root).toHaveAttribute('data-wg-live-mounted', '1');
  await expect(root).toHaveAttribute('data-wg-live-view', 'player');
  await expect(root.locator('.wg-live__mount')).toHaveAttribute('aria-busy', 'false');
  await expect(root.locator('.wg-live__skeleton')).toHaveCount(0);
  // The live region sits outside the aria-busy subtree and starts empty.
  expect(await root.locator('.wg-live__sr-status').evaluate((el) => !el.closest('.wg-live__mount'))).toBe(true);
  await expect(root.locator('.wg-live__sr-status')).toHaveAttribute('role', 'status');
  await expect(root.locator('.wg-live__sr-status')).toHaveAttribute('aria-atomic', 'true');
  await expect(root.locator('.wg-live__sr-status')).toHaveText('');
  // The bootstrap JSON stays in the page, but nothing in the DOM exposes a source URL before Start.
  const html = await root.evaluate((el) => el.outerHTML);
  expect(html).not.toMatch(/demo-tone-[12]\.mp3/);
  await expect(root.locator('audio')).toHaveCount(1);
  expect(await root.locator('audio').evaluate((a: HTMLAudioElement) => a.hasAttribute('src'))).toBe(false);
});

test('calling mountAll() repeatedly is idempotent: one media element, one listener set', async ({ page }) => {
  await trackMediaElements(page);
  const errors = watchErrors(page);
  const rest = recordRequests(page, (u) => isRestUrl(u) && /playback/.test(u));
  const p = await gotoPlayer(page);

  await page.evaluate(async (MAIN_MODULE) => {
    const m = await import(MAIN_MODULE);
    m.mountAll();
    m.mountAll();
    m.mountWithin(document.querySelector('.wg-live'));
    m.mountWithin(document);
  }, MAIN_MODULE);
  await expect(p.audio).toHaveCount(1);
  await expect(page.locator('.wg-live__player-view')).toHaveCount(1);
  await expect(page.locator('.wg-live__play')).toHaveCount(1);

  // One set of listeners: a single click on a radio / start fetches once and plays once.
  await p.start('binaural');
  await p.expectAdvancing();
  expect(rest.count(), 'one descriptor fetch').toBe(1);
  expect(await mediaStats(page)).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
  await p.primary.click();
  await expect(p.statusTitle).toHaveText('已暫停');
  expect(errors).toEqual([]);
});

test('an Elementor-style re-render: the old instance is destroyed (audio stopped), the new one mounts alone', async ({ page }) => {
  await trackMediaElements(page);
  const errors = watchErrors(page);
  const p = await gotoPlayer(page);
  await p.start('atmos');
  await p.expectAdvancing();

  await page.evaluate(async (MAIN_MODULE) => {
    const old = document.querySelector<HTMLElement>('.wg-live');
    if (!old) throw new Error('no container');
    const config = old.querySelector('script.wg-live__config')?.textContent ?? '';
    // A fresh server-rendered container, as Elementor produces when the widget re-renders.
    const fresh = document.createElement('div');
    fresh.className = 'wg-live wg-live--player';
    fresh.dataset.wgLiveView = 'player';
    fresh.id = 'wg-live-2';
    const script = document.createElement('script');
    script.type = 'application/json';
    script.className = 'wg-live__config';
    script.textContent = config;
    const region = document.createElement('div');
    region.className = 'wg-live__sr-status';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-atomic', 'true');
    const mount = document.createElement('div');
    mount.className = 'wg-live__mount';
    mount.setAttribute('aria-busy', 'true');
    const skeleton = document.createElement('div');
    skeleton.className = 'wg-live__skeleton wg-live__skeleton--player';
    mount.append(skeleton);
    fresh.append(script, region, mount);
    old.replaceWith(fresh);
    const m = await import(MAIN_MODULE);
    m.mountWithin(fresh);
    m.mountWithin(fresh); // a second call for the same node is a no-op
  }, MAIN_MODULE);

  const next = page.locator('#wg-live-2');
  await expect(next).toHaveAttribute('data-wg-live-mounted', '1');
  await expect(next.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveCount(1);
  const stats = await mediaStats(page);
  expect(stats.inDom).toBe(1);
  expect(stats.audibleNow, 'the detached instance must not keep playing').toBe(0);
  // The remembered mode (atmos, played above) is preselected by the new instance, but nothing autostarts.
  await expect(next.getByRole('radio', { name: /選擇家庭劇院模式/ })).toBeChecked();
  expect(await next.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  expect(await next.locator('audio').evaluate((a: HTMLAudioElement) => a.hasAttribute('src'))).toBe(false);

  // The new instance works.
  await next.getByRole('radio', { name: /選擇耳機模式/ }).check();
  const start = next.locator('.wg-live__play');
  await expect(start).not.toHaveAttribute('aria-disabled', 'true');
  await start.click();
  await expect.poll(() => next.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.3);
  const after = await mediaStats(page);
  expect(after.audibleNow).toBe(1);
  expect(errors).toEqual([]);
});

test('removing the container stops its media and timers (the detached instance is swept on the next mount)', async ({ page }) => {
  await trackMediaElements(page);
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await page.evaluate(async (MAIN_MODULE) => {
    document.querySelector('.wg-live')?.remove();
    const m = await import(MAIN_MODULE);
    m.mountAll(); // sweepDetached()
  }, MAIN_MODULE);
  await expect.poll(async () => (await mediaStats(page)).audibleNow).toBe(0);
});

test('a second copy of the bundle does not mount over a mounted container', async ({ page }) => {
  await trackMediaElements(page);
  const errors = watchErrors(page);
  const p = await gotoPlayer(page);
  await page.evaluate(async (MAIN_MODULE) => {
    // A different URL = a second module instance with its own registry (double enqueue, optimizers).
    await import(`${MAIN_MODULE}?second-copy=1`);
  }, MAIN_MODULE);
  await expect(page.locator('.wg-live__player-view')).toHaveCount(1);
  await expect(p.audio).toHaveCount(1);
  await p.start('binaural');
  await p.expectAdvancing();
  expect(await mediaStats(page)).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
  expect(errors).toEqual([]);
});

test('a broken bootstrap shows the boot error instead of a blank area', async ({ page }) => {
  await page.route(/\/dev\/index\.html/, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/(<script type="application\/json" class="wg-live__config">)[\s\S]*?(<\/script>)/, '$1{not json$2');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/dev/index.html');
  const root = page.locator('.wg-live');
  await expect(root.locator('.wg-live__boot-error')).toBeVisible();
  await expect(root.locator('.wg-live__boot-error')).toHaveAttribute('role', 'alert');
  await expect(root.locator('.wg-live__boot-error-title')).toHaveText('Live 介面暫時無法載入');
  await expect(root.locator('.wg-live__mount')).toHaveAttribute('aria-busy', 'false');
});

test('without JavaScript the noscript fallback offers plain links', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/dev/index.html');
  const fallback = page.locator('.wg-live noscript');
  await expect(fallback).toHaveCount(1);
  // With scripting disabled the <noscript> content is rendered.
  await expect(page.getByRole('link', { name: '活動列表' })).toBeVisible();
  await expect(page.getByRole('link', { name: '收聽說明' })).toBeVisible();
  await expect(page.getByRole('link', { name: '聯絡我們' }).first()).toBeVisible();
  await context.close();
});
