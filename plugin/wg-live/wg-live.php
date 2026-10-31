<?php
/**
 * Plugin Name:       WG Studio Live
 * Description:       Live / 線上音樂會: event pages and a Binaural / Dolby Atmos listening-mode player interface. M1 ships the interface and a demo player with test video and audio only; it does not check tickets or protect streams.
 * Version:           0.2.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            WG Studio
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wg-live
 *
 * @package WG_Live
 */

defined( 'ABSPATH' ) || exit;

// Keep in sync with package.json, readme.txt (Stable tag) and assets/dist/build-info.json (check:artifact).
define( 'WG_LIVE_VERSION', '0.2.0' );
define( 'WG_LIVE_FILE', __FILE__ );
define( 'WG_LIVE_DIR', plugin_dir_path( __FILE__ ) );
define( 'WG_LIVE_URL', plugin_dir_url( __FILE__ ) );

if ( version_compare( PHP_VERSION, '7.4', '<' ) ) {
	add_action(
		'admin_notices',
		static function () {
			if ( current_user_can( 'activate_plugins' ) ) {
				echo '<div class="notice notice-error"><p>' . esc_html( 'WG Studio Live 需要 PHP 7.4 或更新版本，外掛尚未啟動。' ) . '</p></div>';
			}
		}
	);
	return;
}

require_once WG_LIVE_DIR . 'includes/class-events.php';
require_once WG_LIVE_DIR . 'includes/class-settings.php';
require_once WG_LIVE_DIR . 'includes/class-plugin.php';
require_once WG_LIVE_DIR . 'includes/class-tickets.php';
require_once WG_LIVE_DIR . 'includes/class-entitlement.php';
require_once WG_LIVE_DIR . 'includes/class-stream-signer.php';
require_once WG_LIVE_DIR . 'includes/class-site-links.php';
require_once WG_LIVE_DIR . 'includes/class-public-data.php';
require_once WG_LIVE_DIR . 'includes/class-playback-provider.php';
require_once WG_LIVE_DIR . 'includes/class-shortcodes.php';
require_once WG_LIVE_DIR . 'includes/class-assets.php';

register_activation_hook( __FILE__, array( 'WG_Live\Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'WG_Live\Plugin', 'deactivate' ) );
add_action( 'plugins_loaded', array( 'WG_Live\Plugin', 'boot' ) );
