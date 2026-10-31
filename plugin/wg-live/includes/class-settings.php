<?php
/**
 * Settings page, deployment info screen and the "create suggested pages" flow (M1-PLAN 4.1, 4.3, 4.5, 4.6).
 *
 * @package WG_Live
 */

namespace WG_Live;

use DateTimeImmutable;
use DateTimeZone;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Plugin settings (option "wg_live_settings") and the admin screens around them.
 */
final class Settings {

	const OPTION      = 'wg_live_settings';
	const META_OPTION = 'wg_live_settings_meta';

	const GROUP         = 'wg_live_settings_group';
	const PAGE_SETTINGS = 'wg-live-settings';
	const PAGE_DEPLOY   = 'wg-live-deploy';
	const PAGE_PAGES    = 'wg-live-pages';

	/** Attachment meta set by the settings picker: this audio file may be played as demo audio. */
	const APPROVED_META = '_wg_live_demo_approved';

	const CREATE_PAGES_ACTION = 'wg_live_create_pages';

	const MAX_FAQ_ROWS    = 30;
	const MAX_COMPAT_ROWS = 30;

	/**
	 * Normalized settings, cached per request.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Hook suffixes of our admin pages.
	 *
	 * @var string[]
	 */
	private static $hooks = array();

	/**
	 * Output of the last sanitize() call (WordPress can sanitize twice for a new option).
	 *
	 * @var array|null
	 */
	private static $last_output = null;

	/**
	 * True while set_featured_event() writes the option, so sanitize() lets that one write through.
	 *
	 * @var bool
	 */
	private static $internal_write = false;

