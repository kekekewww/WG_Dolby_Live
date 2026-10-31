/**
 * Plan 4.3 / 4.5 / 4.6 on a real site: link overrides and the host-mismatch warning, the featured event
 * fallback, the event screen's 首頁精選 checkbox (0.2.0), and "create suggested pages" (refuses on conflicts,
 * never overwrites, binds only empty slots).
 *
 * Changes shared site state (settings, page slugs), so it runs in the *-state projects, one at a time.
 * Every test restores what it changed.
 */
import { randomUUID } from 'node:crypto';
import { test, type Page } from '@playwright/test';
import { DEPLOY_URL, openSettings, PAGES_URL, saveLink, submitSettings } from './settings-ui';
import { adminContext, bootConfigs, clickPublish, createEvents, DEMO_VIDEO, deleteEventsByPrefix, deletePosts, deleteUsersByLoginPrefix, DEV, expect, fetchText, fillLoginForm, getSettings, rest, setSettingsKeys, TONE, wpPhp } from './wp';

test.describe.configure({ mode: 'serial' });

const FOREIGN = 'https://staging.example.test/my-account/';
// The plugin's own warnings. WordPress core's "x.y.z is available" nag is also a .notice-warning (.update-nag).
const PLUGIN_WARNING = '.notice-warning:not(.update-nag)';

let settingsSnapshot: Record<string, unknown> = {};

test.beforeAll(() => {
  settingsSnapshot = getSettings(DEV);
});

test.afterAll(() => {
  // Whatever happened, the bindings and links are back to what the seed made.
  setSettingsKeys(DEV, {
    page_events: settingsSnapshot.page_events,
    page_player: settingsSnapshot.page_player,
    page_help: settingsSnapshot.page_help,
    featured_event: settingsSnapshot.featured_event,
    account_url: settingsSnapshot.account_url,
    store_url: settingsSnapshot.store_url,
    contact_url: settingsSnapshot.contact_url,
    deployment_mode: settingsSnapshot.deployment_mode,
  });
});

/** Publish or draft the WooCommerce My Account page (the account-link order test, spec 10.4). */
function setMyAccountStatus(status: 'publish' | 'draft'): void {
  wpPhp(DEV, `$id = (int) get_option( 'woocommerce_myaccount_page_id' ); if ( $id > 0 ) { wp_update_post( array( 'ID' => $id, 'post_status' => '${status}' ) ); } return $id;`);
}

/** Click "建立三個草稿頁面" and wait until WordPress has answered and the pages screen shows the outcome. */
async function submitCreatePages(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('admin-post.php') && r.request().method() === 'POST', { timeout: 120_000 }),
    page.getByRole('button', { name: '建立三個草稿頁面' }).click(),
  ]);
  await expect(page.locator('#wpbody-content .notice-error, #wpbody-content .notice-success').first()).toBeVisible({ timeout: 120_000 });
}

async function adminPage(browser: import('@playwright/test').Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await adminContext(browser, DEV);
  const page = await context.newPage();
  page.on('dialog', (d) => void d.accept());
  return { page, close: () => context.close() };
}

