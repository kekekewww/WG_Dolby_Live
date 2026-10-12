/**
 * Inherit-first on the SHIPPED CSS (spec 3.5): axe `color-contrast`, zero violations, on the homepage card
 * ([wg_live_featured], wg-live-featured.css only) and the events / player / help views, on the dark host
 * (as-is, and with a flat worst-case photo colour) and on ?host=light. See host-contrast.spec.ts.
 */
import { test, type Page } from '@playwright/test';
import { applyHostBackground, expect, gotoPlayer, gotoView, HOSTS, hostQuery, scanContrast, type Host } from './helpers';

test.describe.configure({ timeout: 90_000 });

async function gotoHome(page: Page, host: Host, query: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams({ ...hostQuery(host), ...query }).toString();
  await page.goto(`/dev/dist/home.html${qs === '' ? '' : `?${qs}`}`);
  await expect(page.locator('.wg-live-featured')).toBeVisible();
  await applyHostBackground(page, host);
}

for (const host of HOSTS) {
  test.describe(`dist, host ${host}`, () => {
    const query = hostQuery(host);

    test('homepage card: event, empty state, disabled', async ({ page }) => {
      await gotoHome(page, host);
      await scanContrast(page, `${host}: home event`, '.wg-live-featured');
      await gotoHome(page, host, { featured: 'none' });
      await scanContrast(page, `${host}: home empty`, '.wg-live-featured');
      await gotoHome(page, host, { harness: 'disabled' });
      await scanContrast(page, `${host}: home disabled`, '.wg-live-featured');
    });

    test('homepage card: scheduled and ended events', async ({ page }) => {
      for (const featured of ['demo-scheduled', 'demo-ended']) {
        await gotoHome(page, host, { featured });
        await scanContrast(page, `${host}: home ${featured}`, '.wg-live-featured');
      }
    });

    test('events, help, player (idle, playing)', async ({ page }) => {
      await gotoView(page, 'index', { base: 'dist', query });
      await applyHostBackground(page, host);
      await scanContrast(page, `${host}: dist events`);
      await gotoView(page, 'help', { base: 'dist', query });
      await applyHostBackground(page, host);
      await scanContrast(page, `${host}: dist help`);
      const p = await gotoPlayer(page, { base: 'dist', query });
      await applyHostBackground(page, host);
      await scanContrast(page, `${host}: dist player idle`);
      await p.start('binaural');
      await p.expectAdvancing();
      await scanContrast(page, `${host}: dist player playing`);
    });
  });
}