	/**
	 * Hook everything. Called once by Plugin::instance().
	 *
	 * @return void
	 */
	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ), 20 );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_post_' . self::CREATE_PAGES_ACTION, array( __CLASS__, 'handle_create_pages' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin_assets' ) );
		add_filter( 'option_page_capability_' . self::GROUP, array( __CLASS__, 'option_page_capability' ) );
		add_action( 'added_option', array( __CLASS__, 'flush_cache_for' ) );
		add_action( 'updated_option', array( __CLASS__, 'flush_cache_for' ) );
		add_action( 'deleted_option', array( __CLASS__, 'flush_cache_for' ) );
	}

	/* ------------------------------------------------------------------ */
	/* Public API                                                           */
	/* ------------------------------------------------------------------ */

	/**
	 * Default settings (also used by Plugin::activate() to seed the option).
	 *
	 * @return array
	 */
	public static function defaults(): array {
		return array(
			'page_events'              => 0,
			'page_player'              => 0,
			'page_help'                => 0,
			'featured_event'           => 0,
			'account_url'              => '',
			'store_url'                => '',
			'contact_url'              => '',
			'deployment_mode'          => 'disabled',
			'faq'                      => array(),
			'support_note'             => '',
			'compatibility'            => self::default_compatibility(),
			'demo_audio_binaural'      => 0,
			'demo_audio_atmos'         => 0,
			'style_overrides'          => self::empty_style(),
			'stream_hosts'             => array(),
			'player_origins'           => array(),
			'delete_data_on_uninstall' => false,
		);
	}

	/**
	 * The normalized settings. Every key is present and validated; never throws on bad stored data.
	 *
	 * @return array
	 */
	public static function get(): array {
		if ( null === self::$cache ) {
			$stored      = get_option( self::OPTION, array() );
			self::$cache = self::normalize( is_array( $stored ) ? $stored : array() );
		}
		return self::$cache;
	}

	/**
	 * Forget the cached settings when the option changes.
	 *
	 * @param string $option Option name.
	 * @return void
	 */
	public static function flush_cache_for( $option ): void {
		if ( self::OPTION === $option ) {
			self::$cache = null;
		}
	}

	/**
	 * The capability that guards the option page (D13).
	 *
	 * @return string
	 */
	public static function option_page_capability(): string {
		return Plugin::cap();
	}

	/**
	 * Admin-approved stream hosts (M2-PLAN B1). Event playlist URLs must be on one of these.
	 *
	 * @return string[] Lowercase hostnames.
	 */
	public static function stream_hosts(): array {
		return self::get()['stream_hosts'];
	}

	/**
	 * Admin-approved provider player origins (M2-PLAN D1). Event iframe player URLs must be on one of these.
	 *
	 * @return string[] Normalised https origins, e.g. https://player.example.com or https://player.example.com:8443.
	 */
	public static function player_origins(): array {
		return self::get()['player_origins'];
	}

	/**
	 * Valid, unique https origins (scheme, host and a non-default port; no path, query or credentials); at most 20.
	 *
	 * @param mixed $raw Array of candidates.
	 * @return string[]
	 */
	public static function clean_origins( $raw ): array {
		$out = array();
		foreach ( is_array( $raw ) ? $raw : array() as $candidate ) {
			$origin = is_string( $candidate ) ? self::origin_of( trim( $candidate ) ) : '';
			if ( '' !== $origin && 0 === strpos( $origin, 'https://' ) && ! in_array( $origin, $out, true ) ) {
				$out[] = $origin;
			}
		}
		return array_slice( $out, 0, 20 );
	}

	/**
	 * The origin of a URL ('' when it is not a plain http(s) origin or URL): lowercase scheme and host, the port only
	 * when it is not the scheme's default. With $origin_only, anything after the host (a path other than "/", a
	 * query, a fragment) makes it invalid.
	 *
	 * @param string $url         Candidate.
	 * @param bool   $origin_only Refuse anything but an origin.
	 * @return string
	 */
	public static function origin_of( string $url, bool $origin_only = true ): string {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return '';
		}
		$scheme = strtolower( $parts['scheme'] );
		$host   = strtolower( $parts['host'] );
		if ( ! in_array( $scheme, array( 'https', 'http' ), true ) || array() === self::clean_hosts( array( $host ) ) ) {
			return '';
		}
		if ( $origin_only && ( ( isset( $parts['path'] ) && '' !== $parts['path'] && '/' !== $parts['path'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) ) ) {
			return '';
		}
		$port    = isset( $parts['port'] ) ? (int) $parts['port'] : 0;
		$default = 'https' === $scheme ? 443 : 80;
		return $scheme . '://' . $host . ( $port > 0 && $port !== $default ? ':' . $port : '' );
	}

	/**
	 * Valid, unique, lowercase hostnames (no scheme, path or port); at most 20.
	 *
	 * @param mixed $raw Array of candidates.
	 * @return string[]
	 */
	public static function clean_hosts( $raw ): array {
		$out = array();
		foreach ( is_array( $raw ) ? $raw : array() as $host ) {
			$host = is_string( $host ) ? strtolower( trim( $host ) ) : '';
			if ( 1 === preg_match( '/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/', $host ) && ! in_array( $host, $out, true ) ) {
				$out[] = $host;
			}
		}
		return array_slice( $out, 0, 20 );
	}

	/**
	 * Set (or clear with 0) the homepage featured event from the event screen (0.2.0).
	 *
	 * Event managers (Plugin::events_cap()) may change this one key without the settings capability:
	 * only featured_event is written, everything else in the stored option stays as it is.
	 *
	 * @param int $id Event ID, or 0 to clear.
	 * @return bool True when the stored value changed.
	 */
	public static function set_featured_event( int $id ): bool {
		if ( ! current_user_can( Plugin::events_cap() ) ) {
			return false;
		}
		if ( $id > 0 && ( self::valid_event_id( $id ) !== $id || ! current_user_can( 'edit_post', $id ) ) ) {
			return false;
		}
		$id = max( 0, $id );
		if ( (int) self::get()['featured_event'] === $id ) {
			return false;
		}

		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = self::get();
		}
		$stored['featured_event'] = $id;

		self::$internal_write = true;
		update_option( self::OPTION, $stored );
		self::$internal_write = false;
		self::bump_meta();
		return true;
	}

	/**
	 * Default compatibility rows: every row is "pending" (spec 5.5), so nothing is claimed as supported.
	 *
	 * @return array[]
	 */
	public static function default_compatibility(): array {
		$rows = array(
			// Decision 2026-11-01: one Dolby Atmos stream; every row stays pending until tested on real devices.
			array( 'iPhone／iPad', 'iOS／iPadOS', 'Safari', '耳機（例如 AirPods）' ),
			array( 'Mac', 'macOS', 'Safari', '家庭劇院（HDMI 輸出）' ),
			array( 'Apple TV 4K', 'tvOS', '尚待確認', '家庭劇院（HDMI 輸出）' ),
			array( 'Windows 電腦', 'Windows', 'VLC（個人播放連結）', '喇叭、耳機或家庭劇院' ),
		);
		$out  = array();
		foreach ( $rows as $row ) {
			$out[] = array(
				'device'       => $row[0],
				'os'           => $row[1],
				'browser'      => $row[2],
				'outputPath'   => $row[3],
				'sourceFormat' => '',
				'status'       => 'pending',
				'testedAt'     => null,
				'notes'        => '',
			);
		}
		return $out;
	}

	/* ------------------------------------------------------------------ */
	/* Validation (pure; shared by get() and sanitize())                    */
	/* ------------------------------------------------------------------ */

	/**
	 * @return array<string,string>
	 */
	private static function empty_style(): array {
		return array(
			'accent'         => '',
			'on_accent'      => '',
			'player_surface' => '',
			'player_text'    => '',
		);
	}

	/**
	 * Apply defaults and validation to stored data.
	 *
	 * @param array $stored Raw option value.
	 * @return array
	 */
	private static function normalize( array $stored ): array {
		$d   = self::defaults();
		$out = $d;

		foreach ( array( 'page_events', 'page_player', 'page_help' ) as $key ) {
			$out[ $key ] = isset( $stored[ $key ] ) ? self::valid_page_id( $stored[ $key ] ) : 0;
		}
		$out['featured_event'] = isset( $stored['featured_event'] ) ? self::valid_event_id( $stored['featured_event'] ) : 0;

		foreach ( array( 'account_url', 'store_url' ) as $key ) {
			$value       = isset( $stored[ $key ] ) ? self::clean_url( $stored[ $key ], false ) : '';
			$out[ $key ] = null === $value ? '' : $value;
		}
		$contact            = isset( $stored['contact_url'] ) ? self::clean_url( $stored['contact_url'], true ) : '';
		$out['contact_url'] = null === $contact ? '' : $contact;

		$out['deployment_mode'] = isset( $stored['deployment_mode'] ) && in_array( $stored['deployment_mode'], array( 'demo', 'live' ), true ) ? $stored['deployment_mode'] : 'disabled';

		$problems          = array();
		$out['faq']        = isset( $stored['faq'] ) ? self::clean_faq( $stored['faq'], $problems ) : array();
		$out['support_note'] = isset( $stored['support_note'] ) ? self::clean_text_block( $stored['support_note'], 1000 ) : '';

		if ( array_key_exists( 'compatibility', $stored ) && is_array( $stored['compatibility'] ) ) {
			$out['compatibility'] = self::clean_compatibility( $stored['compatibility'], $problems );
		}

		foreach ( array( 'demo_audio_binaural', 'demo_audio_atmos' ) as $key ) {
			$id          = isset( $stored[ $key ] ) ? absint( $stored[ $key ] ) : 0;
			$out[ $key ] = $id > 0 && self::audio_is_approved( $id ) ? $id : 0;
		}

		$style = self::empty_style();
		if ( isset( $stored['style_overrides'] ) && is_array( $stored['style_overrides'] ) ) {
			foreach ( $style as $key => $unused ) {
				if ( isset( $stored['style_overrides'][ $key ] ) && is_string( $stored['style_overrides'][ $key ] ) ) {
					$color         = sanitize_hex_color( $stored['style_overrides'][ $key ] );
					$style[ $key ] = is_string( $color ) ? $color : '';
				}
			}
		}
		$out['style_overrides'] = $style;
		$out['stream_hosts']    = self::clean_hosts( isset( $stored['stream_hosts'] ) ? $stored['stream_hosts'] : array() );
		$out['player_origins']  = self::clean_origins( isset( $stored['player_origins'] ) ? $stored['player_origins'] : array() );

		$out['delete_data_on_uninstall'] = ! empty( $stored['delete_data_on_uninstall'] );

		return $out;
	}

	/**
	 * Page ID of an existing, non-trashed page (else 0).
	 *
	 * @param mixed $id Candidate.
	 * @return int
	 */
	private static function valid_page_id( $id ): int {
		$id = absint( $id );
		if ( $id <= 0 ) {
			return 0;
		}
		$post = get_post( $id );
		return ( $post instanceof WP_Post && 'page' === $post->post_type && 'trash' !== $post->post_status ) ? $id : 0;
	}

	/**
	 * ID of an existing, non-trashed event (else 0).
	 *
	 * @param mixed $id Candidate.
	 * @return int
	 */
	private static function valid_event_id( $id ): int {
		$id = absint( $id );
		if ( $id <= 0 ) {
			return 0;
		}
		$post = get_post( $id );
		return ( $post instanceof WP_Post && Events::POST_TYPE === $post->post_type && ! in_array( $post->post_status, array( 'trash', 'auto-draft' ), true ) ) ? $id : 0;
	}

	/**
	 * Validate a link override. '' = auto. Returns null when the value is not acceptable.
	 *
	 * @param mixed $value        Candidate.
	 * @param bool  $allow_mailto Also accept a mailto: address.
	 * @return string|null
	 */
	private static function clean_url( $value, bool $allow_mailto ) {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );
		if ( '' === $value ) {
			return '';
		}
		if ( $allow_mailto && 1 === preg_match( '/^mailto:/i', $value ) ) {
			$address = (string) strtok( substr( $value, 7 ), '?' );
			$address = sanitize_email( $address );
			return '' !== $address && is_email( $address ) ? 'mailto:' . $address : null;
		}
		$clean = Events::clean_http_url( $value );
		return '' === $clean ? null : $clean;
	}

	/**
	 * Plain single-line text.
	 *
	 * @param mixed $value  Candidate.
	 * @param int   $length Maximum characters.
	 * @return string
	 */
	private static function clean_text_line( $value, int $length ): string {
		if ( ! is_string( $value ) ) {
			return '';
		}
		return self::shorten( trim( sanitize_text_field( $value ) ), $length );
	}

	/**
	 * Plain multi-line text with "\n" line breaks.
	 *
	 * @param mixed $value  Candidate.
	 * @param int   $length Maximum characters.
	 * @return string
	 */
	private static function clean_text_block( $value, int $length ): string {
		if ( ! is_string( $value ) ) {
			return '';
		}
		$value = str_replace( array( "\r\n", "\r" ), "\n", $value );
		return self::shorten( trim( sanitize_textarea_field( $value ) ), $length );
	}

	/**
	 * Multibyte-safe truncation.
	 *
	 * @param string $value  Text.
	 * @param int    $length Maximum characters.
	 * @return string
	 */
	private static function shorten( string $value, int $length ): string {
		if ( function_exists( 'mb_substr' ) && function_exists( 'mb_strlen' ) ) {
			return mb_strlen( $value, 'UTF-8' ) > $length ? mb_substr( $value, 0, $length, 'UTF-8' ) : $value;
		}
		return strlen( $value ) > $length ? substr( $value, 0, $length ) : $value;
	}

	/**
	 * Validate the FAQ rows. Rows with both fields empty are dropped; half-filled rows are dropped with a problem.
	 *
	 * @param mixed    $rows     Candidate rows.
	 * @param string[] $problems Collects problem messages.
	 * @return array[]
	 */
	private static function clean_faq( $rows, array &$problems ): array {
		if ( ! is_array( $rows ) ) {
			return array();
		}
		$out      = array();
		$position = 0;
		foreach ( $rows as $row ) {
			++$position;
			if ( ! is_array( $row ) ) {
				continue;
			}
			$question = self::clean_text_line( isset( $row['question'] ) ? $row['question'] : '', 200 );
			$answer   = self::clean_text_block( isset( $row['answer'] ) ? $row['answer'] : '', 2000 );
			if ( '' === $question && '' === $answer ) {
				continue;
			}
			if ( '' === $question || '' === $answer ) {
				$problems[] = sprintf( '常見問題第 %d 列需要同時填寫問題與答案，這一列沒有被儲存。', $position );
				continue;
			}
			$out[] = array(
				'question' => $question,
				'answer'   => $answer,
			);
			if ( count( $out ) >= self::MAX_FAQ_ROWS ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * A strict Y-m-d date that is not in the future, else null.
	 *
	 * @param mixed $value Candidate.
	 * @return string|null
	 */
	private static function clean_date( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return null;
		}
		$utc    = new DateTimeZone( 'UTC' );
		$parsed = DateTimeImmutable::createFromFormat( '!Y-m-d', $value, $utc );
		if ( false === $parsed || $parsed->format( 'Y-m-d' ) !== $value ) {
			return null;
		}
		if ( $value > gmdate( 'Y-m-d', time() + DAY_IN_SECONDS ) || $value < '2000-01-01' ) {
			return null;
		}
		return $value;
	}

	/**
	 * Validate the compatibility rows (M1-PLAN 4.3): "verified" and "not_working" are only accepted
	 * with a test date, device, OS, browser and output path; otherwise the row becomes "pending".
	 *
	 * @param mixed    $rows     Candidate rows.
	 * @param string[] $problems Collects problem messages.
	 * @return array[]
	 */
	private static function clean_compatibility( $rows, array &$problems ): array {
		if ( ! is_array( $rows ) ) {
			return array();
		}
		$out      = array();
		$position = 0;
		foreach ( $rows as $row ) {
			++$position;
			if ( ! is_array( $row ) ) {
				continue;
			}
			$clean = array(
				'device'       => self::clean_text_line( isset( $row['device'] ) ? $row['device'] : '', 120 ),
				'os'           => self::clean_text_line( isset( $row['os'] ) ? $row['os'] : '', 120 ),
				'browser'      => self::clean_text_line( isset( $row['browser'] ) ? $row['browser'] : '', 120 ),
				'outputPath'   => self::clean_text_line( isset( $row['outputPath'] ) ? $row['outputPath'] : '', 200 ),
				'sourceFormat' => self::clean_text_line( isset( $row['sourceFormat'] ) ? $row['sourceFormat'] : '', 120 ),
				'status'       => 'pending',
				'testedAt'     => self::clean_date( isset( $row['testedAt'] ) ? $row['testedAt'] : '' ),
				'notes'        => self::clean_text_line( isset( $row['notes'] ) ? $row['notes'] : '', 500 ),
			);

			$status = isset( $row['status'] ) && is_string( $row['status'] ) ? $row['status'] : 'pending';
			if ( ! in_array( $status, array( 'pending', 'verified', 'not_working' ), true ) ) {
				$status = 'pending';
			}

			$blank = '' === $clean['device'] && '' === $clean['os'] && '' === $clean['browser'] && '' === $clean['outputPath']
				&& '' === $clean['sourceFormat'] && '' === $clean['notes'] && null === $clean['testedAt'] && 'pending' === $status;
			if ( $blank ) {
				continue;
			}

			if ( 'pending' !== $status ) {
				$complete = null !== $clean['testedAt'] && '' !== $clean['device'] && '' !== $clean['os'] && '' !== $clean['browser'] && '' !== $clean['outputPath'];
				if ( $complete ) {
					$clean['status'] = $status;
				} else {
					$problems[] = sprintf( '相容表第 %d 列：標示為「已驗證」或「無法使用」時，必須填寫測試日期（不可晚於今天）、裝置、作業系統、瀏覽器與輸出路徑。這一列已改存為「尚待測試」。', $position );
				}
			}

			$out[] = $clean;
			if ( count( $out ) >= self::MAX_COMPAT_ROWS ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Can this attachment be offered as demo audio at all? (audio/*, not a WooCommerce product file.)
	 *
	 * @param int $id Attachment ID.
	 * @return bool
	 */
	private static function audio_is_eligible( int $id ): bool {
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || 'attachment' !== $post->post_type ) {
			return false;
		}
		if ( 0 !== strpos( (string) $post->post_mime_type, 'audio/' ) ) {
			return false;
		}
		$parent = (int) $post->post_parent;
		if ( $parent > 0 && 'product' === get_post_type( $parent ) ) {
			return false;
		}
		$file = get_attached_file( $id );
		if ( is_string( $file ) && false !== strpos( str_replace( '\\', '/', $file ), '/woocommerce_uploads/' ) ) {
			return false;
		}
		return true;
	}

	/**
	 * Eligible AND approved through the settings picker.
	 *
	 * @param int $id Attachment ID.
	 * @return bool
	 */
	private static function audio_is_approved( int $id ): bool {
		return self::audio_is_eligible( $id ) && '1' === (string) get_post_meta( $id, self::APPROVED_META, true );
	}

	/* ------------------------------------------------------------------ */
	/* Registration, sanitize and save bookkeeping                          */
	/* ------------------------------------------------------------------ */

	/**
	 * Add the submenu pages under the event post type menu.
	 *
	 * @return void
	 */
	public static function register_menu(): void {
		$cap    = Plugin::cap();
		$parent = 'edit.php?post_type=' . Events::POST_TYPE;

		$pages = array(
			array( 'WG Live 設定', '設定', self::PAGE_SETTINGS, 'render_settings_page' ),
			array( '部署資訊', '部署資訊', self::PAGE_DEPLOY, 'render_deploy_page' ),
			array( '建立建議頁面', '建立建議頁面', self::PAGE_PAGES, 'render_pages_page' ),
		);
		foreach ( $pages as $page ) {
			$hook = add_submenu_page( $parent, $page[0], $page[1], $cap, $page[2], array( __CLASS__, $page[3] ) );
			if ( is_string( $hook ) ) {
				self::$hooks[] = $hook;
			}
		}
	}

	/**
	 * Register the option, its sections and fields.
	 *
	 * @return void
	 */
	public static function register_settings(): void {
		register_setting(
			self::GROUP,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => self::defaults(),
				'show_in_rest'      => false,
			)
		);

		$page = self::PAGE_SETTINGS;

		add_settings_section( 'wg_live_mode', '運作模式', array( __CLASS__, 'section_mode' ), $page );
		add_settings_field( 'wg_live_f_mode', '部署模式', array( __CLASS__, 'field_mode' ), $page, 'wg_live_mode' );
		add_settings_field( 'wg_live_f_stream_hosts', '串流主機', array( __CLASS__, 'field_stream_hosts' ), $page, 'wg_live_mode', array( 'label_for' => 'wg-live-stream_hosts' ) );
		add_settings_field( 'wg_live_f_player_origins', '播放器網域', array( __CLASS__, 'field_player_origins' ), $page, 'wg_live_mode', array( 'label_for' => 'wg-live-player_origins' ) );

		add_settings_section( 'wg_live_pages', '頁面綁定', array( __CLASS__, 'section_pages' ), $page );
		add_settings_field( 'wg_live_f_page_events', '活動列表頁（/live/）', array( __CLASS__, 'field_page' ), $page, 'wg_live_pages', array( 'key' => 'page_events', 'label_for' => 'wg-live-page_events' ) );
		add_settings_field( 'wg_live_f_page_player', '播放頁（/live/listen/）', array( __CLASS__, 'field_page' ), $page, 'wg_live_pages', array( 'key' => 'page_player', 'label_for' => 'wg-live-page_player' ) );
		add_settings_field( 'wg_live_f_page_help', '聆聽說明頁（/live/help/）', array( __CLASS__, 'field_page' ), $page, 'wg_live_pages', array( 'key' => 'page_help', 'label_for' => 'wg-live-page_help' ) );

		add_settings_section( 'wg_live_featured', '首頁精選活動', array( __CLASS__, 'section_featured' ), $page );
		add_settings_field( 'wg_live_f_featured', '精選活動', array( __CLASS__, 'field_featured' ), $page, 'wg_live_featured', array( 'label_for' => 'wg-live-featured_event' ) );

		add_settings_section( 'wg_live_links', '站內連結覆寫', array( __CLASS__, 'section_links' ), $page );
		add_settings_field( 'wg_live_f_account', '帳號頁連結', array( __CLASS__, 'field_url' ), $page, 'wg_live_links', array( 'key' => 'account_url', 'label_for' => 'wg-live-account_url' ) );
		add_settings_field( 'wg_live_f_store', '商店連結', array( __CLASS__, 'field_url' ), $page, 'wg_live_links', array( 'key' => 'store_url', 'label_for' => 'wg-live-store_url' ) );
		add_settings_field( 'wg_live_f_contact', '聯絡連結', array( __CLASS__, 'field_url' ), $page, 'wg_live_links', array( 'key' => 'contact_url', 'label_for' => 'wg-live-contact_url' ) );

		add_settings_section( 'wg_live_help', '聆聽說明內容', array( __CLASS__, 'section_help' ), $page );
		add_settings_field( 'wg_live_f_support', '支援說明', array( __CLASS__, 'field_support_note' ), $page, 'wg_live_help', array( 'label_for' => 'wg-live-support_note' ) );
		add_settings_field( 'wg_live_f_faq', '常見問題', array( __CLASS__, 'field_faq' ), $page, 'wg_live_help' );
		add_settings_field( 'wg_live_f_compat', '家庭劇院相容表', array( __CLASS__, 'field_compat' ), $page, 'wg_live_help' );

		add_settings_section( 'wg_live_audio', '示範音訊', array( __CLASS__, 'section_audio' ), $page );
		// Decision 2026-11-01: no Binaural mode, so no Binaural demo audio picker (the stored value is kept, unused).
		add_settings_field( 'wg_live_f_audio_a', 'Atmos 示範音訊', array( __CLASS__, 'field_audio' ), $page, 'wg_live_audio', array( 'key' => 'demo_audio_atmos' ) );

		add_settings_section( 'wg_live_style', '樣式覆寫', array( __CLASS__, 'section_style' ), $page );
		add_settings_field( 'wg_live_f_style', '顏色', array( __CLASS__, 'field_style' ), $page, 'wg_live_style' );

		add_settings_section( 'wg_live_uninstall', '解除安裝', array( __CLASS__, 'section_uninstall' ), $page );
		add_settings_field( 'wg_live_f_delete', '解除安裝時刪除資料', array( __CLASS__, 'field_delete' ), $page, 'wg_live_uninstall' );
	}

	/**
	 * Queue a settings error / notice.
	 *
	 * @param string $code    Error code.
	 * @param string $message Message.
	 * @param string $type    error|warning|info|success.
	 * @return void
	 */
	private static function notice( string $code, string $message, string $type = 'error' ): void {
		add_settings_error( self::OPTION, $code, $message, $type );
	}

	/**
	 * Is the current request a post of our settings form (options.php)?
	 *
	 * @return bool
	 */
	private static function is_form_post(): bool {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- options.php verified the nonce before calling the sanitizer.
		return isset( $_POST['option_page'] ) && is_string( $_POST['option_page'] ) && self::GROUP === wp_unslash( $_POST['option_page'] );
	}

	/**
	 * Sanitize callback: validates every key on the server and returns a complete, clean array.
	 *
	 * From our settings form a missing list or checkbox means "empty / off". From anywhere else
	 * (for example the create-pages action) a missing key keeps its current value.
	 *
	 * @param mixed $input Submitted value.
	 * @return array
	 */
	public static function sanitize( $input ): array {
		$current = self::get();
		if ( ! is_array( $input ) ) {
			return $current;
		}
		if ( null !== self::$last_output && $input === self::$last_output ) {
			return $input; // WordPress sanitizes a brand-new option twice.
		}
		if ( self::$internal_write ) {
			return $input; // set_featured_event() changed featured_event only, after its own checks.
		}
		if ( ! current_user_can( Plugin::cap() ) ) {
			return $current;
		}

		$form = self::is_form_post();
		$in   = $input;
		$out  = array();

		// Page bindings.
		$labels = array(
			'page_events' => '活動列表頁',
			'page_player' => '播放頁',
			'page_help'   => '聆聽說明頁',
		);
		foreach ( $labels as $key => $label ) {
			if ( ! array_key_exists( $key, $in ) ) {
				$out[ $key ] = $form ? 0 : $current[ $key ];
				continue;
			}
			$id = absint( $in[ $key ] );
			if ( 0 === $id ) {
				$out[ $key ] = 0;
			} elseif ( self::valid_page_id( $id ) === $id ) {
				$out[ $key ] = $id;
			} else {
				$out[ $key ] = $current[ $key ];
				self::notice( 'wg_live_' . $key, sprintf( '找不到所選的%s（ID %d），已保留原本的綁定。', $label, $id ) );
			}
		}
		$bound = array_filter( array( $out['page_events'], $out['page_player'], $out['page_help'] ) );
		if ( count( $bound ) !== count( array_unique( $bound ) ) ) {
			self::notice( 'wg_live_pages_same', '活動列表、播放與聆聽說明頁面綁定到同一頁，請確認設定是否正確。', 'warning' );
		}

		// Featured event.
		if ( array_key_exists( 'featured_event', $in ) ) {
			$id = absint( $in['featured_event'] );
			if ( 0 === $id ) {
				$out['featured_event'] = 0;
			} elseif ( self::valid_event_id( $id ) === $id ) {
				$out['featured_event'] = $id;
				if ( 'publish' !== get_post_status( $id ) ) {
					self::notice( 'wg_live_featured_draft', '精選活動尚未發布，在發布之前首頁不會顯示它。', 'warning' );
				}
			} else {
				$out['featured_event'] = $current['featured_event'];
				self::notice( 'wg_live_featured', '找不到所選的精選活動，已保留原本的設定。' );
			}
		} else {
			$out['featured_event'] = $form ? 0 : $current['featured_event'];
		}

		// Link overrides.
		$link_labels = array(
			'account_url' => array( '帳號頁連結', false ),
			'store_url'   => array( '商店連結', false ),
			'contact_url' => array( '聯絡連結', true ),
		);
		foreach ( $link_labels as $key => $meta ) {
			if ( ! array_key_exists( $key, $in ) ) {
				$out[ $key ] = $form ? '' : $current[ $key ];
				continue;
			}
			$clean = self::clean_url( $in[ $key ], $meta[1] );
			if ( null === $clean ) {
				$out[ $key ] = $current[ $key ];
				self::notice(
					'wg_live_' . $key,
					sprintf( '%s必須是完整的 http 或 https 網址%s，已保留原本的設定。', $meta[0], $meta[1] ? '（聯絡連結也可以是 mailto: 信箱）' : '' )
				);
			} else {
				$out[ $key ] = $clean;
			}
		}

		// Deployment mode.
		if ( array_key_exists( 'deployment_mode', $in ) ) {
			$mode = is_string( $in['deployment_mode'] ) ? $in['deployment_mode'] : '';
			if ( in_array( $mode, array( 'disabled', 'demo', 'live' ), true ) ) {
				$out['deployment_mode'] = $mode;
			} else {
				$out['deployment_mode'] = $current['deployment_mode'];
				self::notice( 'wg_live_mode', '部署模式只能是「停用」或「示範」，已保留原本的設定。' );
			}
		} else {
			$out['deployment_mode'] = $current['deployment_mode'];
		}

		// Help content.
		$problems = array();
		if ( array_key_exists( 'faq', $in ) ) {
			$out['faq'] = self::clean_faq( $in['faq'], $problems );
		} else {
			$out['faq'] = $form ? array() : $current['faq'];
		}
		$out['support_note'] = array_key_exists( 'support_note', $in ) ? self::clean_text_block( $in['support_note'], 1000 ) : ( $form ? '' : $current['support_note'] );

		if ( array_key_exists( 'compatibility', $in ) ) {
			$out['compatibility'] = self::clean_compatibility( $in['compatibility'], $problems );
		} else {
			$out['compatibility'] = $form ? array() : $current['compatibility'];
		}
		foreach ( $problems as $index => $message ) {
			self::notice( 'wg_live_help_' . $index, $message, 'warning' );
		}

		// Demo audio.
		foreach ( array( 'demo_audio_binaural', 'demo_audio_atmos' ) as $key ) {
			if ( ! array_key_exists( $key, $in ) ) {
				$out[ $key ] = $form ? 0 : $current[ $key ];
				continue;
			}
			$id = absint( $in[ $key ] );
			if ( 0 === $id ) {
				$out[ $key ] = 0;
			} elseif ( $form && self::audio_is_eligible( $id ) ) {
				// Choosing a file through this settings form is the approval (M1-PLAN 4.3).
				update_post_meta( $id, self::APPROVED_META, '1' );
				$out[ $key ] = $id;
			} elseif ( ! $form && self::audio_is_approved( $id ) ) {
				$out[ $key ] = $id;
			} else {
				$out[ $key ] = 0;
				self::notice( 'wg_live_' . $key, sprintf( '附件 %d 不能當作示範音訊（必須是音訊檔，且不能是商品附件或受保護的下載檔）。將使用內建示範音訊。', $id ), 'warning' );
			}
		}
		foreach ( array_unique( array_map( 'absint', array( $current['demo_audio_binaural'], $current['demo_audio_atmos'] ) ) ) as $old_id ) {
			if ( $old_id > 0 && $old_id !== $out['demo_audio_binaural'] && $old_id !== $out['demo_audio_atmos'] ) {
				delete_post_meta( $old_id, self::APPROVED_META ); // No longer used: drop the approval.
			}
		}

		// Style overrides.
		$style = self::empty_style();
		foreach ( $style as $key => $unused ) {
			$given = isset( $in['style_overrides'] ) && is_array( $in['style_overrides'] ) && array_key_exists( $key, $in['style_overrides'] );
			if ( ! $given ) {
				$style[ $key ] = $form ? '' : ( isset( $current['style_overrides'][ $key ] ) ? $current['style_overrides'][ $key ] : '' );
				continue;
			}
			$raw = is_string( $in['style_overrides'][ $key ] ) ? trim( $in['style_overrides'][ $key ] ) : '';
			if ( '' === $raw ) {
				$style[ $key ] = '';
				continue;
			}
			$color = sanitize_hex_color( $raw );
			if ( is_string( $color ) && '' !== $color ) {
				$style[ $key ] = strtolower( $color );
			} else {
				$style[ $key ] = isset( $current['style_overrides'][ $key ] ) ? $current['style_overrides'][ $key ] : '';
				self::notice( 'wg_live_style_' . $key, sprintf( '顏色「%s」不是有效的十六進位色碼（例如 #f0d62b），已保留原本的設定。', esc_html( self::shorten( $raw, 20 ) ) ) );
			}
		}
		$out['style_overrides'] = $style;

		// Stream hosts (M2-PLAN B1): hostnames only, one per line in the form.
		if ( array_key_exists( 'stream_hosts', $in ) ) {
			$lines = is_string( $in['stream_hosts'] ) ? preg_split( '/\r\n|\r|\n/', $in['stream_hosts'] ) : ( is_array( $in['stream_hosts'] ) ? $in['stream_hosts'] : array() );
			$given = array_filter( array_map( 'trim', array_filter( (array) $lines, 'is_string' ) ), 'strlen' );
			$out['stream_hosts'] = self::clean_hosts( $given );
			if ( count( $out['stream_hosts'] ) < count( array_unique( array_map( 'strtolower', $given ) ) ) ) {
				self::notice( 'wg_live_stream_hosts', '有些串流主機格式不正確，已略過。請只填主機名稱，例如 stream.example.com。', 'warning' );
			}
		} else {
			$out['stream_hosts'] = $form ? array() : $current['stream_hosts'];
		}

		// Player origins (M2-PLAN D1): https origins only, one per line in the form.
		if ( array_key_exists( 'player_origins', $in ) ) {
			$lines = is_string( $in['player_origins'] ) ? preg_split( '/\r\n|\r|\n/', $in['player_origins'] ) : ( is_array( $in['player_origins'] ) ? $in['player_origins'] : array() );
			$given = array_filter( array_map( 'trim', array_filter( (array) $lines, 'is_string' ) ), 'strlen' );
			$out['player_origins'] = self::clean_origins( $given );
			if ( count( $out['player_origins'] ) < count( array_unique( $given ) ) ) {
				self::notice( 'wg_live_player_origins', '有些播放器網域格式不正確，已略過。請只填 https 網域，例如 https://player.example.com。', 'warning' );
			}
		} else {
			$out['player_origins'] = $form ? array() : $current['player_origins'];
		}

		// Delete-on-uninstall: from the form it needs both checkboxes (the second is the confirmation).
		if ( $form ) {
			$wants = ! empty( $in['delete_data_on_uninstall'] );
			if ( $wants && empty( $in['delete_data_confirm'] ) ) {
				self::notice( 'wg_live_delete', '要在解除安裝時刪除資料，必須同時勾選下方的確認框。此選項已維持關閉。', 'warning' );
				$wants = false;
			}
			$out['delete_data_on_uninstall'] = $wants;
		} else {
			$out['delete_data_on_uninstall'] = array_key_exists( 'delete_data_on_uninstall', $in ) ? ! empty( $in['delete_data_on_uninstall'] ) : $current['delete_data_on_uninstall'];
		}

		if ( $form ) {
			self::notice( 'wg_live_saved', '設定已儲存。', 'success' );
		}
		self::bump_meta();
		self::$last_output = $out;
		return $out;
	}

	/**
	 * Increment the settings version and record who/when (once per save; the double-sanitize quirk is
	 * absorbed by the last_output memo in sanitize()).
	 *
	 * @return void
	 */
	private static function bump_meta(): void {
		$meta = get_option( self::META_OPTION, array() );
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		$meta['version']    = isset( $meta['version'] ) ? absint( $meta['version'] ) + 1 : 1;
		$meta['updated_at'] = gmdate( 'Y-m-d H:i:s' );
		$meta['updated_by'] = get_current_user_id();
		update_option( self::META_OPTION, $meta, false );
	}

	/**
	 * The settings version record.
	 *
	 * @return array{version:int,updated_at:string,updated_by:int}
	 */
	public static function get_meta(): array {
		$meta = get_option( self::META_OPTION, array() );
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		return array(
			'version'    => isset( $meta['version'] ) ? absint( $meta['version'] ) : 0,
			'updated_at' => isset( $meta['updated_at'] ) && is_string( $meta['updated_at'] ) ? $meta['updated_at'] : '',
			'updated_by' => isset( $meta['updated_by'] ) ? absint( $meta['updated_by'] ) : 0,
		);
	}

	/* ------------------------------------------------------------------ */
	/* Assets                                                               */
	/* ------------------------------------------------------------------ */

	/**
	 * Enqueue the admin script and stylesheet on our screens only.
	 *
	 * @param string $hook_suffix Current admin page.
	 * @return void
	 */
	public static function enqueue_admin_assets( $hook_suffix ): void {
		$is_settings = is_string( $hook_suffix ) && in_array( $hook_suffix, self::$hooks, true );
		$is_event    = false;
		if ( function_exists( 'get_current_screen' ) ) {
			$screen = get_current_screen();
			if ( $screen && Events::POST_TYPE === $screen->post_type && in_array( $screen->base, array( 'post', 'edit' ), true ) ) {
				$is_event = true;
			}
		}
		if ( ! $is_settings && ! $is_event ) {
			return;
		}

		$root = dirname( __DIR__ );
		$main = defined( 'WG_LIVE_FILE' ) ? WG_LIVE_FILE : $root . '/wg-live.php';

		$css = $root . '/assets/admin/admin.css';
		if ( is_readable( $css ) ) {
			wp_enqueue_style( 'wg-live-admin', plugins_url( 'assets/admin/admin.css', $main ), $is_settings ? array( 'wp-color-picker' ) : array(), (string) filemtime( $css ) );
		}

		$js = $root . '/assets/admin/admin.js';
		if ( is_readable( $js ) ) {
			$deps = array();
			if ( $is_settings ) {
				wp_enqueue_media();
				$deps = array( 'jquery', 'wp-color-picker' );
			}
			wp_enqueue_script( 'wg-live-admin', plugins_url( 'assets/admin/admin.js', $main ), $deps, (string) filemtime( $js ), true );
		}
	}

	/* ------------------------------------------------------------------ */
	/* Settings page rendering                                              */
	/* ------------------------------------------------------------------ */

	/**
	 * Name attribute for a settings control.
	 *
	 * @param string $key Settings key (may include "[sub]" parts).
	 * @return string
	 */
	private static function name( string $key ): string {
		$parts = explode( '[', $key, 2 );
		return self::OPTION . '[' . $parts[0] . ']' . ( isset( $parts[1] ) ? '[' . $parts[1] : '' );
	}

	/**
	 * Settings screen.
	 *
	 * @return void
	 */
	public static function render_settings_page(): void {
		if ( ! current_user_can( Plugin::cap() ) ) {
			wp_die( esc_html( '你沒有權限檢視這個頁面。' ), '', array( 'response' => 403 ) );
		}
		$meta = self::get_meta();

		echo '<div class="wrap wg-live-admin"><h1>WG Live 設定</h1>';
		settings_errors();

		if ( $meta['version'] > 0 ) {
			$who = $meta['updated_by'] > 0 ? get_userdata( $meta['updated_by'] ) : false;
			printf(
				'<p class="wg-live-admin__meta">設定版本 %1$d，最後更新（UTC）%2$s，更新者：%3$s</p>',
				(int) $meta['version'],
				esc_html( $meta['updated_at'] ),
				esc_html( $who ? $who->display_name : ( $meta['updated_by'] > 0 ? '使用者 #' . $meta['updated_by'] : '系統' ) )
			);
		}

		echo '<form method="post" action="options.php" class="wg-live-admin__form">';
		settings_fields( self::GROUP );
		do_settings_sections( self::PAGE_SETTINGS );
		submit_button( '儲存設定' );
		echo '</form></div>';
	}

	/** @return void */
	public static function section_mode(): void {
		echo '<p>「停用」是緊急關閉開關：所有公開內容都會隱藏。外掛啟用後預設為停用。M1 只有「停用」與「示範」兩種模式。</p>';
	}

	/** @return void */
	public static function field_stream_hosts(): void {
		printf(
			'<textarea id="wg-live-stream_hosts" name="%1$s" rows="3" class="large-text code" spellcheck="false">%2$s</textarea>',
			esc_attr( self::name( 'stream_hosts' ) ),
			esc_textarea( implode( "\n", self::get()['stream_hosts'] ) )
		);
		echo '<p class="description">每行一個主機名稱，例如 <code>stream.example.com</code>。活動的 HLS 播放清單網址必須使用 https，且主機在這個清單內。觀眾看不到這些網址。</p>';
	}

	/** @return void */
	public static function field_player_origins(): void {
		printf(
			'<textarea id="wg-live-player_origins" name="%1$s" rows="3" class="large-text code" spellcheck="false">%2$s</textarea>',
			esc_attr( self::name( 'player_origins' ) ),
			esc_textarea( implode( "\n", self::get()['player_origins'] ) )
		);
		echo '<p class="description">串流服務商播放器頁面的網域，每行一個，例如 <code>https://player.example.com</code>。活動的「串流服務播放器」網址必須使用 https，且網域在這個清單內。觀眾看不到這些網址。</p>';
	}

	/** @return void */
	public static function field_mode(): void {
		$value = self::get()['deployment_mode'];
		echo '<fieldset><legend class="screen-reader-text">部署模式</legend>';
		printf(
			'<label class="wg-live-admin__choice"><input type="radio" name="%1$s" value="disabled"%2$s /> <strong>停用（disabled）</strong><span class="description">活動列表為空、播放不可用、首頁卡片只顯示文字。聆聽說明頁仍可使用。</span></label>',
			esc_attr( self::name( 'deployment_mode' ) ),
			checked( $value, 'disabled', false )
		);
		printf(
			'<label class="wg-live-admin__choice"><input type="radio" name="%1$s" value="demo"%2$s /> <strong>示範（demo）</strong><span class="description">顯示已發布的活動，並以操作示範影片或音訊（依活動類型）體驗播放介面。這不是正式串流，不會檢查觀看資格。</span></label>',
			esc_attr( self::name( 'deployment_mode' ) ),
			checked( $value, 'demo', false )
		);
		printf(
			'<label class="wg-live-admin__choice"><input type="radio" name="%1$s" value="live"%2$s /> <strong>正式（live）</strong><span class="description">正式活動依購票紀錄確認觀看資格，並在直播中提供已設定的串流。示範活動照常使用示範媒體。</span></label>',
			esc_attr( self::name( 'deployment_mode' ) ),
			checked( $value, 'live', false )
		);
		echo '</fieldset>';
	}

	/** @return void */
	public static function section_pages(): void {
		printf(
			'<p>頁面連結由所選頁面的永久連結取得，不會寫死頁面 ID（各環境的 ID 不同）。還沒有頁面？前往「<a href="%s">建立建議頁面</a>」。</p>',
			esc_url( admin_url( 'edit.php?post_type=' . Events::POST_TYPE . '&page=' . self::PAGE_PAGES ) )
		);
	}

	/**
	 * A page dropdown.
	 *
	 * @param array $args Field args (key).
	 * @return void
	 */
	public static function field_page( $args ): void {
		$key      = isset( $args['key'] ) ? (string) $args['key'] : '';
		$selected = (int) self::get()[ $key ];
		wp_dropdown_pages(
			array(
				'name'              => self::name( $key ),
				'id'                => 'wg-live-' . $key,
				'selected'          => $selected,
				'show_option_none'  => '— 尚未綁定 —',
				'option_none_value' => '0',
				'post_status'       => array( 'publish', 'draft', 'pending', 'private', 'future' ),
				'sort_column'       => 'menu_order, post_title',
			)
		);
		if ( $selected > 0 ) {
			$status = get_post_status( $selected );
			if ( 'publish' === $status ) {
				printf( '<p class="description">已發布：<a href="%1$s">%1$s</a></p>', esc_url( (string) get_permalink( $selected ) ) );
			} else {
				echo '<p class="description wg-live-admin__warn">這一頁尚未發布，所以站內連結暫時不會輸出。</p>';
			}
		}
	}

	/** @return void */
	public static function section_featured(): void {
		echo '<p>首頁的 <code>[wg_live_featured]</code> 卡片會顯示這場活動。沒有指定、或該活動尚未公開時，卡片只顯示「線上音樂會資訊即將公布」與前往 Live 的連結；活動列表頁則會自動挑選最近一場尚未結束的活動。</p>';
	}

	/** @return void */
	public static function field_featured(): void {
		$selected = (int) self::get()['featured_event'];
		$events   = get_posts(
			array(
				'post_type'        => Events::POST_TYPE,
				'post_status'      => array( 'publish', 'draft', 'pending', 'private', 'future' ),
				'posts_per_page'   => 200,
				'orderby'          => 'title',
				'order'            => 'ASC',
				'no_found_rows'    => true,
				'suppress_filters' => true,
			)
		);
		printf( '<select id="wg-live-featured_event" name="%s">', esc_attr( self::name( 'featured_event' ) ) );
		printf( '<option value="0"%s>— 未指定 —</option>', selected( $selected, 0, false ) );
		foreach ( $events as $event ) {
			$label = ( '' !== $event->post_title ? $event->post_title : '（無標題）' ) . ' [' . ( Events::is_valid_slug( $event->post_name ) ? $event->post_name : '代稱無效' ) . ']';
			if ( 'publish' !== $event->post_status ) {
				$label .= '（未發布）';
			}
			if ( '' === Events::get_event_data( $event )['starts_at_utc'] ) {
				$label .= '（未設定開始時間，不會顯示）';
			}
			printf( '<option value="%1$d"%2$s>%3$s</option>', (int) $event->ID, selected( $selected, (int) $event->ID, false ), esc_html( $label ) );
		}
		echo '</select>';
	}

	/** @return void */
	public static function section_links(): void {
		echo '<p>帳號頁與商店：已啟用 WooCommerce 且對應頁面（我的帳號、商店）已發布時，一律使用該頁面；這裡填寫的網址只在沒有 WooCommerce、或該頁面未發布時使用。聯絡連結沒有自動值。填寫時必須是完整網址；staging 的網址不要帶到正式站。</p>';
	}

	/**
	 * A URL input.
	 *
	 * @param array $args Field args (key).
	 * @return void
	 */
	public static function field_url( $args ): void {
		$key = isset( $args['key'] ) ? (string) $args['key'] : '';
		printf(
			'<input type="url" id="wg-live-%1$s" name="%2$s" value="%3$s" class="large-text code" placeholder="留空代表自動" />',
			esc_attr( $key ),
			esc_attr( self::name( $key ) ),
			esc_attr( (string) self::get()[ $key ] )
		);
		if ( 'contact_url' === $key ) {
			echo '<p class="description">只接受 http、https 或 <code>mailto:</code> 信箱。</p>';
		} else {
			echo '<p class="description">只接受 http 或 https。</p>';
		}
	}

	/** @return void */
	public static function section_help(): void {
		echo '<p>這些內容會顯示在聆聽說明頁。全部是純文字，不支援 HTML。</p>';
	}

	/** @return void */
	public static function field_support_note(): void {
		printf(
			'<textarea id="wg-live-support_note" name="%1$s" rows="3" class="large-text">%2$s</textarea><p class="description">顯示在聯絡連結上方。</p>',
			esc_attr( self::name( 'support_note' ) ),
			esc_textarea( (string) self::get()['support_note'] )
		);
	}

	/** @return void */
	public static function field_faq(): void {
		$rows = self::get()['faq'];
		echo '<div class="wg-live-admin__repeat" data-wg-live-repeat data-next-index="' . esc_attr( (string) ( count( $rows ) + 1 ) ) . '">';
		echo '<div data-wg-live-rows>';
		foreach ( array_values( $rows ) as $index => $row ) {
			self::render_faq_row( (string) $index, $row );
		}
		self::render_faq_row( (string) count( $rows ), array() );
		echo '</div>';
		echo '<template data-wg-live-template>';
		self::render_faq_row( '__INDEX__', array() );
		echo '</template>';
		echo '<p><button type="button" class="button" data-wg-live-add hidden>新增一則常見問題</button></p>';
		echo '</div>';
	}

	/**
	 * One FAQ row.
	 *
	 * @param string $index Row index or the "__INDEX__" template placeholder.
	 * @param array  $row   Row values.
	 * @return void
	 */
	private static function render_faq_row( string $index, array $row ): void {
		$base = self::name( 'faq' ) . '[' . $index . ']';
		$id   = 'wg-live-faq-' . $index;
		echo '<div class="wg-live-admin__row" data-wg-live-row>';
		printf( '<p><label for="%1$s-q">問題</label><br /><input type="text" id="%1$s-q" name="%2$s[question]" value="%3$s" class="large-text" maxlength="200" /></p>', esc_attr( $id ), esc_attr( $base ), esc_attr( isset( $row['question'] ) ? (string) $row['question'] : '' ) );
		printf( '<p><label for="%1$s-a">答案</label><br /><textarea id="%1$s-a" name="%2$s[answer]" rows="3" class="large-text" maxlength="2000">%3$s</textarea></p>', esc_attr( $id ), esc_attr( $base ), esc_textarea( isset( $row['answer'] ) ? (string) $row['answer'] : '' ) );
		echo '<p><button type="button" class="button-link button-link-delete" data-wg-live-remove>移除這一則</button></p>';
		echo '</div>';
	}

	/** @return void */
	public static function field_compat(): void {
		$rows = self::get()['compatibility'];
		echo '<p class="description">初始狀態全部是「尚待測試」。沒有實測就不要標示「已驗證」；選擇「已驗證」或「無法使用」時，測試日期、裝置、作業系統、瀏覽器與輸出路徑都必須填寫，否則會自動存回「尚待測試」。</p>';
		echo '<div class="wg-live-admin__repeat" data-wg-live-repeat data-next-index="' . esc_attr( (string) ( count( $rows ) + 1 ) ) . '">';
		echo '<div data-wg-live-rows>';
		foreach ( array_values( $rows ) as $index => $row ) {
			self::render_compat_row( (string) $index, $row );
		}
		self::render_compat_row( (string) count( $rows ), array() );
		echo '</div>';
		echo '<template data-wg-live-template>';
		self::render_compat_row( '__INDEX__', array() );
		echo '</template>';
		echo '<p><button type="button" class="button" data-wg-live-add hidden>新增一列</button></p>';
		echo '</div>';
	}

	/**
	 * One compatibility row.
	 *
	 * @param string $index Row index or the "__INDEX__" template placeholder.
	 * @param array  $row   Row values.
	 * @return void
	 */
	private static function render_compat_row( string $index, array $row ): void {
		$base   = self::name( 'compatibility' ) . '[' . $index . ']';
		$id     = 'wg-live-compat-' . $index;
		$status = isset( $row['status'] ) ? (string) $row['status'] : 'pending';
		$fields = array(
			'device'       => '裝置',
			'os'           => '作業系統',
			'browser'      => '瀏覽器',
			'outputPath'   => '輸出路徑',
			'sourceFormat' => '來源格式',
		);
		echo '<div class="wg-live-admin__row wg-live-admin__row--compat" data-wg-live-row>';
		echo '<div class="wg-live-admin__grid">';
		foreach ( $fields as $key => $label ) {
			printf(
				'<p><label for="%1$s-%2$s">%3$s</label><br /><input type="text" id="%1$s-%2$s" name="%4$s[%2$s]" value="%5$s" class="regular-text" maxlength="200" /></p>',
				esc_attr( $id ),
				esc_attr( $key ),
				esc_html( $label ),
				esc_attr( $base ),
				esc_attr( isset( $row[ $key ] ) ? (string) $row[ $key ] : '' )
			);
		}
		printf(
			'<p><label for="%1$s-testedAt">測試日期</label><br /><input type="date" id="%1$s-testedAt" name="%2$s[testedAt]" value="%3$s" /></p>',
			esc_attr( $id ),
			esc_attr( $base ),
			esc_attr( isset( $row['testedAt'] ) && is_string( $row['testedAt'] ) ? $row['testedAt'] : '' )
		);
		printf( '<p><label for="%1$s-status">測試結果</label><br /><select id="%1$s-status" name="%2$s[status]" data-wg-live-compat-status>', esc_attr( $id ), esc_attr( $base ) );
		printf( '<option value="pending"%s>尚待測試</option>', selected( $status, 'pending', false ) );
		printf( '<option value="verified"%s>已驗證</option>', selected( $status, 'verified', false ) );
		printf( '<option value="not_working"%s>無法使用</option>', selected( $status, 'not_working', false ) );
		echo '</select></p>';
		printf(
			'<p class="wg-live-admin__grid-wide"><label for="%1$s-notes">備註</label><br /><input type="text" id="%1$s-notes" name="%2$s[notes]" value="%3$s" class="large-text" maxlength="500" /></p>',
			esc_attr( $id ),
			esc_attr( $base ),
			esc_attr( isset( $row['notes'] ) ? (string) $row['notes'] : '' )
		);
		echo '</div>';
		echo '<p class="wg-live-admin__hint" data-wg-live-compat-hint role="status"></p>';
		echo '<p><button type="button" class="button-link button-link-delete" data-wg-live-remove>移除這一列</button></p>';
		echo '</div>';
	}

	/** @return void */
	public static function section_audio(): void {
		echo '<p><strong>以下兩個選項只適用於「音訊」類型的活動。</strong>「影片」類型的活動（預設）一律使用外掛內建的操作示範影片，不受這裡的設定影響。</p>';
		echo '<p>預設使用外掛內建的操作示範音訊。你也可以從媒體庫選擇音訊檔；選擇即代表核可它作為公開示範素材，所以請不要選擇商品附件或付費內容。示範音訊在前台永遠標示「操作示範音訊，非 Binaural／Atmos 驗證素材」。</p>';
	}

	/**
	 * A demo audio picker.
	 *
	 * @param array $args Field args (key).
	 * @return void
	 */
	public static function field_audio( $args ): void {
		$key = isset( $args['key'] ) ? (string) $args['key'] : '';
		$id  = (int) self::get()[ $key ];
		$bundled = 'demo_audio_binaural' === $key ? 'demo-tone-1.mp3' : 'demo-tone-2.mp3';
		$name    = '使用內建檔案（' . $bundled . '）';
		if ( $id > 0 ) {
			$file = get_attached_file( $id );
			$name = is_string( $file ) && '' !== $file ? wp_basename( $file ) : get_the_title( $id );
		}
		printf(
			'<div class="wg-live-admin__audio" data-wg-live-audio data-title="%1$s" data-button="%2$s" data-bundled="%3$s">',
			esc_attr( '選擇示範音訊' ),
			esc_attr( '使用此音訊' ),
			esc_attr( '使用內建檔案（' . $bundled . '）' )
		);
		printf(
			'<label for="wg-live-%1$s">附件 ID</label> <input type="number" min="0" step="1" class="small-text" id="wg-live-%1$s" name="%2$s" value="%3$d" data-wg-live-audio-id /> ',
			esc_attr( $key ),
			esc_attr( self::name( $key ) ),
			$id
		);
		printf( '<span class="wg-live-admin__audio-name" data-wg-live-audio-name>%s</span> ', esc_html( $name ) );
		echo '<button type="button" class="button" data-wg-live-audio-pick hidden>從媒體庫選擇</button> ';
		echo '<button type="button" class="button-link" data-wg-live-audio-clear hidden>改用內建檔案</button>';
		echo '</div>';
	}

	/** @return void */
	public static function section_style(): void {
		echo '<p>選填。留空就沿用網站主題的顏色。這些顏色只會套用在 Live 區塊內，不會改動 Elementor 或主題設定。</p>';
	}

	/** @return void */
	public static function field_style(): void {
		$style  = self::get()['style_overrides'];
		$labels = array(
			'accent'         => '強調色（主要按鈕、已選取的聆聽模式）',
			'on_accent'      => '強調色上的文字',
			'player_surface' => '播放器背景',
			'player_text'    => '播放器文字',
		);
		echo '<div class="wg-live-admin__grid">';
		foreach ( $labels as $key => $label ) {
			printf(
				'<p><label for="wg-live-style-%1$s">%2$s</label><br /><input type="text" id="wg-live-style-%1$s" name="%3$s" value="%4$s" class="wg-live-admin__color" maxlength="7" placeholder="#rrggbb" data-wg-live-color /></p>',
				esc_attr( $key ),
				esc_html( $label ),
				esc_attr( self::name( 'style_overrides[' . $key . ']' ) ),
				esc_attr( (string) $style[ $key ] )
			);
		}
		echo '</div>';
		echo '<p class="description">請自行確認文字與背景的對比（WCAG 2.2 AA：一般文字至少 4.5:1）。</p>';
	}

	/** @return void */
	public static function section_uninstall(): void {
		echo '<p>預設在解除安裝外掛時保留所有資料。</p>';
	}

	/** @return void */
	public static function field_delete(): void {
		$checked = (bool) self::get()['delete_data_on_uninstall'];
		printf(
			'<p><label><input type="checkbox" name="%1$s" value="1"%2$s data-wg-live-delete /> 解除安裝時刪除資料（所有活動與外掛設定）</label></p>',
			esc_attr( self::name( 'delete_data_on_uninstall' ) ),
			checked( $checked, true, false )
		);
		printf(
			'<p><label><input type="checkbox" name="%1$s" value="1"%2$s data-wg-live-delete-confirm /> 我了解這會永久刪除所有 Live 活動、活動資料與外掛設定，且無法復原（不會刪除頁面、媒體庫檔案、商品或訂單）。</label></p>',
			esc_attr( self::name( 'delete_data_confirm' ) ),
			checked( $checked, true, false )
		);
	}

	/* ------------------------------------------------------------------ */
	/* Deployment info (M1-PLAN 4.5)                                        */
	/* ------------------------------------------------------------------ */

	/**
	 * Read assets/dist/build-info.json (null when missing or unreadable).
	 *
	 * @return array|null
	 */
	private static function build_info() {
		$file = dirname( __DIR__ ) . '/assets/dist/build-info.json';
		if ( ! is_readable( $file ) ) {
			return null;
		}
		$json = file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local plugin file.
		$data = is_string( $json ) ? json_decode( $json, true ) : null;
		return is_array( $data ) ? $data : null;
	}

	/**
	 * Host of home_url(), lower case.
	 *
	 * @return string
	 */
	private static function home_host(): string {
		$host = wp_parse_url( home_url(), PHP_URL_HOST );
		return is_string( $host ) ? strtolower( $host ) : '';
	}

	/**
	 * Every stored URL that should point at this site's host, with a label.
	 *
	 * @return array<int,array{label:string,url:string}>
	 */
	private static function stored_urls(): array {
		$settings = self::get();
		$urls     = array();
		foreach ( array(
			'account_url' => '帳號頁連結',
			'store_url'   => '商店連結',
			'contact_url' => '聯絡連結',
		) as $key => $label ) {
			if ( '' !== $settings[ $key ] ) {
				$urls[] = array(
					'label' => $label,
					'url'   => $settings[ $key ],
				);
			}
		}

		$texts = array( '支援說明' => $settings['support_note'] );
		foreach ( $settings['faq'] as $index => $row ) {
			$texts[ '常見問題第 ' . ( $index + 1 ) . ' 則' ] = $row['question'] . "\n" . $row['answer'];
		}
		foreach ( $settings['compatibility'] as $index => $row ) {
			$texts[ '相容表第 ' . ( $index + 1 ) . ' 列' ] = $row['notes'];
		}
		foreach ( $texts as $label => $text ) {
			if ( '' !== $text && preg_match_all( '#https?://[^\s<>"\'）)]+#iu', $text, $matches ) ) {
				foreach ( $matches[0] as $url ) {
					$urls[] = array(
						'label' => $label . '（文字連結）',
						'url'   => $url,
					);
				}
			}
		}

		$ids = get_posts(
			array(
				'post_type'        => Events::POST_TYPE,
				'post_status'      => array( 'publish', 'draft', 'pending', 'private', 'future' ),
				'posts_per_page'   => 200,
				'fields'           => 'ids',
				'no_found_rows'    => true,
				'suppress_filters' => true,
			)
		);
		foreach ( $ids as $event_id ) {
			$url = get_post_meta( (int) $event_id, Events::META_PREFIX . 'product_url', true );
			if ( is_string( $url ) && '' !== $url ) {
				$urls[] = array(
					'label' => '活動「' . get_the_title( (int) $event_id ) . '」購票連結',
					'url'   => $url,
				);
			}
		}
		return $urls;
	}

	/**
	 * Deployment info screen.
	 *
	 * @return void
	 */
	public static function render_deploy_page(): void {
		if ( ! current_user_can( Plugin::cap() ) ) {
			wp_die( esc_html( '你沒有權限檢視這個頁面。' ), '', array( 'response' => 403 ) );
		}
		$settings = self::get();
		$meta     = self::get_meta();
		$info     = self::build_info();

		echo '<div class="wrap wg-live-admin"><h1>部署資訊</h1>';
		echo '<p>這一頁只供檢查，不會改動任何設定。每次部署都請把這裡的內容貼進部署紀錄。</p>';

		// Plugin and build.
		echo '<h2>外掛與建置</h2><table class="widefat striped wg-live-admin__table"><tbody>';
		self::kv( '外掛版本', defined( 'WG_LIVE_VERSION' ) ? (string) WG_LIVE_VERSION : '未知' );
		if ( null === $info ) {
			self::kv( '建置資訊', '找不到 assets/dist/build-info.json（建置檔案缺漏，前台無法載入播放器）' );
		} else {
			self::kv( '建置版本', isset( $info['version'] ) && is_scalar( $info['version'] ) ? (string) $info['version'] : '未知' );
			self::kv( '建置 commit', isset( $info['commit'] ) && is_scalar( $info['commit'] ) ? (string) $info['commit'] : '未知' );
			self::kv( '建置時間（UTC）', isset( $info['builtAt'] ) && is_scalar( $info['builtAt'] ) ? (string) $info['builtAt'] : '未知' );
			if ( isset( $info['files'] ) && is_array( $info['files'] ) ) {
				foreach ( $info['files'] as $name => $file ) {
					$hash = is_array( $file ) && isset( $file['sha256'] ) && is_string( $file['sha256'] ) ? $file['sha256'] : '未知';
					self::kv( 'SHA-256 ' . $name, $hash, true );
				}
			}
		}
		echo '</tbody></table>';

		// Environment.
		echo '<h2>環境</h2><table class="widefat striped wg-live-admin__table"><tbody>';
		self::kv( 'WordPress 環境類型', function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : '未知' );
		self::kv( '部署模式', 'live' === $settings['deployment_mode'] ? '正式（live）' : ( 'demo' === $settings['deployment_mode'] ? '示範（demo）' : '停用（disabled）' ) );
		self::kv( '串流簽章', Stream_Signers::describe() );
		self::kv( '串流主機', array() === $settings['stream_hosts'] ? '未設定' : implode( '、', $settings['stream_hosts'] ) );
		self::kv( '播放器網域', array() === $settings['player_origins'] ? '未設定' : implode( '、', $settings['player_origins'] ) );
		$dev = method_exists( __NAMESPACE__ . '\\Plugin', 'dev_tools_enabled' ) ? ( Plugin::dev_tools_enabled() ? '啟用' : '關閉' ) : '未知';
		self::kv( '開發工具面板', $dev );
		self::kv( 'PHP 版本', PHP_VERSION );
		self::kv( 'WordPress 版本', get_bloginfo( 'version' ) );
		self::kv( 'Elementor', defined( 'ELEMENTOR_VERSION' ) ? '已啟用 ' . ELEMENTOR_VERSION : '未啟用' );
		self::kv( 'Elementor Pro', defined( 'ELEMENTOR_PRO_VERSION' ) ? '已啟用 ' . ELEMENTOR_PRO_VERSION : '未啟用' );
		self::kv( 'WooCommerce', defined( 'WC_VERSION' ) ? '已啟用 ' . WC_VERSION : ( class_exists( 'WooCommerce' ) ? '已啟用' : '未啟用' ) );
		$theme  = wp_get_theme();
		$parent = $theme->parent();
		self::kv( '目前佈景主題', $theme->get( 'Name' ) . ' ' . $theme->get( 'Version' ) . ( $parent ? '（父主題 ' . $parent->get( 'Name' ) . ' ' . $parent->get( 'Version' ) . '）' : '' ) );
		$astra = 'astra' === $theme->get_template() || defined( 'ASTRA_THEME_VERSION' );
		self::kv( 'Astra', $astra ? '使用中' . ( defined( 'ASTRA_THEME_VERSION' ) ? ' ' . ASTRA_THEME_VERSION : '' ) : '未使用' );
		self::kv( '網站主機（home_url）', self::home_host() );
		echo '</tbody></table>';

		// Pages.
		echo '<h2>頁面綁定</h2><table class="widefat striped wg-live-admin__table"><thead><tr><th>用途</th><th>頁面 ID</th><th>狀態</th><th>永久連結</th></tr></thead><tbody>';
		foreach ( array(
			'page_events' => '活動列表',
			'page_player' => '播放',
			'page_help'   => '聆聽說明',
		) as $key => $label ) {
			$id = (int) $settings[ $key ];
			echo '<tr><td>' . esc_html( $label ) . '</td>';
			if ( $id <= 0 ) {
				echo '<td colspan="3"><span class="wg-live-admin__flag wg-live-admin__flag--bad">尚未綁定</span></td></tr>';
				continue;
			}
			$status = get_post_status( $id );
			echo '<td>' . (int) $id . '</td><td>' . esc_html( false === $status ? '找不到' : $status );
			if ( 'publish' !== $status ) {
				echo ' <span class="wg-live-admin__flag wg-live-admin__flag--bad">未發布，站內連結不會輸出</span>';
			}
			echo '</td><td>';
			if ( 'publish' === $status ) {
				printf( '<a href="%1$s">%1$s</a>', esc_url( (string) get_permalink( $id ) ) );
			} else {
				echo '—';
			}
			echo '</td></tr>';
		}
		echo '</tbody></table>';

		// Featured event and settings meta.
		echo '<h2>設定</h2><table class="widefat striped wg-live-admin__table"><tbody>';
		$featured = (int) $settings['featured_event'];
		self::kv( '首頁精選活動', $featured > 0 ? get_the_title( $featured ) . ' (#' . $featured . ')' : '未指定（首頁卡片顯示「線上音樂會資訊即將公布」）' );
		self::kv( '設定版本', (string) $meta['version'] );
		self::kv( '最後更新（UTC）', '' !== $meta['updated_at'] ? $meta['updated_at'] : '—' );
		$who = $meta['updated_by'] > 0 ? get_userdata( $meta['updated_by'] ) : false;
		self::kv( '更新者', $who ? $who->display_name . ' (#' . $meta['updated_by'] . ')' : ( $meta['updated_by'] > 0 ? '#' . $meta['updated_by'] : '系統' ) );
		self::kv( '解除安裝時刪除資料', $settings['delete_data_on_uninstall'] ? '是' : '否' );
		echo '</tbody></table>';

		// Host mismatches.
		echo '<h2>連結主機檢查</h2>';
		$home = self::home_host();
		$bad  = array();
		foreach ( self::stored_urls() as $item ) {
			$host = wp_parse_url( $item['url'], PHP_URL_HOST );
			if ( ! is_string( $host ) || '' === $host ) {
				continue; // For example mailto: addresses.
			}
			if ( strtolower( $host ) !== $home ) {
				$bad[] = $item;
			}
		}
		if ( empty( $bad ) ) {
			echo '<p>所有已儲存的連結都指向 ' . esc_html( $home ) . '（或是不含主機的連結）。</p>';
		} else {
			echo '<div class="notice notice-warning inline"><p><strong>下列連結的主機與這個網站（' . esc_html( $home ) . '）不同。</strong> 如果這是正式站，請確認沒有把 staging 的網址帶進來。</p></div>';
			echo '<table class="widefat striped wg-live-admin__table"><thead><tr><th>位置</th><th>網址</th></tr></thead><tbody>';
			foreach ( $bad as $item ) {
				echo '<tr><td>' . esc_html( $item['label'] ) . '</td><td><code>' . esc_html( $item['url'] ) . '</code></td></tr>';
			}
			echo '</tbody></table>';
		}
		echo '</div>';
	}

	/**
	 * One key/value row.
	 *
	 * @param string $label Label.
	 * @param string $value Value (plain text).
	 * @param bool   $code  Render the value as code.
	 * @return void
	 */
	private static function kv( string $label, string $value, bool $code = false ): void {
		echo '<tr><th scope="row">' . esc_html( $label ) . '</th><td>';
		echo $code ? '<code>' . esc_html( $value ) . '</code>' : esc_html( $value );
		echo '</td></tr>';
	}

	/* ------------------------------------------------------------------ */
	/* Create suggested pages (M1-PLAN 4.6)                                 */
	/* ------------------------------------------------------------------ */

	/**
	 * The three suggested pages, in creation order.
	 *
	 * @return array<int,array{key:string,path:string,slug:string,title:string,content:string,binding:string}>
	 */
	private static function suggested_pages(): array {
		return array(
			array(
				'key'     => 'live',
				'path'    => 'live',
				'slug'    => 'live',
				'title'   => 'Live',
				'content' => '[wg_live view="events"]',
				'binding' => 'page_events',
			),
			array(
				'key'     => 'listen',
				'path'    => 'live/listen',
				'slug'    => 'listen',
				'title'   => 'Listen',
				'content' => '[wg_live view="player"]',
				'binding' => 'page_player',
			),
			array(
				'key'     => 'help',
				'path'    => 'live/help',
				'slug'    => 'help',
				'title'   => 'Listening Guide',
				'content' => '[wg_live view="help"]',
				'binding' => 'page_help',
			),
		);
	}

	/**
	 * A page or media-library file with this slug under this parent in any status except trash.
	 *
	 * Attachments share the page slug namespace: wp_unique_post_slug() checks page and attachment together,
	 * so an unattached "live" file would rename the published Live page to live-2. Pages win when both match.
	 *
	 * @param string $slug      Page slug.
	 * @param int    $parent_id Parent page ID.
	 * @return object|null Row with ID, post_title, post_status, post_type.
	 */
	private static function find_page( string $slug, int $parent_id ) {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT ID, post_title, post_status, post_type FROM {$wpdb->posts} WHERE post_type IN ('page', 'attachment') AND post_name = %s AND post_parent = %d AND post_status NOT IN ('trash', 'auto-draft') ORDER BY (post_type = 'page') DESC, ID ASC LIMIT 1",
				$slug,
				$parent_id
			)
		);
		return $row ? $row : null;
	}

	/**
	 * Which of the suggested pages already exist?
	 *
	 * @return array<string,object> Keyed by suggested page key.
	 */
	private static function page_conflicts(): array {
		$found     = array();
		$parent_id = 0;
		foreach ( self::suggested_pages() as $page ) {
			$existing = self::find_page( $page['slug'], 'live' === $page['key'] ? 0 : $parent_id );
			if ( $existing ) {
				$found[ $page['key'] ] = $existing;
			}
			if ( 'live' === $page['key'] ) {
				$parent_id = $existing ? (int) $existing->ID : -1; // -1: no parent, children cannot exist yet.
			}
		}
		return $found;
	}

	/**
	 * Preview screen for the create-pages action.
	 *
	 * @return void
	 */
	public static function render_pages_page(): void {
		if ( ! current_user_can( Plugin::cap() ) ) {
			wp_die( esc_html( '你沒有權限檢視這個頁面。' ), '', array( 'response' => 403 ) );
		}
		$conflicts = self::page_conflicts();
		$settings  = self::get();

		echo '<div class="wrap wg-live-admin"><h1>建立建議頁面</h1>';
		echo '<p>會建立三個<strong>草稿</strong>頁面：<code>/live/</code>、<code>/live/listen/</code>、<code>/live/help/</code>，內容各是對應的短代碼。不會修改既有頁面、選單或首頁，也不會自動發布。</p>';

		echo '<table class="widefat striped wg-live-admin__table"><thead><tr><th>路徑</th><th>標題</th><th>內容</th><th>檢查結果</th></tr></thead><tbody>';
		foreach ( self::suggested_pages() as $page ) {
			echo '<tr><td><code>/' . esc_html( $page['path'] ) . '/</code></td><td>' . esc_html( $page['title'] ) . '</td><td><code>' . esc_html( $page['content'] ) . '</code></td><td>';
			if ( isset( $conflicts[ $page['key'] ] ) ) {
				$existing = $conflicts[ $page['key'] ];
				printf(
					'<span class="wg-live-admin__flag wg-live-admin__flag--bad">已存在</span> <a href="%1$s">%2$s（#%3$d，%4$s%5$s）</a>',
					esc_url( (string) get_edit_post_link( (int) $existing->ID, 'raw' ) ),
					esc_html( $existing->post_title ),
					(int) $existing->ID,
					esc_html( $existing->post_status ),
					'attachment' === $existing->post_type ? esc_html( '，媒體庫檔案' ) : ''
				);
			} else {
				echo '<span class="wg-live-admin__flag wg-live-admin__flag--ok">可建立</span>';
			}
			echo '</td></tr>';
		}
		echo '</tbody></table>';

		if ( ! empty( $conflicts ) ) {
			echo '<div class="notice notice-error inline"><p>已有相同路徑的頁面，所以不能建立。請先改名或移除既有頁面，或直接到「設定」頁綁定現有頁面。</p></div>';
			printf( '<p><a class="button" href="%s">前往設定</a></p></div>', esc_url( admin_url( 'edit.php?post_type=' . Events::POST_TYPE . '&page=' . self::PAGE_SETTINGS ) ) );
			return;
		}

		$has_binding = $settings['page_events'] > 0 || $settings['page_player'] > 0 || $settings['page_help'] > 0;

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::CREATE_PAGES_ACTION ) . '" />';
		wp_nonce_field( self::CREATE_PAGES_ACTION );
		if ( $has_binding ) {
			echo '<div class="notice notice-warning inline"><p>設定中已經綁定了頁面。預設不會覆寫既有綁定，只會建立新草稿。</p></div>';
			echo '<p><label><input type="checkbox" name="replace_bindings" value="1" /> 我確認要用新建立的頁面取代既有的頁面綁定</label></p>';
		} else {
			echo '<p>建立後會自動把三個頁面綁定到設定中。</p>';
		}
		submit_button( '建立三個草稿頁面' );
		echo '</form></div>';
	}

	/**
	 * Handle the create-pages form.
	 *
	 * @return void
	 */
	public static function handle_create_pages(): void {
		if ( ! current_user_can( Plugin::cap() ) || ! current_user_can( 'edit_pages' ) ) {
			wp_die( esc_html( '你沒有權限執行這個動作。' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::CREATE_PAGES_ACTION );

		$back = admin_url( 'edit.php?post_type=' . Events::POST_TYPE . '&page=' . self::PAGE_PAGES );

		$conflicts = self::page_conflicts();
		if ( ! empty( $conflicts ) ) {
			Events::flash( 'error', '已有相同路徑的頁面，沒有建立任何頁面。' );
			wp_safe_redirect( $back );
			exit;
		}

		$created   = array();
		$parent_id = 0;
		$error     = '';
		foreach ( self::suggested_pages() as $page ) {
			$result = wp_insert_post(
				array(
					'post_type'      => 'page',
					'post_status'    => 'draft',
					'post_title'     => $page['title'],
					'post_name'      => $page['slug'],
					'post_parent'    => 'live' === $page['key'] ? 0 : $parent_id,
					'post_content'   => $page['content'],
					'comment_status' => 'closed',
					'ping_status'    => 'closed',
				),
				true
			);
			if ( is_wp_error( $result ) || (int) $result <= 0 ) {
				$error = is_wp_error( $result ) ? $result->get_error_message() : '未知的錯誤';
				break;
			}
			$created[ $page['binding'] ] = (int) $result;
			if ( 'live' === $page['key'] ) {
				$parent_id = (int) $result;
			}
		}

		if ( '' !== $error ) {
			$ids = empty( $created ) ? '' : '（已建立的草稿 ID：' . implode( '、', $created ) . '，請手動檢查）';
			Events::flash( 'error', '建立頁面時發生錯誤：' . $error . $ids );
			wp_safe_redirect( $back );
			exit;
		}

		// Bind only empty slots, unless the second confirmation was given.
		$settings = self::get();
		$replace  = isset( $_POST['replace_bindings'] ) && '1' === $_POST['replace_bindings']; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified by check_admin_referer() above.
		$changes  = array();
		foreach ( $created as $binding => $page_id ) {
			if ( $replace || 0 === (int) $settings[ $binding ] ) {
				$changes[ $binding ] = $page_id;
			}
		}
		if ( ! empty( $changes ) ) {
			update_option( self::OPTION, array_merge( $settings, $changes ) );
		}

		$message = sprintf( '已建立三個草稿頁面（ID %s）。請檢查內容後再發布。', implode( '、', array_values( $created ) ) );
		if ( count( $changes ) === count( $created ) ) {
			$message .= '頁面已綁定到設定。';
		} elseif ( empty( $changes ) ) {
			$message .= '既有的頁面綁定沒有被更動，請到「設定」頁自行決定是否改綁。';
		} else {
			$message .= '只綁定了原本沒有設定的欄位，其餘既有綁定維持不變。';
		}
		Events::flash( 'success', $message );
		wp_safe_redirect( $back );
		exit;
	}
}