test.describe('link overrides and the host-mismatch warning (deployment screen)', () => {
  test('with the default settings every stored link points at this host', async ({ browser }) => {
    const { page, close } = await adminPage(browser);
    try {
      await page.goto(DEPLOY_URL);
      await expect(page.getByRole('heading', { name: '連結主機檢查' })).toBeVisible();
      await expect(page.locator('#wpbody-content')).toContainText('所有已儲存的連結都指向 localhost');
      await expect(page.locator(PLUGIN_WARNING)).toHaveCount(0);
      // The deployment screen reports the real environment.
      await expect(page.locator('#wpbody-content')).toContainText('local');
      await expect(page.locator('#wpbody-content')).toContainText('0.4.0');
    } finally {
      await close();
    }
  });

  test('a foreign account URL is stored, used by the front end, and flagged on the deployment screen', async ({ browser }) => {
    const { page, close } = await adminPage(browser);
    try {
      const notices = await saveLink(page, 'account_url', FOREIGN);
      expect(notices).not.toContain('必須是完整的 http 或 https 網址');
      expect(getSettings(DEV).account_url).toBe(FOREIGN);

      await page.goto(DEPLOY_URL);
      const warning = page.locator(PLUGIN_WARNING);
      await expect(warning).toContainText('下列連結的主機與這個網站（localhost）不同');
      await expect(page.locator('#wpbody-content table.wg-live-admin__table').last()).toContainText(FOREIGN);
      await expect(page.locator('#wpbody-content table.wg-live-admin__table').last()).toContainText('帳號頁連結');
      // A same-host link is not flagged.
      await expect(page.locator('#wpbody-content table.wg-live-admin__table').last()).not.toContainText('http://localhost:8888/shop/');

      // Spec 10.4 order: the WooCommerce My Account page wins while it is published, so the stored override
      // is not used yet (F12).
      const wcLinks = bootConfigs((await fetchText(DEV, '/live/')).text)[0]?.links;
      expect(wcLinks.account).toMatch(/^http:\/\/localhost:8888\/my-account\/$/);

      // Without a published My Account page the override reaches the pages (login links).
      setMyAccountStatus('draft');
      const links = bootConfigs((await fetchText(DEV, '/live/')).text)[0]?.links;
      expect(links.account).toBe(FOREIGN);
      setMyAccountStatus('publish');
    } finally {
      setMyAccountStatus('publish');
      await saveLink(page, 'account_url', '').catch(() => setSettingsKeys(DEV, { account_url: '' }));
      await close();
    }
    const restored = bootConfigs((await fetchText(DEV, '/live/')).text)[0]?.links;
    expect(restored.account).toMatch(/^http:\/\/localhost:8888\/my-account\/$/); // the WooCommerce My Account page again
  });

  test('foreign hosts in an event buy link and in the FAQ text are found too', async ({ browser }) => {
    const prefix = 'it-host-state';
    deleteEventsByPrefix(DEV, prefix);
    const ids = createEvents(DEV, [{ slug: `${prefix}-buy`, title: `${prefix} buy`, meta: { product_url: 'https://tickets.example.test/buy' } }]);
    const faqBefore = settingsSnapshot.faq;
    setSettingsKeys(DEV, { faq: [{ question: '哪裡購票？', answer: '請到 https://shop.example.test/tickets 購買。' }] });
    const { page, close } = await adminPage(browser);
    try {
      await page.goto(DEPLOY_URL);
      const table = page.locator('#wpbody-content table.wg-live-admin__table').last();
      await expect(page.locator(PLUGIN_WARNING)).toContainText('下列連結的主機與這個網站（localhost）不同');
      await expect(table).toContainText('https://tickets.example.test/buy');
      await expect(table).toContainText('購票連結');
      await expect(table).toContainText('https://shop.example.test/tickets');
      await expect(table).toContainText('常見問題第 1 則');
    } finally {
      setSettingsKeys(DEV, { faq: faqBefore });
      deletePosts(DEV, Object.values(ids));
      deleteEventsByPrefix(DEV, prefix);
      await close();
    }
  });

  test('a link that is not http(s) is refused and the old value stays', async ({ browser }) => {
    const { page, close } = await adminPage(browser);
    try {
      for (const bad of ['javascript:alert(1)', 'ftp://example.test/x', 'data:text/html,x', '/relative/path']) {
        const notices = await saveLink(page, 'account_url', bad);
        expect(notices, bad).toContain('帳號頁連結必須是完整的 http 或 https 網址');
        expect(getSettings(DEV).account_url, bad).toBe('');
      }
      // The contact link may also be a mailto: address.
      const ok = await saveLink(page, 'contact_url', 'mailto:hello@example.test');
      expect(ok).not.toContain('必須是完整的');
      expect(getSettings(DEV).contact_url).toBe('mailto:hello@example.test');
    } finally {
      await saveLink(page, 'contact_url', '').catch(() => setSettingsKeys(DEV, { contact_url: '' }));
      await close();
    }
    expect(getSettings(DEV).contact_url).toBe('');
  });
});

