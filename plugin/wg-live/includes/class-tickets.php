<?php
/**
 * Ticket ownership from WooCommerce orders (M2-PLAN A1, decision D2).
 *
 * A user owns a ticket product when one of their own paid orders (customer_id = user ID) has a line for
 * that product, or a variation of it, that is not fully refunded. Never inferred from roles, e-mail
 * addresses or guest-checkout orders (spec 10.4).
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Ticket ownership.
 */
final class Tickets {

	/**
	 * Does this user own this ticket product?
	 *
	 * @param int $user_id    User ID (0 = guest).
	 * @param int $product_id Product ID (a simple product, or the parent of variations).
	 * @return bool
	 */
	public static function owns_product( int $user_id, int $product_id ): bool {
		if ( $user_id < 1 || $product_id < 1 || ! function_exists( 'wc_get_orders' ) || ! function_exists( 'wc_get_is_paid_statuses' ) ) {
			return false;
		}

		$orders = wc_get_orders(
			array(
				'customer_id' => $user_id,
				'status'      => wc_get_is_paid_statuses(),
				'limit'       => -1,
			)
		);
		if ( ! is_array( $orders ) ) {
			return false;
		}

		foreach ( $orders as $order ) {
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			foreach ( $order->get_items() as $item_id => $item ) {
				if ( ! $item instanceof \WC_Order_Item_Product ) {
					continue;
				}
				if ( (int) $item->get_product_id() !== $product_id && (int) $item->get_variation_id() !== $product_id ) {
					continue;
				}
				// get_qty_refunded_for_item() is negative (or 0).
				if ( (int) $item->get_quantity() + (int) $order->get_qty_refunded_for_item( $item_id ) > 0 ) {
					return true;
				}
			}
		}
		return false;
	}
}
