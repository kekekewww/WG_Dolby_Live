<?php
/**
 * Front-end assets (plan 4.1, spec 8.4).
 *
 * Handles: "wg-live" (script + style) and "wg-live-featured" (style only). Versions are the
 * SHA-256 prefixes recorded in assets/dist/build-info.json. The app loads on the bound Live pages
 * (by page ID, never by has_shortcode alone, because Elementor content is not in post_content), in
 * the Elementor preview, and as a late fallback when a shortcode renders elsewhere. The featured
 * CSS loads on the front page and on pages that contain [wg_live_featured].
 *
 * A missing build never causes a fatal error: nothing is enqueued, an admin notice appears and the
 * shortcode prints a readable message.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Asset registration and enqueueing.
 */
final class Assets {

	/**
	 * Style/script handle of the app.
	 *
	 * @var string
	 */
	const HANDLE_APP = 'wg-live';

	/**
	 * Style handle of the featured card.
	 *
	 * @var string
	 */
	const HANDLE_FEATURED = 'wg-live-featured';

	/**
	 * The fixed set of built files (plan D3).
	 *
	 * @var string[]
	 */
	const DIST_FILES = array( 'wg-live.js', 'wg-live.css', 'wg-live-featured.css', 'wg-live-hls.js' );

	/**
	 * Admin override key => CSS custom property (plan 3.3).
	 *
	 * @var array<string,string>
	 */
	const OVERRIDE_PROPERTIES = array(
		'accent'         => '--wg-accent',
		'on_accent'      => '--wg-on-accent',
		'player_surface' => '--wg-player-surface',
		'player_text'    => '--wg-player-text',
	);

	/**
	 * Parsed build-info.json (null = not read yet).
	 *
	 * @var array|null
	 */
	private static $build_info = null;

	/**
	 * Handles that already received the override CSS.
	 *
	 * @var array<string,bool>
	 */
	private static $overrides_attached = array();

	/**
	 * Hook the enqueue points.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_for_request' ) );
		// Elementor loads the preview iframe through its own hooks; the shortcode widget re-renders there.
		add_action( 'elementor/preview/enqueue_scripts', array( __CLASS__, 'enqueue_for_elementor_preview' ) );
		add_action( 'elementor/preview/enqueue_styles', array( __CLASS__, 'enqueue_for_elementor_preview' ) );
	}

	/* ------------------------------------------------------------------ */
	/* Build info                                                          */
	/* ------------------------------------------------------------------ */

	/**
	 * Does a built file exist?
	 *
	 * @param string $file File name inside assets/dist.
	 * @return bool
	 */
	private static function has_file( $file ) {
		return is_readable( WG_LIVE_DIR . 'assets/dist/' . $file );
	}

	/**
	 * Are the app files (script and style) present?
	 *
	 * @return bool
	 */
	public static function has_app_build() {
		return self::has_file( 'wg-live.js' ) && self::has_file( 'wg-live.css' );
	}

	/**
	 * Are all built files present?
	 *
	 * @return bool
	 */
	public static function is_build_present() {
		return empty( self::missing_files() );
	}

	/**
	 * Names of built files that are missing.
	 *
	 * @return string[]
	 */
	public static function missing_files() {
		$missing = array();
		foreach ( self::DIST_FILES as $file ) {
			if ( ! self::has_file( $file ) ) {
				$missing[] = $file;
			}
		}
		return $missing;
	}