test.describe('the homepage card when the featured event is not usable', () => {
  test('a draft, a trashed or a missing featured event gives the fallback text and a link to Live, never the event', async () => {
    test.setTimeout(900_000);
    const prefix = 'it-feat-state';
    deleteEventsByPrefix(DEV, prefix);
    const ids = createEvents(DEV, [
      { slug: `${prefix}-draft`, title: `${prefix} draft`, status: 'draft' },
      { slug: `${prefix}-trash`, title: `${prefix} trash`, status: 'trash' },
      { slug: `${prefix}-password`, title: `${prefix} password`, password: `${prefix}-pw` },
    ]);
    try {
      for (const [name, id] of [['draft', ids[`${prefix}-draft`]], ['trash', ids[`${prefix}-trash`]], ['password', ids[`${prefix}-password`]], ['missing', 987654], ['unset', 0]] as const) {
        setSettingsKeys(DEV, { featured_event: id });
        const { text } = await fetchText(DEV, '/');
        expect(text, name).toContain('wg-live-featured--empty');
        expect(text, name).not.toContain('wg-live-featured--event');
        expect(text, name).toContain('線上音樂會資訊即將公布');
        expect(text, name).not.toContain(`${prefix} `);
        expect(text, name).not.toContain(`${prefix}-pw`);
        // The fallback links to the Live page.
        expect(text, name).toMatch(/<a class="wg-live-featured__link" href="http:\/\/localhost:8888\/live\/">/);
        expect(bootConfigs((await fetchText(DEV, '/live/')).text)[0]?.featuredEventSlug, name).toBeNull();
      }
    } finally {
      setSettingsKeys(DEV, { featured_event: settingsSnapshot.featured_event });
      deletePosts(DEV, Object.values(ids));
      deleteEventsByPrefix(DEV, prefix);
    }
    expect((await fetchText(DEV, '/')).text).toContain('wg-live-featured--event');
  });
});

test.describe('the 首頁精選 checkbox on the event screen (0.2.0)', () => {
  test('an Editor sets and clears the homepage featured event; no other setting changes', async ({ browser }) => {
    test.setTimeout(900_000);
    const prefix = 'it-feat-editor';
    deleteEventsByPrefix(DEV, prefix);
    deleteUsersByLoginPrefix(DEV, `${prefix}-`);
    const id = createEvents(DEV, [{ slug: `${prefix}-concert`, title: `${prefix} concert` }])[`${prefix}-concert`] ?? 0;
    expect(id).toBeGreaterThan(0);
    const login = `${prefix}-${randomUUID().slice(0, 8)}`;
    const password = randomUUID();
    const userId = wpPhp<number>(DEV, `return wp_insert_user( array( 'user_login' => '${login}', 'user_pass' => '${password}', 'user_email' => '${login}@example.invalid', 'role' => 'editor' ) );`);
    const metaVersion = (): number => wpPhp<number>(DEV, `$m = get_option( 'wg_live_settings_meta', array() ); return isset( $m['version'] ) ? (int) $m['version'] : 0;`);
    const ctx = await browser.newContext({ baseURL: DEV.baseURL });
    try {
      const p = await ctx.newPage();
      p.on('dialog', (d) => void d.accept());
      await p.goto('/wp-login.php');
      await fillLoginForm(p, login, password);
      await p.locator('#wp-submit').click();
      await p.waitForURL(/wp-admin/);

      const save = async (): Promise<void> => {
        await Promise.all([p.waitForURL(/post\.php\?post=\d+&action=edit&message=\d+/, { timeout: 120_000 }), clickPublish(p)]);
      };
      const box = p.locator('input[name="wg_live[featured]"]');
      const before = getSettings(DEV);
      const version = metaVersion();
      expect(Number(before.featured_event), 'the seed features its demo event').toBeGreaterThan(0);

      await p.goto(`/wp-admin/post.php?post=${id}&action=edit`);
      await expect(box).not.toBeChecked();
      await expect(p.locator('#wg-live-event-fields')).toContainText('目前的首頁精選是');
      await box.check();
      await save();
      await expect(box).toBeChecked();

      const after = getSettings(DEV);
      expect(after.featured_event).toBe(id);
      expect({ ...after, featured_event: before.featured_event }, 'only featured_event changed').toEqual(before);
      expect(metaVersion()).toBe(version + 1);
      const home = (await fetchText(DEV, '/')).text;
      expect(home).toContain('wg-live-featured--event');
      expect(home).toContain(`${prefix} concert`);
      await p.goto('/wp-admin/edit.php?post_type=wg_live_event');
      await expect(p.locator(`#post-${id} .column-wg_live_home`)).toContainText('首頁精選');

      // An edit screen opened before 0.2.0 has neither the box nor its marker: saving it leaves the featured event alone.
      await p.goto(`/wp-admin/post.php?post=${id}&action=edit`);
      await p.locator('input[name="wg_live[featured]"], input[name="wg_live[featured_shown]"]').evaluateAll((els) => els.forEach((el) => el.remove()));
      await save();
      expect(getSettings(DEV).featured_event).toBe(id);

      // Unticking clears it (the homepage falls back to the "coming soon" card).
      await p.goto(`/wp-admin/post.php?post=${id}&action=edit`);
      await box.uncheck();
      await save();
      expect(getSettings(DEV).featured_event).toBe(0);
      expect((await fetchText(DEV, '/')).text).toContain('wg-live-featured--empty');
    } finally {
      await ctx.close();
      wpPhp(DEV, `require_once ABSPATH . 'wp-admin/includes/user.php'; return wp_delete_user( ${userId}, 1 );`);
      setSettingsKeys(DEV, { featured_event: settingsSnapshot.featured_event });
      deletePosts(DEV, [id]);
      deleteEventsByPrefix(DEV, prefix);
    }
    expect((await fetchText(DEV, '/')).text).toContain('wg-live-featured--event');
  });
});

