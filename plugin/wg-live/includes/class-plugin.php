<?php
/**
 * Plugin bootstrap: wiring, the capability (D13) and the dev-tools gate (D17).
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Wires the plugin together.
 */
final class Plugin {

	/**
	 * Singleton.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Has init() run?
	 *
	 * @var bool
	 */
	private $booted = false;

	/**
	 * Constructor is private: use instance().
	 */
	private function __construct() {}

	/**
	 * The one instance.
	 *
	 * @return Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hook target for plugins_loaded.
	 *
	 * @return void
	 */
	public static function boot() {
		self::instance()->init();
	}

	/**
	 * Register every component. Idempotent.
	 *
	 * The admin classes (Events, Settings) own their hooks; they expose a static init().
	 *
	 * @return void
	 */
	public function init() {
		if ( $this->booted ) {
			return;
		}
		$this->booted = true;

		foreach ( array( 'WG_Live\Events', 'WG_Live\Settings' ) as $class ) {
			if ( class_exists( $class ) && is_callable( array( $class, 'init' ) ) ) {
				call_user_func( array( $class, 'init' ) );
			}
		}

		Public_Data::init();
		Shortcodes::init();
		Assets::init();

		add_action( 'admin_notices', array( $this, 'build_missing_notice' ) );
	}

	/**
	 * The capability that guards the settings, deploy-info and create-pages screens (plan D13).
	 *
	 * @return string
	 */
	public static function cap() {
		$cap = apply_filters( 'wg_live_manage_capability', 'manage_options' );
		return ( is_string( $cap ) && '' !== $cap ) ? $cap : 'manage_options';
	}

	/**
	 * The capability that lets a user create, edit, publish and delete Live events (plan D13, 0.2.0).
	 *
	 * Defaults to publish_pages, so Editors and WooCommerce Shop Managers can run the event calendar
	 * while the settings stay with cap(). Activation still writes no roles.
	 *
	 * @return string
	 */
	public static function events_cap() {
		$cap = apply_filters( 'wg_live_events_capability', 'publish_pages' );
		return ( is_string( $cap ) && '' !== $cap ) ? $cap : 'publish_pages';
	}

	/**
	 * May the dev/demo state panel be offered on this request? (plan D17)
	 *
	 * local / development: yes. staging: only a logged-in user with cap(). production, or
	 * anything else: never, not even in an admin preview. WG_LIVE_DEV_TOOLS === false forces off.
	 * There is deliberately no query parameter, cookie or option that can turn this on.
	 *
	 * @return bool
	 */
	public static function dev_tools_enabled() {
		if ( defined( 'WG_LIVE_DEV_TOOLS' ) && false === WG_LIVE_DEV_TOOLS ) {
			return false;
		}
		$env = wp_get_environment_type();
		if ( 'local' === $env || 'development' === $env ) {
			return true;
		}
		if ( 'staging' === $env ) {
			return is_user_logged_in() && current_user_can( self::cap() );
		}
		return false;
	}

	/**
	 * Activation: seed the default options only (deployment mode "disabled", plan 4.1).
	 * No pages, menus, roles, theme changes or rewrite flushes.
	 *
	 * @return void
	 */
	public static function activate() {
		// add_option() is a no-op when the option already exists, so a re-activation keeps the settings.
		add_option( Settings::OPTION, Settings::defaults() );
		add_option(
			Settings::META_OPTION,
			array(
				'version'    => 1,
				'updated_at' => gmdate( 'Y-m-d H:i:s' ),
				'updated_by' => (int) get_current_user_id(),
			)
		);
	}

	/**
	 * Deactivation: nothing destructive. Settings, events and pages stay.
	 *
	 * @return void
	 */
	public static function deactivate() {
	}

	/**
	 * Admin notice when the built front-end files are missing (the plugin keeps working, the viewer sees a message).
	 *
	 * @return void
	 */
	public function build_missing_notice() {
		if ( ! current_user_can( self::cap() ) ) {
			return;
		}
		$missing = Assets::missing_files();
		if ( empty( $missing ) ) {
			return;
		}
		printf(
			'<div class="notice notice-error"><p>%s</p></div>',
			esc_html(
				'WG Studio Live：找不到前端建置檔案（' . implode( '、', $missing ) . '）。Live 頁面暫時無法顯示介面。請重新安裝外掛 ZIP，或在開發環境執行 npm run build。'
			)
		);
	}
}
