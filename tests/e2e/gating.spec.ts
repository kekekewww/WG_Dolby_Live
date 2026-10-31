/**
 * Plan 7.4 F02 (direct player, unknown slug), F10 (cancelled / ended / no source / dev panel states,
 * entitlement panels, disabled, not_configured), F12 (unknown wg_mode) and the dev-panel gating (D17).
 */
import { test } from '@playwright/test';
import {
  expect,
  expectHref,
  gotoPlayer,
  gotoView,
  isMediaUrl,
  isRestUrl,
  recordRequests,
  rewriteBootConfig,
  SLUG_ENDED,
  SLUG_LIVE,
  SLUG_PENDING,
  SLUG_SCHEDULED,
} from './helpers';

test.describe.configure({ timeout: 90_000 });

test.describe('F02 direct player link', () => {
  test('renders the event: title with demo badge, status, performers, time, info and programme', async ({ page }) => {
    const p = await gotoPlayer(page);
    await expect(p.title).toContainText('【介面示範】錄音室現場音樂會 Live');
    // The badge sits in the meta row above the title; the heading's accessible name still includes it.
    await expect(p.root.locator('.wg-live__meta-row .wg-live__badge--demo')).toHaveText('介面示範');
    await expect(p.title).toHaveAccessibleName(/錄音室現場音樂會 Live.*介面示範/);
    await expect(p.statusBadge).toHaveText('演出中');
    await expect(p.root.locator('.wg-live__player-meta')).toContainText('演出者：示範樂手 A、示範樂手 B');
    await expect(p.root.locator('.wg-live__player-meta time')).toHaveText(/台北時間/);
    await expect(p.root.getByRole('heading', { name: '活動資訊' })).toBeVisible();
    await expect(p.root.locator('.wg-live__info')).toContainText('這是介面示範活動');
    await expect(p.root.getByRole('heading', { name: '節目單' })).toBeVisible();
    await expect(p.root.locator('.wg-live__programme-list li')).toHaveText(['示範曲目 一', '示範曲目 二', '示範曲目 三']);
    await expect(p.root.locator('.wg-live__programme-note')).toContainText('不代表目前正在播放的曲目');
    await expect(p.root.locator('.wg-live__help-link a')).toHaveText('聆聽說明');
    await expectHref(p.root.locator('.wg-live__help-link a'), '/dev/help.html');

    // The player is a labelled group; the shortcuts are advertised on the play button (UI-08).
    await expect(p.region).toHaveAttribute('role', 'group');
    await expect(p.region).toHaveAccessibleName('音樂會播放器');
    expect(await p.region.getAttribute('aria-keyshortcuts')).toBeNull();
    await expect(p.primary).toHaveAttribute('aria-keyshortcuts', 'Space K');
    // The skeleton is gone and the media element is the single stable one, without controls/autoplay.
    await expect(page.locator('.wg-live__skeleton')).toHaveCount(0);
    await expect(page.locator('audio, video')).toHaveCount(1);
    await expect(page.locator('.wg-live__stage video')).toHaveCount(1); // every concert is streamed with video
    await expect(page.locator('audio')).toHaveCount(0);
  });

  test('both modes are offered side by side with the spec 5.2 copy, nothing selected', async ({ page }) => {
    const p = await gotoPlayer(page);
    const group = p.root.getByRole('group', { name: '選擇聆聽模式' });
    await expect(group).toBeVisible();
    await expect(group).toContainText('耳機聆聽 · Binaural');
    await expect(group).toContainText('使用耳機聆聽錄音室製作的雙耳版本。');
    await expect(group).toContainText('一般耳機即可播放此版本；音訊效果依錄音室交付內容為準。');
    await expect(group).toContainText('選擇耳機模式');
    await expect(group).toContainText('家庭劇院 · Dolby Atmos');
    await expect(group).toContainText('適用於經確認的播放裝置、連接方式與 Atmos 家庭劇院。');
    await expect(group).toContainText('請先閱讀支援條件；選用 Atmos 音軌不等於系統已確認最終設備輸出。');
    await expect(group).toContainText('選擇家庭劇院模式');
    await expect(p.radio('binaural')).not.toBeChecked();
    await expect(p.radio('atmos')).not.toBeChecked();
    await expectHref(group.getByRole('link', { name: '閱讀聆聽說明與支援條件' }), '/dev/help.html');
    // No Dolby badge or certification claim is rendered.
    await expect(p.root).not.toContainText('認證');
    await expect(p.root).not.toContainText('7.1.4');
  });

  test('unknown slug -> 找不到這場活動 with a link back to the list, no controller and no requests', async ({ page }) => {
    const rest = recordRequests(page, isRestUrl);
    const media = recordRequests(page, isMediaUrl);
    await gotoView(page, 'listen', { event: 'no-such-event' });
    const root = page.locator('.wg-live');
    await expect(root.getByRole('heading', { name: '找不到這場活動' })).toBeVisible();
    await expect(root).toContainText('這場活動可能已下架，或連結有誤。');
    await expectHref(root.getByRole('link', { name: '返回活動列表' }), '/dev/index.html');
    await expectHref(root.getByRole('link', { name: '聆聽說明' }), '/dev/help.html');
    await expect(root.locator('.wg-live__player-view--unavailable')).toHaveAttribute('data-gate', 'not_found');
    await expect(root.locator('audio, video')).toHaveCount(0);
    await expect(root.getByRole('radio')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(rest.count()).toBe(0);
    expect(media.count()).toBe(0);
  });

  for (const [label, query] of [
    ['missing wg_event', undefined],
    ['empty', ''],
    ['uppercase', 'DEMO-LIVE-BINAURAL-ATMOS'],
    ['path traversal', '../../etc/passwd'],
    ['Chinese', '錄音室'],
    ['trailing hyphen', 'demo-live-'],
    ['markup', '<img src=x onerror=alert(1)>'],
  ] as const) {
    test(`an invalid wg_event is treated as not found: ${label}`, async ({ page }) => {
      const url = query === undefined ? '/dev/listen.html' : `/dev/listen.html?wg_event=${encodeURIComponent(query)}`;
      await page.goto(url);
      await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
      await expect(page.locator('.wg-live').getByRole('heading', { name: '找不到這場活動' })).toBeVisible();
      await expect(page.locator('audio, video')).toHaveCount(0);
    });
  }

  test('a repeated wg_event is refused as ambiguous', async ({ page }) => {
    await page.goto(`/dev/listen.html?wg_event=${SLUG_LIVE}&wg_event=${SLUG_SCHEDULED}`);
    await expect(page.locator('.wg-live').getByRole('heading', { name: '找不到這場活動' })).toBeVisible();
  });

  test('the fixed event of the shortcode wins over ?wg_event=', async ({ page }) => {
    const p = await gotoPlayer(page, { event: SLUG_SCHEDULED, query: { fixed: SLUG_LIVE } });
    await expect(p.title).toContainText('【介面示範】錄音室現場音樂會 Live');
  });

  test('disabled deployment mode -> 線上音樂會尚未開放 with home and contact links, no requests', async ({ page }) => {
    const rest = recordRequests(page, isRestUrl);
    const p = await gotoPlayer(page, { harness: 'disabled' });
    await expect(p.root.getByRole('heading', { name: '線上音樂會尚未開放' })).toBeVisible();
    await expectHref(p.root.getByRole('link', { name: '回首頁' }), '/dev/stub.html?page=home');
    await expectHref(p.root.getByRole('link', { name: '聯絡我們' }), '/dev/stub.html?page=contact');
    await expect(p.media).toHaveCount(0);
    await expect(p.root.getByRole('radio')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(rest.count()).toBe(0);
  });
});

test.describe('F10 event states (real event data)', () => {
  test('scheduled: 演出尚未開始 with the start time and help link; modes selectable, Start disabled with the reason', async ({ page }) => {
    const p = await gotoPlayer(page, { event: SLUG_SCHEDULED });
    await expect(p.statusTitle).toHaveText('演出尚未開始');
    await expect(p.statusDetail).toHaveText(/^開始時間：.*台北時間$/);
    await expectHref(p.root.locator('.wg-live__status').getByRole('link', { name: '聆聽說明' }), '/dev/help.html');
    await expect(p.statusBadge).toHaveText('尚未開始');
    await expect(p.startReason).toHaveText('請先選擇聆聽模式');
    await p.radio('atmos').check();
    await expect(p.radio('atmos')).toBeChecked();
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    await expect(p.startReason).toHaveText('演出開始前無法聆聽，請於演出時間再回來');
    await expect(p.modeLabel).toHaveText('已選擇：Dolby Atmos 音軌');
    await p.primary.click({ force: true });
    await expect(p.statusTitle).toHaveText('演出尚未開始'); // a click on the disabled button does nothing
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused && !a.hasAttribute('src'))).toBe(true);
  });

  test('ended: 本場演出已結束 with a link back to the events, no controls, no replay', async ({ page }) => {
    const p = await gotoPlayer(page, { event: SLUG_ENDED });
    await expect(p.statusTitle).toHaveText('本場演出已結束');
    await expect(p.statusBadge).toHaveText('已結束');
    await expectHref(p.root.getByRole('link', { name: '返回活動列表' }), '/dev/index.html');
    await expect(p.root.getByRole('radio')).toBeHidden();
    await expect(p.primary).toBeHidden();
    await expect(p.root.getByRole('link', { name: /回放|重播/ })).toHaveCount(0);
  });

  test('non-demo event without a source: 播放來源尚未開放, 查看活動資訊 moves focus to the info section', async ({ page }) => {
    const p = await gotoPlayer(page, { event: SLUG_PENDING });
    await expect(p.statusTitle).toHaveText('播放來源尚未開放');
    await expect(p.statusDetail).toContainText('這場活動的播放來源尚未開放');
    await expect(p.root.getByRole('radio')).toBeHidden();
    await expect(p.primary).toBeHidden();
    // Plan 6.2: entitlement is not fetched behind a blocking gate, so there is no entitlement panel.
    await expect(p.entitlement).toBeHidden();
    await p.action('查看活動資訊').click();
    await expect(p.root.getByRole('heading', { name: '活動資訊' })).toBeFocused();
  });

  test('a real event with a source we cannot play never starts: no media request is ever made', async ({ page }) => {
    const media = recordRequests(page, isMediaUrl);
    await gotoPlayer(page, { event: SLUG_PENDING, mode: 'binaural' });
    await page.waitForTimeout(500);
    expect(media.count()).toBe(0);
  });
});