test.describe('review fixes: escaping (F1, F2)', () => {
  test('F2: an invalid colour is echoed escaped in the notice, never as markup', async ({ browser }) => {
    const { page, close } = await adminPage(browser);
    try {
      await openSettings(page);
      await page.locator('[name="wg_live_settings[style_overrides][accent]"]').evaluate((el: HTMLInputElement) => {
        el.removeAttribute('maxlength');
        el.value = '<i id="it-f2-probe">q</i>';
      });
      await submitSettings(page);
      const notices = page.locator('#wpbody-content .notice');
      await expect(notices.filter({ hasText: '不是有效的十六進位色碼' })).toHaveCount(1);
      // The submitted text is shown as text: no element was created from it.
      await expect(page.locator('#it-f2-probe')).toHaveCount(0);
      await expect(notices.filter({ hasText: '不是有效的十六進位色碼' })).toContainText('<i id="it-f2-probe">');
      expect((getSettings(DEV).style_overrides as Record<string, string>).accent).toBe(((settingsSnapshot.style_overrides ?? {}) as Record<string, string>).accent ?? '');
    } finally {
      await close();
    }
  });

  test('F1: a bare [shortcode] in a title survives a second do_shortcode() pass (Elementor) in the card and in the JSON bootstrap', async () => {
    const prefix = 'it-f1-state';
    deleteEventsByPrefix(DEV, prefix);
    const title = `${prefix} [wg_live view="help"] 與 [gallery] 演出`;
    const ids = createEvents(DEV, [{ slug: `${prefix}-brackets`, title, meta: { description: '描述 [wg_live_featured] 結尾' } }]);
    try {
      setSettingsKeys(DEV, { featured_event: ids[`${prefix}-brackets`] });

      const card = wpPhp<{ first: string; second: string }>(DEV, `$first = do_shortcode( '[wg_live_featured]' ); return array( 'first' => $first, 'second' => do_shortcode( $first ) );`);
      expect(card.first, 'the card is rendered').toContain('wg-live-featured--event');
      expect(card.second, 'a second pass changes nothing').toBe(card.first);
      expect(card.first).not.toContain('[wg_live');
      expect(card.first).not.toContain('[gallery]');
      expect(card.first).toContain('&#x5B;wg_live');

      const app = wpPhp<{ first: string; second: string }>(DEV, `$first = do_shortcode( '[wg_live view="events"]' ); return array( 'first' => $first, 'second' => do_shortcode( $first ) );`);
      expect(app.second, 'a second pass changes nothing').toBe(app.first);
      expect(app.first).not.toContain('[wg_live');

      // The browser still decodes the original text from the escaped JSON.
      const fetched = await fetchText(DEV, '/live/');
      expect(fetched.text).not.toContain('[wg_live view=');
      const decoded = bootConfigs(fetched.text)[0]?.events.find((e: { slug: string }) => e.slug === `${prefix}-brackets`);
      expect(decoded?.title).toBe(title);
      expect(decoded?.description).toBe('描述 [wg_live_featured] 結尾');
      expect(Array.isArray(bootConfigs(fetched.text)[0]?.events), 'array brackets stay structural').toBe(true);
    } finally {
      setSettingsKeys(DEV, { featured_event: settingsSnapshot.featured_event });
      deletePosts(DEV, Object.values(ids));
      deleteEventsByPrefix(DEV, prefix);
    }
  });
});

