/**
 * Plan 7.4 F01: events list, empty state, featured event and order, demo badge, CTA labels, and the
 * disabled variant (D16). The events view renders from the bootstrap only (orchestrator decision 5).
 */
import { test, type Locator } from '@playwright/test';
import { expect, expectHref, gotoView, isRestUrl, recordRequests, rewriteBootConfig, SLUG_ENDED, SLUG_LIVE, SLUG_PENDING, SLUG_SCHEDULED } from './helpers';

test.describe.configure({ timeout: 60_000 });

const card = (root: Locator, slug: string): Locator => root.locator(`article.wg-live__event-card[data-event-slug="${slug}"]`);

test.describe('F01 events list', () => {
  test('featured event first, then the others in plan order, no filler cards', async ({ page }) => {
    const rest = recordRequests(page, isRestUrl);
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');

    // View title, subtitle and intro (plan 6.1 section 1).
    await expect(root.locator('.wg-live__view-title')).toHaveText('Live');
    await expect(root.locator('.wg-live__view-subtitle')).toHaveText('線上音樂會');
    await expect(root.locator('.wg-live__view-intro')).toHaveText('以耳機或家庭劇院，聆聽維光音樂的現場演出。');

    // Featured: the earliest event that is neither ended nor cancelled (the live demo).
    const featured = root.locator('.wg-live__featured');
    await expect(featured.getByRole('heading', { name: '精選活動' })).toBeVisible();
    await expect(featured.locator('article')).toHaveCount(1);
    await expect(card(featured, SLUG_LIVE)).toBeVisible();

    // Section order in the DOM: header, featured, 聆聽方式, others, FAQ (plan 6.1).
    const headings = await root.locator('h2, h3').allTextContents();
    const order = ['精選活動', '聆聽方式', '其他活動', '常見問題'].map((name) => headings.findIndex((t) => t.trim() === name));
    expect(order.every((i) => i >= 0), `headings: ${headings.join(' | ')}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Other events: upcoming ascending by start, then ended descending.
    const others = await root.locator('.wg-live__others article.wg-live__event-card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.eventSlug));
    expect(others).toEqual([SLUG_PENDING, SLUG_SCHEDULED, SLUG_ENDED]);
    await expect(root.locator('article.wg-live__event-card')).toHaveCount(4);
    await expect(root.locator('.wg-live__others').getByRole('heading', { name: '其他活動' })).toBeVisible();

    expect(rest.count(), 'the events view is rendered from the bootstrap: no REST request').toBe(0);
  });

  test('card fields: title, demo badge, performers, date with zone, status badge, modes', async ({ page }) => {
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');

    const live = card(root, SLUG_LIVE);
    await expect(live.locator('.wg-live__event-card-title-text')).toHaveText('【介面示範】錄音室現場音樂會 Live');
    await expect(live.locator('.wg-live__badge--demo')).toHaveText('介面示範');
    // The badge sits inside the heading, so it is part of the accessible name.
    await expect(live.getByRole('heading', { level: 4 })).toContainText('介面示範');
    await expect(live).toHaveAccessibleName(/介面示範/);
    await expect(live.locator('.wg-live__event-card-status')).toHaveText('演出中');
    await expect(live.locator('.wg-live__event-card-performers')).toHaveText('演出者：示範樂手 A、示範樂手 B');
    await expect(live.locator('.wg-live__event-card-when time')).toHaveText(/\d{4}年\d{1,2}月\d{1,2}日（.）\d{2}:\d{2} 台北時間/);
    await expect(live.locator('.wg-live__event-card-modes')).toContainText('耳機 Binaural');
    await expect(live.locator('.wg-live__event-card-modes')).toContainText('家庭劇院 Dolby Atmos');
    const img = live.locator('img.wg-live__event-card-img');
    await expect(img).toHaveAttribute('width', '1200');
    await expect(img).toHaveAttribute('height', '675');
    await expect(img).toHaveAttribute('loading', 'eager'); // the featured poster is the LCP candidate

    // The non-demo test event carries no demo badge.
    const pending = card(root, SLUG_PENDING);
    await expect(pending.locator('.wg-live__badge--demo')).toHaveCount(0);
    await expect(pending).not.toHaveAccessibleName(/介面示範/);
    await expect(card(root, SLUG_SCHEDULED).locator('img.wg-live__event-card-img')).toHaveAttribute('loading', 'lazy');

    // An event without a poster renders no empty image box.
    await expect(card(root, SLUG_ENDED).locator('img')).toHaveCount(0);
    await expect(card(root, SLUG_ENDED).locator('.wg-live__event-card-status')).toHaveText('已結束');
    await expect(card(root, SLUG_ENDED).locator('.wg-live__event-card-modes')).toContainText('耳機 Binaural');
    await expect(card(root, SLUG_ENDED).locator('.wg-live__event-card-modes')).not.toContainText('Dolby Atmos');
  });

  test('primary CTA labels and targets follow the plan 6.1 table', async ({ page }) => {
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');

    // demo + demo source -> 體驗播放介面 -> player link with the slug.
    const demo = card(root, SLUG_LIVE).getByRole('link', { name: /體驗播放介面/ });
    await expect(demo).toBeVisible();
    await expectHref(demo, `/dev/listen.html?wg_event=${SLUG_LIVE}`);

    // live, not demo -> 進入聆聽 -> player link.
    const enter = card(root, SLUG_PENDING).getByRole('link', { name: /進入聆聽/ });
    await expectHref(enter, `/dev/listen.html?wg_event=${SLUG_PENDING}`);

    // scheduled demo: the demo row wins over the status rows (first match wins): still 體驗播放介面.
    await expect(card(root, SLUG_SCHEDULED).getByRole('link', { name: /體驗播放介面/ })).toBeVisible();

    // ended -> 查看活動資訊 (a button that expands details), never a replay button.
    const ended = card(root, SLUG_ENDED);
    const viewInfo = ended.getByRole('button', { name: /查看活動資訊/ });
    await expect(viewInfo).toHaveAttribute('aria-expanded', 'false');
    await expect(ended.getByRole('link', { name: /回放|重播|觀看/ })).toHaveCount(0);
    await expect(ended.locator('.wg-live__event-details')).toBeHidden();
    await viewInfo.click();
    await expect(viewInfo).toHaveAttribute('aria-expanded', 'true');
    await expect(ended.locator('.wg-live__event-details')).toBeVisible();
    await expect(ended.locator('.wg-live__event-details')).toContainText('本場演出已結束');
    // No replay text because replayAvailable is false.
    await expect(ended).not.toContainText('回放資訊待公布');
    await viewInfo.click();
    await expect(ended.locator('.wg-live__event-details')).toBeHidden();
  });

  test('secondary CTAs: 購票 only with a product URL, 登入 never on ended events, neither claims access', async ({ page }) => {
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');
    const pending = card(root, SLUG_PENDING);
    await expectHref(pending.getByRole('link', { name: /^購票/ }), 'https://example.com/shop/pending-source-live');
    await expectHref(pending.getByRole('link', { name: /^登入/ }), '/dev/stub.html?page=account');
    // No product URL -> no 購票.
    await expect(card(root, SLUG_LIVE).getByRole('link', { name: /^購票/ })).toHaveCount(0);
    // Orchestrator decision 5: 購票/登入 hidden for ended and cancelled events.
    const ended = card(root, SLUG_ENDED);
    await expect(ended.getByRole('link', { name: /^購票/ })).toHaveCount(0);
    await expect(ended.getByRole('link', { name: /^登入/ })).toHaveCount(0);
  });

  test('scheduled card: countdown is plain text outside any live region, 活動簡介 toggle reveals details', async ({ page }) => {
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');
    const sched = card(root, SLUG_SCHEDULED);
    const countdown = sched.locator('.wg-live__event-card-countdown');
    await expect(countdown).toBeVisible();
    await expect(countdown).toHaveText(/^距離開始：\d+ 天/);
    expect(await countdown.evaluate((el) => el.closest('[aria-live], [role="status"], [role="alert"], [role="log"]'))).toBeNull();
    await expect(root.locator('.wg-live__sr-status'), 'nothing is announced on the events page').toHaveText('');

    const toggle = sched.getByRole('button', { name: /活動簡介/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sched.locator('.wg-live__event-details')).toBeVisible();
    await expect(sched.locator('.wg-live__event-details')).toContainText('這是介面示範活動，演出時間尚未到。');
    await expect(sched.locator('.wg-live__event-details')).toContainText('節目單');
    await expect(sched.locator('.wg-live__event-details')).toContainText('操作示範音訊，非 Binaural／Atmos 驗證素材');
  });

  test('?featured=<slug> chooses the featured event; an unknown value falls back to the earliest upcoming', async ({ page }) => {
    await gotoView(page, 'index', { query: { featured: SLUG_SCHEDULED } });
    const root = page.locator('.wg-live');
    await expect(card(root.locator('.wg-live__featured'), SLUG_SCHEDULED)).toBeVisible();
    await expect(root.locator('.wg-live__others article')).toHaveCount(3);

    await gotoView(page, 'index', { query: { featured: 'no-such-event' } });
    await expect(card(page.locator('.wg-live__featured'), SLUG_LIVE)).toBeVisible();
  });

  test('empty state: no events -> 目前沒有已公布的線上音樂會 and a help link, no filler cards', async ({ page }) => {
    await rewriteBootConfig(page, /\/dev\/index\.html/, (config) => {
      config.events = [];
      config.featuredEventSlug = null;
    });
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');
    await expect(root.getByRole('heading', { name: '目前沒有已公布的線上音樂會' })).toBeVisible();
    await expect(root.getByText('線上音樂會資訊即將公布')).toBeVisible();
    await expectHref(root.getByRole('link', { name: '聆聽說明' }), '/dev/help.html');
    await expect(root.locator('article')).toHaveCount(0);
    await expect(root.locator('.wg-live__view-title')).toHaveText('Live');
  });

  test('a single event renders one card and no "other events" section', async ({ page }) => {
    await rewriteBootConfig(page, /\/dev\/index\.html/, (config) => {
      config.events = config.events.filter((e: { slug: string }) => e.slug === SLUG_LIVE);
    });
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');
    await expect(root.locator('article.wg-live__event-card')).toHaveCount(1);
    await expect(root.locator('.wg-live__others')).toHaveCount(0);
  });

  test('disabled mode (D16): only the 尚未開放 panel with home and contact links, no events', async ({ page }) => {
    const rest = recordRequests(page, isRestUrl);
    await gotoView(page, 'index', { harness: 'disabled' });
    const root = page.locator('.wg-live');
    await expect(root.getByRole('heading', { name: '線上音樂會尚未開放' })).toBeVisible();
    await expectHref(root.getByRole('link', { name: '回首頁' }), '/dev/stub.html?page=home');
    await expectHref(root.getByRole('link', { name: '聯絡我們' }), '/dev/stub.html?page=contact');
    await expect(root.locator('article')).toHaveCount(0);
    expect(rest.count()).toBe(0);
  });

  test('heading=h1 promotes the view title and shifts the section levels down', async ({ page }) => {
    await gotoView(page, 'index', { query: { heading: 'h1' } });
    const root = page.locator('.wg-live');
    await expect(root.locator('h1.wg-live__view-title')).toHaveText('Live');
    await expect(root.locator('.wg-live__featured h2')).toHaveText('精選活動');
    await expect(root.locator('article h3').first()).toBeVisible();
  });

  test('FAQ summary shows the admin entries (max 3) with a link to help; the listening guide links to help', async ({ page }) => {
    await gotoView(page, 'index');
    const root = page.locator('.wg-live');
    const faq = root.locator('.wg-live__faq');
    await expect(faq.locator('details')).toHaveCount(2);
    await expect(faq.locator('summary').first()).toHaveText('【介面示範】需要什麼設備？');
    await faq.locator('summary').first().click();
    await expect(faq.locator('details').first()).toHaveAttribute('open', '');
    await expectHref(faq.getByRole('link', { name: '查看更多說明' }), '/dev/help.html');
    const guide = root.getByRole('heading', { name: '聆聽方式' }).locator('xpath=ancestor::section[1]');
    await expect(guide).toContainText('耳機聆聽 · Binaural');
    await expect(guide).toContainText('家庭劇院 · Dolby Atmos');
    await expectHref(guide.getByRole('link', { name: '閱讀完整聆聽說明' }), '/dev/help.html');
  });

  test('no capability is faked on the events page (no Dolby badge, viewer count or certification text)', async ({ page }) => {
    await gotoView(page, 'index');
    const text = await page.locator('.wg-live').innerText();
    for (const banned of ['已認證', '認證', '7.1.4', '觀看人數', '人正在觀看', '延遲']) {
      expect(text, `banned phrase: ${banned}`).not.toContain(banned);
    }
    await expect(page.locator('.wg-live img[alt*="Dolby"], .wg-live svg[aria-label*="Dolby"]')).toHaveCount(0);
  });
});