test.describe('F10 dev panel states', () => {
  test('the panel is a collapsed <details> that says it changes the display only', async ({ page }) => {
    const p = await gotoPlayer(page);
    await expect(p.devPanel).toBeVisible();
    await expect(p.devPanel).not.toHaveAttribute('open', '');
    await expect(p.devPanel.locator('summary')).toHaveText('開發用示範面板（正式站不顯示）');
    const { status } = await p.openDevPanel();
    await expect(p.devPanel).toContainText('只改變畫面顯示，不會改變伺服器上的活動、權限或播放來源');
    await expect(status).toBeVisible();
    await expect(p.devPanel.locator('.wg-live__dev-simulated')).toBeHidden();
  });

  const statusCases: Array<{ option: string; title: string; badge: string; extra?: (p: Awaited<ReturnType<typeof gotoPlayer>>) => Promise<void> }> = [
    {
      option: '已取消',
      title: '本場活動已取消',
      badge: '已取消',
      extra: async (p) => {
        await expect(p.statusDetail).toHaveText('詳細資訊請見活動公告，或聯絡我們。');
        await expectHref(p.root.locator('.wg-live__status').getByRole('link', { name: '聯絡我們' }), '/dev/stub.html?page=contact');
        await expect(p.root.getByRole('radio')).toBeHidden();
      },
    },
    {
      option: '已結束',
      title: '本場演出已結束',
      badge: '已結束',
      extra: async (p) => {
        await expectHref(p.root.locator('.wg-live__status').getByRole('link', { name: '返回活動列表' }), '/dev/index.html');
        await expect(p.root.getByRole('radio')).toBeHidden();
      },
    },
    {
      option: '尚未開始',
      title: '演出尚未開始',
      badge: '尚未開始',
      extra: async (p) => {
        await expect(p.statusDetail).toContainText('開始時間：');
      },
    },
    {
      option: '即將開放',
      title: '即將開放聆聽',
      badge: '即將開放',
      extra: async (p) => {
        await expect(p.statusDetail).toHaveText('開放後即可按「開始聆聽」。');
        await p.radio('binaural').check(); // mode selection works, Start stays disabled
        await expect(p.radio('binaural')).toBeChecked();
        await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
        await expect(p.startReason).toHaveText('尚未開放聆聽，開放後即可開始');
      },
    },
    {
      option: '中場休息',
      title: '演出中場休息',
      badge: '中場休息',
      extra: async (p) => {
        await p.radio('binaural').check();
        await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true'); // intermission: Start can be enabled
      },
    },
    {
      option: '演出中',
      title: '請先選擇聆聽模式',
      badge: '演出中',
    },
  ];

  for (const c of statusCases) {
    test(`event status ${c.option} shows the plan copy`, async ({ page }) => {
      const p = await gotoPlayer(page);
      const { status } = await p.openDevPanel();
      // Start from another state so that 演出中 is a real change.
      if (c.option === '演出中') await status.selectOption({ label: '已取消' });
      await status.selectOption({ label: c.option });
      await expect(p.statusBadge).toHaveText(c.badge);
      if (c.option === '演出中') {
        await expect(p.statusTitle).toHaveText(c.title);
      } else if (c.option === '中場休息') {
        await expect(p.statusTitle).toHaveText('演出中場休息');
        await expect(p.statusDetail).toHaveText('請先選擇聆聽模式');
      } else {
        await expect(p.statusTitle).toHaveText(c.title);
      }
      await expect(p.devPanel.locator('.wg-live__dev-simulated')).toBeVisible();
      await expect(p.devPanel.locator('.wg-live__dev-simulated')).toHaveText('目前顯示的是模擬狀態');
      await c.extra?.(p);
      // The live region carries the status change, not a countdown.
      if (c.option !== '演出中' && c.option !== '中場休息') {
        await expect(p.srStatus).toContainText(`活動狀態更新：${c.badge}`);
      }
    });
  }

  test('reset returns to the real status', async ({ page }) => {
    const p = await gotoPlayer(page);
    const { status, reset } = await p.openDevPanel();
    await status.selectOption({ label: '已取消' });
    await expect(p.statusTitle).toHaveText('本場活動已取消');
    await reset.click();
    await expect(status).toHaveValue('');
    await expect(p.statusBadge).toHaveText('演出中');
    await expect(p.statusTitle).toHaveText('請先選擇聆聽模式');
    await expect(p.devPanel.locator('.wg-live__dev-simulated')).toBeHidden();
    await expect(p.root.getByRole('radio', { name: /選擇耳機模式/ })).toBeVisible();
  });

  test('doors_open -> live enables Start without starting playback (no autostart)', async ({ page }) => {
    const media = recordRequests(page, isMediaUrl);
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { status } = await p.openDevPanel();
    await status.selectOption({ label: '即將開放' });
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    await expect(p.radio('binaural')).toBeChecked(); // selection kept
    await status.selectOption({ label: '演出中' });
    await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(500);
    expect(media.count()).toBe(0);
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
  });

  test('playing then ended/cancelled stops the stream, closes the dialog and shows the gate copy', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    await p.switchButton.click();
    await expect(p.dialog).toBeVisible();
    // The page is modal now; the dev panel sits behind the dialog, so drive the dev controls through the DOM.
    await p.page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>('.wg-live__dev-select');
      if (!select) throw new Error('dev select missing');
      select.value = 'ended';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(p.statusTitle).toHaveText('本場演出已結束');
    await expect(p.dialog).toBeHidden();
    await expect.poll(() => p.media.evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.hasAttribute('src')), 'the source is released').toBe(false);
    await expect(p.media).toHaveCount(1);
  });

  test('playing then scheduled stops playback but keeps the selected mode; intermission changes nothing', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('atmos');
    await p.expectAdvancing();
    const { status } = await p.openDevPanel();

    await status.selectOption({ label: '中場休息' });
    await expect(p.statusBadge).toHaveText('中場休息');
    await expect(p.statusTitle).toHaveText('播放中');
    await expect(p.statusDetail).toHaveText('演出中場休息');
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused), 'intermission does not touch the adapter').toBe(false);

    await status.selectOption({ label: '尚未開始' });
    await expect(p.statusTitle).toHaveText('演出尚未開始');
    await expect.poll(() => p.media.evaluate((a: HTMLMediaElement) => a.paused)).toBe(true);
    await expect(p.radio('atmos')).toBeChecked();
    await expect(p.modeLabel).toHaveText('已選擇：Dolby Atmos 音軌');
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('F10 entitlement panels', () => {
  test('guest -> 請先登入 with the account link; Start is blocked and says why', async ({ page }) => {
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '未登入' });
    await expect(p.entitlement).toBeVisible();
    await expect(p.entitlement.locator('.wg-live__entitlement-message')).toHaveText('請先登入');
    await expectHref(p.entitlement.getByRole('link', { name: '登入' }), '/dev/stub.html?page=account');
    await expect(p.entitlement).toContainText('觀看資格由伺服器端確認');
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    await expect(p.startReason).toHaveText('請先登入');
    // The status message and the entitlement panel are separate things (plan 6.2).
    await expect(p.statusTitle).not.toHaveText('請先登入');
  });

  test('not_entitled -> 尚未取得觀看資格; 購票 appears only with a product URL', async ({ page }) => {
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '尚未取得資格' });
    await expect(p.entitlement.locator('.wg-live__entitlement-message')).toHaveText('尚未取得觀看資格');
    await expect(p.entitlement.getByRole('link', { name: '購票' })).toHaveCount(0); // demo event has no product URL
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    await expect(p.startReason).toHaveText('尚未取得觀看資格');
  });

  test('not_entitled with a product URL shows 購票 linking to it', async ({ page }) => {
    await rewriteBootConfig(page, /\/dev\/listen\.html/, (config) => {
      for (const e of config.events) if (e.slug === SLUG_LIVE) e.productUrl = 'https://example.com/shop/demo-live';
    });
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '尚未取得資格' });
    await expectHref(p.entitlement.getByRole('link', { name: '購票' }), 'https://example.com/shop/demo-live');
  });

  test('unavailable -> 暫時無法確認觀看資格 with 重試 and a contact link; fail closed', async ({ page }) => {
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '無法確認資格' });
    await expect(p.entitlement.locator('.wg-live__entitlement-message')).toHaveText('暫時無法確認觀看資格');
    await expect(p.entitlement.getByRole('button', { name: '重試' })).toBeVisible();
    await expectHref(p.entitlement.getByRole('link', { name: '聯絡我們' }), '/dev/stub.html?page=contact');
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    await expect(p.startReason).toHaveText('暫時無法確認觀看資格');
    // 重試 re-checks; the simulated answer is still "unavailable", so Start stays blocked.
    await p.entitlement.getByRole('button', { name: '重試' }).click();
    await expect(p.entitlement.locator('.wg-live__entitlement-message')).toHaveText('暫時無法確認觀看資格');
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
    // Back to the default rule: entitled again, Start enabled.
    await entitlement.selectOption({ label: '使用預設' });
    await expect(p.entitlement).toBeHidden();
    await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('entitled (simulated) shows no panel', async ({ page }) => {
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '已取得資格' });
    await expect(p.entitlement).toBeHidden();
    await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a non-entitled override never lets a stream start (fail closed on playback)', async ({ page }) => {
    const media = recordRequests(page, isMediaUrl);
    const p = await gotoPlayer(page, { mode: 'binaural' });
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '未登入' });
    await p.primary.click({ force: true });
    await page.waitForTimeout(500);
    expect(media.count()).toBe(0);
    await expect(p.statusTitle).not.toHaveText('播放中');
  });
});

