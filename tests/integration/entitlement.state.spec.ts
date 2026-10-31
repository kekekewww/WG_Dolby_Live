/**
 * M2-PLAN A2: deployment mode "live", Entitlement::check from tickets, GET wg-live/v1/entitlement and the REST
 * nonce in the bootstrap. Changes the deployment mode (shared state), so it runs in the *-state projects and
 * restores the settings afterwards.
 */
import { randomUUID } from 'node:crypto';
import { test, type Page } from '@playwright/test';
import { adminContext, bootConfigs, createEvents, deleteEventsByPrefix, deletePosts, deleteUsersByLoginPrefix, DEV, expect, fillLoginForm, getSettings, rest, setSettingsKeys, wpPhp } from './wp';

test.describe.configure({ mode: 'serial' });

const prefix = 'it-ent-state';
let snapshot: Record<string, unknown> = {};
let product = 0;
let eventId = 0;
let noProductEvent = 0;
const users: Record<'buyer' | 'other', { login: string; password: string; id: number }> = {} as never;
const orders: number[] = [];

function customer(tag: 'buyer' | 'other'): void {
  const login = `${prefix}-${tag}-${randomUUID().slice(0, 6)}`;
  const password = randomUUID();
  const id = wpPhp<number>(DEV, `return wp_insert_user( array( 'user_login' => '${login}', 'user_pass' => '${password}', 'user_email' => '${login}@example.invalid', 'role' => 'customer' ) );`);
  users[tag] = { login, password, id };
}

async function loggedIn(browser: import('@playwright/test').Browser, tag: 'buyer' | 'other'): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ baseURL: DEV.baseURL });
  const page = await ctx.newPage();
  await page.goto('/wp-login.php');
  await fillLoginForm(page, users[tag].login, users[tag].password);
  await page.locator('#wp-submit').click();
  await page.waitForURL(/wp-admin|my-account/);
  return { page, close: () => ctx.close() };
}

/** GET entitlement from inside the page, with (or without) the bootstrap nonce. */
async function entitlementFromPage(page: Page, id: number, withNonce = true): Promise<{ status: number; body: { status: string; reason?: string }; cache: string | null }> {
  await page.goto(`/live/listen/?wg_event=${prefix}-concert`);
  const nonce = withNonce ? (bootConfigs(await page.content())[0]?.rest?.nonce ?? null) : null;
  return page.evaluate(
    async ([eid, n]) => {
      const r = await fetch(`/wp-json/wg-live/v1/entitlement?event=${eid}`, { credentials: 'same-origin', headers: n ? { 'X-WP-Nonce': n as string } : {} });
      return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
    },
    [id, nonce] as const,
  );
}

test.beforeAll(() => {
  snapshot = getSettings(DEV);
  deleteEventsByPrefix(DEV, prefix);
  deleteUsersByLoginPrefix(DEV, `${prefix}-`);
  customer('buyer');
  customer('other');
  product = wpPhp<number>(DEV, `$p = new WC_Product_Simple(); $p->set_name( '${prefix} ticket' ); $p->set_regular_price( '100' ); $p->set_status( 'publish' ); return $p->save();`);
  const ids = createEvents(DEV, [
    { slug: `${prefix}-concert`, title: `${prefix} concert`, meta: { is_demo: '0', source_type: 'not_configured', product_id: product } },
    { slug: `${prefix}-noticket`, title: `${prefix} noticket`, meta: { is_demo: '0', source_type: 'not_configured', product_id: 0 } },
  ]);
  eventId = ids[`${prefix}-concert`] ?? 0;
  noProductEvent = ids[`${prefix}-noticket`] ?? 0;
  orders.push(wpPhp<number>(DEV, `$o = wc_create_order( array( 'customer_id' => ${users.buyer.id} ) ); $o->add_product( wc_get_product( ${product} ), 1 ); $o->calculate_totals(); $o->set_status( 'completed' ); $o->save(); return $o->get_id();`));
});

test.afterAll(() => {
  setSettingsKeys(DEV, { deployment_mode: snapshot.deployment_mode });
  wpPhp(DEV, `foreach ( ${JSON.stringify(orders)} as $id ) { $o = wc_get_order( (int) $id ); if ( $o ) { $o->delete( true ); } } $p = wc_get_product( ${product} ); if ( $p ) { $p->delete( true ); } return true;`);
  deletePosts(DEV, [eventId, noProductEvent]);
  deleteEventsByPrefix(DEV, prefix);
  deleteUsersByLoginPrefix(DEV, `${prefix}-`);
});

test('demo mode keeps M1: a real event is unavailable/not_live_mode', async () => {
  setSettingsKeys(DEV, { deployment_mode: 'demo' });
  const { status, json } = await rest(DEV, `entitlement?event=${eventId}`);
  expect(status).toBe(200);
  expect(json).toEqual({ status: 'unavailable', reason: 'not_live_mode' });
});

test('live mode: guest, buyer, non-buyer, event without a ticket product; never cached', async ({ browser }) => {
  setSettingsKeys(DEV, { deployment_mode: 'live' });
  const guest = await rest(DEV, `entitlement?event=${eventId}`);
  expect(guest.json).toEqual({ status: 'guest' });

  const buyer = await loggedIn(browser, 'buyer');
  try {
    const ok = await entitlementFromPage(buyer.page, eventId);
    expect(ok.body).toEqual({ status: 'entitled' });
    expect(ok.cache).toContain('no-store');
    // WordPress cookie auth: a logged-in request WITHOUT the nonce is a guest.
    expect((await entitlementFromPage(buyer.page, eventId, false)).body).toEqual({ status: 'guest' });
    expect((await entitlementFromPage(buyer.page, noProductEvent)).body).toEqual({ status: 'unavailable', reason: 'no_ticket_product' });
  } finally {
    await buyer.close();
  }

  const other = await loggedIn(browser, 'other');
  try {
    expect((await entitlementFromPage(other.page, eventId)).body).toEqual({ status: 'not_entitled' });
  } finally {
    await other.close();
  }
});

test('bootstrap: guests get nonce null; logged-in users a 10-char nonce and the nonce refresh URL works', async ({ browser }) => {
  setSettingsKeys(DEV, { deployment_mode: 'live' });
  const guestRes = await fetch(`${DEV.baseURL}/live/listen/?wg_event=${prefix}-concert`);
  const guestBoot = bootConfigs(await guestRes.text())[0];
  expect(guestBoot?.rest?.nonce).toBeNull();
  expect(guestBoot?.rest?.nonceUrl).toMatch(/admin-ajax\.php\?action=rest-nonce$/);
  expect(guestBoot?.deploymentMode).toBe('live');

  const buyer = await loggedIn(browser, 'buyer');
  try {
    await buyer.page.goto(`/live/listen/?wg_event=${prefix}-concert`);
    const boot = bootConfigs(await buyer.page.content())[0];
    expect(boot?.rest?.nonce).toMatch(/^[0-9a-f]{10}$/);
    const fresh = await buyer.page.evaluate(async (url: string) => (await fetch(url, { credentials: 'same-origin' })).text(), boot?.rest?.nonceUrl as string);
    expect(fresh).toMatch(/^[0-9a-f]{10}$/);
  } finally {
    await buyer.close();
  }
});

test('the deployment screen names the live mode', async ({ browser }) => {
  setSettingsKeys(DEV, { deployment_mode: 'live' });
  const ctx = await adminContext(browser, DEV);
  try {
    const page = await ctx.newPage();
    await page.goto('/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-deploy');
    await expect(page.locator('#wpbody-content')).toContainText('正式（live）');
  } finally {
    await ctx.close();
  }
});
