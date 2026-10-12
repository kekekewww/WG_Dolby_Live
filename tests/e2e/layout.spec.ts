/**
 * Plan 7.4 layout: no horizontal scroll on any view at 360x800 and 390x844, targets stay tappable on
 * a narrow screen, the stage keeps its place in the mobile order (spec 5.3), the dialog becomes a
 * bottom sheet at <= 768 px, and layout does not jump when the view mounts (CLS, lab only).
 */
import { test, type Page } from '@playwright/test';
import { expect, gotoPlayer, gotoView, horizontalOverflow, rewriteBootConfig, SLUG_ENDED, SLUG_LIVE, SLUG_PENDING, SLUG_SCHEDULED } from './helpers';

test.describe.configure({ timeout: 90_000 });

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
] as const;

async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  // Let transitions and the minute tick settle, then measure the document and the plugin subtree.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  const result = await horizontalOverflow(page);
  expect(result.offenders, `${label}: elements outside the viewport`).toEqual([]);
  expect(result.wg, `${label}: .wg-live scrolls horizontally`).toBeLessThanOrEqual(0);
  expect(result.doc, `${label}: the page scrolls horizontally`).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`no horizontal scroll at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('events list', async ({ page }) => {
      await gotoView(page, 'index');
      await expectNoHorizontalScroll(page, 'events');
    });

    test('events list, all cards expanded and the FAQ open', async ({ page }) => {
      await gotoView(page, 'index');
      for (const toggle of await page.locator('.wg-live__event-card-toggle').all()) await toggle.click();
      for (const summary of await page.locator('.wg-live__faq summary').all()) await summary.click();
      await expectNoHorizontalScroll(page, 'events expanded');
    });

    test('events list, empty and disabled', async ({ page }) => {
      await rewriteBootConfig(page, /\/dev\/index\.html/, (config) => {
        config.events = [];
      });
      await gotoView(page, 'index');
      await expectNoHorizontalScroll(page, 'events empty');
      await gotoView(page, 'index', { harness: 'disabled' });
      await expectNoHorizontalScroll(page, 'events disabled');
    });

    test('help page (compatibility table stacks instead of scrolling)', async ({ page }) => {
      await gotoView(page, 'help');
      await expectNoHorizontalScroll(page, 'help');
      const table = page.locator('.wg-live__compat-table');
      await expect(table).toBeVisible();
      const wrap = await page.locator('.wg-live__compat-wrap').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(wrap.sw).toBeLessThanOrEqual(wrap.cw + 1);
    });

    test('player: idle, mode chosen', async ({ page }) => {
      const p = await gotoPlayer(page);
      await expectNoHorizontalScroll(page, 'player idle');
      await p.choose('atmos');
      await expectNoHorizontalScroll(page, 'player selecting');
    });

    test('player: playing, dialog open, dev panel open', async ({ page }) => {
      const p = await gotoPlayer(page);
      await p.start('binaural');
      await p.expectAdvancing();
      await expectNoHorizontalScroll(page, 'player playing');
      await p.devPanel.locator('summary').click();
      await expectNoHorizontalScroll(page, 'dev panel open');
      await p.switchButton.scrollIntoViewIfNeeded();
      await p.switchButton.click();
      await expect(p.dialog).toBeVisible();
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')); // the 200 ms slide-in
      await expectNoHorizontalScroll(page, 'dialog open');
      // Bottom sheet: pinned to the bottom edge and as wide as the viewport.
      const box = await p.dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom, vh: window.innerHeight, vw: window.innerWidth };
      });
      expect(box.right - box.left).toBeGreaterThan(box.vw - 4);
      expect(Math.abs(box.bottom - box.vh)).toBeLessThanOrEqual(2);
    });

    test('player: entitlement panels and event states', async ({ page }) => {
      const p = await gotoPlayer(page, { mode: 'binaural' });
      const { entitlement, status } = await p.openDevPanel();
      for (const option of ['未登入', '尚未取得資格', '無法確認資格']) {
        await entitlement.selectOption({ label: option });
        await expectNoHorizontalScroll(page, `entitlement ${option}`);
      }
      for (const option of ['已取消', '已結束', '尚未開始', '即將開放', '中場休息']) {
        await status.selectOption({ label: option });
        await expectNoHorizontalScroll(page, `status ${option}`);
      }
    });

    test('player: failed state with all recovery actions, play blocked', async ({ page }) => {
      const p = await gotoPlayer(page);
      const { fault } = await p.openDevPanel();
      await fault.selectOption({ label: '不支援的來源' });
      await p.start('atmos');
      await expect(p.view).toHaveAttribute('data-status', 'failed');
      await expect(p.action('改用耳機 Binaural')).toBeVisible();
      await expectNoHorizontalScroll(page, 'player failed');
    });

    test('player: real scheduled, ended and not-configured events; not found; disabled', async ({ page }) => {
      for (const slug of [SLUG_SCHEDULED, SLUG_ENDED, SLUG_PENDING]) {
        await gotoPlayer(page, { event: slug });
        await expectNoHorizontalScroll(page, `event ${slug}`);
      }
      await gotoView(page, 'listen', { event: 'no-such-event' });
      await expectNoHorizontalScroll(page, 'not found');
      await gotoView(page, 'listen', { event: 'demo-live-binaural-atmos', harness: 'disabled' });
      await expectNoHorizontalScroll(page, 'player disabled');
    });

    test('player with long unbroken text (a long title, performer and programme line) wraps instead of overflowing', async ({ page }) => {
      await rewriteBootConfig(page, /\/dev\/listen\.html/, (config) => {
        const long = '超長的活動名稱'.repeat(12) + 'A'.repeat(60);
        for (const e of config.events) {
          if (e.slug === 'demo-live-binaural-atmos') {
            e.title = long;
            e.performers = ['很長很長的演出者名稱'.repeat(8), 'B'.repeat(80)];
            e.programme = ['曲目'.repeat(40), 'C'.repeat(90)];
            e.description = 'D'.repeat(200);
          }
        }
      });
      await gotoPlayer(page);
      await expectNoHorizontalScroll(page, 'player long text');
      await rewriteBootConfig(page, /\/dev\/index\.html/, (config) => {
        const long = '超長的活動名稱'.repeat(12) + 'A'.repeat(60);
        for (const e of config.events) {
          e.title = long;
          e.performers = ['E'.repeat(90)];
        }
      });
      await gotoView(page, 'index');
      await expectNoHorizontalScroll(page, 'events long text');
    });

    test('the primary action and mode cards are full-width tap targets', async ({ page }) => {
      const p = await gotoPlayer(page);
      const primary = await p.primary.boundingBox();
      const region = await p.region.boundingBox();
      expect(primary).not.toBeNull();
      expect(region).not.toBeNull();
      expect((primary?.width ?? 0) / (region?.width ?? 1)).toBeGreaterThan(0.6);
      expect(primary?.height ?? 0).toBeGreaterThanOrEqual(47.9); // 48 px target, minus sub-pixel rounding
      const cards = await p.root.locator('.wg-live__mode-card').all();
      expect(cards).toHaveLength(2);
      const [a, b] = await Promise.all(cards.map((c) => c.boundingBox()));
      // Stacked on narrow screens (spec 5.2), each at least 44 px high.
      expect((b?.y ?? 0) - (a?.y ?? 0)).toBeGreaterThan((a?.height ?? 0) - 2);
      expect(a?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  });
}

/**
 * UI-01: base.css keeps <time> on one line, but the full date and zone label (about 290px) is wider than
 * the one-third info column on tablets and wider than a 320px column. The page must not scroll sideways
 * from phone to iPad portrait width.
 */
for (const width of [320, 768, 820, 834]) {
  test.describe(`player page reflows at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    for (const slug of [SLUG_LIVE, SLUG_SCHEDULED, SLUG_ENDED]) {
      test(`event ${slug}: the document does not scroll horizontally`, async ({ page }) => {
        await gotoPlayer(page, { event: slug });
        await expectNoHorizontalScroll(page, `${slug} at ${width}`);
        const times = await page.locator('.wg-live__player-meta time, .wg-live__info-when time').evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { right: r.right, vw: document.documentElement.clientWidth };
          }),
        );
        expect(times.length).toBeGreaterThan(0);
        for (const t of times) expect(t.right).toBeLessThanOrEqual(t.vw + 1);
      });
    }
  });
}

