/**
 * F14 (plan 7.2 / 7.4): an Elementor page holds exactly one media element, and neither a second mount
 * nor an Elementor re-render creates a second source or duplicate listeners. Also: in the Elementor
 * editor preview, as an admin, the assets are loaded and the widget mounts once.
 *
 * The editor tests drive the real Elementor editor (#elementor-preview-iframe) on the dev site.
 */
import { test } from '@playwright/test';
import { previewState, openEditor } from './elementor';
import { adminContext, createElementorPage, deletePosts, DEV, ELEMENTOR_URL, expect, MODE_NAME, SLUG_LIVE, SLUG_ENDED, DEMO_VIDEO, waitMounted } from './wp';

interface PlayCounter {
  __plays: number;
}
declare global {
  interface Window {
    WGLive: { mountAll(): void; mountWithin(scope: unknown): void; version: string };
    __plays: number;
    __oldAudio: HTMLMediaElement | undefined;
  }
}

const PUBLIC_URL = `${ELEMENTOR_URL}?wg_event=${SLUG_LIVE}`;

test.describe('F14 Elementor page, front end', () => {
  test('one mount, one media element, theme chrome kept; re-mount keeps the same element and one listener set', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as PlayCounter).__plays = 0;
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        (window as unknown as PlayCounter).__plays++;
        return original.call(this);
      };
    });
    const bundles: string[] = [];
    page.on('request', (r) => {
      if (/assets\/dist\/wg-live\.js/.test(r.url())) bundles.push(r.url());
    });

    await page.goto(PUBLIC_URL);
    await waitMounted(page);

    // Exactly one container inside the Elementor shortcode widget, one media element, one script.
    await expect(page.locator('.elementor-widget-shortcode .wg-live')).toHaveCount(1);
    await expect(page.locator('.wg-live')).toHaveCount(1);
    await expect(page.locator('audio, video')).toHaveCount(1);
    expect(bundles).toHaveLength(1);
    await expect(page.locator('script[src*="assets/dist/wg-live.js"]')).toHaveCount(1);
    // "Elementor Full Width" keeps the site header and footer (not Canvas).
    await expect(page.locator('header#masthead, header.site-header')).toHaveCount(1);
    await expect(page.locator('footer#colophon, footer.site-footer')).toHaveCount(1);
    expect(await page.evaluate(() => typeof window.WGLive.mountAll)).toBe('function');

    // Play, tag the element, mount again in every way the API allows.
    const audio = page.locator('.wg-live audio, .wg-live video');
    const primary = page.locator('.wg-live .wg-live__play');
    await page.getByRole('radio', { name: /選擇耳機模式/ }).check();
    await primary.click();
    await expect.poll(() => audio.evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);
    await audio.evaluate((a: HTMLMediaElement) => {
      (a as HTMLMediaElement & { __tag?: string }).__tag = 'first';
    });
    const playsBefore = await page.evaluate(() => window.__plays);
    expect(playsBefore).toBe(1);

    await page.evaluate(() => {
      window.WGLive.mountAll();
      window.WGLive.mountAll();
      window.WGLive.mountWithin(document);
      window.WGLive.mountWithin(document.querySelector('.wg-live'));
      window.WGLive.mountWithin(document.querySelector('.elementor-widget-shortcode'));
      window.dispatchEvent(new Event('elementor/frontend/init'));
    });
    await page.waitForTimeout(1500);
    await expect(page.locator('.wg-live')).toHaveCount(1);
    await expect(page.locator('audio, video')).toHaveCount(1);
    expect(await audio.evaluate((a: HTMLMediaElement) => (a as HTMLMediaElement & { __tag?: string }).__tag)).toBe('first');
    expect(await page.evaluate(() => window.__plays), 're-mounting must not call play() again').toBe(playsBefore);
    await expect(page.locator('.wg-live .wg-live__status-title')).toHaveText('播放中');

    // One pause and one resume produce exactly one pause and one play: no duplicate listeners.
    await primary.click();
    await expect(page.locator('.wg-live .wg-live__status-title')).toHaveText('已暫停');
    expect(await audio.evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
    await primary.click();
    await expect(page.locator('.wg-live .wg-live__status-title')).toHaveText('播放中');
    expect(await page.evaluate(() => window.__plays)).toBe(playsBefore + 1);
    await expect(page.locator('.wg-live audio, .wg-live video')).toHaveCount(1);
  });

  test('a simulated Elementor re-render replaces the widget DOM: the old instance is destroyed, no second source plays', async ({ page }) => {
    await page.goto(PUBLIC_URL);
    await waitMounted(page);
    const html = await (await page.request.get(PUBLIC_URL)).text();

    await page.getByRole('radio', { name: /選擇耳機模式/ }).check();
    await page.locator('.wg-live .wg-live__play').click();
    await expect.poll(() => page.locator('.wg-live audio, .wg-live video').evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);

    // What Elementor does when a widget re-renders: the old container leaves the DOM, a fresh server-rendered one comes in.
    await page.evaluate((markup) => {
      const fresh = new DOMParser().parseFromString(markup, 'text/html').querySelector('.wg-live') as HTMLElement;
      const old = document.querySelector('.wg-live') as HTMLElement;
      window.__oldAudio = old.querySelector('audio, video') as HTMLMediaElement;
      old.replaceWith(document.importNode(fresh, true));
      window.WGLive.mountAll();
    }, html);
    await waitMounted(page);

    await expect(page.locator('.wg-live')).toHaveCount(1);
    await expect(page.locator('audio, video')).toHaveCount(1);
    const old = await page.evaluate(() => ({ connected: window.__oldAudio?.isConnected, paused: window.__oldAudio?.paused }));
    expect(old, 'the old element is gone and silent').toEqual({ connected: false, paused: true });
    // The fresh player starts idle (no autoplay) and plays on its own gesture, alone.
    expect(await page.locator('.wg-live audio, .wg-live video').evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
    await page.getByRole('radio', { name: /選擇家庭劇院模式/ }).check();
    await page.locator('.wg-live .wg-live__play').click();
    await expect.poll(() => page.locator('.wg-live audio, .wg-live video').evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);
    expect(await page.locator('.wg-live audio, .wg-live video').evaluate((a: HTMLMediaElement) => a.currentSrc)).toContain(DEMO_VIDEO.atmos);
    expect(await page.evaluate(() => window.__oldAudio?.paused)).toBe(true);
    await expect(page.locator('.wg-live .wg-live__mode-label')).toHaveText(`目前播放：${MODE_NAME.atmos}`);
  });

  test('the seeded Elementor page without wg_event is a readable not-found, still one container and no media element', async ({ page }) => {
    await page.goto(ELEMENTOR_URL);
    await waitMounted(page);
    await expect(page.locator('.wg-live')).toHaveCount(1);
    await expect(page.locator('audio, video')).toHaveCount(0);
    await expect(page.locator('.wg-live').getByRole('heading', { name: '找不到這場活動' })).toBeVisible();
  });
});

