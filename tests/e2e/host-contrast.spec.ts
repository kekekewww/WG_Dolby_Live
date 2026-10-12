/**
 * Inherit-first (spec 3.5): text that sits on the host background follows the host's colour, so the plugin is readable
 * on the dark live site AND on a light section. axe `color-contrast` (zero violations, any impact) on events, player
 * (every state that has its own colours) and help, on three hosts:
 *   dark        the default harness site (gradient stand-in for the photo; axe reports such text as "incomplete")
 *   dark-solid  the same site with the lightest possible photo pixel as a flat colour (axe can judge it)
 *   light       ?host=light, a white section with Astra's #3a3a3a
 * Chromium only (colour maths does not differ per engine); the other browsers keep the existing scans of a11y.spec.ts.
 * The homepage card is in host-contrast.dist.spec.ts (it only exists in the dist harness).
 */
import { test, type Page } from '@playwright/test';
import { applyHostBackground, expect, gotoPlayer, gotoView, HOSTS, hostQuery, scanContrast, SLUG_ENDED, SLUG_PENDING, SLUG_SCHEDULED, type Host } from './helpers';

test.describe.configure({ timeout: 90_000 });

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'colour contrast is engine independent; chromium is enough');
});

async function scan(page: Page, host: Host, label: string): Promise<void> {
  await scanContrast(page, `${host}: ${label}`);
}

for (const host of HOSTS) {
  test.describe(`host ${host}`, () => {
    const query = hostQuery(host);

    test('the host variant renders what it says (light section, or the dark site)', async ({ page }) => {
      const p = await gotoPlayer(page, { query });
      await applyHostBackground(page, host);
      const [text, bg] = await Promise.all([
        p.title.evaluate((el) => getComputedStyle(el).color),
        p.root.evaluate((el) => getComputedStyle(el.closest('.wgm-container') ?? el).backgroundColor),
      ]);
      if (host === 'light') {
        expect(text).toBe('rgb(58, 58, 58)');
        expect(bg).toBe('rgb(255, 255, 255)');
      } else {
        expect(text).toBe('rgb(240, 245, 250)');
        expect(bg).not.toBe('rgb(255, 255, 255)');
      }
    });

    test('events: featured, grid, guide, FAQ; every card expanded', async ({ page }) => {
      await gotoView(page, 'index', { query });
      await applyHostBackground(page, host);
      await scan(page, host, 'events');
      for (const toggle of await page.locator('.wg-live__event-card-toggle').all()) await toggle.click();
      for (const summary of await page.locator('.wg-live__faq summary').all()) await summary.click();
      await scan(page, host, 'events expanded');
    });

    test('events: disabled mode', async ({ page }) => {
      await gotoView(page, 'index', { harness: 'disabled', query });
      await applyHostBackground(page, host);
      await scan(page, host, 'events disabled');
    });

    test('help', async ({ page }) => {
      await gotoView(page, 'help', { query });
      await applyHostBackground(page, host);
      for (const summary of await page.locator('.wg-live__faq summary').all()) await summary.click();
      await scan(page, host, 'help');
    });

    test('player: idle, chosen, playing, dialog, paused', async ({ page }) => {
      const p = await gotoPlayer(page, { query });
      await applyHostBackground(page, host);
      await scan(page, host, 'player idle');
      await p.choose('atmos');
      await scan(page, host, 'player chosen');
      await p.primary.click();
      await p.expectAdvancing();
      await scan(page, host, 'player playing');
      await p.switchButton.click();
      await expect(p.dialog).toBeVisible();
      await scan(page, host, 'player dialog');
      await p.dialog.getByRole('button', { name: '取消' }).click();
      await p.primary.click();
      await expect(p.statusTitle).toHaveText('已暫停');
      await scan(page, host, 'player paused');
    });

    test('player: failed, entitlement panel, cancelled', async ({ page }) => {
      const p = await gotoPlayer(page, { query });
      await applyHostBackground(page, host);
      const { fault } = await p.openDevPanel();
      await fault.selectOption({ label: '解碼失敗' });
      await p.start('binaural');
      await expect(p.view).toHaveAttribute('data-status', 'failed');
      await scan(page, host, 'player failed');

      await gotoPlayer(page, { query, mode: 'binaural' });
      await applyHostBackground(page, host);
      const panel = await p.openDevPanel();
      await panel.entitlement.selectOption({ label: '尚未取得資格' });
      await expect(p.entitlement).toBeVisible();
      await scan(page, host, 'player not entitled');

      await gotoPlayer(page, { query });
      await applyHostBackground(page, host);
      const again = await p.openDevPanel();
      await again.status.selectOption({ label: '已取消' });
      await expect(p.statusBadge).toHaveText('已取消');
      await scan(page, host, 'player cancelled');
    });

    test('player: scheduled, ended, source not configured, not found', async ({ page }) => {
      for (const slug of [SLUG_SCHEDULED, SLUG_ENDED, SLUG_PENDING, 'no-such-event']) {
        await gotoView(page, 'listen', { event: slug, query });
        await applyHostBackground(page, host);
        await scan(page, host, `player ${slug}`);
      }
    });
  });
}
