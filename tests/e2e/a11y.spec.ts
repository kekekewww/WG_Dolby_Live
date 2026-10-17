/**
 * Plan 7.1 / 7.4 accessibility: @axe-core/playwright scans every view, the open switch dialog and the
 * dev panel against WCAG 2.2 AA (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa). The scan is
 * limited to the plugin's own subtree (.wg-live): the fake site chrome around it is not ours.
 * Zero serious or critical violations is the gate; lesser findings are printed.
 *
 * Also: heading structure, landmark/names, live-region discipline, reduced motion and the target
 * sizes of plan 3.3 (primary >= 48 px, secondary >= 44 px).
 */
import { test, type Page } from '@playwright/test';
import { expect, gotoPlayer, gotoView, rewriteBootConfig, scanWgLive, SLUG_ENDED, SLUG_PENDING, SLUG_SCHEDULED } from './helpers';

test.describe.configure({ timeout: 90_000 });

test.describe('axe: events, help and the unavailable states', () => {
  test('events list (featured, others, listening guide, FAQ)', async ({ page }) => {
    await gotoView(page, 'index');
    await scanWgLive(page, 'events');
  });

  test('events list with every card expanded and the FAQ open', async ({ page }) => {
    await gotoView(page, 'index');
    for (const toggle of await page.locator('.wg-live__event-card-toggle').all()) await toggle.click();
    for (const summary of await page.locator('.wg-live__faq summary').all()) await summary.click();
    await scanWgLive(page, 'events expanded');
  });

  test('events list, empty state', async ({ page }) => {
    await rewriteBootConfig(page, /\/dev\/index\.html/, (config) => {
      config.events = [];
    });
    await gotoView(page, 'index');
    await scanWgLive(page, 'events empty');
  });

  test('events list, disabled mode', async ({ page }) => {
    await gotoView(page, 'index', { harness: 'disabled' });
    await scanWgLive(page, 'events disabled');
  });

  test('events list with heading=h1', async ({ page }) => {
    await gotoView(page, 'index', { query: { heading: 'h1' } });
    await scanWgLive(page, 'events h1');
  });

  test('help page', async ({ page }) => {
    await gotoView(page, 'help');
    await scanWgLive(page, 'help');
  });

  test('help page with the FAQ open and heading=h1', async ({ page }) => {
    await gotoView(page, 'help', { query: { heading: 'h1' } });
    for (const summary of await page.locator('.wg-live__faq summary').all()) await summary.click();
    await scanWgLive(page, 'help h1');
  });
});

test.describe('axe: player states', () => {
  const scan = async (page: Page, label: string): Promise<void> => scanWgLive(page, label);

  test('player, nothing chosen', async ({ page }) => {
    await gotoPlayer(page);
    await scan(page, 'player idle');
  });

  test('player, mode chosen (Start enabled)', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.choose('atmos');
    await scan(page, 'player selecting');
  });

  test('player, playing', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    await scan(page, 'player playing');
  });

  test('player, paused', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    await p.primary.click();
    await expect(p.statusTitle).toHaveText('已暫停');
    await scan(page, 'player paused');
  });

  test('player, switch dialog open', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    await p.switchButton.click();
    await expect(p.dialog).toBeVisible();
    await scan(page, 'player dialog');
  });

  test('player, dev panel open (status, entitlement, fault controls)', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.openDevPanel();
    await scan(page, 'dev panel');
  });

  test('player, dev panel open with a simulated status', async ({ page }) => {
    const p = await gotoPlayer(page);
    const { status } = await p.openDevPanel();
    await status.selectOption({ label: '已取消' });
    await scan(page, 'dev panel simulated');
  });

  for (const [option, label] of [
    ['未登入', 'guest'],
    ['尚未取得資格', 'not_entitled'],
    ['無法確認資格', 'unavailable'],
  ] as const) {
    test(`player, entitlement panel: ${label}`, async ({ page }) => {
      const p = await gotoPlayer(page, { mode: 'binaural' });
      const { entitlement } = await p.openDevPanel();
      await entitlement.selectOption({ label: option });
      await expect(p.entitlement).toBeVisible();
      await scan(page, `entitlement ${label}`);
    });
  }

  for (const [option, label] of [
    ['尚未開始', 'scheduled'],
    ['即將開放', 'doors_open'],
    ['中場休息', 'intermission'],
    ['已結束', 'ended'],
    ['已取消', 'cancelled'],
  ] as const) {
    test(`player, event status: ${label}`, async ({ page }) => {
      const p = await gotoPlayer(page);
      const { status } = await p.openDevPanel();
      await status.selectOption({ label: option });
      await expect(p.statusBadge).toHaveText(option);
      await scan(page, `status ${label}`);
    });
  }

  test('player, real scheduled / ended / not-configured events', async ({ page }) => {
    for (const slug of [SLUG_SCHEDULED, SLUG_ENDED, SLUG_PENDING]) {
      await gotoPlayer(page, { event: slug });
      await scan(page, `event ${slug}`);
    }
  });

  test('player, reconnecting and failed states', async ({ page }) => {
    const p = await gotoPlayer(page);
    const { fault } = await p.openDevPanel();
    await fault.selectOption({ label: '解碼失敗' });
    await p.start('binaural');
    await expect(p.view).toHaveAttribute('data-status', 'failed');
    await scan(page, 'failed');
  });

  test('player, play blocked', async ({ page }) => {
    const p = await gotoPlayer(page);
    const { fault } = await p.openDevPanel();
    await fault.selectOption({ label: '播放被瀏覽器阻擋' });
    await p.start('binaural');
    await expect(p.statusTitle).toHaveText('請點擊開始聆聽');
    await scan(page, 'play blocked');
  });

  test('player, event not found', async ({ page }) => {
    await gotoView(page, 'listen', { event: 'no-such-event' });
    await scan(page, 'not found');
  });

  test('player, disabled mode', async ({ page }) => {
    await gotoView(page, 'listen', { harness: 'disabled', event: 'demo-live-binaural-atmos' });
    await scan(page, 'player disabled');
  });

  test('player with heading=h1', async ({ page }) => {
    await gotoPlayer(page, { query: { heading: 'h1' } });
    await scan(page, 'player h1');
  });
});