test.describe('dev panel gating (D17)', () => {
  test('?harness=nodev (what production sends): no panel, no dev strings, no dev controls anywhere', async ({ page }) => {
    const p = await gotoPlayer(page, { harness: 'nodev' });
    await expect(p.devPanel).toHaveCount(0);
    await expect(p.root.locator('[class*="wg-live__dev"]')).toHaveCount(0);
    await expect(p.root).not.toContainText('開發用示範面板');
    await expect(p.root).not.toContainText('模擬狀態');
  });

  test('public query parameters cannot change playback conditions', async ({ page }) => {
    // Neither ?paid=true, ?debug=1, ?harness=... nor a dev flag opens playback for a real event.
    const p = await gotoPlayer(page, { event: SLUG_PENDING, harness: 'nodev', query: { paid: 'true', debug: '1', entitled: '1', devTools: '1' } });
    await expect(p.statusTitle).toHaveText('播放來源尚未開放');
    await expect(p.devPanel).toHaveCount(0);
    await expect(p.primary).toBeHidden();
  });

  test('a simulated entitlement is ignored for a real (non-demo) event', async ({ page }) => {
    // Force the pending event's gate open by pretending it is live+demo-less: the dev select does not exist for
    // blocked gates, so the rule is exercised through the boot config instead.
    await rewriteBootConfig(page, /\/dev\/listen\.html/, (config) => {
      for (const e of config.events) {
        if (e.slug === SLUG_PENDING) {
          e.sourceKind = 'demo'; // pretend the server said demo, but the event is not a demo event
        }
      }
    });
    const p = await gotoPlayer(page, { event: SLUG_PENDING, mode: 'binaural' });
    await expect(p.statusTitle).not.toHaveText('播放中');
    const { entitlement } = await p.openDevPanel();
    await entitlement.selectOption({ label: '已取得資格' });
    await expect(p.entitlement.locator('.wg-live__entitlement-message')).toHaveText('暫時無法確認觀看資格');
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('F12 mode parameter', () => {
  for (const [label, value] of [
    ['unknown value', 'bogus'],
    ['uppercase', 'ATMOS'],
    ['empty', ''],
    ['markup', '<script>alert(1)</script>'],
    ['demo-style flag', 'demo'],
  ] as const) {
    test(`an invalid wg_mode is ignored: ${label}`, async ({ page }) => {
      const media = recordRequests(page, isMediaUrl);
      const rest = recordRequests(page, (u) => /playback/.test(u) && isRestUrl(u));
      const p = await gotoPlayer(page, { mode: value });
      await expect(p.radio('binaural')).not.toBeChecked();
      await expect(p.radio('atmos')).not.toBeChecked();
      await expect(p.statusTitle).toHaveText('請先選擇聆聽模式');
      await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
      await page.waitForTimeout(300);
      expect(media.count()).toBe(0);
      expect(rest.count(), 'no descriptor is prefetched for an ignored mode').toBe(0);
    });
  }

  test('a repeated wg_mode is ambiguous and ignored', async ({ page }) => {
    await page.goto(`/dev/listen.html?wg_event=${SLUG_LIVE}&wg_mode=atmos&wg_mode=binaural`);
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
    await expect(page.getByRole('radio', { name: /選擇家庭劇院模式/ })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: /選擇耳機模式/ })).not.toBeChecked();
  });

  test('a valid wg_mode that the event does not offer is ignored', async ({ page }) => {
    await rewriteBootConfig(page, /\/dev\/listen\.html/, (config) => {
      for (const e of config.events) if (e.slug === SLUG_LIVE) e.availableModes = ['binaural'];
    });
    const p = await gotoPlayer(page, { mode: 'atmos' });
    // Decision 2026-11-01: a single-mode event shows no selector and preselects its only mode; ?wg_mode=atmos is ignored.
    await expect(p.root.getByRole('radio')).toHaveCount(0);
    await expect(p.modeLabel).toHaveText('已選擇：Binaural');
    await expect(p.statusTitle).not.toHaveText('請先選擇聆聽模式');
  });

  test('the remembered mode preselects after a successful start; garbage in storage is ignored', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('atmos');
    await p.expectAdvancing();
    expect(await page.evaluate(() => localStorage.getItem('wg-live:mode'))).toBe('atmos');

    await page.reload();
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
    await expect(p.radio('atmos')).toBeChecked();
    await expect(p.media).toHaveCount(1);
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.paused), 'a remembered mode never autostarts').toBe(true);

    // An explicit valid parameter wins over the remembered one.
    await page.goto(`/dev/listen.html?wg_event=${SLUG_LIVE}&wg_mode=binaural`);
    await expect(p.radio('binaural')).toBeChecked();

    await page.evaluate(() => localStorage.setItem('wg-live:mode', 'surround-51'));
    await page.goto(`/dev/listen.html?wg_event=${SLUG_LIVE}`);
    await expect(page.locator('.wg-live[data-wg-live-mounted="1"]')).toBeAttached();
    await expect(p.radio('binaural')).not.toBeChecked();
    await expect(p.radio('atmos')).not.toBeChecked();
  });

  test('blocked storage does not break the page', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
  });
});

test.describe('plain permalink REST root', () => {
  test('?harness=plain: descriptors are fetched through index.php?rest_route= and playback works', async ({ page }) => {
    const rest = recordRequests(page, (u) => /rest_route=/.test(u));
    const pretty = recordRequests(page, (u) => /\/wp-json\//.test(u));
    const p = await gotoPlayer(page, { harness: 'plain' });
    await p.start('atmos');
    await p.expectAdvancing();
    expect(rest.urls.some((u) => u.includes('rest_route=/wg-live/v1/playback') && u.includes('mode=atmos') && u.includes('event=9001'))).toBe(true);
    expect(pretty.count()).toBe(0);
  });

  test('?harness=disabled,plain still shows the disabled panel without REST traffic', async ({ page }) => {
    const rest = recordRequests(page, isRestUrl);
    const p = await gotoPlayer(page, { harness: 'disabled,plain' });
    await expect(p.root.getByRole('heading', { name: '線上音樂會尚未開放' })).toBeVisible();
    await page.waitForTimeout(300);
    expect(rest.count()).toBe(0);
  });
});
