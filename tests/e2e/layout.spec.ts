/**
 * Plan 7.4 layout: no horizontal scroll on any view at 360x800 and 390x844, targets stay tappable on
 * a narrow screen, the stage keeps its place in the mobile order (spec 5.3), the dialog becomes a
 * bottom sheet at <= 768 px, and layout does not jump when the view mounts (CLS, lab only).
 */
import { test, type Locator, type Page } from '@playwright/test';
import { asAudioEvent, expect, gotoPlayer, gotoView, horizontalOverflow, rewriteBootConfig, SLUG_ENDED, SLUG_LIVE, SLUG_PENDING, SLUG_SCHEDULED } from './helpers';

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

/**
 * Spec 5.3: the mode panels and the one Start button must be visible without scrolling at a common desktop size
 * (1440x1000), and on a phone (390x844) the first mode panel must start inside the first viewport. This holds for
 * both media kinds: video (the default; stage + head share one row from 1024px) and audio-only (a compact cover).
 */
async function box(locator: Locator): Promise<{ top: number; bottom: number; left: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  expect(b, 'element has a box').not.toBeNull();
  const r = b as { x: number; y: number; width: number; height: number };
  return { top: r.y, bottom: r.y + r.height, left: r.x, width: r.width, height: r.height };
}

/** The fixed site banner of the harness (the live site's Backer Plan bar), if it is showing. */
async function bannerTop(page: Page): Promise<number | null> {
  const banner = page.locator('#wgm-banner');
  if ((await banner.count()) === 0 || !(await banner.isVisible())) return null;
  return (await box(banner)).top;
}

