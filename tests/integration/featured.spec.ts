/**
 * Plan 6.10 / 7.2: the homepage card is server-rendered by [wg_live_featured]. It loads only its own
 * stylesheet: no wg-live.js, no player stylesheet, no media element, no REST call. Pages that do not
 * show a Live view load none of the plugin's assets.
 *
 * Read-only. The disabled-mode text of the card is covered in disabled.state.spec.ts.
 */
import { test } from '@playwright/test';
import { DEV, expect, fetchText, SLUG_LIVE } from './wp';

test.describe('featured card on the homepage', () => {
  test('renders the featured demo event with its status, a demo badge and a CTA to the player', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('section.wg-live-featured--event');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.wg-live-featured__title')).toContainText('【介面示範】直播中的線上音樂會');
    await expect(card.locator('.wg-live-featured__badge--demo')).toHaveText('介面示範');
    await expect(card.locator('.wg-live-featured__badge--status')).toHaveText('演出中');
    await expect(card.locator('time.wg-live-featured__time')).toHaveText(/\d{4}年\d{1,2}月\d{1,2}日（.）\d{2}:\d{2} 台北時間/);
    const cta = card.locator('a.wg-live-featured__cta');
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute('href', new RegExp(`/live/listen/\\?wg_event=${SLUG_LIVE}$`));
    // The card names its heading and the demo is labeled: no fake claims.
    await expect(card).toHaveAttribute('aria-labelledby', /wg-live-featured-\d+-title/);
    await expect(card).not.toContainText(/Dolby Atmos 認證|7\.1\.4|Atmos certified/);
  });

  test('the homepage loads no wg-live.js, no player stylesheet, no media, no REST call', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('section.wg-live-featured')).toHaveCount(1);

    expect(requests.filter((u) => /wg-live\.js/.test(u)), 'no player script').toEqual([]);
    expect(requests.filter((u) => /assets\/dist\/wg-live\.css/.test(u)), 'no player stylesheet').toEqual([]);
    expect(requests.filter((u) => /wg-live\/v1|wg-live%2Fv1|rest_route=\/wg-live/.test(u)), 'no REST call').toEqual([]);
    expect(requests.filter((u) => /\.(mp3|m3u8|mp4|ts)(\?|$)/.test(u))).toEqual([]);
    expect(requests.filter((u) => /wg-live-featured\.css\?ver=[0-9a-f]{12}/.test(u))).toHaveLength(1);

    await expect(page.locator('script[src*="wg-live"]')).toHaveCount(0);
    await expect(page.locator('.wg-live, .wg-live__config')).toHaveCount(0);
    await expect(page.locator('audio, video, iframe[src*="wg-live"]')).toHaveCount(0);
  });

  test('the card is plain HTML: it renders with JavaScript turned off', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: DEV.baseURL, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('section.wg-live-featured--event .wg-live-featured__title')).toContainText('直播中');
      await expect(page.locator('a.wg-live-featured__cta')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('no horizontal overflow at 360 px', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: DEV.baseURL, viewport: { width: 360, height: 740 } });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('section.wg-live-featured--event')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const card = await page.locator('section.wg-live-featured--event').boundingBox();
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(360);
    } finally {
      await context.close();
    }
  });
});

test.describe('assets only where they are needed', () => {
  test('unrelated pages (sample page, shop, my account) load none of the plugin assets', async () => {
    for (const path of ['/sample-page/', '/shop/', '/my-account/', '/cart/']) {
      const { status, text } = await fetchText(DEV, path);
      expect(status, path).toBe(200);
      expect(text, path).not.toMatch(/wg-live/);
    }
  });

  test('the bound Live pages load the app assets once, the help page too', async () => {
    for (const path of ['/live/', '/live/listen/?wg_event=demo-live', '/live/help/']) {
      const { text } = await fetchText(DEV, path);
      expect(text.match(/assets\/dist\/wg-live\.js/g) ?? [], path).toHaveLength(1);
      expect(text.match(/assets\/dist\/wg-live\.css/g) ?? [], path).toHaveLength(1);
    }
    // The Live pages are not the front page: the featured stylesheet is not needed there.
    expect((await fetchText(DEV, '/live/')).text).not.toMatch(/wg-live-featured\.css/);
  });
});
