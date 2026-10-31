/**
 * Plan 6.11 / spec 5.5: the help page /live/help/ renders the fixed sections in order, the
 * compatibility table with 尚待測試 for untested rows, the keyboard shortcuts and the contact link. It
 * stays available when the deployment mode is disabled (D16).
 */
import { test } from '@playwright/test';
import { expect, expectHref, gotoView, isMediaUrl, isRestUrl, recordRequests } from './helpers';

test.describe.configure({ timeout: 60_000 });

// Decision 2026-11-01: one Dolby Atmos stream; 切換模式 became 用 VLC 收聽.
const SECTION_HEADINGS = ['播放方式', '瀏覽器與驗收說明', '家庭劇院連接方式', '沒有聲音時', '重新連線', '用 VLC 收聽', '鍵盤操作', '聯絡我們'];

test('the fixed sections appear in the documented order, followed by the admin FAQ', async ({ page }) => {
  const rest = recordRequests(page, (u) => isRestUrl(u) || isMediaUrl(u));
  await gotoView(page, 'help');
  const root = page.locator('.wg-live');
  await expect(root.locator('.wg-live__heading').first()).toBeVisible();
  const headings = (await root.locator('section > h2, section > h3').allTextContents()).map((t) => t.trim());
  const indexes = SECTION_HEADINGS.map((name) => headings.indexOf(name));
  expect(indexes.every((i) => i >= 0), `headings: ${headings.join(' | ')}`).toBe(true);
  expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  expect(headings.indexOf('常見問題'), 'admin FAQ follows the fixed sections').toBeGreaterThan(indexes[indexes.length - 1] as number);
  expect(rest.count(), 'static page: no REST, no media').toBe(0);
});

test('the 播放方式 section describes one Dolby Atmos stream, Safari and VLC, and the label note', async ({ page }) => {
  await gotoView(page, 'help');
  const modes = page.locator('.wg-live__help-section--modes');
  await expect(modes).toContainText('每場音樂會提供一個 Dolby Atmos 串流');
  await expect(modes).toContainText('Mac、iPhone、iPad · Safari');
  await expect(modes).toContainText('Windows 與其他瀏覽器 · VLC');
  await expect(modes).not.toContainText('Binaural');
  await expect(modes).toContainText('只代表播放的音訊版本，不代表已確認裝置的輸出方式');
});

test('the Safari-first note does not block other browsers and promises no state the UI never shows', async ({ page }) => {
  await gotoView(page, 'help');
  const safari = page.locator('.wg-live__help-section--safari');
  await expect(safari).toContainText('Safari');
  await expect(safari).toContainText('不依瀏覽器名稱限制使用');
  await expect(safari).not.toContainText('尚未確認');
});

test('the compatibility table is a real table; untested rows read 尚待測試; nothing is claimed supported', async ({ page }) => {
  await gotoView(page, 'help');
  const section = page.locator('.wg-live__help-section--compat');
  const table = section.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table).toHaveAccessibleName(/家庭劇院相容表/);
  for (const column of ['裝置', '作業系統', '瀏覽器', '輸出路徑', '來源格式', '測試結果', '測試日期', '備註']) {
    await expect(table.getByRole('columnheader', { name: column })).toBeVisible();
  }
  const rows = table.locator('tbody tr, tr.wg-live__compat-row');
  await expect(rows).toHaveCount(2);
  await expect(section.locator('.wg-live__compat-status')).toHaveText(['尚待測試', '尚待測試']);
  await expect(section).not.toContainText('已驗證');
  await expect(section).not.toContainText('支援 Atmos');
  await expect(section).toContainText('不代表支援，也不代表不支援');
  await expect(section.locator('.wg-live__compat-row').first()).toContainText('iPhone / iPad');
});

