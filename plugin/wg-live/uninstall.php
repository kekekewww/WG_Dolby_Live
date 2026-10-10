<?php
/**
 * Uninstall handler (M1-PLAN 4.1).
 *
 * The plugin is not loaded while it is uninstalled, so this file uses literal names only. It
 * deletes data only when the administrator opted in ("delete_data_on_uninstall") and never
 * deletes attachments, pages, users, products or orders.
 *
 * @package WG_Live
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( ! function_exists( 'wg_live_uninstall_site' ) ) {

	/**
	 * Delete the plugin's data on the current site, when the site opted in.
	 *
	 * @return void
	 */
	function wg_live_uninstall_site() {
		global $wpdb;

		$settings = get_option( 'wg_live_settings' );
		if ( ! is_array( $settings ) || empty( $settings['delete_data_on_uninstall'] ) ) {
			return;
		}

		// Every event in any status (including trash and auto-draft), in batches. wp_delete_post()
		// removes the post's meta (_wg_live_*) and leaves attachments in the media library.
		$statuses = array_values( array_unique( array_merge( array_values( get_post_stati() ), array( 'trash', 'auto-draft' ) ) ) );
		$seen = array();
		do {
			$ids = get_posts(
				array(
					'post_type'        => 'wg_live_event',
					'post_status'      => $statuses,
					'posts_per_page'   => 200,
					'fields'           => 'ids',
					'orderby'          => 'ID',
					'order'            => 'ASC',
					'no_found_rows'    => true,
					'suppress_filters' => true,
				)
			);
			$fresh = array_diff( array_map( 'intval', $ids ), $seen ); // Stop if something refuses to delete.
			foreach ( $fresh as $event_id ) {
				wp_delete_post( $event_id, true );
				$seen[] = $event_id;
			}
		} while ( ! empty( $fresh ) );

		// The approval flag set on media library files by the settings picker (the files stay).
		delete_post_meta_by_key( '_wg_live_demo_approved' );

		delete_option( 'wg_live_settings' );
		delete_option( 'wg_live_settings_meta' );

		// Queued admin notices (transients); they expire by themselves, this just tidies up.
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
				$wpdb->esc_like( '_transient_wg_live_notices_' ) . '%',
				$wpdb->esc_like( '_transient_timeout_wg_live_notices_' ) . '%'
			)
		); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off cleanup at uninstall.
	}
}

if ( is_multisite() ) {
	$wg_live_offset = 0;
	do {
		$wg_live_sites = get_sites(
			array(
				'fields' => 'ids',
				'number' => 100,
				'offset' => $wg_live_offset,
			)
		);
		foreach ( $wg_live_sites as $wg_live_site_id ) {
			switch_to_blog( (int) $wg_live_site_id );
			wg_live_uninstall_site();
			restore_current_blog();
		}
		$wg_live_offset += 100;
	} while ( count( $wg_live_sites ) === 100 );
} else {
	wg_live_uninstall_site();
}
