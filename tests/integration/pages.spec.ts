/**
 * Plan 7.2 / 7.4: the Live pages on a real WordPress (Astra + Elementor + WooCommerce), served by
 * wp-env at :8888. Covers F02 (direct player link), F11 (reload, back, forward, deep link) and
 * playback of the demo video (the default media kind) in both modes on the real page.
 *
 * Read-only: nothing here changes site state.
 */
import { test } from '@playwright/test';
import { bootConfigs, expect, fetchText, HELP_URL, LISTEN_URL, LIVE_URL, MODE_NAME, SEEDED_SLUGS, SLUG_LIVE, SLUG_PENDING, DEMO_VIDEO, waitMounted, DEV } from './wp';

const DEMO_NOTICE = '操作示範音訊，非 Binaural／Atmos 驗證素材';
const isMediaUrl = (url: string): boolean => /\/assets\/demo\/(?:demo-tone-[12]\.mp3|demo-video-[12]\.mp4)/.test(url);

const root = (page: import('@playwright/test').Page) => page.locator('.wg-live').first();
/** The one media element: a <video> for the seeded (video) demo events. */
const mediaEl = (page: import('@playwright/test').Page) => root(page).locator('audio, video');
const radios = (page: import('@playwright/test').Page) => root(page).getByRole('radio');
const primary = (page: import('@playwright/test').Page) => root(page).locator('.wg-live__play');

async function expectAdvancing(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(() => mediaEl(page).evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);
  const t1 = await mediaEl(page).evaluate((a: HTMLMediaElement) => a.currentTime);
  await expect.poll(() => mediaEl(page).evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 15_000 }).toBeGreaterThan(t1);
}

