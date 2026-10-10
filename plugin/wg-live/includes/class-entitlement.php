<?php
/**
 * Server-side entitlement seam (plan D6).
 *
 * M1 has no ticket check. The only entitled case is a public demo event with a demo source, whose
 * media is public test material. Everything else is "unavailable": playback is denied, never
 * allowed by default. M2 replaces the body of check() with a real ticket check.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Entitlement checks.
 */
final class Entitlement {

	/**
	 * May this user play this event?
	 *
	 * Ownership is never inferred from roles, e-mail addresses or orders in M1.
	 *
	 * @param int $event_id Event post ID.
	 * @param int $user_id  User ID (0 = guest). Unused in M1; kept for the M2 contract.
	 * @return array{status:string,reason:string} status: guest|not_entitled|entitled|unavailable.
	 */
	public static function check( $event_id, $user_id ) {
		unset( $user_id );

		if ( ! Public_Data::is_enabled() ) {
			return self::result( 'unavailable', 'disabled' );
		}

		$post = get_post( (int) $event_id );
		if ( ! $post instanceof \WP_Post || ! Events::is_public( $post ) ) {
			return self::result( 'unavailable', 'event_not_found' );
		}

		$data = Events::get_event_data( $post );
		if ( ! empty( $data['is_demo'] ) && isset( $data['source_type'] ) && 'demo' === $data['source_type'] ) {
			return self::result( 'entitled', 'demo' );
		}

		return self::result( 'unavailable', 'not_implemented' );
	}

	/**
	 * Build a result.
	 *
	 * @param string $status Status.
	 * @param string $reason Machine-readable reason (never shown to viewers).
	 * @return array{status:string,reason:string}
	 */
	private static function result( $status, $reason ) {
		return array(
			'status' => $status,
			'reason' => $reason,
		);
	}
}