test.describe('wide screens', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('mode cards sit side by side and the player becomes stage + info columns', async ({ page }) => {
    const p = await gotoPlayer(page);
    const cards = await p.root.locator('.wg-live__mode-card').all();
    const [a, b] = await Promise.all(cards.map((c) => c.boundingBox()));
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 99))).toBeLessThan(4);
    expect((b?.x ?? 0)).toBeGreaterThan((a?.x ?? 0) + (a?.width ?? 0) - 2);
    const result = await horizontalOverflow(page);
    expect(result.wg).toBeLessThanOrEqual(0);
  });

  test('the dialog is a centred modal, not a bottom sheet', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    await p.switchButton.click();
    await expect(p.dialog).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    const box = await p.dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, bottom: r.bottom, vh: window.innerHeight, vw: window.innerWidth };
    });
    expect(box.right - box.left).toBeLessThan(box.vw - 100);
    expect(box.bottom).toBeLessThan(box.vh - 20);
  });
});

test.describe('layout stability (lab only)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mounting the player does not shift the layout: CLS stays below 0.1 in this harness', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
            if (!entry.hadRecentInput) w.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        w.__cls = -1; // layout-shift entries are not available in this browser
      }
    });
    await gotoPlayer(page);
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    test.skip(cls === -1, 'layout-shift is not exposed by this browser');
    test.info().annotations.push({ type: 'cls', description: `player CLS ${cls.toFixed(4)} (lab, dev harness)` });
    expect(cls).toBeLessThan(0.1);
  });
});