	/**
	 * Contents of build-info.json (empty array when missing or invalid).
	 *
	 * @return array
	 */
	public static function build_info() {
		if ( null !== self::$build_info ) {
			return self::$build_info;
		}
		self::$build_info = array();
		$path             = WG_LIVE_DIR . 'assets/dist/build-info.json';
		if ( is_readable( $path ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file inside the plugin.
			$decoded = json_decode( (string) file_get_contents( $path ), true );
			if ( is_array( $decoded ) ) {
				self::$build_info = $decoded;
			}
		}
		return self::$build_info;
	}

	/**
	 * Cache-busting version for a built file: the first 12 hex characters of its recorded SHA-256,
	 * else the plugin version.
	 *
	 * @param string $file File name inside assets/dist.
	 * @return string
	 */
	public static function version_for( $file ) {
		$info = self::build_info();
		if ( isset( $info['files'][ $file ]['sha256'] ) && is_string( $info['files'][ $file ]['sha256'] )
			&& 1 === preg_match( '/^[0-9a-f]{64}$/D', $info['files'][ $file ]['sha256'] ) ) {
			return substr( $info['files'][ $file ]['sha256'], 0, 12 );
		}
		return WG_LIVE_VERSION;
	}

	/**
	 * Versioned URL of a built file that the app loads itself (M2-PLAN C1: wg-live-hls.js), or null when the
	 * build lacks it. Not enqueued: the player injects it only when it plays an hls source.
	 *
	 * @param string $file File name inside assets/dist.
	 * @return string|null
	 */
	public static function script_url( $file ) {
		if ( ! in_array( $file, self::DIST_FILES, true ) || ! self::has_file( $file ) ) {
			return null;
		}
		return add_query_arg( 'ver', self::version_for( $file ), WG_LIVE_URL . 'assets/dist/' . $file );
	}

	/**
	 * Register the handles that have a built file. Idempotent (WordPress ignores a second registration).
	 *
	 * @return void
	 */
	public static function register() {
		if ( self::has_file( 'wg-live.css' ) ) {
			wp_register_style( self::HANDLE_APP, WG_LIVE_URL . 'assets/dist/wg-live.css', array(), self::version_for( 'wg-live.css' ) );
		}
		if ( self::has_file( 'wg-live.js' ) ) {
			wp_register_script(
				self::HANDLE_APP,
				WG_LIVE_URL . 'assets/dist/wg-live.js',
				array(),
				self::version_for( 'wg-live.js' ),
				array(
					'strategy'  => 'defer',
					'in_footer' => true,
				)
			);
		}
		if ( self::has_file( 'wg-live-featured.css' ) ) {
			wp_register_style( self::HANDLE_FEATURED, WG_LIVE_URL . 'assets/dist/wg-live-featured.css', array(), self::version_for( 'wg-live-featured.css' ) );
		}
	}

	/* ------------------------------------------------------------------ */
	/* Enqueue                                                             */
	/* ------------------------------------------------------------------ */

	/**
	 * Enqueue the app script and style. Safe to call late (from a shortcode): WordPress prints
	 * styles and scripts enqueued after wp_head in the footer.
	 *
	 * @return bool False when the build is missing.
	 */
	public static function enqueue_app() {
		if ( ! self::has_app_build() ) {
			return false;
		}
		self::register();
		wp_enqueue_style( self::HANDLE_APP );
		wp_enqueue_script( self::HANDLE_APP );
		self::attach_overrides( self::HANDLE_APP );
		return true;
	}

	/**
	 * Enqueue the featured-card style.
	 *
	 * @return bool False when the built file is missing.
	 */
	public static function enqueue_featured() {
		if ( ! self::has_file( 'wg-live-featured.css' ) ) {
			return false;
		}
		self::register();
		wp_enqueue_style( self::HANDLE_FEATURED );
		self::attach_overrides( self::HANDLE_FEATURED );
		return true;
	}

	/**
	 * Add the admin style overrides as inline CSS after a style handle (plan 3.3). Every value goes
	 * through sanitize_hex_color() again here. Runs once per handle.
	 *
	 * @param string $handle Style handle.
	 * @return void
	 */
	public static function attach_overrides( $handle ) {
		if ( isset( self::$overrides_attached[ $handle ] ) || ! wp_style_is( $handle, 'registered' ) ) {
			return;
		}
		self::$overrides_attached[ $handle ] = true;

		$settings  = Settings::get();
		$overrides = isset( $settings['style_overrides'] ) && is_array( $settings['style_overrides'] ) ? $settings['style_overrides'] : array();
		$css       = '';
		foreach ( self::OVERRIDE_PROPERTIES as $key => $property ) {
			if ( empty( $overrides[ $key ] ) || ! is_string( $overrides[ $key ] ) ) {
				continue;
			}
			$hex = sanitize_hex_color( $overrides[ $key ] );
			if ( is_string( $hex ) && '' !== $hex ) {
				$css .= $property . ':' . $hex . ';';
			}
		}
		if ( '' !== $css ) {
			wp_add_inline_style( $handle, '.wg-live,.wg-live-featured{' . $css . '}' );
		}
	}

	/* ------------------------------------------------------------------ */
	/* Hooks                                                               */
	/* ------------------------------------------------------------------ */

	/**
	 * IDs of the bound Live pages.
	 *
	 * @return int[]
	 */
	public static function bound_page_ids() {
		$settings = Settings::get();
		$ids      = array();
		foreach ( array( 'page_events', 'page_player', 'page_help' ) as $key ) {
			$id = isset( $settings[ $key ] ) ? (int) $settings[ $key ] : 0;
			if ( $id > 0 ) {
				$ids[] = $id;
			}
		}
		return array_values( array_unique( $ids ) );
	}

	/**
	 * Does this request show the homepage card?
	 *
	 * @return bool
	 */
	private static function request_needs_featured() {
		if ( is_front_page() ) {
			return true;
		}
		if ( is_singular() ) {
			$post = get_queried_object();
			return $post instanceof \WP_Post && has_shortcode( $post->post_content, 'wg_live_featured' );
		}
		return false;
	}

	/**
	 * wp_enqueue_scripts: bound pages get the app, the front page and pages with the card get the card style.
	 *
	 * @return void
	 */
	public static function enqueue_for_request() {
		$ids = self::bound_page_ids();
		if ( ! empty( $ids ) && is_page( $ids ) ) {
			self::enqueue_app();
		}
		if ( self::request_needs_featured() ) {
			self::enqueue_featured();
		}
	}

	/**
	 * Elementor preview iframe: load everything the shortcode widgets may render.
	 *
	 * @return void
	 */
	public static function enqueue_for_elementor_preview() {
		self::enqueue_app();
		self::enqueue_featured();
	}
}