test.describe('video player: stage + head row keeps the mode choice above the fold', () => {
  test.describe('desktop 1440x1000', () => {
    test.use({ viewport: { width: 1440, height: 1000 } });

    test('both mode panels and the Start button are fully inside the first viewport, beside-the-stage layout', async ({ page }) => {
      const p = await gotoPlayer(page);
      await expect(p.view).toHaveAttribute('data-media-kind', 'video');
      const cards = p.root.locator('.wg-live__mode-card');
      await expect(cards).toHaveCount(2);
      const stage = await box(p.root.locator('.wg-live__stage'));
      const content = await box(p.view);
      // The hero: a 16:9 stage of about 60-65% of the content width, on the left.
      expect(stage.width / stage.height).toBeGreaterThan(1.7);
      expect(stage.width / stage.height).toBeLessThan(1.85);
      expect(stage.width / content.width).toBeGreaterThanOrEqual(0.58);
      expect(stage.width / content.width).toBeLessThanOrEqual(0.66);
      // The head (status badge, title, performers / date, status line) sits to the right of the stage, in the same row.
      const title = await box(p.title);
      expect(title.left).toBeGreaterThan(stage.left + stage.width - 1);
      expect(title.top).toBeLessThan(stage.bottom);
      for (const card of await cards.all()) {
        const c = await box(card);
        expect(c.top, 'panel top is below the stage row').toBeGreaterThanOrEqual(stage.bottom - 1);
        expect(c.bottom, 'panel fully inside the viewport').toBeLessThanOrEqual(1000);
      }
      for (const mode of ['binaural', 'atmos'] as const) expect((await box(p.radio(mode))).top).toBeLessThan(1000);
      const start = await box(p.primary);
      expect(start.top, 'Start top inside the viewport').toBeLessThan(1000);
      expect(start.bottom, 'Start fully inside the viewport').toBeLessThanOrEqual(1000);
      // ... and not hidden behind the fixed site banner.
      const banner = await bannerTop(page);
      if (banner !== null) expect(start.bottom, 'Start is above the fixed banner').toBeLessThanOrEqual(banner);
      // The stage stays the largest element of the view.
      const area = (b: { width: number; height: number }): number => b.width * b.height;
      for (const card of await cards.all()) expect(area(stage)).toBeGreaterThan(area(await box(card)));
      expect(area(stage)).toBeGreaterThan(area(await box(p.root.locator('.wg-live__player-head'))));
      await expectNoHorizontalScroll(page, 'video 1440');
    });

    test('after Start the one control bar sits right under the stage + head row', async ({ page }) => {
      const p = await gotoPlayer(page);
      await p.start('binaural');
      await expect(p.view).toHaveAttribute('data-status', /loading|playing/);
      const stage = await box(p.root.locator('.wg-live__stage'));
      const head = await box(p.root.locator('.wg-live__player-head'));
      const bar = await box(p.root.locator('.wg-live__controls'));
      const rowBottom = Math.max(stage.bottom, head.bottom);
      expect(bar.top).toBeGreaterThanOrEqual(rowBottom - 1);
      expect(bar.top - rowBottom).toBeLessThanOrEqual(40);
      expect(bar.bottom, 'the bar is inside the first viewport').toBeLessThanOrEqual(1000);
      // The stage did not move or change size when playback started (no layout jump).
      const after = await box(p.root.locator('.wg-live__stage'));
      expect(Math.abs(after.top - stage.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.width - stage.width)).toBeLessThanOrEqual(1);
    });
  });

  // The laptop fold: on a short viewport (max-height 900px, from 1024px wide) the stage is sized to the height that
  // is left and the mode panels are compact, so both panels and the one Start button are fully inside the first
  // screen. (The fixed site banner of the harness, 80px, still covers the bottom of the screen; it can be dismissed.)
  for (const vp of [
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
  ]) {
    test.describe(`desktop ${vp.width}x${vp.height}: laptop fold`, () => {
      test.use({ viewport: vp });

      test('stage left, head right, both mode panels and Start fully inside the first viewport', async ({ page }) => {
        const p = await gotoPlayer(page);
        await expect(p.view).toHaveAttribute('data-media-kind', 'video');
        const cards = p.root.locator('.wg-live__mode-card');
        await expect(cards).toHaveCount(2);
        const stage = await box(p.root.locator('.wg-live__stage'));
        const title = await box(p.title);
        expect(stage.width / stage.height, 'still a 16:9 stage').toBeGreaterThan(1.7);
        expect(stage.width / stage.height).toBeLessThan(1.85);
        expect(stage.width, 'the stage stays the hero (at least 420px wide)').toBeGreaterThanOrEqual(419);
        expect(title.left, 'the head stays right of the stage').toBeGreaterThan(stage.left + stage.width - 1);
        expect(title.top).toBeLessThan(stage.bottom);
        for (const card of await cards.all()) {
          const c = await box(card);
          expect(c.top, 'panel top is below the stage row').toBeGreaterThanOrEqual(stage.bottom - 1);
          expect(c.bottom, 'panel fully inside the viewport').toBeLessThanOrEqual(vp.height);
        }
        for (const mode of ['binaural', 'atmos'] as const) expect((await box(p.radio(mode))).bottom).toBeLessThanOrEqual(vp.height);
        const start = await box(p.primary);
        expect(start.bottom, 'Start fully inside the viewport').toBeLessThanOrEqual(vp.height);
        // No copy was dropped to get there: the same text is still in the panels and the Start row.
        for (const card of await cards.all()) {
          await expect(card.locator('.wg-live__mode-title')).toBeVisible();
          await expect(card.locator('.wg-live__mode-desc')).toBeVisible();
          await expect(card.locator('.wg-live__mode-helper')).toBeVisible();
        }
        await expect(p.root.locator('.wg-live__mode-legend')).toBeVisible();
        await expect(p.root.locator('.wg-live__mode-help')).toBeVisible();
        await expectNoHorizontalScroll(page, `video ${vp.width}`);
      });

      test('after Start the one control bar is inside the first screen and the stage does not jump', async ({ page }) => {
        // Clicking Start may scroll the page (the fixed site banner can cover the button), so compare document positions.
        const docBox = async (locator: Locator): Promise<{ top: number; bottom: number; width: number }> => {
          const b = await box(locator);
          const scrollY = await page.evaluate(() => window.scrollY);
          return { top: b.top + scrollY, bottom: b.bottom + scrollY, width: b.width };
        };
        const p = await gotoPlayer(page);
        const before = await docBox(p.root.locator('.wg-live__stage'));
        await p.start('binaural');
        await expect(p.view).toHaveAttribute('data-status', /loading|playing/);
        const bar = await docBox(p.root.locator('.wg-live__controls'));
        expect(bar.bottom, 'the bar is inside the first screen').toBeLessThanOrEqual(vp.height);
        const after = await docBox(p.root.locator('.wg-live__stage'));
        expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
      });
    });
  }

  test.describe('tablet 768x1024: the stage is full width, under the head', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('the first mode panel starts inside the first viewport', async ({ page }) => {
      const p = await gotoPlayer(page);
      const stage = await box(p.root.locator('.wg-live__stage'));
      const content = await box(p.view);
      expect(stage.width).toBeGreaterThanOrEqual(content.width - 1);
      expect(stage.width / stage.height).toBeGreaterThan(1.7);
      expect(stage.width / stage.height).toBeLessThan(1.85);
      const first = await box(p.root.locator('.wg-live__mode-card').first());
      expect(first.top, 'first mode panel top inside the viewport').toBeLessThan(1024);
      await expectNoHorizontalScroll(page, 'video 768');
    });
  });

  for (const vp of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test.describe(`phone ${vp.width}x${vp.height}`, () => {
      test.use({ viewport: vp });

      test('keeps the spec 5.3 order and the first mode panel starts inside the first viewport', async ({ page }) => {
        const p = await gotoPlayer(page);
        const first = await box(p.root.locator('.wg-live__mode-card').first());
        expect(first.top, 'first mode panel top inside the viewport').toBeLessThan(vp.height);
        const stage = await box(p.root.locator('.wg-live__stage'));
        const title = await box(p.title);
        // Title and status, then the stage, then the controls (the mode panels).
        expect(title.top).toBeLessThan(stage.top);
        expect(stage.bottom).toBeLessThanOrEqual(first.top + 1);
        const content = await box(p.view);
        expect(stage.width).toBeGreaterThanOrEqual(content.width - 1);
        expect(stage.width / stage.height).toBeGreaterThan(1.7);
        expect(stage.width / stage.height).toBeLessThan(1.85);
        await expectNoHorizontalScroll(page, `video ${vp.width}`);
      });

      test('banner-aware: the status prompt stays above the fixed site banner; the panel and Start positions are recorded', async ({ page }) => {
        const p = await gotoPlayer(page);
        const banner = await bannerTop(page);
        expect(banner, 'the harness shows the mock Backer Plan banner').not.toBeNull();
        const bannerY = banner as number;
        const statusTitle = await box(p.statusTitle);
        await expect(p.statusTitle).toHaveText('請先選擇聆聽模式');
        // What the phone layout guarantees: the status prompt (title + status come first, spec 5.3) is fully visible
        // above the banner. It does NOT guarantee the mode panels or Start: the panels start at or under the banner
        // (known gap, the real banner height is an estimate and must be confirmed on staging), so they are only recorded.
        expect(statusTitle.bottom, 'status prompt is above the banner top').toBeLessThanOrEqual(bannerY);
        const first = await box(p.root.locator('.wg-live__mode-card').first());
        const start = await box(p.primary);
        test.info().annotations.push({
          type: 'phone-banner',
          description: `${vp.width}x${vp.height}: banner top ${Math.round(bannerY)}, status prompt bottom ${Math.round(statusTitle.bottom)}, first mode panel ${Math.round(first.top)}-${Math.round(first.bottom)} (visible above banner: ${Math.max(0, Math.round(bannerY - first.top))}px), Start top ${Math.round(start.top)}`,
        });
      });
    });
  }
});

