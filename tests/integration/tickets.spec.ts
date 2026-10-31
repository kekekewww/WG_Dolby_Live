/**
 * M2-PLAN A1: ticket ownership comes only from paid WooCommerce orders linked to the user ID (spec 10.4, D2).
 * Never from roles, e-mail strings or a front-end flag. Fixtures (users, products, orders) are created per
 * browser project with a unique prefix and removed afterwards.
 */
import { randomUUID } from 'node:crypto';
import { test } from '@playwright/test';
import { deleteUsersByLoginPrefix, DEV, expect, wpPhp } from './wp';

test.describe.configure({ mode: 'serial' });

let prefix = '';
let buyer = 0;
let other = 0;
let product = 0;
let otherProduct = 0;
let variable = 0;
let variation = 0;
const orders: number[] = [];

const owns = (user: number, productId: number): boolean =>
  wpPhp<boolean>(DEV, `return WG_Live\\Tickets::owns_product( ${user}, ${productId} );`);

function user(tag: string): number {
  const login = `${prefix}-${tag}-${randomUUID().slice(0, 6)}`;
  return wpPhp<number>(DEV, `return wp_insert_user( array( 'user_login' => '${login}', 'user_pass' => wp_generate_password(), 'user_email' => '${login}@example.invalid', 'role' => 'customer' ) );`);
}

function simpleProduct(name: string): number {
  return wpPhp<number>(DEV, `$p = new WC_Product_Simple(); $p->set_name( '${name}' ); $p->set_regular_price( '100' ); $p->set_status( 'publish' ); return $p->save();`);
}

/** An order for `lines` ([productId, qty]) with this status; customerId 0 = guest checkout with `email`. */
function order(customerId: number, lines: Array<[number, number]>, status: string, email = ''): number {
  const add = lines.map(([p, q]) => `$o->add_product( wc_get_product( ${p} ), ${q} );`).join(' ');
  const id = wpPhp<number>(
    DEV,
    `$o = wc_create_order( array( 'customer_id' => ${customerId} ) ); ${add} ${email ? `$o->set_billing_email( '${email}' );` : ''} $o->calculate_totals(); $o->set_status( '${status}' ); $o->save(); return $o->get_id();`,
  );
  orders.push(id);
  return id;
}

/** Refund `qty` of the order's line for `productId` (refund_payment false: no gateway call). */
function refund(orderId: number, productId: number, qty: number): void {
  wpPhp(
    DEV,
    `$o = wc_get_order( ${orderId} ); foreach ( $o->get_items() as $item_id => $item ) { if ( (int) $item->get_product_id() === ${productId} ) { wc_create_refund( array( 'order_id' => ${orderId}, 'amount' => 100 * ${qty}, 'line_items' => array( $item_id => array( 'qty' => ${qty}, 'refund_total' => 100 * ${qty} ) ) ) ); } } return true;`,
  );
}

test.beforeAll(async ({}, testInfo) => {
  prefix = `it-tix-${testInfo.project.name}`;
  deleteUsersByLoginPrefix(DEV, `${prefix}-`);
  buyer = user('buyer');
  other = user('other');
  product = simpleProduct(`${prefix} ticket`);
  otherProduct = simpleProduct(`${prefix} other`);
  variable = wpPhp<number>(DEV, `$p = new WC_Product_Variable(); $p->set_name( '${prefix} variable' ); $p->set_status( 'publish' ); return $p->save();`);
  variation = wpPhp<number>(DEV, `$v = new WC_Product_Variation(); $v->set_parent_id( ${variable} ); $v->set_regular_price( '100' ); $v->set_status( 'publish' ); return $v->save();`);
});

test.afterAll(() => {
  wpPhp(DEV, `foreach ( ${JSON.stringify(orders)} as $id ) { $o = wc_get_order( (int) $id ); if ( $o ) { $o->delete( true ); } } return true;`);
  wpPhp(DEV, `foreach ( array( ${variation}, ${variable}, ${product}, ${otherProduct} ) as $id ) { $p = wc_get_product( (int) $id ); if ( $p ) { $p->delete( true ); } } return true;`);
  deleteUsersByLoginPrefix(DEV, `${prefix}-`);
});

test('a completed order for the product grants it', () => {
  order(buyer, [[product, 1]], 'completed');
  expect(owns(buyer, product)).toBe(true);
});

test('processing counts; pending, on-hold, cancelled, failed and refunded orders do not', () => {
  const u = user('status');
  for (const status of ['pending', 'on-hold', 'cancelled', 'failed', 'refunded']) {
    order(u, [[otherProduct, 1]], status);
    expect(owns(u, otherProduct), status).toBe(false);
  }
  order(u, [[otherProduct, 1]], 'processing');
  expect(owns(u, otherProduct), 'processing').toBe(true);
});

test('a variation of the product counts as the product', () => {
  const u = user('variation');
  order(u, [[variation, 1]], 'completed');
  expect(owns(u, variable)).toBe(true);
  expect(owns(u, variation)).toBe(true);
});

test('another product, another user, user 0 and product 0 are false', () => {
  expect(owns(buyer, otherProduct)).toBe(false);
  expect(owns(other, product)).toBe(false);
  expect(owns(0, product)).toBe(false);
  expect(owns(buyer, 0)).toBe(false);
});

test('a guest-checkout order (customer_id 0) with the same e-mail does not grant it', () => {
  const u = user('guestbuy');
  const email = wpPhp<string>(DEV, `return get_userdata( ${u} )->user_email;`);
  order(0, [[product, 1]], 'completed', email);
  expect(owns(u, product)).toBe(false);
});

test('a fully refunded line is false; 1 of 2 refunded is still true', () => {
  const u = user('refund');
  const full = order(u, [[product, 1], [otherProduct, 1]], 'completed');
  refund(full, product, 1);
  expect(owns(u, product)).toBe(false);
  expect(owns(u, otherProduct)).toBe(true);

  const v = user('refund2');
  const two = order(v, [[product, 2]], 'completed');
  refund(two, product, 1);
  expect(owns(v, product)).toBe(true);
});