test.describe('Live pages mount on the real site', () => {
  test('events page: the bound page loads wg-live.js and wg-live.css, renders the seeded events from the bootstrap', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (r) => {
      if (/wg-live\.(js|css)/.test(r.url())) scripts.push(r.url());
    });
    const rest: string[] = [];
    page.on('request', (r) => {
      if (/wg-live\/v1\/events/.test(r.url())) rest.push(r.url());
    });

    await page.goto(LIVE_URL);
    await waitMounted(page);

    expect(scripts.some((u) => /assets\/dist\/wg-live\.js\?ver=[0-9a-f]{12}/.test(u)), `scripts: ${scripts.join(', ')}`).toBe(true);
    expect(scripts.some((u) => /assets\/dist\/wg-live\.css\?ver=[0-9a-f]{12}/.test(u))).toBe(true);
    await expect(page.locator('.wg-live')).toHaveCount(1);
    await expect(root(page).locator('.wg-live__view-title')).toHaveText('Live');
    for (const slug of SEEDED_SLUGS) {
      await expect(root(page).locator(`article.wg-live__event-card[data-event-slug="${slug}"]`)).toHaveCount(1);
    }
    expect(rest, 'the events view renders from the bootstrap, not from REST').toHaveLength(0);
    // The page is a normal WordPress page: the theme header and footer are still there, once.
    await expect(page.locator('header#masthead, header.site-header').first()).toBeVisible();
    await expect(page.locator('footer#colophon, footer.site-footer').first()).toBeAttached();
  });

  test('help page mounts and lists the listening guide, without any media element', async ({ page }) => {
    await page.goto(HELP_URL);
    await waitMounted(page);
    await expect(page.locator('.wg-live--help')).toHaveCount(1);
    await expect(page.locator('audio, video')).toHaveCount(0);
    await expect(root(page).getByText('Binaural').first()).toBeVisible();
  });

  test('the bootstrap carries no source URL, no credential and no raw meta', async () => {
    for (const path of [LIVE_URL, `${LISTEN_URL}?wg_event=${SLUG_LIVE}`, HELP_URL]) {
      const { status, text } = await fetchText(DEV, path);
      expect(status).toBe(200);
      const configs = bootConfigs(text);
      expect(configs, path).toHaveLength(1);
      // The whole page: no media URL, no raw meta key, no password field. (WooCommerce's own order
      // attribution script contains the text "source_type", so that word is checked in our JSON only.)
      expect(text, path).not.toMatch(/demo-tone|demo-video|\.mp3|\.mp4|_wg_live_|post_password/);
      expect(JSON.stringify(configs[0]), path).not.toMatch(/source_type|sourceUrl|\.mp3|\.mp4|_wg_live_|post_password|https?:\/\/[^"]*\/uploads\//);
      const events = configs[0]?.events as Array<Record<string, unknown>>;
      for (const e of events) {
        expect(Object.keys(e)).not.toContain('source_type');
        expect(JSON.stringify(e)).not.toMatch(/\.mp3|\.mp4|\/uploads\//);
      }
    }
  });
});

test.describe('F02 / F11 direct link, reload, back and forward', () => {
  test('F02 a direct link opens the right event, nothing is requested or played before a gesture', async ({ page, browserName }) => {
    const media: string[] = [];
    page.on('request', (r) => {
      if (isMediaUrl(r.url())) media.push(r.url());
    });
    await page.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}`);
    await waitMounted(page);

    await expect(root(page).locator('.wg-live__player-title')).toContainText('【介面示範】直播中的線上音樂會');
    await expect(page.locator('audio, video')).toHaveCount(1);
    await expect(primary(page)).toHaveText('開始聆聽');
    await expect(primary(page)).not.toHaveAttribute('aria-disabled', 'true'); // Atmos is preselected, so it is ready
    await expect(root(page).locator('.wg-live__demo-notice')).toHaveText(DEMO_NOTICE);
    await page.waitForTimeout(1000);
    const el = await mediaEl(page).evaluate((a: HTMLMediaElement) => ({ paused: a.paused, preload: a.preload, autoplay: a.autoplay, src: a.currentSrc }));
    expect(el).toEqual({ paused: true, preload: 'none', autoplay: false, src: '' });
    if (browserName !== 'webkit') expect(media, 'no media request before the user starts playback').toHaveLength(0);
  });

  test('F02 an unknown or malformed event is a readable not-found, not a crash', async ({ page }) => {
    for (const q of ['does-not-exist', 'UPPER', '..%2F..%2Fetc', '%E4%B8%AD%E6%96%87']) {
      await page.goto(`${LISTEN_URL}?wg_event=${q}`);
      await waitMounted(page);
      await expect(root(page).getByRole('heading', { name: '找不到這場活動' })).toBeVisible();
      await expect(page.locator('audio, video')).toHaveCount(0);
    }
  });

  test('F02 a non-demo event without a source shows 播放來源尚未開放 and never creates a source', async ({ page }) => {
    await page.goto(`${LISTEN_URL}?wg_event=${SLUG_PENDING}&wg_mode=binaural`);
    await waitMounted(page);
    await expect(root(page).getByText('播放來源尚未開放').first()).toBeVisible();
    await expect(primary(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(mediaEl(page)).toHaveJSProperty('currentSrc', '');
  });

  test('wg_mode=atmos keeps Atmos preselected without playing; wg_mode=binaural and unknown values are ignored', async ({ page }) => {
    for (const q of ['atmos', 'binaural', 'surround']) {
      await page.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}&wg_mode=${q}`);
      await waitMounted(page);
      await expect(radios(page)).toHaveCount(0);
      await expect(root(page).locator('.wg-live__mode-label')).toHaveText('已選擇：Dolby Atmos 音軌');
      await page.waitForTimeout(800);
      expect(await mediaEl(page).evaluate((a: HTMLMediaElement) => a.paused), `wg_mode=${q}`).toBe(true);
      await expect(primary(page)).toHaveText('開始聆聽');
    }
  });

  test('F11 reload while playing stops playback, keeps one media element and requires a new gesture', async ({ page }) => {
    await page.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}&wg_mode=binaural`);
    await waitMounted(page);
    await primary(page).click();
    await expectAdvancing(page);

    await page.reload();
    await waitMounted(page);
    await expect(page.locator('audio, video')).toHaveCount(1);
    expect(await mediaEl(page).evaluate((a: HTMLMediaElement) => ({ paused: a.paused, t: a.currentTime }))).toEqual({ paused: true, t: 0 });
    await expect(radios(page)).toHaveCount(0);
    await expect(root(page).locator('.wg-live__mode-label')).toHaveText('已選擇：Dolby Atmos 音軌');
    await expect(primary(page)).toHaveText('開始聆聽');
    await page.waitForTimeout(800);
    expect(await mediaEl(page).evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
  });

  test('F11 back and forward between the list and the player: a view per navigation, media never keeps playing', async ({ page }) => {
    await page.goto(LIVE_URL);
    await waitMounted(page);
    const card = root(page).locator(`article.wg-live__event-card[data-event-slug="${SLUG_LIVE}"]`);
    await card.getByRole('link', { name: /體驗播放介面/ }).click();
    await page.waitForURL(new RegExp(`${LISTEN_URL}\\?wg_event=${SLUG_LIVE}`));
    await waitMounted(page);
    await expect(root(page).locator('.wg-live__player-title')).toContainText('直播中');

    await expect(radios(page)).toHaveCount(0);
    await primary(page).click();
    await expectAdvancing(page);

    await page.goBack();
    await page.waitForURL(new RegExp(`${LIVE_URL}$`));
    await waitMounted(page);
    await expect(page.locator('.wg-live')).toHaveCount(1);
    await expect(page.locator('.wg-live--events')).toHaveCount(1);
    await expect(page.locator('audio, video')).toHaveCount(0);

    await page.goForward();
    await page.waitForURL(new RegExp(`${LISTEN_URL}\\?wg_event=${SLUG_LIVE}`));
    await waitMounted(page);
    await expect(page.locator('audio, video')).toHaveCount(1);
    // Whether the page came from the bfcache or was rebuilt, it must not be playing by itself.
    await page.waitForTimeout(800);
    expect(await mediaEl(page).evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
    await expect(primary(page)).not.toHaveText('暫停');
  });

  test('F11 the event link survives a reload on the events page and the help link works from the player', async ({ page }) => {
    await page.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}`);
    await waitMounted(page);
    await page.reload();
    await waitMounted(page);
    await expect(root(page).locator('.wg-live__player-title')).toContainText('直播中');
    const help = root(page).getByRole('link', { name: /聆聽說明/ }).first();
    await expect(help).toHaveAttribute('href', new RegExp(`${HELP_URL}$`));
  });
});

