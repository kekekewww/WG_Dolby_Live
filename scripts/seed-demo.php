<?php
/**
 * Seeds demo events and, in "setup" mode, the whole demo site for wg-live (spec 11.3, M1-PLAN 4.2, 7.2).
 *
 * Run inside wp-env (scripts/ is mapped to wp-content/wg-live-scripts, see .wp-env.json; the
 * lifecycle script scripts/wp-env-setup.mjs runs "setup" after every wp-env start):
 *
 *   npx wp-env run cli wp eval-file wp-content/wg-live-scripts/seed-demo.php            events only
 *   npx wp-env run cli wp eval-file wp-content/wg-live-scripts/seed-demo.php mode=demo  + deployment mode demo
 *   npx wp-env run cli wp eval-file wp-content/wg-live-scripts/seed-demo.php setup      everything below
 *
 * "setup" (implies mode=demo), idempotent:
 *   - activates the Astra theme (when installed),
 *   - sets pretty permalinks (/%postname%/) and flushes the rewrite rules ONCE (only when the structure changed),
 *   - seeds the demo events (explicit ASCII slugs, Chinese titles),
 *   - creates the pages live, live/listen and live/help with the wg_live shortcodes (published),
 *   - creates the page "Live (Elementor)" as an Elementor document (_elementor_edit_mode=builder,
 *     a shortcode widget holding [wg_live view="player"], template elementor_header_footer),
 *   - creates a home page holding [wg_live_featured] and makes it the static front page,
 *   - binds the page IDs, the featured event and deployment_mode=demo in wg_live_settings.
 * Pages are only ever created or updated when this script created them (post meta _wg_live_seed);
 * a page of the same path that it did not create stops the run with an error.
 *
 * Without "setup": events are found by slug (post_name) and updated, otherwise created. Start times
 * are relative to the current time on every run. The optional argument "mode=demo" (or "--mode=demo",
 * or the environment variable WG_LIVE_SEED_MODE=demo) also sets wg_live_settings['deployment_mode'].
 *
 * It never touches users, orders, products or any page it did not create.
 *
 * SAFETY GUARD: it changes the theme, permalinks, the static front page and publishes test events, so it refuses to
 * run unless wp_get_environment_type() is "local" or "development", or the argument "force" is passed (wp-env's
 * tests site is "production" on purpose, so scripts/wp-env-setup.mjs passes "force" for it). Never pass "force" on a
 * staging copy or a production site.
 *
 * Compatible with PHP 7.4.
 */

defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'wg_live_seed_log' ) ) {

	/**
	 * @param string $message Line to print.
	 * @return void
	 */
	function wg_live_seed_log( $message ) {
		if ( class_exists( 'WP_CLI' ) ) {
			WP_CLI::log( $message );
		} else {
			echo $message . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
		}
	}

	/**
	 * Is "mode=demo" requested through the WP-CLI arguments or the environment?
	 *
	 * @param array $cli_args Positional arguments handed to eval-file.
	 * @return bool
	 */
	function wg_live_seed_wants_demo_mode( array $cli_args ) {
		foreach ( $cli_args as $arg ) {
			if ( is_string( $arg ) && in_array( $arg, array( '--mode=demo', 'mode=demo' ), true ) ) {
				return true;
			}
		}
		return getenv( 'WG_LIVE_SEED_MODE' ) === 'demo';
	}

	/**
	 * May the seed run here? Only on a local/development environment, or when "force" is given explicitly.
	 *
	 * @param array $cli_args Positional arguments handed to eval-file.
	 * @return bool
	 */
	function wg_live_seed_allowed( array $cli_args ) {
		foreach ( $cli_args as $arg ) {
			if ( is_string( $arg ) && in_array( $arg, array( 'force', '--force' ), true ) ) {
				return true;
			}
		}
		$type = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production';
		return in_array( $type, array( 'local', 'development' ), true );
	}

	/**
	 * UTC timestamp string in the stored format.
	 *
	 * @param int $timestamp Unix time.
	 * @return string Y-m-d\TH:i:s\Z
	 */
	function wg_live_seed_utc( $timestamp ) {
		return gmdate( 'Y-m-d\TH:i:s\Z', (int) $timestamp );
	}

	/**
	 * Find an event by slug in any status.
	 *
	 * @param string $slug Event slug (post_name).
	 * @return int Post ID or 0.
	 */
	function wg_live_seed_find( $slug ) {
		$ids = get_posts(
			array(
				'post_type'        => 'wg_live_event',
				'name'             => $slug,
				'post_status'      => 'any',
				'posts_per_page'   => 1,
				'fields'           => 'ids',
				'suppress_filters' => true,
				'no_found_rows'    => true,
			)
		);
		return empty( $ids ) ? 0 : (int) $ids[0];
	}

	/**
	 * Create or update one demo event.
	 *
	 * @param array $event Definition: slug, title, meta (keys without the _wg_live_ prefix).
	 * @return string "created" or "updated".
	 */
	function wg_live_seed_upsert( array $event ) {
		$post_id = wg_live_seed_find( $event['slug'] );
		$postarr = array(
			'post_type'   => 'wg_live_event',
			'post_status' => 'publish',
			'post_title'  => $event['title'],
			'post_name'   => $event['slug'],
		);

		if ( $post_id > 0 ) {
			$postarr['ID'] = $post_id;
			$result        = wp_update_post( $postarr, true );
			$action        = 'updated';
		} else {
			$result = wp_insert_post( $postarr, true );
			$action = 'created';
		}
		if ( is_wp_error( $result ) || (int) $result <= 0 ) {
			$message = is_wp_error( $result ) ? $result->get_error_message() : 'unknown error';
			throw new RuntimeException( 'Could not save event ' . $event['slug'] . ': ' . $message );
		}
		$post_id = (int) $result;

		foreach ( $event['meta'] as $key => $value ) {
			update_post_meta( $post_id, '_wg_live_' . $key, $value );
		}

		$stored = get_post( $post_id );
		if ( ! $stored || $stored->post_name !== $event['slug'] ) {
			throw new RuntimeException( 'Event ' . $event['slug'] . ' was saved with a different slug (' . ( $stored ? $stored->post_name : 'none' ) . ').' );
		}

		wg_live_seed_log(
			sprintf(
				'  %s #%d %s  status=%s  starts_at_utc=%s  post_status=%s',
				$action,
				$post_id,
				$event['slug'],
				$event['meta']['status'],
				$event['meta']['starts_at_utc'],
				$stored->post_status
			)
		);
		return $action;
	}

	/**
	 * The demo events, with start times relative to $now.
	 *
	 * @param int $now Unix time.
	 * @return array[]
	 */
	function wg_live_seed_events( $now ) {
		$note  = '這是介面示範用的活動資料。音訊為操作示範音訊，非 Binaural／Atmos 驗證素材。';
		$base  = array(
			'performers'       => array( 'WG Studio 示範表演者' ),
			'programme'        => array( '示範曲目一', '示範曲目二', '示範曲目三' ),
			'display_timezone' => 'Asia/Taipei',
			'media_kind'       => 'audio',
			'available_modes'  => array( 'binaural', 'atmos' ),
			'product_id'       => 0,
			'product_url'      => '',
			'is_demo'          => 1,
			'source_type'      => 'demo',
			'replay_available' => 0,
		);
		$start = (int) ( floor( $now / 60 ) * 60 );

		return array(
			array(
				'slug'  => 'demo-live',
				'title' => '【介面示範】直播中的線上音樂會',
				'meta'  => array_merge(
					$base,
					array(
						'description'   => $note . '此活動固定為直播中，用來檢視兩種收聽模式。',
						'starts_at_utc' => wg_live_seed_utc( $start - 10 * 60 ),
						'status'        => 'live',
					)
				),
			),
			array(
				'slug'  => 'demo-upcoming',
				'title' => '【介面示範】即將開始的線上音樂會',
				'meta'  => array_merge(
					$base,
					array(
						'description'   => $note . '此活動為三天後開始，用來檢視倒數與尚未開始的狀態。',
						'starts_at_utc' => wg_live_seed_utc( $start + 3 * 86400 ),
						'status'        => 'scheduled',
					)
				),
			),
			array(
				'slug'  => 'demo-ended',
				'title' => '【介面示範】已結束的線上音樂會',
				'meta'  => array_merge(
					$base,
					array(
						'description'   => $note . '此活動已結束，用來檢視結束後的狀態。',
						'starts_at_utc' => wg_live_seed_utc( $start - 2 * 86400 ),
						'status'        => 'ended',
					)
				),
			),
			array(
				'slug'  => 'pending-source',
				'title' => '【測試資料】播放來源尚未設定的活動',
				'meta'  => array_merge(
					$base,
					array(
						'description'   => '這是開發測試資料，不是實際活動。此活動不是示範活動，且尚未設定播放來源，用來檢視「播放來源尚未開放」。',
						'starts_at_utc' => wg_live_seed_utc( $start - 5 * 60 ),
						'status'        => 'live',
						'is_demo'       => 0,
						'source_type'   => 'not_configured',
					)
				),
			),
		);
	}

	/**
	 * Is the "setup" argument present?
	 *
	 * @param array $cli_args Positional arguments handed to eval-file.
	 * @return bool
	 */
	function wg_live_seed_wants_setup( array $cli_args ) {
		return in_array( 'setup', $cli_args, true );
	}

	/**
	 * Update wg_live_settings (merge) and bump wg_live_settings_meta when something changed.
	 *
	 * @param array $changes Settings keys to set.
	 * @return bool True when the stored settings changed.
	 */
	function wg_live_seed_update_settings( array $changes ) {
		$settings = get_option( 'wg_live_settings', array() );
		if ( ! is_array( $settings ) ) {
			$settings = array();
		}
		$merged = array_merge( $settings, $changes );
		if ( $merged == $settings ) { // phpcs:ignore Universal.Operators.StrictComparisons.LooseEqual -- order-insensitive array comparison is intended.
			return false;
		}
		update_option( 'wg_live_settings', $merged );

		$meta = get_option( 'wg_live_settings_meta', array() );
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		$meta['version']    = isset( $meta['version'] ) ? (int) $meta['version'] + 1 : 1;
		$meta['updated_at'] = gmdate( 'Y-m-d H:i:s' );
		$meta['updated_by'] = 0;
		update_option( 'wg_live_settings_meta', $meta );
		return true;
	}

	/**
	 * Activate Astra when it is installed and not active yet.
	 *
	 * @return void
	 */
	function wg_live_seed_theme() {
		$theme = wp_get_theme( 'astra' );
		if ( ! $theme->exists() ) {
			wg_live_seed_log( '  theme: Astra is not installed, left the active theme unchanged' );
			return;
		}
		if ( get_option( 'stylesheet' ) === 'astra' ) {
			wg_live_seed_log( '  theme: Astra already active' );
			return;
		}
		switch_theme( 'astra' );
		wg_live_seed_log( '  theme: activated Astra ' . $theme->get( 'Version' ) );
	}

	/**
	 * Make the dev site look like the real (dark) site: Astra's global colour palette and the settings that read it.
	 *
	 * Astra's default is a light theme, on which the plugin's inherited text colour is dark. The live site is dark
	 * (background #111111 under its photo, text #f0f5fa, links and brand #f0d62b), so the dev site gets the same values
	 * to review the real look. Dev only (setup mode inside the environment guard of wg_live_seed_run), idempotent
	 * (only the keys below are written, and only when they differ), and it never touches a site that is not on Astra.
	 * Palette slots follow Astra: 0 accent, 1 accent hover, 2 headings, 3 text, 4 page background, 5 content background,
	 * 6 border, 7 and 8 extras. See docs/design/site-mock.md for the matching harness page (dev/site-mock.css).
	 *
	 * @return void
	 */
	function wg_live_seed_astra_palette() {
		if ( get_option( 'stylesheet' ) !== 'astra' ) {
			wg_live_seed_log( '  astra palette: Astra is not the active theme, left unchanged' );
			return;
		}
		$palette = array( '#f0d62b', '#c2a903', '#f0f5fa', '#f0f5fa', '#111111', '#111111', '#2b2b2b', '#3a3a3a', '#000000' );
		$solid   = static function ( $slot ) {
			$bg = array(
				'background-color'      => 'var(--ast-global-color-' . $slot . ')',
				'background-image'      => '',
				'background-repeat'     => 'repeat',
				'background-position'   => 'center center',
				'background-size'       => 'auto',
				'background-attachment' => 'scroll',
				'background-type'       => 'color',
				'background-media'      => '',
				'overlay-type'          => '',
				'overlay-color'         => '',
				'overlay-opacity'       => '',
				'overlay-gradient'      => '',
			);
			return array(
				'desktop' => $bg,
				'tablet'  => $bg,
				'mobile'  => $bg,
			);
		};
		$wanted  = array(
			'text-color'                           => 'var(--ast-global-color-3)',
			'link-color'                           => 'var(--ast-global-color-0)',
			'link-h-color'                         => 'var(--ast-global-color-1)',
			'theme-color'                          => 'var(--ast-global-color-0)',
			'heading-base-color'                   => 'var(--ast-global-color-2)',
			'site-layout-outside-bg-obj-responsive' => $solid( 4 ),
			'content-bg-obj-responsive'            => $solid( 5 ),
		);
		$options = get_option( 'astra-settings', array() );
		if ( ! is_array( $options ) ) {
			$options = array();
		}
		$current = isset( $options['global-color-palette'] ) && is_array( $options['global-color-palette'] ) ? $options['global-color-palette'] : array();
		$before  = $options;

		$current['palette']                = $palette;
		$options['global-color-palette'] = $current;
		foreach ( $wanted as $key => $value ) {
			$options[ $key ] = $value;
		}
		if ( $options === $before ) {
			wg_live_seed_log( '  astra palette: already dark (#111111 background, #f0f5fa text, #f0d62b links)' );
			return;
		}
		update_option( 'astra-settings', $options );
		wg_live_seed_log( '  astra palette: set to the live site look (#111111 background, #f0f5fa text, #f0d62b links)' );
	}

	/**
	 * Pretty permalinks (/%postname%/); flush the rewrite rules only when the structure changes.
	 *
	 * @return void
	 */
	function wg_live_seed_permalinks() {
		global $wp_rewrite;
		$structure = '/%postname%/';
		if ( get_option( 'permalink_structure' ) === $structure ) {
			wg_live_seed_log( '  permalinks: already ' . $structure . ' (no flush)' );
			return;
		}
		// Let WordPress write .htaccess even though the CLI has no Apache modules (what "wp rewrite flush --hard" does).
		add_filter( 'got_url_rewrite', '__return_true' );
		add_filter( 'got_rewrite', '__return_true' );
		if ( ! function_exists( 'save_mod_rewrite_rules' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/misc.php';
		}
		$wp_rewrite->set_permalink_structure( $structure );
		flush_rewrite_rules( true );
		wg_live_seed_log( '  permalinks: set ' . $structure . ' and flushed once' );
	}

	/**
	 * Find a page seeded by this script (or report a foreign page in the way).
	 *
	 * @param string $slug   Page slug (post_name).
	 * @param int    $parent Parent page ID.
	 * @return int Page ID or 0.
	 * @throws RuntimeException When a page with this path exists but was not created by this script.
	 */
	function wg_live_seed_find_page( $slug, $parent ) {
		$ids = get_posts(
			array(
				'post_type'        => 'page',
				'name'             => $slug,
				'post_parent'      => $parent,
				'post_status'      => 'any',
				'posts_per_page'   => 1,
				'fields'           => 'ids',
				'suppress_filters' => true,
				'no_found_rows'    => true,
			)
		);
		if ( empty( $ids ) ) {
			return 0;
		}
		$id = (int) $ids[0];
		if ( get_post_meta( $id, '_wg_live_seed', true ) !== 'setup' ) {
			throw new RuntimeException( 'A page with the slug "' . $slug . '" (ID ' . $id . ') already exists and was not created by this script. Rename or remove it, then run setup again.' );
		}
		return $id;
	}

	/**
	 * Create or update one seeded page.
	 *
	 * @param string $slug    Page slug.
	 * @param string $title   Page title.
	 * @param int    $parent  Parent page ID.
	 * @param string $content Post content ('' for Elementor documents).
	 * @return int Page ID.
	 * @throws RuntimeException When the page cannot be saved.
	 */
	function wg_live_seed_page( $slug, $title, $parent, $content ) {
		$id      = wg_live_seed_find_page( $slug, $parent );
		$postarr = array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => $title,
			'post_name'    => $slug,
			'post_parent'  => $parent,
			'post_content' => $content,
		);
		if ( $id > 0 ) {
			$postarr['ID'] = $id;
			$result        = wp_update_post( $postarr, true );
			$action        = 'updated';
		} else {
			$result = wp_insert_post( $postarr, true );
			$action = 'created';
		}
		if ( is_wp_error( $result ) || (int) $result <= 0 ) {
			$message = is_wp_error( $result ) ? $result->get_error_message() : 'unknown error';
			throw new RuntimeException( 'Could not save page ' . $slug . ': ' . $message );
		}
		$id = (int) $result;
		update_post_meta( $id, '_wg_live_seed', 'setup' );
		wg_live_seed_log( sprintf( '  page %s #%d %s  %s', $action, $id, get_page_uri( $id ), get_post_status( $id ) ) );
		return $id;
	}

	/**
	 * Turn a seeded page into an Elementor document holding one Shortcode widget.
	 *
	 * @param int    $page_id   Page ID.
	 * @param string $shortcode Shortcode text.
	 * @return void
	 */
	function wg_live_seed_elementor_document( $page_id, $shortcode ) {
		$data = array(
			array(
				'id'       => 'wglc0001',
				'elType'   => 'container',
				'settings' => array(),
				'elements' => array(
					array(
						'id'         => 'wgls0001',
						'elType'     => 'widget',
						'widgetType' => 'shortcode',
						'settings'   => array( 'shortcode' => $shortcode ),
						'elements'   => array(),
					),
				),
				'isInner'  => false,
			),
		);
		update_post_meta( $page_id, '_elementor_edit_mode', 'builder' );
		update_post_meta( $page_id, '_elementor_template_type', 'wp-page' );
		update_post_meta( $page_id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '3.0.0' );
		update_post_meta( $page_id, '_wp_page_template', 'elementor_header_footer' );
		// Elementor stores the JSON string slashed, like the editor does.
		update_post_meta( $page_id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
		wg_live_seed_log( '  page #' . $page_id . ' is an Elementor document (elementor_header_footer, shortcode widget)' );
	}

	/**
	 * Pages, front page and settings bindings (the non-event part of "setup").
	 *
	 * @return void
	 */
	function wg_live_seed_site() {
		$live   = wg_live_seed_page( 'live', 'Live', 0, '[wg_live view="events"]' );
		$listen = wg_live_seed_page( 'listen', 'Listen', $live, '[wg_live view="player"]' );
		$help   = wg_live_seed_page( 'help', 'Listening Guide', $live, '[wg_live view="help"]' );

		$elementor = wg_live_seed_page( 'live-elementor', 'Live (Elementor)', 0, '' );
		wg_live_seed_elementor_document( $elementor, '[wg_live view="player"]' );

		$home = wg_live_seed_page( 'wg-live-home', 'WG Live Home', 0, '[wg_live_featured]' );
		if ( get_option( 'show_on_front' ) !== 'page' ) {
			update_option( 'show_on_front', 'page' );
		}
		if ( (int) get_option( 'page_on_front' ) !== $home ) {
			update_option( 'page_on_front', $home );
		}
		wg_live_seed_log( '  front page: static page #' . $home . ' ([wg_live_featured])' );

		// Dev site only: WooCommerce shows a "coming soon" placeholder on fresh installs,
		// which hides the shop/cart/checkout pages the regression specs compare.
		if ( get_option( 'woocommerce_coming_soon' ) === 'yes' ) {
			update_option( 'woocommerce_coming_soon', 'no' );
			wg_live_seed_log( '  woocommerce_coming_soon: no' );
		}

		// Dev site only: wp-env names the site after the checkout folder (e.g. "wg-live" for the WSL mirror),
		// which leaks the plugin slug into every page title. Use a neutral, stable name instead.
		if ( get_option( 'blogname' ) !== 'WG Studio Dev' ) {
			update_option( 'blogname', 'WG Studio Dev' );
			wg_live_seed_log( '  blogname: WG Studio Dev' );
		}

		$featured = wg_live_seed_find( 'demo-live' );
		$changed  = wg_live_seed_update_settings(
			array(
				'page_events'     => $live,
				'page_player'     => $listen,
				'page_help'       => $help,
				'featured_event'  => $featured,
				'deployment_mode' => 'demo',
			)
		);
		wg_live_seed_log( '  settings: pages ' . $live . '/' . $listen . '/' . $help . ', featured event #' . $featured . ', deployment_mode demo' . ( $changed ? '' : ' (unchanged)' ) );
	}

	/**
	 * Run the seeder.
	 *
	 * @param array $cli_args Positional arguments handed to eval-file.
	 * @return int Exit code.
	 */
	function wg_live_seed_run( array $cli_args ) {
		if ( ! wg_live_seed_allowed( $cli_args ) ) {
			$type    = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production';
			$message = 'seed-demo.php refused: the environment type is "' . $type . '" (only "local" and "development" are allowed). It changes the theme, permalinks and front page and publishes test events. Pass the argument "force" only for a throw-away site.';
			if ( class_exists( 'WP_CLI' ) ) {
				WP_CLI::error( $message );
			}
			echo $message . "
"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
			return 1;
		}

		if ( ! post_type_exists( 'wg_live_event' ) ) {
			$message = 'The post type wg_live_event is not registered. Activate the wg-live plugin first.';
			if ( class_exists( 'WP_CLI' ) ) {
				WP_CLI::error( $message );
			}
			echo $message . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
			return 1;
		}

		$now = time();
		wg_live_seed_log( 'wg-live demo seed at ' . wg_live_seed_utc( $now ) . ' (UTC)' );

		if ( wg_live_seed_wants_setup( $cli_args ) ) {
			wg_live_seed_theme();
			wg_live_seed_astra_palette();
			wg_live_seed_permalinks();
		}

		$counts = array(
			'created' => 0,
			'updated' => 0,
		);
		foreach ( wg_live_seed_events( $now ) as $event ) {
			$counts[ wg_live_seed_upsert( $event ) ]++;
		}

		if ( wg_live_seed_wants_setup( $cli_args ) ) {
			wg_live_seed_site();
		} elseif ( wg_live_seed_wants_demo_mode( $cli_args ) ) {
			$settings = get_option( 'wg_live_settings', array() );
			if ( ! is_array( $settings ) ) {
				$settings = array();
			}
			$before = isset( $settings['deployment_mode'] ) ? (string) $settings['deployment_mode'] : '(unset)';
			wg_live_seed_update_settings( array( 'deployment_mode' => 'demo' ) );
			wg_live_seed_log( '  settings: deployment_mode ' . $before . ' -> demo' );
		} else {
			wg_live_seed_log( '  settings: deployment_mode left unchanged (pass mode=demo to set it)' );
		}

		wg_live_seed_log( sprintf( 'Done: %d created, %d updated.', $counts['created'], $counts['updated'] ) );
		return 0;
	}
}

try {
	wg_live_seed_run( isset( $args ) && is_array( $args ) ? $args : array() );
} catch ( Exception $e ) {
	if ( class_exists( 'WP_CLI' ) ) {
		WP_CLI::error( $e->getMessage() );
	}
	echo $e->getMessage() . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
}
