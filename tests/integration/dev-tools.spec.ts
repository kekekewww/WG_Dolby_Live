/**
 * Plan D17 / CLAUDE.md: the dev/demo state panel shows only on local/development (and on staging for
 * a user with the manage capability). It never shows on production, not even for an admin in the
 * Elementor preview, and no query parameter can turn it on.
 *
 *   dev   :8888  WP_ENVIRONMENT_TYPE=local       panel on
 *   tests :8889  WP_ENVIRONMENT_TYPE=production  panel never
 */
import { test } from '@playwright/test';
import { previewState, openEditor } from './elementor';
import { adminContext, bootConfigs, createElementorPage, deletePosts, DEV, ELEMENTOR_URL, expect, fetchText, LISTEN_URL, SLUG_LIVE, TESTS, waitMounted } from './wp';

const PLAYER = `${LISTEN_URL}?wg_event=${SLUG_LIVE}`;
const DEV_PARAMS = 'debug=1&paid=true&dev=1&devTools=1&wg_dev=1&wg_debug=1&entitled=1&status=live';

test.describe('environment types', () => {
  test('the two instances really have the types this spec relies on', async () => {
    // The bootstrap is the only public place that exposes the decision.
    const dev = bootConfigs((await fetchText(DEV, PLAYER)).text)[0];
    const prod = bootConfigs((await fetchText(TESTS, PLAYER)).text)[0];
    expect(dev?.devTools).toBe(true);
    expect(prod?.devTools).toBe(false);
  });
});

test.describe('local site (:8888): dev tools available', () => {
  test('the player page shows the dev panel and is never cached', async ({ page }) => {
    const res = await page.goto(PLAYER);
    await waitMounted(page);
    await expect(page.locator('details.wg-live__dev')).toHaveCount(1);
    const cache = res?.headers()['cache-control'] ?? '';
    expect(cache).toMatch(/no-store/);
    expect(cache).toMatch(/no-cache/);
  });

  test('the dev panel offers the simulated event status and entitlement controls', async ({ page }) => {
    await page.goto(PLAYER);
    await waitMounted(page);
    const panel = page.locator('details.wg-live__dev');
    await panel.locator('summary').click();
    await expect(panel.getByLabel('活動狀態')).toBeVisible();
    await expect(panel.getByLabel(/觀看資格/)).toBeVisible();
  });
});

test.describe('production site (:8889): dev tools never', () => {
  test('anonymous visitors: no dev panel, bootstrap says devTools=false, no forced no-cache headers', async ({ page }) => {
    const res = await page.goto(`${TESTS.baseURL}${PLAYER}`);
    await waitMounted(page);
    await expect(page.locator('.wg-live__dev')).toHaveCount(0);
    expect(bootConfigs(await page.content())[0]?.devTools).toBe(false);
    expect(res?.headers()['cache-control'] ?? '').not.toMatch(/no-store/);
  });

  test('no query parameter turns the panel on or changes playback conditions', async ({ page }) => {
    await page.goto(`${TESTS.baseURL}${PLAYER}&${DEV_PARAMS}`);
    await waitMounted(page);
    await expect(page.locator('.wg-live__dev')).toHaveCount(0);
    expect(bootConfigs(await page.content())[0]?.devTools ?? false).toBe(false);
    // The same parameters on the local site do not add anything either: the panel is controlled by the environment only.
    const html = (await fetchText(TESTS, `${PLAYER}&${DEV_PARAMS}`)).text;
    expect(bootConfigs(html)[0]?.devTools).toBe(false);
  });

  test('a logged-in administrator sees no panel on the front end either', async ({ browser }) => {
    const context = await adminContext(browser, TESTS);
    try {
      const page = await context.newPage();
      await page.goto(PLAYER);
      await waitMounted(page);
      // The admin really is logged in on this site.
      await expect(page.locator('#wpadminbar')).toBeAttached();
      await expect(page.locator('.wg-live__dev')).toHaveCount(0);
      expect(bootConfigs(await page.content())[0]?.devTools).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('an administrator in ?elementor-preview mode gets the assets but no panel', async ({ browser }) => {
    const context = await adminContext(browser, TESTS);
    try {
      const page = await context.newPage();
      const res = await page.request.get('/wp-json/wp/v2/pages?slug=live-elementor&_fields=id');
      const id = ((await res.json()) as Array<{ id: number }>)[0]?.id;
      expect(id).toBeGreaterThan(0);
      await page.goto(`${ELEMENTOR_URL}?elementor-preview=${id}&ver=1&wg_event=${SLUG_LIVE}`);
      await expect(page.locator('script[src*="assets/dist/wg-live.js"]')).toHaveCount(1);
      await expect(page.locator('.wg-live__dev')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('an administrator in the real Elementor editor: the widget mounts and shows no panel', async ({ browser }) => {
    test.setTimeout(420_000);
    const pageId = createElementorPage(TESTS, `it-devtools-${test.info().project.name}`, 'IT dev tools', `[wg_live view="player" event="${SLUG_LIVE}"]`);
    const context = await adminContext(browser, TESTS);
    try {
      const page = await context.newPage();
      const { frame } = await openEditor(page, pageId);
      await frame.waitForSelector('.wg-live[data-wg-live-mounted="1"]', { timeout: 120_000 });
      // The player rendered (one video element, the default media kind), the assets are there, and the panel is not.
      expect(await previewState(frame)).toEqual({ roots: 1, mounted: 1, audio: 0, video: 1, devPanels: 0, scripts: 1, styles: 1 });
      await expect(frame.locator('.wg-live__player-title')).toContainText('直播中');
    } finally {
      await context.close();
      deletePosts(TESTS, [pageId]);
    }
  });
});