test.describe('the demo plays in Atmos, the only mode, on the real page', () => {
  test('no mode selector: Atmos preselected, start, the video advances, one media element, demo notice, now-playing label', async ({ page, browserName }) => {
    const media: string[] = [];
    page.on('request', (r) => {
      if (isMediaUrl(r.url())) media.push(r.url());
    });
    await page.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}`);
    await waitMounted(page);

    await expect(radios(page)).toHaveCount(0);
    await expect(root(page).getByRole('radio', { name: /選擇耳機模式|選擇家庭劇院模式/ })).toHaveCount(0);
    await expect(root(page).locator('.wg-live__mode-label')).toHaveText(`已選擇：${MODE_NAME.atmos}`);
    await expect(primary(page)).not.toHaveAttribute('aria-disabled', 'true');
    await primary(page).click();

    await expectAdvancing(page);
    await expect(root(page).locator('.wg-live__status-title')).toHaveText('播放中');
    await expect(root(page).locator('.wg-live__mode-label')).toHaveText(`目前播放：${MODE_NAME.atmos}`);
    await expect(page.locator('audio, video')).toHaveCount(1);
    const src = await mediaEl(page).evaluate((a: HTMLMediaElement) => a.currentSrc);
    expect(src).toContain(DEMO_VIDEO.atmos);
    expect(src).toMatch(/\/wp-content\/plugins\/wg-live\/assets\/demo\//);
    await expect(root(page).locator('.wg-live__demo-notice')).toHaveText(DEMO_NOTICE);
    if (browserName !== 'webkit') expect(media.every((u) => u.includes(DEMO_VIDEO.atmos)), media.join(', ')).toBe(true);
  });

  test('no mode switch is offered, before or during playback', async ({ page }) => {
    await page.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}`);
    await waitMounted(page);
    await expect(root(page).locator('.wg-live__switch')).toBeHidden();
    await expect(root(page).getByRole('button', { name: /切換模式/ })).toHaveCount(0);
    await primary(page).click();
    await expectAdvancing(page);
    await expect(root(page).locator('.wg-live__switch')).toBeHidden();
    await expect(root(page).getByRole('button', { name: /切換模式/ })).toHaveCount(0);
    await expect(root(page).locator('dialog.wg-live__dialog[open]')).toHaveCount(0);
    await expect(page.locator('audio, video')).toHaveCount(1);
  });
});