test.describe('F14 Elementor editor preview (admin)', () => {
  let pageId = 0;

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern for the fixtures argument.
  test.beforeAll(async ({}, testInfo) => {
    pageId = createElementorPage(DEV, `it-f14-${testInfo.project.name}`, 'IT F14 Elementor', `[wg_live view="player" event="${SLUG_LIVE}"]`);
  });

  test.afterAll(() => {
    if (pageId > 0) deletePosts(DEV, [pageId]);
  });

  test('preview: assets are loaded, the widget mounts once, dev tools show on the local site, a re-render leaves one mount', async ({ browser }) => {
    test.setTimeout(420_000);
    const context = await adminContext(browser, DEV);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    try {
      const { frame } = await openEditor(page, pageId);
      await frame.waitForSelector('.wg-live[data-wg-live-mounted="1"]', { timeout: 120_000 });

      const first = await previewState(frame);
      expect(first).toEqual({ roots: 1, mounted: 1, audio: 0, video: 1, devPanels: 1, scripts: 1, styles: 1 });
      await expect(frame.locator('.wg-live__player-title')).toContainText('【介面示範】直播中的線上音樂會');

      // 1. Re-render the widget view (what Elementor does for any change to the widget).
      await frame.evaluate(() => {
        const root = document.querySelector('.wg-live') as HTMLElement & { __old?: boolean };
        root.__old = true;
        window.__oldAudio = root.querySelector('audio, video') as HTMLMediaElement;
      });
      await page.evaluate(() => {
        // `elementor` is the editor's global in the parent window.
        const editor = (window as unknown as { elementor: { getPreviewContainer(): { children: Array<{ children: Array<{ view: { render(): void } }> }> } } }).elementor;
        editor.getPreviewContainer().children[0]!.children[0]!.view.render();
      });
      await frame.waitForFunction(() => {
        const root = document.querySelector('.wg-live') as (HTMLElement & { __old?: boolean }) | null;
        return root !== null && root.__old === undefined && root.getAttribute('data-wg-live-mounted') === '1';
      }, undefined, { timeout: 60_000 });
      expect(await previewState(frame)).toEqual({ roots: 1, mounted: 1, audio: 0, video: 1, devPanels: 1, scripts: 1, styles: 1 });
      expect(await frame.evaluate(() => window.__oldAudio?.isConnected)).toBe(false);

      // 2. Change the shortcode in the editor: the server renders the widget again and the new DOM mounts.
      await page.evaluate((shortcode) => {
        const w = window as unknown as {
          $e: { run(command: string, args: unknown): unknown };
          elementor: { getPreviewContainer(): { children: Array<{ children: unknown[] }> } };
        };
        const container = w.elementor.getPreviewContainer().children[0]!.children[0];
        w.$e.run('document/elements/settings', { container, settings: { shortcode }, options: { external: true } });
      }, `[wg_live view="player" event="${SLUG_ENDED}"]`);
      await expect(frame.locator('.wg-live__player-title')).toContainText('已結束的線上音樂會', { timeout: 90_000 });
      await frame.waitForSelector('.wg-live[data-wg-live-mounted="1"]');
      expect(await previewState(frame)).toEqual({ roots: 1, mounted: 1, audio: 0, video: 1, devPanels: 1, scripts: 1, styles: 1 });
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe('Elementor preview mode on the server', () => {
  test('?elementor-preview as an admin enqueues the app and the featured styles exactly once', async ({ browser }) => {
    const context = await adminContext(browser, DEV);
    try {
      const page = await context.newPage();
      const bundles: string[] = [];
      page.on('request', (r) => {
        if (/assets\/dist\/wg-live[^/]*\.(js|css)/.test(r.url())) bundles.push(r.url().replace(/\?.*$/, '').split('/').pop() as string);
      });
      // 18 = the seeded Elementor page; resolve its ID from the public slug instead of hard-coding it.
      const res = await page.request.get('/wp-json/wp/v2/pages?slug=live-elementor&_fields=id');
      const id = ((await res.json()) as Array<{ id: number }>)[0]?.id;
      expect(id, 'the seeded page live-elementor exists').toBeGreaterThan(0);

      await page.goto(`${ELEMENTOR_URL}?elementor-preview=${id}&ver=1`, { waitUntil: 'load' });
      await expect(page.locator('script[src*="assets/dist/wg-live.js"]')).toHaveCount(1);
      await expect(page.locator('link[rel="stylesheet"][href*="assets/dist/wg-live.css"]')).toHaveCount(1);
      await expect(page.locator('link[rel="stylesheet"][href*="assets/dist/wg-live-featured.css"]')).toHaveCount(1);
      expect(bundles.filter((f) => f === 'wg-live.js'), bundles.join(', ')).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
});