test.describe('create suggested pages (plan 4.6)', () => {
  const pageState = (): Array<{ id: number; uri: string; status: string; parent: number; content: string }> =>
    wpPhp(DEV, `$o = array(); foreach ( get_posts( array( 'post_type' => 'page', 'post_status' => 'any', 'numberposts' => -1, 'orderby' => 'ID' ) ) as $p ) { $o[] = array( 'id' => $p->ID, 'uri' => get_page_uri( $p ), 'status' => $p->post_status, 'parent' => (int) $p->post_parent, 'content' => $p->post_content ); } return $o;`);

  test('with the three paths taken, the screen lists the conflicts and offers no form', async ({ browser }) => {
    const { page, close } = await adminPage(browser);
    try {
      await page.goto(PAGES_URL);
      const rows = page.locator('#wpbody-content table tbody tr');
      await expect(rows).toHaveCount(3);
      for (let i = 0; i < 3; i++) await expect(rows.nth(i)).toContainText('已存在');
      await expect(page.locator('.notice-error')).toContainText('已有相同路徑的頁面，所以不能建立');
      await expect(page.locator('input[name="action"][value="wg_live_create_pages"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '建立三個草稿頁面' })).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('F3: an unattached media-library file named like a page slug is a conflict too (no live-2 rename)', async ({ browser }) => {
    const before = pageState();
    const liveId = before.find((p) => p.uri === 'live')!.id;
    const { page, close } = await adminPage(browser);
    let attachmentId = 0;
    try {
      // Free the page path, then let a media file take the slug (wp_unique_post_slug() checks pages and attachments together).
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live-tmp-it' ) ); return true;`);
      attachmentId = wpPhp<number>(DEV, `return wp_insert_attachment( array( 'post_title' => 'live', 'post_name' => 'live', 'post_status' => 'inherit', 'post_mime_type' => 'image/png', 'post_parent' => 0 ), false );`);
      expect(attachmentId).toBeGreaterThan(0);
      expect(wpPhp<string>(DEV, `return get_post_field( 'post_name', ${attachmentId} );`)).toBe('live');

      await page.goto(PAGES_URL);
      const rows = page.locator('#wpbody-content table tbody tr');
      await expect(rows.first()).toContainText('已存在');
      await expect(rows.first()).toContainText('媒體庫檔案');
      await expect(page.locator('.notice-error')).toContainText('已有相同路徑的頁面，所以不能建立');
      await expect(page.getByRole('button', { name: '建立三個草稿頁面' })).toHaveCount(0);
      expect(pageState().map((p) => p.id), 'no page was created').toEqual(before.map((p) => p.id));
    } finally {
      if (attachmentId > 0) deletePosts(DEV, [attachmentId]);
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live' ) ); return true;`);
      await close();
    }
    expect(pageState()).toEqual(before);
  });

  test('the handler re-checks conflicts: a form rendered while the paths were free is refused once a page exists', async ({ browser }) => {
    const before = pageState();
    const liveId = before.find((p) => p.uri === 'live')!.id;
    const { page, close } = await adminPage(browser);
    try {
      // Free the path, render the confirm form (with its nonce) ...
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live-tmp-it' ) ); return true;`);
      await page.goto(PAGES_URL);
      await expect(page.getByRole('button', { name: '建立三個草稿頁面' })).toBeVisible();
      // ... then take the path again before the person clicks.
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live' ) ); return true;`);
      await submitCreatePages(page);
      await expect(page.locator('.notice-error', { hasText: '已有相同路徑的頁面，沒有建立任何頁面' })).toHaveCount(1);
      expect(pageState(), 'nothing was created, nothing was changed').toEqual(before);
    } finally {
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live' ) ); return true;`);
      await close();
    }
  });

  test('without conflicts it creates three DRAFT pages with the right shortcodes and parent, and leaves the bindings alone', async ({ browser }) => {
    const before = pageState();
    const liveId = before.find((p) => p.uri === 'live')!.id;
    const bound = { page_events: settingsSnapshot.page_events, page_player: settingsSnapshot.page_player, page_help: settingsSnapshot.page_help };
    const { page, close } = await adminPage(browser);
    let createdIds: number[] = [];
    try {
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live-tmp-it' ) ); return true;`);
      await page.goto(PAGES_URL);
      await expect(page.locator('input[name="replace_bindings"]')).toHaveCount(1); // bindings exist: a second confirmation is offered
      await expect(page.locator('#wpbody-content table tbody tr').first()).toContainText('可建立');
      await submitCreatePages(page);
      await expect(page.locator('.notice-success')).toContainText('已建立三個草稿頁面');
      await expect(page.locator('.notice-success')).toContainText('既有的頁面綁定沒有被更動');

      const after = pageState();
      const known = new Set(before.map((p) => p.id));
      const added = after.filter((p) => !known.has(p.id));
      createdIds = added.map((p) => p.id);
      expect(added.map((p) => p.uri).sort()).toEqual(['live', 'live/help', 'live/listen']);
      for (const p of added) expect(p.status, p.uri).toBe('draft'); // never published
      const parent = added.find((p) => p.uri === 'live')!;
      expect(added.find((p) => p.uri === 'live/listen')).toMatchObject({ parent: parent.id, content: '[wg_live view="player"]' });
      expect(added.find((p) => p.uri === 'live/help')).toMatchObject({ parent: parent.id, content: '[wg_live view="help"]' });
      expect(parent.content).toBe('[wg_live view="events"]');
      // Existing pages are untouched (the renamed Live page and its children differ only by path) and the bindings still point at the seeded pages.
      const moved = (p: { id: number; parent: number }): boolean => p.id === liveId || p.parent === liveId;
      const strip = (p: { id: number; status: string; parent: number; content: string }): object => ({ id: p.id, status: p.status, parent: p.parent, content: p.content });
      expect(after.filter((p) => known.has(p.id) && !moved(p))).toEqual(before.filter((p) => !moved(p)));
      expect(after.filter((p) => known.has(p.id) && moved(p)).map(strip)).toEqual(before.filter(moved).map(strip));
      const settings = getSettings(DEV);
      expect({ page_events: settings.page_events, page_player: settings.page_player, page_help: settings.page_help }).toEqual(bound);
      // The new drafts own the /live/ path but are not public; the renamed seeded page still answers at its temporary path.
      // WordPress may answer a missing path with a redirect to a similar page, but it never serves the draft (status 200).
      const draftPath = await fetchText(DEV, '/live/');
      expect(draftPath.status, 'the draft is not served').not.toBe(200);
      expect(draftPath.text).not.toContain('wg-live__config');
      expect((await fetchText(DEV, '/live-tmp-it/')).status).toBe(200);
    } finally {
      deletePosts(DEV, createdIds);
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live' ) ); return true;`);
      await close();
    }
    expect(pageState()).toEqual(before);
  });

  test('only with the explicit second confirmation are existing bindings replaced', async ({ browser }) => {
    const before = pageState();
    const liveId = before.find((p) => p.uri === 'live')!.id;
    const { page, close } = await adminPage(browser);
    let createdIds: number[] = [];
    try {
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live-tmp-it' ) ); return true;`);
      await page.goto(PAGES_URL);
      await page.locator('input[name="replace_bindings"]').check();
      await submitCreatePages(page);
      await expect(page.locator('.notice-success')).toContainText('頁面已綁定到設定');

      const known = new Set(before.map((p) => p.id));
      const added = pageState().filter((p) => !known.has(p.id));
      createdIds = added.map((p) => p.id);
      const byUri = Object.fromEntries(added.map((p) => [p.uri, p.id]));
      const settings = getSettings(DEV);
      expect(settings.page_events).toBe(byUri['live']);
      expect(settings.page_player).toBe(byUri['live/listen']);
      expect(settings.page_help).toBe(byUri['live/help']);
    } finally {
      setSettingsKeys(DEV, { page_events: settingsSnapshot.page_events, page_player: settingsSnapshot.page_player, page_help: settingsSnapshot.page_help });
      deletePosts(DEV, createdIds);
      wpPhp(DEV, `wp_update_post( array( 'ID' => ${liveId}, 'post_name' => 'live' ) ); return true;`);
      await close();
    }
    expect(pageState()).toEqual(before);
    const live = bootConfigs((await fetchText(DEV, '/live/')).text);
    expect(live).toHaveLength(1);
  });
});

test.describe('the demo audio override (M1-PLAN 4.3: it applies to AUDIO events only)', () => {
  const PREFIX = 'it-override';
  const TOKEN = `${PREFIX}-${Date.now()}`;

  test('an approved media-library audio file is what /playback returns for an audio event; a video event always gets the bundled mp4', async () => {
    deleteEventsByPrefix(DEV, PREFIX);
    const before = getSettings(DEV);
    const ids = createEvents(DEV, [
      { slug: `${TOKEN}-audio`, title: `${TOKEN} audio`, meta: { media_kind: 'audio' } },
      { slug: `${TOKEN}-video`, title: `${TOKEN} video`, meta: { media_kind: 'video' } },
    ]);
    // A copy of the bundled demo tone in the uploads folder, registered as an audio attachment.
    const attachment = wpPhp<{ id: number; url: string }>(
      DEV,
      `require_once ABSPATH . 'wp-admin/includes/image.php';
       $u    = wp_upload_dir();
       $file = $u['path'] . '/${TOKEN}.mp3';
       copy( WP_PLUGIN_DIR . '/wg-live/assets/demo/demo-tone-2.mp3', $file );
       $id = wp_insert_attachment( array( 'post_mime_type' => 'audio/mpeg', 'post_title' => '${TOKEN}', 'post_status' => 'inherit' ), $file );
       return array( 'id' => $id, 'url' => wp_get_attachment_url( $id ) );`,
    );
    try {
      expect(attachment.id).toBeGreaterThan(0);
      const playback = async (id: number, mode: 'binaural' | 'atmos') => (await rest(DEV, `playback?event=${id}&mode=${mode}`)).json;
      const audio = ids[`${TOKEN}-audio`] as number;
      const video = ids[`${TOKEN}-video`] as number;

      // Selected but NOT approved (the picker sets the flag): the bundled tone is used.
      setSettingsKeys(DEV, { demo_audio_atmos: attachment.id });
      expect((await playback(audio, 'atmos')).url, 'unapproved attachment is ignored').toMatch(new RegExp(`/assets/demo/${TONE.atmos}\\?ver=`));

      // Approved: the audio event plays the library file (Atmos is the only mode an event offers).
      wpPhp(DEV, `update_post_meta( ${attachment.id}, '_wg_live_demo_approved', '1' ); return true;`);
      const overridden = await playback(audio, 'atmos');
      expect(overridden).toEqual({ kind: 'demo', url: attachment.url, mimeType: 'audio/mpeg' });
      expect(await playback(audio, 'binaural'), 'binaural is not offered: no URL').toEqual({ kind: 'not_ready', reason: 'mode_unavailable' });

      // The video event ignores the audio picker.
      const v = await playback(video, 'atmos');
      expect(v.mimeType).toBe('video/mp4');
      expect(v.url).toMatch(new RegExp(`/assets/demo/${DEMO_VIDEO.atmos}\\?ver=`));
      expect(v.url).not.toContain(TOKEN);
      // The override file is real, public test media.
      const media = await fetch(attachment.url, { method: 'GET', headers: { Range: 'bytes=0-1' } });
      expect([200, 206]).toContain(media.status);
    } finally {
      setSettingsKeys(DEV, { demo_audio_binaural: before.demo_audio_binaural ?? 0, demo_audio_atmos: before.demo_audio_atmos ?? 0 });
      wpPhp(DEV, `wp_delete_attachment( ${attachment.id}, true ); return true;`);
      deleteEventsByPrefix(DEV, PREFIX);
    }
    expect(getSettings(DEV).demo_audio_binaural ?? 0).toBe(before.demo_audio_binaural ?? 0);
  });
});