test('no-sound steps, reconnecting and the VLC section state the real behaviour', async ({ page }) => {
  await gotoView(page, 'help');
  await expect(page.locator('.wg-live__help-section--no-sound')).toBeVisible();
  const root = page.locator('.wg-live');
  await expect(root).toContainText('確認已按下「開始聆聽」，且畫面顯示「播放中」');
  await expect(root).toContainText('自動重試，最多 3 次');
  await expect(root).toContainText('無法播放，請重試');
  await expect(root).toContainText('取得我的播放連結');
  await expect(root).toContainText('媒體 → 開啟網路串流');
  await expect(root).not.toContainText('改用耳機 Binaural'); // the demo label 「非 Binaural／Atmos 驗證素材」 stays (CLAUDE.md)
});

test('keyboard section documents Tab, Enter/Space and K in the player (no Esc: no switch dialog)', async ({ page }) => {
  await gotoView(page, 'help');
  const keyboard = page.locator('.wg-live__help-section--keyboard');
  await expect(keyboard).toContainText('Tab');
  await expect(keyboard).toContainText('Enter');
  await expect(keyboard).toContainText('K');
  await expect(keyboard).not.toContainText('Esc');
  await expect(keyboard).toContainText('焦點在播放器內（輸入欄位除外）時，切換播放與暫停');
  await expect(keyboard.locator('kbd').first()).toBeVisible();
});

test('contact: the support note comes first, then the contact link', async ({ page }) => {
  await gotoView(page, 'help');
  const contact = page.locator('.wg-live__help-section--contact');
  await expect(contact).toContainText('這是介面示範用的客服說明。');
  await expectHref(contact.getByRole('link', { name: '聯絡我們' }), '/dev/stub.html?page=contact');
});

test('admin FAQ items render as disclosure widgets after the fixed sections', async ({ page }) => {
  await gotoView(page, 'help');
  const faq = page.locator('.wg-live').getByRole('heading', { name: '常見問題' }).locator('xpath=ancestor::section[1]');
  const items = faq.locator('details');
  await expect(items).toHaveCount(2);
  await expect(items.first().locator('summary')).toHaveText('【介面示範】需要什麼設備？');
  await items.first().locator('summary').click();
  await expect(items.first()).toContainText('這是示範內容。');
  await expect(items.first()).toHaveAttribute('open', '');
});

test('an empty FAQ is valid: no FAQ section, no empty heading', async ({ page }) => {
  await page.route(/\/dev\/help\.html/, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const re = /(<script type="application\/json" class="wg-live__config">)([\s\S]*?)(<\/script>)/;
    const match = re.exec(html);
    if (!match) throw new Error('config script not found');
    const config = JSON.parse(match[2] as string);
    config.help.faq = [];
    await route.fulfill({ response, body: html.replace(re, (_m, a: string, _b: string, c: string) => `${a}${JSON.stringify(config)}${c}`) });
  });
  await gotoView(page, 'help');
  await expect(page.locator('.wg-live').getByRole('heading', { name: '常見問題' })).toHaveCount(0);
  await expect(page.locator('.wg-live__help-section--contact')).toBeVisible();
});

test('the help page stays available when the deployment mode is disabled (D16)', async ({ page }) => {
  await gotoView(page, 'help', { harness: 'disabled' });
  await expect(page.locator('.wg-live').getByRole('heading', { name: '播放方式' })).toBeVisible();
  await expect(page.locator('.wg-live__help-section--compat')).toBeVisible();
});

test('heading=h1 promotes the view title; sections move to h2', async ({ page }) => {
  await gotoView(page, 'help', { query: { heading: 'h1' } });
  const root = page.locator('.wg-live');
  await expect(root.locator('h1')).toHaveCount(1);
  await expect(root.locator('h2').first()).toBeVisible();
  await expect(root.locator('h1')).toContainText('Listening Guide');
});

test('exactly one top-level title per page: with the default heading the plugin adds no h1', async ({ page }) => {
  await gotoView(page, 'help');
  await expect(page.locator('.wg-live h1')).toHaveCount(0);
  await expect(page.locator('.wg-live h2').first()).toBeVisible();
});
