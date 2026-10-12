<?php
/**
 * Links to the bound pages and to the existing account / store / contact pages (plan 4.1).
 *
 * Page IDs differ between environments, so links always come from stored IDs and get_permalink().
 * A link that cannot be resolved is null: the UI hides it. The WooCommerce "home" fallback is
 * never used.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Site links.
 */
final class Site_Links {

	/**
	 * Mode names accepted in player URLs.
	 *
	 * @var string[]
	 */
	const MODES = array( 'binaural', 'atmos' );

	/**
	 * Every link the front end may use (the SiteLinks contract in src/types.ts).
	 *
	 * @return array{home:string,events:?string,player:?string,help:?string,account:?string,store:?string,contact:?string}
	 */
	public static function all() {
		$settings = Settings::get();

		return array(
			'home'    => home_url( '/' ),
			'events'  => self::page_permalink( isset( $settings['page_events'] ) ? $settings['page_events'] : 0 ),
			'player'  => self::page_permalink( isset( $settings['page_player'] ) ? $settings['page_player'] : 0 ),
			'help'    => self::page_permalink( isset( $settings['page_help'] ) ? $settings['page_help'] : 0 ),
			'account' => self::wc_or_override( $settings, 'account_url', 'myaccount', array( 'http', 'https' ) ),
			'store'   => self::wc_or_override( $settings, 'store_url', 'shop', array( 'http', 'https' ) ),
			'contact' => self::override_or_null( $settings, 'contact_url', array( 'http', 'https', 'mailto' ) ),
		);
	}

	/**
	 * URL of the player page for an event, optionally with a preselected mode.
	 *
	 * @param string      $slug Event slug.
	 * @param string|null $mode binaural|atmos or null.
	 * @return string Empty string when the player page is not bound/published or the slug is invalid.
	 */
	public static function player_url( $slug, $mode = null ) {
		$links = self::all();
		$base  = $links['player'];
		if ( null === $base || ! Public_Data::is_valid_slug( $slug ) ) {
			return '';
		}
		$args = array( 'wg_event' => $slug );
		if ( is_string( $mode ) && in_array( $mode, self::MODES, true ) ) {
			$args['wg_mode'] = $mode;
		}
		return add_query_arg( $args, $base );
	}

	/**
	 * Permalink of a published page, else null.
	 *
	 * @param mixed $page_id Page ID.
	 * @return string|null
	 */
	private static function page_permalink( $page_id ) {
		$page_id = (int) $page_id;
		if ( $page_id <= 0 ) {
			return null;
		}
		$post = get_post( $page_id );
		if ( ! $post instanceof \WP_Post || 'page' !== $post->post_type || 'publish' !== $post->post_status ) {
			return null;
		}
		$url = get_permalink( $post );
		return is_string( $url ) && '' !== $url ? $url : null;
	}

	/**
	 * The WooCommerce page when WooCommerce is active and that page is published (spec 10.4), else a valid
	 * admin override, else null. Never the WooCommerce home fallback.
	 *
	 * @param array    $settings  Settings.
	 * @param string   $key       Override key.
	 * @param string   $wc_page   WooCommerce page name for wc_get_page_id().
	 * @param string[] $protocols Allowed schemes.
	 * @return string|null
	 */
	private static function wc_or_override( array $settings, $key, $wc_page, array $protocols ) {
		if ( function_exists( 'wc_get_page_id' ) ) {
			$id = (int) wc_get_page_id( $wc_page );
			if ( $id > 0 ) {
				$url = self::page_permalink( $id );
				if ( null !== $url ) {
					return $url;
				}
			}
		}
		return self::override_or_null( $settings, $key, $protocols );
	}

	/**
	 * A valid admin override, else null.
	 *
	 * @param array    $settings  Settings.
	 * @param string   $key       Override key.
	 * @param string[] $protocols Allowed schemes.
	 * @return string|null
	 */
	private static function override_or_null( array $settings, $key, array $protocols ) {
		if ( empty( $settings[ $key ] ) || ! is_string( $settings[ $key ] ) ) {
			return null;
		}
		$url = esc_url_raw( trim( $settings[ $key ] ), $protocols );
		return '' !== $url ? $url : null;
	}
}