test.describe('audio player: compact cover keeps the mode choice above the fold', () => {
  test.describe('desktop 1440x1000', () => {
    test.use({ viewport: { width: 1440, height: 1000 } });

    test('both mode panels and the Start button start inside the first viewport', async ({ page }) => {
      await asAudioEvent(page);
      const p = await gotoPlayer(page);
      await expect(p.view).toHaveAttribute('data-media-kind', 'audio');
      const cards = p.root.locator('.wg-live__mode-card');
      await expect(cards).toHaveCount(2);
      const stage = await box(p.root.locator('.wg-live__stage'));
      // A compact cover: roughly square, 280-340 px, never the old 16:9 slab.
      expect(stage.width).toBeGreaterThanOrEqual(279);
      expect(stage.width).toBeLessThanOrEqual(341);
      expect(Math.abs(stage.width - stage.height)).toBeLessThanOrEqual(2);
      for (const mode of ['binaural', 'atmos'] as const) {
        const radio = await box(p.radio(mode));
        expect(radio.top, `${mode} radio panel top inside the viewport`).toBeLessThan(1000);
        expect(radio.top).toBeGreaterThan(0);
      }
      for (const card of await cards.all()) expect((await box(card)).top).toBeLessThan(1000);
      const start = await box(p.primary);
      expect(start.top, 'Start top inside the viewport').toBeLessThan(1000);
      expect(start.bottom, 'Start fully inside the viewport').toBeLessThanOrEqual(1000);
      // The cover sits beside the title, not above it.
      const title = await box(p.title);
      expect(title.left).toBeGreaterThan(stage.left + stage.width - 1);
    });

    test('after Start the one control bar sits right under the cover + title row', async ({ page }) => {
      await asAudioEvent(page);
      const p = await gotoPlayer(page);
      await p.start('binaural');
      await expect(p.view).toHaveAttribute('data-status', /loading|playing/);
      const stage = await box(p.root.locator('.wg-live__stage'));
      const head = await box(p.root.locator('.wg-live__player-head'));
      const bar = await box(p.root.locator('.wg-live__controls'));
      const rowBottom = Math.max(stage.bottom, head.bottom);
      expect(bar.top).toBeGreaterThanOrEqual(rowBottom - 1);
      expect(bar.top - rowBottom).toBeLessThanOrEqual(40);
    });
  });

  test.describe('phone 390x844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the first mode panel starts inside the first viewport, beside a compact cover', async ({ page }) => {
      await asAudioEvent(page);
      const p = await gotoPlayer(page);
      const first = await box(p.root.locator('.wg-live__mode-card').first());
      expect(first.top, 'first mode panel top inside the viewport').toBeLessThan(844);
      const stage = await box(p.root.locator('.wg-live__stage'));
      expect(stage.width).toBeLessThanOrEqual(390 * 0.4 + 1);
      expect(Math.abs(stage.width - stage.height)).toBeLessThanOrEqual(2);
      const title = await box(p.title);
      // Spec 5.3 mobile order is kept: title/status, stage, controls (the cover shares the title's row).
      expect(stage.top).toBeLessThan(title.bottom);
      expect(stage.top).toBeLessThan(first.top);
      await expectNoHorizontalScroll(page, 'compact cover');
    });
  });
});

test.describe('layout stability (lab only)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mounting the player does not shift the layout: CLS stays below 0.02 in this harness', async ({ page }) => {
    // Engines without the 'layout-shift' entry type (the installed Firefox and WebKit) only warn on observe(), which would
    // leave __cls at 0 and pass without measuring anything. Skip there, with the reason on record.
    await page.goto('/dev/index.html');
    const supported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes?.includes('layout-shift') === true);
    test.skip(!supported, 'layout-shift is not in PerformanceObserver.supportedEntryTypes in this browser: nothing would be measured');
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
    expect(cls).toBeLessThan(0.02);
  });
});
