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
      // Plugin output only (asset URLs, handles, container/config markup) — a bare /wg-live/ would also match
      // a site title derived from the checkout folder (the WSL mirror lives in ~/wg-live).
      expect(text, path).not.toMatch(/Fatal error|Uncaught|Call to undefined|plugins\/wg-live\/|id=['"]wg-live(?:-featured)?-(?:css|js)['"]|class="wg-live[\s_"-]|wg-live__config|Great things are on the horizon/);
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

  test('Cart and Checkout WITH an item in the cart: both render their forms with the plugin on and off, and carry no wg-live asset or markup (no order is placed)', async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    // Plugin output only (assets, handles, container and config markup); a bare "wg-live" could match a folder name.
    const PLUGIN_OUTPUT = /plugins\/wg-live\/|id=['"]wg-live(?:-featured)?-(?:css|js)['"]|class="wg-live[\s_"-]|wg-live__config/;

    interface Seen {
      cartUrl: string;
      checkoutUrl: string;
      cartKind: string;
      checkoutKind: string;
      cartMentionsProduct: boolean;
      checkoutMentionsProduct: boolean;
      placeOrderControl: boolean;
      pluginMarkup: string[];
      pluginRequests: string[];
    }

    /** One guest, one cart (a fresh context): add the fixture product, then look at /cart/ and /checkout/. Never places an order. */
    async function visit(): Promise<Seen> {
      const context = await browser.newContext({ baseURL: DEV.baseURL, viewport: DESKTOP });
      try {
        const page = await context.newPage();
        const pluginRequests: string[] = [];
        const pluginMarkup: string[] = [];
        const kindOf = async (): Promise<string> =>
          page.evaluate(() => {
            if (document.querySelector('.wc-block-checkout, .wp-block-woocommerce-checkout')) return 'checkout-block';
            if (document.querySelector('form.woocommerce-checkout, form.checkout')) return 'checkout-shortcode';
            if (document.querySelector('.wc-block-cart, .wp-block-woocommerce-cart')) return 'cart-block';
            if (document.querySelector('form.woocommerce-cart-form')) return 'cart-shortcode';
            return 'none';
          });
        const scan = async (label: string): Promise<void> => {
          const html = await page.content();
          if (PLUGIN_OUTPUT.test(html)) pluginMarkup.push(`${label}: wg-live markup in the HTML`);
          const dom = await page.evaluate(() => document.querySelectorAll('[class*="wg-live"], link[href*="wg-live"], script[src*="wg-live"], [id^="wg-live"]').length);
          if (dom > 0) pluginMarkup.push(`${label}: ${dom} wg-live node(s) in the DOM`);
        };

        // Adding to the cart goes through the home page, which carries the plugin's card (legitimately): only the cart and
        // checkout pages are watched for plugin requests.
        await page.goto(`/?add-to-cart=${productId}`, { waitUntil: 'load' });
        page.on('request', (r) => {
          if (/\/wp-content\/plugins\/wg-live\/|\/wp-json\/wg-live\//.test(r.url())) pluginRequests.push(r.url());
        });
        await page.goto('/cart/', { waitUntil: 'load' });
        await expect(page.locator('.wc-block-cart, form.woocommerce-cart-form').first()).toBeVisible({ timeout: 90_000 });
        await expect(page.getByText('IT Regression Product').first()).toBeVisible({ timeout: 90_000 });
        const cartKind = await kindOf();
        const cartMentionsProduct = (await page.locator('body').innerText()).includes('IT Regression Product');
        await scan('/cart/');
        const cartUrl = page.url();

        await page.goto('/checkout/', { waitUntil: 'load' });
        // With an item the checkout does NOT redirect to the cart (an empty cart would).
        await expect(page).toHaveURL(/\/checkout\/?(?:\?.*)?$/);
        await expect(page.locator('.wc-block-checkout, form.woocommerce-checkout').first()).toBeVisible({ timeout: 90_000 });
        await expect(page.getByText('IT Regression Product').first()).toBeVisible({ timeout: 90_000 });
        const checkoutKind = await kindOf();
        const checkoutMentionsProduct = (await page.locator('body').innerText()).includes('IT Regression Product');
        // The place-order control exists (it is looked at, never clicked).
        await expect(page.locator('#place_order, .wc-block-components-checkout-place-order-button').first()).toBeAttached({ timeout: 90_000 });
        const placeOrderControl = true;
        await scan('/checkout/');
        const checkoutUrl = page.url();
        await testInfo.attach(`checkout-with-item.png`, { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' });
        return { cartUrl, checkoutUrl, cartKind, checkoutKind, cartMentionsProduct, checkoutMentionsProduct, placeOrderControl, pluginMarkup, pluginRequests };
      } finally {
        await context.close();
        // The cart lives in the guest's WooCommerce session: clear them all (local test database).
        wpPhp(DEV, `global $wpdb; $wpdb->query( "DELETE FROM {$wpdb->prefix}woocommerce_sessions" ); return true;`);
      }
    }

    const on = await visit();
    let off: Seen;
    expect(wpAll(DEV, ['plugin', 'deactivate', 'wg-live']).code).toBe(0);
    try {
      off = await visit();
    } finally {
      expect(wpAll(DEV, ['plugin', 'activate', 'wg-live']).code).toBe(0);
    }

    for (const [label, seen] of [['plugin on', on], ['plugin off', off]] as const) {
      expect(seen.cartKind, `${label}: the cart form/block is rendered`).toMatch(/^cart-(block|shortcode)$/);
      expect(seen.checkoutKind, `${label}: the checkout form/block is rendered`).toMatch(/^checkout-(block|shortcode)$/);
      expect(seen.checkoutUrl, `${label}: /checkout/ did not redirect to the cart`).toMatch(/\/checkout\/?$/);
      expect(seen.cartMentionsProduct, `${label}: the cart lists the product`).toBe(true);
      expect(seen.checkoutMentionsProduct, `${label}: the checkout summarises the product`).toBe(true);
      expect(seen.placeOrderControl, `${label}: the place-order control exists`).toBe(true);
      expect(seen.pluginMarkup, `${label}: no wg-live markup on cart or checkout`).toEqual([]);
      expect(seen.pluginRequests, `${label}: no request to a wg-live asset or endpoint`).toEqual([]);
    }
    // The same kind of page with the plugin on and off.
    expect({ cart: on.cartKind, checkout: on.checkoutKind }).toEqual({ cart: off.cartKind, checkout: off.checkoutKind });
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, `cart-checkout-with-item-${testInfo.project.name}.json`), JSON.stringify({ on, off }, null, 2));
    // The carts are gone.
    expect(wpPhp<number>(DEV, `global $wpdb; return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}woocommerce_sessions" );`)).toBe(0);
  });
});

test.describe('lab Core Web Vitals on wp-env (spec 13.4: the site and the plugin increment, reported separately)', () => {
  // Chromium exposes layout-shift and largest-contentful-paint entries; the other engines would measure nothing.
  const PAGES: Array<{ name: string; path: string }> = [
    { name: 'Home', path: '/' },
    { name: 'Live /live/', path: LIVE_URL },
    { name: 'Listen /live/listen/?wg_event=demo-live', path: `${LISTEN_URL}?wg_event=demo-live` },
  ];
  const RUNS = 3;

  interface Sample {
    lcp: number;
    cls: number;
  }

  async function measure(browser: Browser, path: string): Promise<Sample> {
    // A fresh context per sample: a cold HTTP cache, like a first visit.
    const context = await browser.newContext({ baseURL: DEV.baseURL, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number; __lcp: number };
        w.__cls = 0;
        w.__lcp = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
            if (!entry.hadRecentInput) w.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((list) => {
          const last = list.getEntries().at(-1);
          if (last) w.__lcp = last.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      return page.evaluate(() => ({ lcp: (window as unknown as { __lcp: number }).__lcp, cls: (window as unknown as { __cls: number }).__cls }));
    } finally {
      await context.close();
    }
  }

  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

  test('LCP and CLS of Home, /live/ and /live/listen/ with the plugin on and off (lab data, Chromium, no throttling)', async ({ browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'layout-shift and largest-contentful-paint entries are Chromium-only; the other engines would measure nothing');
    test.setTimeout(1_500_000);
    const supported = await (async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${DEV.baseURL}/`, { waitUntil: 'commit' });
        return await page.evaluate(() => ['layout-shift', 'largest-contentful-paint'].every((t) => PerformanceObserver.supportedEntryTypes?.includes(t)));
      } finally {
        await context.close();
      }
    })();
    test.skip(!supported, 'this browser does not expose layout-shift / largest-contentful-paint');

    const result: Record<'on' | 'off', Record<string, { lcpMedianMs: number; clsMax: number; samples: Sample[] }>> = { on: {}, off: {} };
    const run = async (state: 'on' | 'off'): Promise<void> => {
      for (const { name, path } of PAGES) {
        const samples: Sample[] = [];
        for (let i = 0; i < RUNS; i++) samples.push(await measure(browser, path));
        result[state][name] = { lcpMedianMs: Math.round(median(samples.map((s) => s.lcp))), clsMax: Math.max(...samples.map((s) => s.cls)), samples };
      }
    };

    await run('on');
    expect(wpAll(DEV, ['plugin', 'deactivate', 'wg-live']).code).toBe(0);
    try {
      await run('off');
    } finally {
      expect(wpAll(DEV, ['plugin', 'activate', 'wg-live']).code).toBe(0);
    }

    const lines = PAGES.map(({ name }) => {
      const a = result.on[name] as { lcpMedianMs: number; clsMax: number };
      const b = result.off[name] as { lcpMedianMs: number; clsMax: number };
      return `${name}: plugin on LCP ${a.lcpMedianMs} ms / CLS ${a.clsMax.toFixed(4)}; plugin off LCP ${b.lcpMedianMs} ms / CLS ${b.clsMax.toFixed(4)}`;
    });
    const summary = `${lines.join(' | ')} (LAB data: Chromium, wp-env, no throttling, cold cache, median of ${RUNS} LCP, max CLS; not field data)`;
    testInfo.annotations.push({ type: 'lab-cwv', description: summary });
    console.log(`[lab CWV] ${summary}`);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, `lab-cwv-${testInfo.project.name}.json`), JSON.stringify({ kind: 'lab data, not field data', runs: RUNS, ...result }, null, 2));

    // Sane bounds only: an LCP happened and is finite, and the plugin does not push CLS over the 0.1 "good" line.
    for (const { name } of PAGES) {
      for (const state of ['on', 'off'] as const) {
        const m = result[state][name] as { lcpMedianMs: number; clsMax: number };
        expect(m.lcpMedianMs, `${name} (${state}) has an LCP`).toBeGreaterThan(0);
        expect(m.lcpMedianMs, `${name} (${state}) LCP is finite and below a 30 s sanity ceiling`).toBeLessThan(30_000);
      }
      expect((result.on[name] as { clsMax: number }).clsMax, `${name} CLS with the plugin on`).toBeLessThan(0.1);
    }
  });
});
