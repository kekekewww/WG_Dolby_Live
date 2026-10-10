/**
 * harness-dist (Chromium): the BUILT plugin assets, loaded the way WordPress enqueues them
 * (<link rel="stylesheet"> + <script defer>, versioned with the content hash from build-info.json).
 * Nothing is bundled or transformed by the test server. Covers: the `WGLive` global, the skeleton
 * being replaced, idempotent remounting, CSS via <link>, demo playback and switching on the shipped
 * bundle, the homepage loading CSS only, scoped CSS, a11y of the shipped CSS, lab CWV (plan 13.4).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page } from '@playwright/test';
import { inspectPlugin, scanScopedRules } from './css-probe';
import { expect, gotoPlayer, gotoView, isMediaUrl, recordRequests, scanWgLive, SLUG_LIVE, TONE, trackMediaElements, mediaStats, watchErrors } from './helpers';

test.describe.configure({ timeout: 90_000 });

const root = resolve(import.meta.dirname, '../..');
const buildInfo = JSON.parse(readFileSync(resolve(root, 'plugin/wg-live/assets/dist/build-info.json'), 'utf8')) as {
  version: string;
  files: Record<string, { sha256: string }>;
};
const packageVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version;

type WGLiveGlobal = { mountAll(): void; mountWithin(scope: unknown): void; version: string };
const wg = (page: Page) => ({
  keys: () => page.evaluate(() => Object.keys((window as unknown as { WGLive: object }).WGLive).sort()),
  version: () => page.evaluate(() => (window as unknown as { WGLive: WGLiveGlobal }).WGLive.version),
});

test.describe('player page, built bundle', () => {
  test('window.WGLive exists with exactly mountAll, mountWithin and version (no dev object)', async ({ page }) => {
    await gotoPlayer(page, { base: 'dist' });
    expect(await page.evaluate(() => typeof (window as unknown as { WGLive?: unknown }).WGLive)).toBe('object');
    expect(await wg(page).keys()).toEqual(['mountAll', 'mountWithin', 'version']);
    expect(await wg(page).version()).toBe(packageVersion);
    expect(buildInfo.version).toBe(packageVersion);
    // Nothing dev-related leaks onto window.
    const globals = await page.evaluate(() => Object.keys(window).filter((k) => /wg|dev/i.test(k) && !/^(WGLive)$/.test(k)));
    expect(globals.filter((k) => /^(wgNote|__wg)/.test(k))).toEqual([]);
  });

  test('the skeleton is replaced, aria-busy is false and the container is marked mounted', async ({ page }) => {
    await page.goto('/dev/dist/listen.html?wg_event=demo-live-binaural-atmos');
    const rootEl = page.locator('.wg-live');
    await expect(rootEl).toHaveAttribute('data-wg-live-mounted', '1');
    await expect(rootEl.locator('.wg-live__mount')).toHaveAttribute('aria-busy', 'false');
    await expect(rootEl.locator('.wg-live__skeleton')).toHaveCount(0);
    await expect(rootEl.locator('.wg-live__player-view')).toHaveCount(1);
    await expect(rootEl.locator('audio')).toHaveCount(1);
  });

  test('remounting is idempotent: WGLive.mountAll() twice leaves one media element and one listener set', async ({ page }) => {
    await trackMediaElements(page);
    const errors = watchErrors(page);
    const playback = recordRequests(page, (u) => /wg-live\/v1\/playback/.test(u));
    const p = await gotoPlayer(page, { base: 'dist' });
    await page.evaluate(() => {
      const api = (window as unknown as { WGLive: WGLiveGlobal }).WGLive;
      api.mountAll();
      api.mountAll();
      api.mountWithin(document.querySelector('.wg-live'));
    });
    await expect(page.locator('audio')).toHaveCount(1);
    await expect(page.locator('.wg-live__player-view')).toHaveCount(1);
    await p.start('binaural');
    await p.expectAdvancing();
    expect(playback.count(), 'one descriptor fetch: no duplicate listeners').toBe(1);
    expect(await mediaStats(page)).toEqual({ inDom: 1, everPlayed: 1, audibleNow: 1 });
    expect(errors).toEqual([]);
  });

  test('an Elementor-style re-render through WGLive.mountWithin replaces the instance without duplicates', async ({ page }) => {
    await trackMediaElements(page);
    const p = await gotoPlayer(page, { base: 'dist' });
    await p.start('atmos');
    await p.expectAdvancing();
    await page.evaluate(() => {
      const old = document.querySelector<HTMLElement>('.wg-live');
      if (!old) throw new Error('no container');
      const fresh = document.createElement('div');
      fresh.className = 'wg-live wg-live--player';
      fresh.dataset.wgLiveView = 'player';
      fresh.id = 'wg-live-2';
      const script = document.createElement('script');
      script.type = 'application/json';
      script.className = 'wg-live__config';
      script.textContent = old.querySelector('script.wg-live__config')?.textContent ?? '';
      const mount = document.createElement('div');
      mount.className = 'wg-live__mount';
      mount.setAttribute('aria-busy', 'true');
      fresh.append(script, mount);
      old.replaceWith(fresh);
      (window as unknown as { WGLive: WGLiveGlobal }).WGLive.mountWithin(fresh);
    });
    await expect(page.locator('#wg-live-2')).toHaveAttribute('data-wg-live-mounted', '1');
    await expect(page.locator('audio')).toHaveCount(1);
    const stats = await mediaStats(page);
    expect(stats.inDom).toBe(1);
    expect(stats.audibleNow).toBe(0);
  });

  test('assets load the WordPress way: <link rel=stylesheet> and <script defer>, versioned by the content hash', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/dev/dist/listen.html?wg_event=demo-live-binaural-atmos');
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();

    const css = page.locator('head link[rel="stylesheet"][href*="/dist/wg-live.css"]');
    await expect(css).toHaveCount(1);
    const href = (await css.getAttribute('href')) ?? '';
    expect(href).toMatch(/\/dist\/wg-live\.css\?ver=[0-9a-f]{12}$/);
    expect(href.endsWith((buildInfo.files['wg-live.css']?.sha256 ?? 'x').slice(0, 12))).toBe(true);
    const script = page.locator('script[src*="/dist/wg-live.js"]');
    await expect(script).toHaveCount(1);
    expect(await script.evaluate((el: HTMLScriptElement) => ({ defer: el.defer, module: el.type === 'module', async: el.async }))).toEqual({ defer: true, module: false, async: false });
    expect((await script.getAttribute('src')) ?? '').toMatch(/\?ver=[0-9a-f]{12}$/);

    // The stylesheet really applies (a token defined by the built CSS resolves on the container).
    expect(await page.locator('.wg-live').evaluate((el) => getComputedStyle(el).getPropertyValue('--wg-accent').trim())).toBe('#f0d62b');
    expect(await page.evaluate(() => Array.from(document.styleSheets).some((s) => (s.href ?? '').includes('/dist/wg-live.css')))).toBe(true);

    // No dev server artefacts, no featured CSS on the player page, nothing from another host.
    expect(requests.filter((u) => /\/@vite|\/src\/|\.ts(\?|$)|:5174/.test(u))).toEqual([]);
    expect(requests.some((u) => u.includes('wg-live-featured.css'))).toBe(false);
    expect(await page.locator('style[data-vite-dev-id]').count()).toBe(0);
    const foreign = requests.filter((u) => !u.startsWith('http://localhost:5175/') && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(foreign).toEqual([]);
  });

  test('the demo plays on the shipped bundle: binaural, then switch to atmos with one element', async ({ page }) => {
    const errors = watchErrors(page);
    const media = recordRequests(page, isMediaUrl);
    const p = await gotoPlayer(page, { base: 'dist' });
    await p.start('binaural');
    await p.expectAdvancing();
    await expect(p.modeLabel).toHaveText('目前播放：Binaural');
    await expect(p.demoNotice).toHaveText('操作示範音訊，非 Binaural／Atmos 驗證素材');
    expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc)).toContain(TONE.binaural);

    await p.switchButton.click();
    await p.dialog.getByRole('button', { name: /確認切換/ }).click();
    await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌', { timeout: 20_000 });
    await p.expectAdvancing(0.2);
    expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc)).toContain(TONE.atmos);
    await expect(p.audio).toHaveCount(1);
    const oldCount = media.count(TONE.binaural);
    await page.waitForTimeout(1200);
    expect(media.count(TONE.binaural), 'the old URL gets no further requests').toBe(oldCount);

    await p.primary.click();
    await expect(p.statusTitle).toHaveText('已暫停');
    await p.primary.click();
    await expect(p.statusTitle).toHaveText('播放中');
    expect(errors).toEqual([]);
  });

  test('the dev panel ships inert: present for devTools=true, entirely absent for devTools=false', async ({ page }) => {
    const p = await gotoPlayer(page, { base: 'dist' });
    await expect(p.devPanel).toBeVisible();
    await gotoPlayer(page, { base: 'dist', harness: 'nodev' });
    await expect(page.locator('[class*="wg-live__dev"]')).toHaveCount(0);
    await expect(page.locator('.wg-live')).not.toContainText('開發用示範面板');
    expect(await wg(page).keys()).toEqual(['mountAll', 'mountWithin', 'version']);
  });

  test('unknown event, disabled mode and a plain-permalink REST root work on the shipped bundle', async ({ page }) => {
    await gotoView(page, 'listen', { base: 'dist', event: 'no-such-event' });
    await expect(page.locator('.wg-live').getByRole('heading', { name: '找不到這場活動' })).toBeVisible();
    await gotoView(page, 'listen', { base: 'dist', event: SLUG_LIVE, harness: 'disabled' });
    await expect(page.locator('.wg-live').getByRole('heading', { name: '線上音樂會尚未開放' })).toBeVisible();
    const rest = recordRequests(page, (u) => /rest_route=/.test(u));
    const p = await gotoPlayer(page, { base: 'dist', harness: 'plain' });
    await p.start('atmos');
    await p.expectAdvancing();
    expect(rest.count()).toBeGreaterThanOrEqual(1);
  });

  test('autoplay blocked and network failure paths behave on the shipped bundle', async ({ page }) => {
    await page.addInitScript(() => {
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
    const p = await gotoPlayer(page, { base: 'dist' });
    await p.start('binaural');
    await expect(p.statusTitle).toHaveText('請點擊開始聆聽');
    await p.primary.click();
    await p.expectAdvancing();
  });
});

test.describe('events and help pages, built bundle', () => {
  test('events list mounts from the bootstrap and links to the dist player page', async ({ page }) => {
    const errors = watchErrors(page);
    await gotoView(page, 'index', { base: 'dist' });
    const rootEl = page.locator('.wg-live');
    await expect(rootEl.locator('article.wg-live__event-card')).toHaveCount(4);
    await expect(rootEl.getByRole('link', { name: /體驗播放介面：【介面示範】錄音室現場音樂會 Live/ })).toHaveAttribute('href', /\/dev\/dist\/listen\.html\?wg_event=demo-live-binaural-atmos$/);
    await expect(rootEl.locator('.wg-live__view-title')).toHaveText('Live');
    expect(errors).toEqual([]);
  });

  test('help page mounts with every fixed section', async ({ page }) => {
    await gotoView(page, 'help', { base: 'dist' });
    for (const name of ['兩種聆聽模式', '瀏覽器與驗收說明', '家庭劇院連接方式', '沒有聲音時', '重新連線', '切換模式', '鍵盤操作', '聯絡我們']) {
      await expect(page.locator('.wg-live').getByRole('heading', { name })).toBeVisible();
    }
  });

  test('page navigation between the built pages keeps working (links from the events page)', async ({ page }) => {
    await gotoView(page, 'index', { base: 'dist' });
    await page.locator('.wg-live').getByRole('link', { name: /體驗播放介面/ }).first().click();
    await expect(page).toHaveURL(/\/dev\/dist\/listen\.html\?wg_event=demo-live-binaural-atmos/);
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
    await expect(page.locator('.wg-live__player-view')).toBeVisible();
    await page.locator('.wg-live').getByRole('link', { name: '聆聽說明' }).last().click();
    await expect(page).toHaveURL(/\/dev\/dist\/help\.html/);
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
  });
});

test.describe('homepage featured card, built CSS only', () => {
  test('home.html loads wg-live-featured.css and no JavaScript of ours', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/dev/dist/home.html');
    await expect(page.locator('.wg-live-featured')).toBeVisible();
    await expect(page.locator('link[rel="stylesheet"][href*="wg-live-featured.css"]')).toHaveCount(1);
    expect(requests.some((u) => u.includes('wg-live.js'))).toBe(false);
    expect(requests.some((u) => u.includes('wg-live.css'))).toBe(false);
    expect(requests.some((u) => /hls|\.mp3/.test(u))).toBe(false);
    await expect(page.locator('script')).toHaveCount(0);
    expect(await page.locator('.wg-live-featured').evaluate((el) => getComputedStyle(el).getPropertyValue('--wg-accent').trim())).toBe('#f0d62b');
    expect(await page.evaluate(() => (window as unknown as { WGLive?: unknown }).WGLive)).toBeUndefined();
  });

  test('the featured stylesheet is scoped and does not restyle the homepage chrome', async ({ page }) => {
    await page.goto('/dev/dist/home.html');
    const report = await scanScopedRules(page, 'dist');
    expect(report.sheets).toBe(1);
    expect(report.ruleCount).toBeGreaterThan(5);
    expect(report.unscoped).toEqual([]);
    expect(report.badNames).toEqual([]);
    const chrome = await page.evaluate(() => {
      const h1 = getComputedStyle(document.querySelector('main > h1') as Element);
      const p = getComputedStyle(document.querySelector('main > p:not(.site-note)') as Element);
      return { transform: h1.textTransform, align: p.textAlign, color: h1.color };
    });
    expect(chrome).toEqual({ transform: 'uppercase', align: 'justify', color: 'rgb(140, 158, 255)' });
  });
});

test.describe('shipped CSS', () => {
  test('every rule of wg-live.css is scoped; @keyframes are prefixed; no @font-face', async ({ page }) => {
    await gotoView(page, 'listen', { base: 'dist', event: SLUG_LIVE });
    const report = await scanScopedRules(page, 'dist');
    expect(report.sheets).toBe(1);
    expect(report.ruleCount).toBeGreaterThan(100);
    expect(report.unscoped, 'selectors outside .wg-live').toEqual([]);
    expect(report.badNames).toEqual([]);
  });

  test('the hostile site chrome cannot restyle the shipped plugin (events, help, player, dialog)', async ({ page }) => {
    await gotoView(page, 'index', { base: 'dist' });
    expect(await inspectPlugin(page)).toEqual([]);
    await gotoView(page, 'help', { base: 'dist' });
    expect(await inspectPlugin(page)).toEqual([]);
    const p = await gotoPlayer(page, { base: 'dist' });
    await p.start('binaural');
    await p.expectAdvancing();
    await p.switchButton.click();
    await expect(p.dialog).toBeVisible();
    expect(await inspectPlugin(page)).toEqual([]);
  });
});

test.describe('axe on the shipped CSS', () => {
  test('events, help, player (idle, chosen, playing, dialog)', async ({ page }) => {
    await gotoView(page, 'index', { base: 'dist' });
    await scanWgLive(page, 'dist events');
    await gotoView(page, 'help', { base: 'dist' });
    await scanWgLive(page, 'dist help');
    const p = await gotoPlayer(page, { base: 'dist' });
    await scanWgLive(page, 'dist player idle');
    await p.choose('atmos');
    await scanWgLive(page, 'dist player chosen');
    await p.primary.click();
    await p.expectAdvancing();
    await scanWgLive(page, 'dist player playing');
    await p.switchButton.click();
    await expect(p.dialog).toBeVisible();
    await scanWgLive(page, 'dist player dialog');
    await p.dialog.getByRole('button', { name: '取消' }).click();
    await p.devPanel.locator('summary').click();
    await scanWgLive(page, 'dist dev panel');
  });
});

test.describe('lab metrics (plan 13.4: lab only, separate from the site baseline)', () => {
  test('LCP and CLS of the events and player pages on the built bundle', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __lcp: number };
      w.__cls = 0;
      w.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) w.__lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const rows: string[] = [];
    for (const [view, opts] of [
      ['index', {}],
      ['listen', { event: SLUG_LIVE }],
    ] as const) {
      await gotoView(page, view, { base: 'dist', ...opts });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => ({ cls: (window as unknown as { __cls: number }).__cls, lcp: (window as unknown as { __lcp: number }).__lcp }));
      rows.push(`${view}: LCP ${Math.round(m.lcp)} ms, CLS ${m.cls.toFixed(4)}`);
      expect(m.cls, `${view} CLS`).toBeLessThan(0.1);
    }
    test.info().annotations.push({ type: 'lab-metrics', description: `${rows.join(' | ')} (Chromium, local server, no throttling; not the site's field data)` });
    console.log(`[lab metrics] ${rows.join(' | ')}`);
  });
});