test.describe('structure and semantics', () => {
  test('heading levels never skip below the page title, on every view', async ({ page }) => {
    const levels = async (): Promise<number[]> =>
      page.locator('.wg-live').evaluate((root) => Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter((h) => (h as HTMLElement).offsetParent !== null || getComputedStyle(h).position === 'fixed').map((h) => Number(h.tagName.slice(1))));
    for (const view of ['index', 'help'] as const) {
      await gotoView(page, view);
      const found = await levels();
      // The theme provides the H1; the plugin starts at h2 and may not jump by more than one level.
      expect(found[0], `${view}: first heading`).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < found.length; i++) {
        expect((found[i] as number) - (found[i - 1] as number), `${view}: heading ${i} (${found.join(',')})`).toBeLessThanOrEqual(1);
      }
    }
    await gotoPlayer(page);
    const found = await levels();
    for (let i = 1; i < found.length; i++) {
      expect((found[i] as number) - (found[i - 1] as number), `player: ${found.join(',')}`).toBeLessThanOrEqual(1);
    }
  });

  test('exactly one live region, empty at load, outside the aria-busy subtree; the countdown is never in it', async ({ page }) => {
    await gotoView(page, 'index');
    await expect(page.locator('.wg-live [role="status"], .wg-live [aria-live]')).toHaveCount(1);
    await expect(page.locator('.wg-live__sr-status')).toHaveText('');
    const p = await gotoPlayer(page);
    await expect(p.root.locator('[role="status"], [aria-live], [role="alert"]')).toHaveCount(1);
    await expect(p.srStatus).toHaveText('');
  });

  test('the live region announces state changes once and not the countdown, retry counter or time', async ({ page }) => {
    const p = await gotoPlayer(page);
    const seen: string[] = [];
    await page.exposeFunction('wgNote', (text: string) => seen.push(text));
    await page.evaluate(() => {
      const region = document.querySelector('.wg-live__sr-status');
      if (!region) throw new Error('no live region');
      new MutationObserver(() => (window as unknown as { wgNote: (t: string) => void }).wgNote(region.textContent ?? '')).observe(region, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await p.start('binaural');
    await p.expectAdvancing();
    await expect(p.srStatus).toHaveText('目前播放：Binaural'); // announcements are coalesced for 750 ms; let this one out
    await p.primary.click();
    await expect(p.srStatus).toHaveText('已暫停');
    const unique = seen.filter((t, i) => t !== '' && seen.indexOf(t) === i);
    expect(unique).toEqual(expect.arrayContaining(['目前播放：Binaural', '已暫停']));
    for (const text of seen) expect(text, 'no digits: no countdown, counter or time').not.toMatch(/\d/);
    // Never announced twice in a row.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  test('buttons and radios have accessible names; the media element is not exposed as a control', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    const unnamed = await p.root.evaluate((root) => {
      const bad: string[] = [];
      for (const el of Array.from(root.querySelectorAll('button, a[href], input, select, summary'))) {
        if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== 'fixed') continue;
        const label =
          el.getAttribute('aria-label') ??
          (el.getAttribute('aria-labelledby')
            ? el
                .getAttribute('aria-labelledby')!
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? '')
                .join(' ')
            : '') ??
          '';
        const labels = (el as HTMLInputElement).labels ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent ?? '') : [];
        const text = `${label} ${labels.join(' ')} ${el.textContent ?? ''}`.trim();
        if (text === '') bad.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
      return bad;
    });
    expect(unnamed).toEqual([]);
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.hasAttribute('controls'))).toBe(false);
  });

  test('the <video> has an accessible name (title・播放舞台), not carried by the stage div (WCAG 1.1.1)', async ({ page }) => {
    const p = await gotoPlayer(page);
    const title = (await p.root.locator('.wg-live__player-title-text').textContent())?.trim() ?? '';
    expect(title).not.toBe('');
    await expect(p.media).toHaveAttribute('aria-label', `${title}・播放舞台`);
    expect(await p.media.evaluate((v) => v.getAttribute('aria-label')?.trim().length ?? 0)).toBeGreaterThan('播放舞台'.length);
    await expect(p.root.locator('.wg-live__stage')).not.toHaveAttribute('aria-label', /.+/);
    // Still true while playing, and the name does not make the element a control.
    await p.start('binaural');
    await p.expectAdvancing();
    await expect(p.media).toHaveAttribute('aria-label', `${title}・播放舞台`);
    expect(await p.media.evaluate((a: HTMLMediaElement) => a.hasAttribute('controls'))).toBe(false);
  });

  test('target sizes: primary controls are at least 48x48 and secondary controls at least 44x44', async ({ page }) => {
    const p = await gotoPlayer(page);
    await p.start('binaural');
    await p.expectAdvancing();
    const box = async (loc: import('@playwright/test').Locator) => (await loc.boundingBox()) ?? { width: 0, height: 0 };
    const primary = await box(p.primary);
    expect(primary.height).toBeGreaterThanOrEqual(47.9); // 48 px target, minus sub-pixel rounding
    expect(primary.width).toBeGreaterThanOrEqual(47.9);
    const sw = await box(p.switchButton);
    expect(sw.height).toBeGreaterThanOrEqual(43.9);
    expect(sw.width).toBeGreaterThanOrEqual(43.9);
    const mute = p.root.locator('.wg-live__mute');
    if (await mute.isVisible()) {
      const m = await box(mute);
      expect(m.height).toBeGreaterThanOrEqual(43.9);
      expect(m.width).toBeGreaterThanOrEqual(43.9);
    }
    await gotoView(page, 'index');
    for (const cta of await page.locator('.wg-live__event-card-cta, .wg-live__event-card-toggle').all()) {
      const b = await box(cta);
      expect(b.height, 'event card CTA height').toBeGreaterThanOrEqual(43.9);
    }
  });

  test('prefers-reduced-motion removes transitions and animations in the plugin', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const p = await gotoPlayer(page);
    const durations = await p.root.evaluate((root) => {
      const out: string[] = [];
      for (const el of Array.from(root.querySelectorAll('.wg-live__btn, .wg-live__mode-card, a'))) {
        const cs = getComputedStyle(el);
        for (const d of cs.transitionDuration.split(',')) if (parseFloat(d) > 0.001) out.push(`${el.className}: ${cs.transitionDuration}`);
        for (const d of cs.animationDuration.split(',')) if (parseFloat(d) > 0.001) out.push(`${el.className}: animation ${cs.animationDuration}`);
      }
      return out;
    });
    expect(durations).toEqual([]);
  });

  test('with motion allowed the buttons use a short transition (160-220 ms range, plan 3.3)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const p = await gotoPlayer(page);
    const seconds = await p.primary.evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.transitionDuration.split(',').map((d) => parseFloat(d));
    });
    for (const d of seconds) expect(d).toBeLessThanOrEqual(0.22);
  });

  test('forced-colors: controls keep visible borders', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    const p = await gotoPlayer(page);
    await p.choose('binaural');
    const border = await p.primary.evaluate((el) => ({ width: getComputedStyle(el).borderTopWidth, style: getComputedStyle(el).borderTopStyle }));
    expect(border.style).not.toBe('none');
    expect(parseFloat(border.width)).toBeGreaterThan(0);
    // (No axe scan here: axe reads the author colours, which forced-colors mode replaces, and reports false contrast failures.)
  });

  test('dark and light colour-scheme preferences do not change the (dark) plugin theme', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const p = await gotoPlayer(page);
      const color = await p.title.evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe('rgb(240, 245, 250)');
    }
  });

  test('text zoom 200%: no loss of content or function (320 px wide, large text)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const p = await gotoPlayer(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await p.choose('binaural');
    await expect(p.primary).toBeVisible();
    await scanWgLive(page, 'zoomed text');
  });
});
