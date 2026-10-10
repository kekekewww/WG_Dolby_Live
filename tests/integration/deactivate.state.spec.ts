/**
 * F15 and the regression comparison (plan 7.2, spec 13.3):
 *
 *  - Deactivating wg-live leaves My Account, Cart, Checkout, Shop (and the product and home pages) rendering,
 *    leaves raw shortcode text on the Live pages (documented in docs/deploy/ROLLBACK.md), keeps all data,
 *    and reactivating brings everything back. Neither step prints PHP notices.
 *  - Commerce pages look the same with the plugin on and off (pixel comparison of full-page screenshots).
 *    The homepage is compared on a page without the featured block, because the block is the only thing
 *    the plugin adds there.
 *
 * Changes shared site state (plugin activation, the front page), so it runs in the *-state projects, one
 * at a time, and always puts the plugin and the front page back.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser } from '@playwright/test';
import { bootConfigs, DEV, diffPng, ELEMENTOR_URL, expect, fetchText, getSettings, HELP_URL, LISTEN_URL, LIVE_URL, rest, wp, wpAll, wpPhp } from './wp';

test.describe.configure({ mode: 'serial' });

const EVIDENCE_DIR = join(process.cwd(), 'evidence', 'screenshots', 'integration');
const PHP_PROBLEM = /PHP (Notice|Warning|Deprecated|Fatal)|Fatal error|Parse error|Deprecated:|Stack trace/i;

interface Snapshot {
  settings: Record<string, unknown>;
  settingsMeta: unknown;
  events: number;
  pages: Array<{ id: number; uri: string; status: string; content: string }>;
  menus: number;
  theme: string;
  permalinks: string;
  rewriteRules: string;
  pluginActive: boolean;
}

function snapshot(): Snapshot {
  return wpPhp<Snapshot>(
    DEV,
    `global $wpdb;
     $pages = array();
     foreach ( get_posts( array( 'post_type' => 'page', 'post_status' => 'any', 'numberposts' => -1, 'orderby' => 'ID' ) ) as $p ) {
       $pages[] = array( 'id' => $p->ID, 'uri' => get_page_uri( $p ), 'status' => $p->post_status, 'content' => $p->post_content );
     }
     return array(
       'settings'     => get_option( 'wg_live_settings' ),
       'settingsMeta' => get_option( 'wg_live_settings_meta' ),
       'events'       => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'wg_live_event' AND post_status <> 'auto-draft'" ),
       'pages'        => $pages,
       'menus'        => count( wp_get_nav_menus() ),
       'theme'        => get_option( 'stylesheet' ),
       'permalinks'   => get_option( 'permalink_structure' ),
       'rewriteRules' => md5( serialize( get_option( 'rewrite_rules' ) ) ),
       'pluginActive' => is_plugin_active( 'wg-live/wg-live.php' ),
     );`,
  );
}

// WooCommerce ships with "coming soon" mode on: visitors would see its placeholder instead of the shop, cart and
// checkout, and a comparison of those pages would compare placeholders. The store is opened for this file and
// the previous values are put back afterwards.
let comingSoonBefore: { coming_soon: string; pages_only: string } = { coming_soon: 'yes', pages_only: 'yes' };

test.beforeAll(() => {
  comingSoonBefore = wpPhp<{ coming_soon: string; pages_only: string }>(
    DEV,
    `$b = array( 'coming_soon' => (string) get_option( 'woocommerce_coming_soon', 'no' ), 'pages_only' => (string) get_option( 'woocommerce_store_pages_only', 'no' ) );
     update_option( 'woocommerce_coming_soon', 'no' ); return $b;`,
  );
});

test.afterAll(() => {
  wpPhp(DEV, `update_option( 'woocommerce_coming_soon', '${comingSoonBefore.coming_soon}' ); update_option( 'woocommerce_store_pages_only', '${comingSoonBefore.pages_only}' ); return true;`);
});

// Redirects are followed: an empty cart sends /checkout/ to /cart/, with the plugin on and off alike.
const body = async (path: string): Promise<{ status: number; text: string }> => {
  const { status, text } = await fetchText(DEV, path, { redirect: 'follow' });
  return { status, text };
};

/** Visible text of a server-rendered page, without scripts and styles. */
const visibleText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0?91;|&lsqb;/g, '[')
    .replace(/&#0?93;|&rsqb;/g, ']')
    .replace(/&#822[01];|&#8243;|&quot;|&#0?34;|[“”″]/g, '"')
    .replace(/\s+/g, ' ');

test('F15 deactivate: commerce pages still render, Live pages show the raw shortcode, data stays; reactivate restores', async ({ browser }) => {
  test.setTimeout(900_000);
  const before = snapshot();
  expect(before.pluginActive).toBe(true);
  expect(before.events).toBeGreaterThanOrEqual(4);

  // Server-rendered content that must keep working without the plugin.
  const commerce = ['/shop/', '/my-account/', '/cart/', '/checkout/', '/sample-page/'];
  const onOk = await Promise.all(commerce.map(async (p) => [p, (await body(p)).status] as const));
  for (const [path, status] of onOk) expect(status, `${path} with the plugin on`).toBe(200);
  expect((await body('/shop/')).text, 'the store is open (not the coming-soon placeholder)').not.toMatch(/Great things are on the horizon/);

  const off = wpAll(DEV, ['plugin', 'deactivate', 'wg-live']);
  try {
    expect(off.code, off.out).toBe(0);
    expect(off.out).toMatch(/deactivated/i);
    expect(off.out, 'deactivation prints no PHP problem').not.toMatch(PHP_PROBLEM);

    const during = snapshot();
    expect(during.pluginActive).toBe(false);
    // Deactivation is not destructive: events, options, pages, menus, theme and rewrite rules are as they were.
    expect({ ...during, pluginActive: true }).toEqual(before);

    // WooCommerce pages and the rest of the site.
    for (const path of commerce) {
      const { status, text } = await body(path);
      expect(status, path).toBe(200);
      expect(text, path).toMatch(/<h1[^>]*>/i);
      expect(text, path).not.toMatch(/Fatal error|Uncaught|Call to undefined|wg-live|Great things are on the horizon/);
    }
    expect((await body('/')).status).toBe(200);

    // Live pages: raw shortcode text (documented), no assets, no bootstrap, no fatal error.
    for (const [path, shortcode] of [
      [LIVE_URL, '[wg_live view="events"]'],
      [`${LISTEN_URL}?wg_event=demo-live`, '[wg_live view="player"]'],
      [HELP_URL, '[wg_live view="help"]'],
      [ELEMENTOR_URL, '[wg_live view="player"]'],
    ] as const) {
      const { status, text } = await body(path);
      expect(status, path).toBe(200);
      expect(visibleText(text), path).toContain(shortcode);
      expect(bootConfigs(text), path).toHaveLength(0);
      expect(text, path).not.toMatch(/assets\/dist\/wg-live/);
    }
    expect(visibleText((await body('/')).text)).toContain('[wg_live_featured]'); // the seeded homepage holds the card shortcode

    // Public data is gone with the plugin; the data itself is still in the database.
    const gone = await rest(DEV, 'events');
    expect(gone.status).toBe(404);
    expect(gone.json.code).toBe('rest_no_route');

    // In the browser: the Live page is just a page with text.
    const context = await browser.newContext({ baseURL: DEV.baseURL });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(LIVE_URL);
      const shown = (await page.locator('main, .entry-content').first().innerText()).replace(/[“”″]/g, '"');
      expect(shown).toContain('[wg_live view="events"]');
      await expect(page.locator('.wg-live')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    const on = wpAll(DEV, ['plugin', 'activate', 'wg-live']);
    expect(on.code, on.out).toBe(0);
    expect(on.out, 'activation prints no PHP problem').not.toMatch(PHP_PROBLEM);
  }

  const after = snapshot();
  expect(after).toEqual(before); // activation did not create pages or menus, change the theme, flush rewrites or touch settings
  expect(getSettings(DEV).deployment_mode).toBe('demo');

  const list = await rest(DEV, 'events');
  expect(list.status).toBe(200);
  expect(list.json.events.length).toBeGreaterThanOrEqual(4);
  const live = await body(LIVE_URL);
  expect(bootConfigs(live.text)).toHaveLength(1);
  expect(live.text).toMatch(/assets\/dist\/wg-live\.js/);
  expect(visibleText(live.text)).not.toContain('[wg_live view=');
  expect((await body('/')).text).toContain('wg-live-featured--event');
});

test.describe('regression: commerce and theme pages look the same with the plugin on and off', () => {
  let productId = 0;
  let sampleId = 0;
  let frontBefore: { show_on_front: string; page_on_front: number } = { show_on_front: 'posts', page_on_front: 0 };

  const DESKTOP = { width: 1280, height: 800 };
  const MOBILE = { width: 390, height: 844 };
  const DESKTOP_PATHS = ['/', '/shop/', '/product/it-regression-product/', '/my-account/', '/cart/', '/checkout/', '/sample-page/'];
  const MOBILE_PATHS = ['/', '/shop/', '/my-account/'];

  test.beforeAll(() => {
    productId = wpPhp<number>(
      DEV,
      `$old = get_page_by_path( 'it-regression-product', OBJECT, 'product' ); if ( $old ) { wp_delete_post( $old->ID, true ); }
       $p = new WC_Product_Simple(); $p->set_name( 'IT Regression Product' ); $p->set_slug( 'it-regression-product' ); $p->set_regular_price( '120' );
       $p->set_description( 'Product used by the plugin on/off comparison.' ); $p->set_status( 'publish' ); return $p->save();`,
    );
    const state = wpPhp<{ show_on_front: string; page_on_front: number; sample: number }>(
      DEV,
      `$s = get_page_by_path( 'sample-page' ); return array( 'show_on_front' => get_option( 'show_on_front' ), 'page_on_front' => (int) get_option( 'page_on_front' ), 'sample' => $s->ID );`,
    );
    frontBefore = { show_on_front: state.show_on_front, page_on_front: state.page_on_front };
    sampleId = state.sample;
    // The seeded front page holds the plugin's card; compare the home URL on a page without it.
    wpPhp(DEV, `update_option( 'show_on_front', 'page' ); update_option( 'page_on_front', ${sampleId} ); return true;`);
  });

  test.afterAll(() => {
    wpAll(DEV, ['plugin', 'activate', 'wg-live']);
    wpPhp(DEV, `update_option( 'show_on_front', '${frontBefore.show_on_front}' ); update_option( 'page_on_front', ${frontBefore.page_on_front} ); if ( ${productId} ) { wp_delete_post( ${productId}, true ); } return true;`);
  });

  async function capture(browser: Browser, viewport: { width: number; height: number }, paths: string[]): Promise<Map<string, Buffer>> {
    const context = await browser.newContext({ baseURL: DEV.baseURL, viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const shots = new Map<string, Buffer>();
    try {
      const page = await context.newPage();
      for (const path of paths) {
        await page.goto(path, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(600);
        shots.set(path, await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }));
      }
    } finally {
      await context.close();
    }
    return shots;
  }

  test('pixel comparison, desktop and 390 px: plugin on vs off (and the capture is repeatable)', async ({ browser }, testInfo) => {
    test.setTimeout(1_500_000);
    const report: Record<string, { differing: number; sizeMatch: boolean; width: number; height: number }> = {};
    mkdirSync(EVIDENCE_DIR, { recursive: true });

    const onDesktop = await capture(browser, DESKTOP, DESKTOP_PATHS);
    const onMobile = await capture(browser, MOBILE, MOBILE_PATHS);
    let offDesktop: Map<string, Buffer>;
    let offMobile: Map<string, Buffer>;

    const out = wpAll(DEV, ['plugin', 'deactivate', 'wg-live']);
    expect(out.code, out.out).toBe(0);
    try {
      offDesktop = await capture(browser, DESKTOP, DESKTOP_PATHS);
      offMobile = await capture(browser, MOBILE, MOBILE_PATHS);
    } finally {
      expect(wpAll(DEV, ['plugin', 'activate', 'wg-live']).code).toBe(0);
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const failures: string[] = [];
      for (const [label, a, b] of [
        ['desktop', onDesktop, offDesktop],
        ['mobile', onMobile, offMobile],
      ] as const) {
        for (const [path, shot] of a) {
          const other = b.get(path) as Buffer;
          const result = await diffPng(page, shot, other, 0);
          const key = `${label} ${path}`;
          report[key] = { differing: result.differing, sizeMatch: result.sizeMatch, width: result.width, height: result.height };
          await testInfo.attach(`${label}${path.replace(/\//g, '_')}-plugin-on.png`, { body: shot, contentType: 'image/png' });
          if (result.differing > 0 || !result.sizeMatch) {
            failures.push(`${key}: ${result.differing} differing pixels, same size: ${result.sizeMatch}`);
            const file = join(EVIDENCE_DIR, `diff-${testInfo.project.name}-${label}${path.replace(/\//g, '_')}.png`);
            writeFileSync(file, result.diffPng);
            writeFileSync(file.replace('diff-', 'on-'), shot);
            writeFileSync(file.replace('diff-', 'off-'), other);
          }
        }
      }
      writeFileSync(join(EVIDENCE_DIR, `regression-${testInfo.project.name}.json`), JSON.stringify(report, null, 2));
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      await context.close();
    }
    // Sanity: the pages are real (not blank or an error page).
    expect((await body('/shop/')).text).toContain('IT Regression Product');
    expect(wp(DEV, ['option', 'get', 'page_on_front']).trim()).toBe(String(sampleId));
  });
});
