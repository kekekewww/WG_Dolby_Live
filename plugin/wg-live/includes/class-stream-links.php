<?php
/**
 * A ticket holder's own stream link (0.5.3, user decision 2026-11-02).
 *
 * The personal link no longer shows the stream host: each ticket holder gets one random address per event on this
 * site, GET wg-live/v1/s/<event>/<token>/<mode>.m3u8. Opening it (VLC, Safari, no cookie needed) runs the same checks
 * as /playback for the token's owner and answers with a redirect to the stream. WordPress answers once per start;
 * the player then fetches the playlists and segments from the stream host itself, never through WordPress.
 *
 * This hides the address from the link people copy. It does not protect the stream: the player follows the redirect,
 * so the address can still be read, and it plays without a ticket until the stream server checks signed links.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Per-ticket-holder links that redirect to the stream.
 */
final class Stream_Links {

	/**
	 * User meta key prefix; the event ID follows. The value is the user's token for that event.
	 */
	const META_PREFIX = '_wg_live_link_';

	/**
	 * 16 random bytes, base64url without padding.
	 */
	const TOKEN_PATTERN = '[A-Za-z0-9_-]{22}';

	/**
	 * REST route of the link (inside Public_Data::REST_NAMESPACE).
	 */
	const ROUTE = '/s/(?P<event>[1-9][0-9]*)/(?P<token>[A-Za-z0-9_-]{22})/(?P<mode>binaural|atmos)\.m3u8';

	/**
	 * The user's own link for an event and mode, made on first use and the same afterwards. '' when it cannot be made.
	 *
	 * @param int    $event_id Event post ID.
	 * @param int    $user_id  User ID.
	 * @param string $mode     binaural|atmos.
	 * @return string
	 */
	public static function url( $event_id, $user_id, $mode ) {
		$event_id = (int) $event_id;
		$token    = self::token( $event_id, (int) $user_id );
		if ( '' === $token || ! in_array( $mode, array( 'binaural', 'atmos' ), true ) ) {
			return '';
		}
		return rest_url( Public_Data::REST_NAMESPACE . '/s/' . $event_id . '/' . $token . '/' . $mode . '.m3u8' );
	}

	/**
	 * The user's token for an event, created once.
	 *
	 * @param int $event_id Event post ID.
	 * @param int $user_id  User ID.
	 * @return string
	 */
	private static function token( $event_id, $user_id ) {
		if ( $event_id < 1 || $user_id < 1 ) {
			return '';
		}
		$key   = self::META_PREFIX . $event_id;
		$token = (string) get_user_meta( $user_id, $key, true );
		if ( self::is_token( $token ) ) {
			return $token;
		}
		try {
			$token = rtrim( strtr( base64_encode( random_bytes( 16 ) ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- a random token, not obfuscation.
		} catch ( \Exception $e ) {
			return '';
		}
		update_user_meta( $user_id, $key, $token );
		return $token;
	}

	/**
	 * The user a token belongs to for this event, or 0. The database compares case-insensitively, so every candidate
	 * is compared again exactly.
	 *
	 * @param int    $event_id Event post ID.
	 * @param string $token    Token from the link.
	 * @return int
	 */
	public static function owner( $event_id, $token ) {
		if ( ! self::is_token( $token ) ) {
			return 0;
		}
		$key = self::META_PREFIX . (int) $event_id;
		$ids = get_users(
			array(
				'meta_key'    => $key, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- one indexed key per event.
				'meta_value'  => $token, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- matched within that key only.
				'number'      => 5,
				'fields'      => 'ID',
				'count_total' => false,
			)
		);
		foreach ( $ids as $id ) {
			if ( hash_equals( (string) get_user_meta( (int) $id, $key, true ), $token ) ) {
				return (int) $id;
			}
		}
		return 0;
	}

	/**
	 * GET s/<event>/<token>/<mode>.m3u8: 302 to the stream for a ticket holder whose show is open, 404 for an unknown
	 * link, 403 when it is known but not playable now (refund, event not live). Never cached.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function rest_open( $request ) {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		$event_id = (int) $request->get_param( 'event' );
		$user_id  = self::owner( $event_id, (string) $request->get_param( 'token' ) );
		if ( $user_id < 1 ) {
			return self::answer( 404, null );
		}
		$source = Playback_Provider::resolve( $event_id, (string) $request->get_param( 'mode' ), $user_id );
		if ( 'hls' !== $source['kind'] || empty( $source['url'] ) ) {
			return self::answer( 403, null );
		}
		return self::answer( 302, $source['url'] );
	}

	/**
	 * Remove every stored link of an event (uninstall).
	 *
	 * @param int $event_id Event post ID.
	 * @return void
	 */
	public static function forget_event( $event_id ) {
		delete_metadata( 'user', 0, self::META_PREFIX . (int) $event_id, '', true );
	}

	/**
	 * Does a value look like a token?
	 *
	 * @param mixed $value Value.
	 * @return bool
	 */
	private static function is_token( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^' . self::TOKEN_PATTERN . '$/', $value );
	}

	/**
	 * A no-store answer with no body, redirecting when $location is given.
	 *
	 * @param int         $status   HTTP status.
	 * @param string|null $location Redirect target.
	 * @return \WP_REST_Response
	 */
	private static function answer( $status, $location ) {
		$response = new \WP_REST_Response( null, $status );
		if ( null !== $location ) {
			$response->header( 'Location', $location );
		}
		foreach ( wp_get_nocache_headers() as $name => $value ) {
			if ( '' !== $value ) {
				$response->header( $name, $value );
			}
		}
		return $response;
	}
}
