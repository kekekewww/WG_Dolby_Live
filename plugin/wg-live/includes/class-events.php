<?php
/**
 * Event custom post type: registration, meta boxes, save rules, list columns (M1-PLAN 4.1, 4.2).
 *
 * @package WG_Live
 */

namespace WG_Live;

use DateTimeImmutable;
use DateTimeZone;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * The wg_live_event post type and everything that edits it.
 *
 * Storage format (M1-PLAN 4.2): meta keys are "_wg_live_{key}". List fields (performers,
 * programme, available_modes) are native PHP arrays, booleans are '1' / '0', everything else is a
 * string or an int. The event 代稱 (slug) is the post_name.
 */
final class Events {

	const POST_TYPE = 'wg_live_event';

	/**
	 * The one event slug pattern (D14), WITHOUT delimiters. It is byte-identical to
	 * EVENT_SLUG_PATTERN in src/types.ts (tests/unit/slug-pattern-sync.test.ts checks this).
	 * Use Events::is_valid_slug() or Events::SLUG_REGEX in PHP: PCRE's "$" also matches before a
	 * trailing newline, so the delimited form needs the "D" modifier.
	 */
	const SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';

	/** Maximum slug length (D14). */
	const SLUG_MAX_LENGTH = 100;

	/** Delimited, dollar-end-only form of SLUG_PATTERN for preg_match(). */
	const SLUG_REGEX = '/' . self::SLUG_PATTERN . '/D';

	const META_PREFIX = '_wg_live_';

	/** Stored source types read back as themselves; anything else reads as not_configured (M2-PLAN B3). */
	const SOURCE_TYPES = array( 'not_configured', 'demo', 'hls' );

	const DEFAULT_TIMEZONE = 'Asia/Taipei';

	const NONCE_ACTION = 'wg_live_save_event_';
	const NONCE_NAME   = 'wg_live_event_nonce';
	const FIELD_KEY    = 'wg_live';

	/** Per-user queue of notices that must survive the redirect after a save. */
	const NOTICE_TRANSIENT = 'wg_live_notices_';

	/**
	 * Set while an untrash is running (the slug filter must not interfere with it).
	 *
	 * @var bool
	 */
	private static $untrashing = false;

	/**
	 * Set when the slug filter forced a publish attempt back to draft in this request.
	 *
	 * @var bool
	 */
	private static $forced_draft = false;

	/**
	 * Hook everything. Called once by Plugin::instance().
	 *
	 * @return void
	 */
	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'register_post_type' ) );
		add_action( 'add_meta_boxes_' . self::POST_TYPE, array( __CLASS__, 'add_meta_boxes' ) );
		add_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'save_post' ), 10, 2 );
		add_filter( 'wp_insert_post_data', array( __CLASS__, 'filter_insert_post_data' ), 99, 4 );
		add_action( 'untrash_post', array( __CLASS__, 'begin_untrash' ) );
		add_action( 'untrashed_post', array( __CLASS__, 'end_untrash' ) );
		add_filter( 'redirect_post_location', array( __CLASS__, 'filter_redirect_location' ), 10, 2 );
		add_filter( 'manage_' . self::POST_TYPE . '_posts_columns', array( __CLASS__, 'list_columns' ) );
		add_action( 'manage_' . self::POST_TYPE . '_posts_custom_column', array( __CLASS__, 'list_column_content' ), 10, 2 );
		add_action( 'admin_notices', array( __CLASS__, 'print_notices' ) );
	}

	/* ------------------------------------------------------------------ */
	/* Public helpers                                                       */
	/* ------------------------------------------------------------------ */

	/**
	 * Is this a valid event slug (shared pattern, 1-100 chars, no trailing newline)?
	 *
	 * @param mixed $slug Candidate.
	 * @return bool
	 */
	public static function is_valid_slug( $slug ): bool {
		return is_string( $slug )
			&& '' !== $slug
			&& strlen( $slug ) <= self::SLUG_MAX_LENGTH
			&& 1 === preg_match( self::SLUG_REGEX, $slug );
	}

	/**
	 * The public predicate (M1-PLAN 4.2): the one test for "may this event be shown to visitors".
	 *
	 * @param WP_Post|null $post Candidate post.
	 * @return bool
	 */
	public static function is_public( $post ): bool {
		return $post instanceof WP_Post
			&& self::POST_TYPE === $post->post_type
			&& 'publish' === $post->post_status
			&& '' === (string) $post->post_password
			&& self::is_valid_slug( $post->post_name );
	}

	/**
	 * Event status whitelist (spec 6) with admin labels.
	 *
	 * @return array<string,string>
	 */
	public static function status_labels(): array {
		return array(
			'scheduled'    => '尚未開始',
			'doors_open'   => '等待入場（即將開放聆聽）',
			'live'         => '直播中',
			'intermission' => '中場休息',
			'ended'        => '已結束',
			'cancelled'    => '已取消',
		);
	}

	/**
	 * Listening mode whitelist with admin labels.
	 *
	 * @return array<string,string>
	 */
	public static function mode_labels(): array {
		return array(
			'binaural' => '耳機 Binaural',
			'atmos'    => '家庭劇院 Dolby Atmos',
		);
	}

	/**
	 * Is this an IANA time zone identifier PHP knows?
	 *
	 * @param mixed $timezone Candidate.
	 * @return bool
	 */
	public static function is_valid_timezone( $timezone ): bool {
		static $known = null;
		if ( ! is_string( $timezone ) || '' === $timezone ) {
			return false;
		}
		if ( null === $known ) {
			$known = array_flip( timezone_identifiers_list() );
		}
		return isset( $known[ $timezone ] );
	}

	/**
	 * Normalized event data, from the stored meta (M1-PLAN 4.2). Never throws on bad data.
	 *
	 * @param WP_Post $post Event post.
	 * @return array{performers:string[],description:string,starts_at_utc:string,display_timezone:string,status:string,media_kind:string,available_modes:string[],programme:string[],product_id:int,product_url:string,replay_available:bool,is_demo:bool,source_type:string}
	 */
	public static function get_event_data( $post ): array {
		$id = $post instanceof WP_Post ? (int) $post->ID : 0;

		$timezone = self::meta( $id, 'display_timezone' );
		if ( ! self::is_valid_timezone( $timezone ) ) {
			$timezone = self::DEFAULT_TIMEZONE;
		}

		$status = self::meta( $id, 'status' );
		if ( ! isset( self::status_labels()[ $status ] ) ) {
			$status = 'scheduled';
		}

		$media_kind = 'audio' === self::meta( $id, 'media_kind' ) ? 'audio' : 'video';

		$is_demo     = self::meta_bool( $id, 'is_demo' );
		$source_type = self::meta( $id, 'source_type' );
		$source_type = in_array( $source_type, self::SOURCE_TYPES, true ) ? $source_type : 'not_configured';

		$product_url = self::meta( $id, 'product_url' );
		if ( '' !== $product_url && '' === self::clean_http_url( $product_url ) ) {
			$product_url = '';
		}

		return array(
			'performers'       => self::meta_list( $id, 'performers' ),
			'description'      => self::meta( $id, 'description' ),
			'starts_at_utc'    => self::clean_utc( self::meta( $id, 'starts_at_utc' ) ),
			'display_timezone' => $timezone,
			'status'           => $status,
			'media_kind'       => $media_kind,
			'available_modes'  => self::clean_modes( get_post_meta( $id, self::META_PREFIX . 'available_modes', true ) ),
			'programme'        => self::meta_list( $id, 'programme' ),
			'product_id'       => absint( self::meta( $id, 'product_id' ) ),
			'product_url'      => $product_url,
			'replay_available' => self::meta_bool( $id, 'replay_available' ),
			'is_demo'          => $is_demo,
			'source_type'      => $source_type,
		);
	}

	/* ------------------------------------------------------------------ */
	/* Post type                                                            */
	/* ------------------------------------------------------------------ */

	/**
	 * Register wg_live_event: wp-admin only, no public routes (spec 10.1, D13).
	 *
	 * @return void
	 */
	public static function register_post_type(): void {
		$cap = Plugin::events_cap();

		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'               => 'Live 活動',
					'singular_name'      => 'Live 活動',
					'menu_name'          => 'Live 活動',
					'add_new'            => '新增活動',
					'add_new_item'       => '新增 Live 活動',
					'edit_item'          => '編輯 Live 活動',
					'new_item'           => '新增活動',
					'view_item'          => '檢視活動',
					'search_items'       => '搜尋活動',
					'not_found'          => '尚未建立任何活動',
					'not_found_in_trash' => '垃圾桶內沒有活動',
					'all_items'          => '所有活動',
					'item_published'     => '活動已發布。',
					'item_updated'       => '活動已更新。',
					'featured_image'     => '活動海報',
					'set_featured_image' => '設定活動海報',
					'remove_featured_image' => '移除活動海報',
					'use_featured_image' => '使用為活動海報',
				),
				'public'              => false,
				'show_ui'             => true,
				'show_in_menu'        => true,
				'show_in_admin_bar'   => false,
				'show_in_nav_menus'   => false,
				'publicly_queryable'  => false,
				'query_var'           => false,
				'rewrite'             => false,
				'has_archive'         => false,
				'exclude_from_search' => true,
				'show_in_rest'        => false,
				'can_export'          => true,
				'delete_with_user'    => false,
				'menu_position'       => 26,
				'menu_icon'           => 'dashicons-format-audio',
				'supports'            => array( 'title', 'thumbnail' ),
				'map_meta_cap'        => true,
				'capabilities'        => array(
					'edit_post'              => 'edit_post',
					'read_post'              => 'read_post',
					'delete_post'            => 'delete_post',
					'edit_posts'             => $cap,
					'edit_others_posts'      => $cap,
					'delete_posts'           => $cap,
					'publish_posts'          => $cap,
					'read_private_posts'     => $cap,
					'delete_private_posts'   => $cap,
					'delete_published_posts' => $cap,
					'delete_others_posts'    => $cap,
					'edit_private_posts'     => $cap,
					'edit_published_posts'   => $cap,
					'create_posts'           => $cap,
				),
			)
		);
	}

	/* ------------------------------------------------------------------ */
	/* Meta box                                                             */
	/* ------------------------------------------------------------------ */

	/**
	 * Register the single meta box.
	 *
	 * @return void
	 */
	public static function add_meta_boxes(): void {
		add_meta_box(
			'wg-live-event-fields',
			'活動資料',
			array( __CLASS__, 'render_meta_box' ),
			self::POST_TYPE,
			'normal',
			'high'
		);
	}

	/**
	 * Render the event fields.
	 *
	 * @param WP_Post $post Event being edited.
	 * @return void
	 */
	public static function render_meta_box( $post ): void {
		$data = self::get_event_data( $post );
		$key  = self::FIELD_KEY;

		wp_nonce_field( self::NONCE_ACTION . $post->ID, self::NONCE_NAME );

		$slug = (string) $post->post_name;
		if ( ! self::is_valid_slug( $slug ) ) {
			$slug = '';
			$title = (string) $post->post_title;
			if ( 'auto-draft' !== $post->post_status && '' !== $title && 1 === preg_match( '/^[\x20-\x7e]+$/', $title ) ) {
				$guess = sanitize_title( $title );
				if ( self::is_valid_slug( $guess ) ) {
					$slug = $guess;
				}
			}
		}

		$timezone = $data['display_timezone'];
		$local    = '';
		if ( '' !== $data['starts_at_utc'] ) {
			try {
				$utc   = new DateTimeImmutable( $data['starts_at_utc'], new DateTimeZone( 'UTC' ) );
				$local = $utc->setTimezone( new DateTimeZone( $timezone ) )->format( 'Y-m-d\TH:i' );
			} catch ( \Exception $e ) {
				$local = '';
			}
		}

		echo '<div class="wg-live-admin wg-live-admin__event">';

		if ( 'publish' === $post->post_status && ! self::is_valid_slug( $post->post_name ) ) {
			echo '<div class="notice notice-error inline"><p>這場活動的代稱無效，因此不會對訪客顯示。請填入有效的代稱後更新。</p></div>';
		}

		echo '<table class="form-table wg-live-admin__table" role="presentation"><tbody>';

		// Slug.
		self::row_open( 'wg-live-slug', '代稱（必填）' );
		printf(
			'<input type="text" id="wg-live-slug" name="%1$s[slug]" value="%2$s" class="regular-text code" maxlength="%3$d" pattern="%4$s" autocomplete="off" spellcheck="false" aria-required="true" aria-describedby="wg-live-slug-help wg-live-slug-status" data-wg-live-slug />',
			esc_attr( $key ),
			esc_attr( $slug ),
			(int) self::SLUG_MAX_LENGTH,
			esc_attr( '[a-z0-9]+(?:-[a-z0-9]+)*' )
		);
		echo '<p class="description" id="wg-live-slug-help">只能使用小寫英文字母、數字與連字號（例如 <code>spring-concert-2026</code>），不可以連字號開頭或結尾，最多 100 個字元。代稱必須唯一，會出現在聆聽連結中，發布後請勿任意修改。中文標題不會自動轉成代稱。</p>';
		echo '<p class="wg-live-admin__slug-status" id="wg-live-slug-status" role="status"></p>';
		self::row_close();

		// Performers.
		self::row_open( 'wg-live-performers', '演出者' );
		printf(
			'<textarea id="wg-live-performers" name="%1$s[performers]" rows="3" class="large-text">%2$s</textarea>',
			esc_attr( $key ),
			esc_textarea( implode( "\n", $data['performers'] ) )
		);
		echo '<p class="description">每行一位。空白行會被忽略。</p>';
		self::row_close();

		// Description.
		self::row_open( 'wg-live-description', '簡介' );
		printf(
			'<textarea id="wg-live-description" name="%1$s[description]" rows="5" class="large-text">%2$s</textarea>',
			esc_attr( $key ),
			esc_textarea( $data['description'] )
		);
		echo '<p class="description">純文字，不支援 HTML。換行會顯示為段落。</p>';
		self::row_close();

		// Start time and time zone.
		self::row_open( 'wg-live-starts-local', '開始時間' );
		printf(
			'<input type="datetime-local" id="wg-live-starts-local" name="%1$s[starts_local]" value="%2$s" step="60" aria-describedby="wg-live-starts-help" /> ',
			esc_attr( $key ),
			esc_attr( $local )
		);
		printf(
			'<label for="wg-live-timezone" class="screen-reader-text">顯示時區</label><input type="text" id="wg-live-timezone" name="%1$s[display_timezone]" value="%2$s" list="wg-live-timezones" class="regular-text code" autocomplete="off" spellcheck="false" />',
			esc_attr( $key ),
			esc_attr( $timezone )
		);
		echo '<datalist id="wg-live-timezones">';
		foreach ( timezone_identifiers_list() as $identifier ) {
			printf( '<option value="%s"></option>', esc_attr( $identifier ) );
		}
		echo '</datalist>';
		echo '<p class="description" id="wg-live-starts-help">開始時間以右側時區的當地時間輸入（預設 Asia/Taipei），系統會換算為 UTC 儲存。';
		if ( '' !== $data['starts_at_utc'] ) {
			printf( ' 目前儲存的 UTC 時間：<code>%s</code>。', esc_html( $data['starts_at_utc'] ) );
		}
		echo '</p>';
		self::row_close();

		// Status.
		self::row_open( 'wg-live-status', '活動狀態' );
		printf( '<select id="wg-live-status" name="%s[status]">', esc_attr( $key ) );
		foreach ( self::status_labels() as $value => $label ) {
			printf( '<option value="%1$s"%2$s>%3$s</option>', esc_attr( $value ), selected( $data['status'], $value, false ), esc_html( $label ) );
		}
		echo '</select>';
		echo '<p class="description">狀態由管理者手動設定；倒數到零不代表正在直播。</p>';
		self::row_close();

		// Media kind.
		self::row_open( 'wg-live-media-kind', '媒體類型' );
		printf( '<select id="wg-live-media-kind" name="%s[media_kind]">', esc_attr( $key ) );
		printf( '<option value="video"%s>影片 video（預設）</option>', selected( $data['media_kind'], 'video', false ) );
		printf( '<option value="audio"%s>音訊 audio</option>', selected( $data['media_kind'], 'audio', false ) );
		echo '</select>';
		self::row_close();

		// Available modes.
		self::row_open( '', '可用聆聽模式' );
		echo '<fieldset><legend class="screen-reader-text">可用聆聽模式</legend>';
		foreach ( self::mode_labels() as $value => $label ) {
			printf(
				'<label class="wg-live-admin__check"><input type="checkbox" name="%1$s[available_modes][]" value="%2$s"%3$s /> %4$s</label><br />',
				esc_attr( $key ),
				esc_attr( $value ),
				checked( in_array( $value, $data['available_modes'], true ), true, false ),
				esc_html( $label )
			);
		}
		echo '</fieldset>';
		echo '<p class="description">兩者都不勾選時，前台會顯示「即將開放」。</p>';
		self::row_close();

		// Programme.
		self::row_open( 'wg-live-programme', '節目單' );
		printf(
			'<textarea id="wg-live-programme" name="%1$s[programme]" rows="5" class="large-text">%2$s</textarea>',
			esc_attr( $key ),
			esc_textarea( implode( "\n", $data['programme'] ) )
		);
		echo '<p class="description">每行一個項目。僅為節目清單，不會被當成即時曲目資料。</p>';
		self::row_close();

		// Product.
		self::row_open( 'wg-live-product-id', '商品 ID' );
		printf(
			'<input type="number" id="wg-live-product-id" name="%1$s[product_id]" value="%2$s" min="0" step="1" class="small-text" />',
			esc_attr( $key ),
			esc_attr( $data['product_id'] > 0 ? (string) $data['product_id'] : '' )
		);
		echo '<p class="description">選填。已發布的 WooCommerce 商品 ID；填寫後購票連結取自該商品。正式站與 staging 的 ID 可能不同，請在各環境確認。</p>';
		self::row_close();

		self::row_open( 'wg-live-product-url', '購票連結' );
		printf(
			'<input type="url" id="wg-live-product-url" name="%1$s[product_url]" value="%2$s" class="large-text code" placeholder="https://" />',
			esc_attr( $key ),
			esc_attr( $data['product_url'] )
		);
		echo '<p class="description">選填，只接受 http 或 https。商品 ID 有效時以商品連結為準。</p>';
		self::row_close();

		// Replay.
		self::row_open( '', '回放' );
		printf(
			'<label><input type="checkbox" name="%1$s[replay_available]" value="1"%2$s /> 已確認可提供回放</label>',
			esc_attr( $key ),
			checked( $data['replay_available'], true, false )
		);
		echo '<p class="description">M1 不提供回放播放；勾選只會顯示「回放資訊待公布」。開放前請確認內容與有效期間。</p>';
		self::row_close();

		// Demo flag.
		self::row_open( '', '示範活動' );
		printf(
			'<label><input type="checkbox" name="%1$s[is_demo]" value="1"%2$s /> 示範活動（前台會標示「介面示範」）</label>',
			esc_attr( $key ),
			checked( $data['is_demo'], true, false )
		);
		echo '<p class="description">請明確區分測試與正式內容。示範活動使用操作示範音訊，非 Binaural／Atmos 驗證素材。</p>';
		self::row_close();

		// Source type.
		self::row_open( 'wg-live-source-type', '來源類型' );
		printf( '<select id="wg-live-source-type" name="%s[source_type]">', esc_attr( $key ) );
		printf( '<option value="not_configured"%s>尚未設定</option>', selected( $data['source_type'], 'not_configured', false ) );
		printf( '<option value="demo"%s>示範</option>', selected( $data['source_type'], 'demo', false ) );
		printf( '<option value="hls"%s>HLS 串流（本站播放器）</option>', selected( $data['source_type'], 'hls', false ) );
		echo '<option value="iframe" disabled="disabled">串流服務播放器（iframe，尚未開放）</option>';
		echo '</select>';
		echo '<p class="description">「示範」需同時勾選「示範活動」。正式活動選「HLS 串流」並填入下方播放清單；只有部署模式為「正式」、購票的觀眾在直播中才拿得到串流。</p>';
		self::row_close();

		// HLS playlists per mode (M2-PLAN B1). Never sent to viewers except through /playback after the ticket check.
		foreach ( array( 'binaural' => 'HLS 播放清單（耳機 Binaural）', 'atmos' => 'HLS 播放清單（家庭劇院 Dolby Atmos）' ) as $mode => $label ) {
			self::row_open( 'wg-live-source-hls-' . $mode, $label );
			printf(
				'<input type="url" id="wg-live-source-hls-%1$s" name="%2$s[source_hls_%1$s]" value="%3$s" class="large-text code" spellcheck="false" placeholder="https://" />',
				esc_attr( $mode ),
				esc_attr( $key ),
				esc_attr( self::source_url( (int) $post->ID, 'hls', $mode ) )
			);
			self::row_close();
		}
		echo '<tr><th scope="row"></th><td><p class="description">網址必須使用 https，且主機在「Live 活動 → 設定 → 串流主機」清單內（由管理員設定）。</p></td></tr>';

		// Homepage featured card (0.2.0).
		$featured = (int) Settings::get()['featured_event'];
		self::row_open( '', '首頁精選' );
		printf(
			'<label><input type="checkbox" name="%1$s[featured]" value="1"%2$s /> 設為首頁精選（首頁 Live 區塊顯示這場活動）</label>',
			esc_attr( $key ),
			checked( $featured, (int) $post->ID, false )
		);
		// An unticked box sends nothing: this marker tells save_post() the box was on the form.
		printf( '<input type="hidden" name="%s[featured_shown]" value="1" />', esc_attr( $key ) );
		if ( $featured > 0 && $featured !== (int) $post->ID ) {
			$current = get_the_title( $featured );
			printf( '<p class="description">目前的首頁精選是「%s」，勾選後會改成這場。</p>', esc_html( '' !== $current ? $current : '（無標題）' ) );
		}
		echo '<p class="description">同一時間只有一場首頁精選。活動發布、代稱有效並設定開始時間之後，首頁才會顯示它。</p>';
		self::row_close();

		echo '</tbody></table></div>';
	}

	/**
	 * A stored source URL for one mode (M2-PLAN B1). Server-side only: never part of PublicEvent.
	 *
	 * @param int    $post_id Event ID.
	 * @param string $type    hls (iframe in D1).
	 * @param string $mode    binaural|atmos.
	 * @return string
	 */
	public static function source_url( int $post_id, string $type, string $mode ): string {
		if ( ! in_array( $type, array( 'hls', 'iframe' ), true ) || ! in_array( $mode, array( 'binaural', 'atmos' ), true ) ) {
			return '';
		}
		$value = get_post_meta( $post_id, self::META_PREFIX . 'source_' . $type . '_' . $mode, true );
		return is_string( $value ) ? $value : '';
	}

	/**
	 * Why a stream URL is refused ('' = acceptable): https only, and the host must be on Settings::stream_hosts().
	 * In local/development environments plain http is also accepted for a loopback address or this site's own
	 * host, for test fixtures.
	 *
	 * @param string $url Candidate.
	 * @return string Taiwan Chinese message, or ''.
	 */
	public static function stream_url_error( string $url ): string {
		$parts  = wp_parse_url( $url );
		$scheme = is_array( $parts ) && isset( $parts['scheme'] ) ? strtolower( $parts['scheme'] ) : '';
		$host   = is_array( $parts ) && isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
		$own    = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
		$ip     = ip2long( $host );
		$local  = in_array( wp_get_environment_type(), array( 'local', 'development' ), true )
			&& ( ( false !== $ip && 127 === ( $ip >> 24 ) ) || ( '' !== $own && $own === $host ) );
		if ( '' === $host || ! ( 'https' === $scheme || ( 'http' === $scheme && $local ) ) ) {
			return sprintf( '串流網址「%s」必須使用 https，已保留原本的網址。', self::shorten( $url, 80 ) );
		}
		if ( ! in_array( $host, Settings::stream_hosts(), true ) ) {
			return sprintf( '「%s」不在「設定 → 串流主機」清單內，已保留原本的網址。請管理員先加入這個主機。', $host );
		}
		return '';
	}

	/**
	 * Open a table row.
	 *
	 * @param string $for   ID of the labelled control ('' for a group).
	 * @param string $label Row label.
	 * @return void
	 */
	private static function row_open( string $for, string $label ): void {
		echo '<tr><th scope="row">';
		if ( '' !== $for ) {
			printf( '<label for="%s">%s</label>', esc_attr( $for ), esc_html( $label ) );
		} else {
			echo esc_html( $label );
		}
		echo '</th><td>';
	}

	/**
	 * Close a table row.
	 *
	 * @return void
	 */
	private static function row_close(): void {
		echo '</td></tr>';
	}

	/* ------------------------------------------------------------------ */
	/* Slug filter                                                          */
	/* ------------------------------------------------------------------ */

	/**
	 * Remember that an untrash is running.
	 *
	 * @return void
	 */
	public static function begin_untrash(): void {
		self::$untrashing = true;
	}

	/**
	 * Untrash finished.
	 *
	 * @return void
	 */
	public static function end_untrash(): void {
		self::$untrashing = false;
	}

	/**
	 * Validate the 代稱 before WordPress stores it (M1-PLAN 4.2).
	 *
	 * The RAW submitted value is checked against SLUG_PATTERN before any sanitize_title(). A missing,
	 * invalid or duplicate slug stores nothing new (the previous post_name stays), shows a notice
	 * and pulls a publish attempt back to draft. Nothing is ever auto-suffixed with "-2".
	 *
	 * @param array $data                Slashed, sanitized post data.
	 * @param array $postarr             Sanitized post array.
	 * @param array $unsanitized_postarr Raw post array.
	 * @param bool  $update              Whether this is an update.
	 * @return array
	 */
	public static function filter_insert_post_data( $data, $postarr = array(), $unsanitized_postarr = array(), $update = false ) {
		if ( ! is_array( $data ) || ! isset( $data['post_type'] ) || self::POST_TYPE !== $data['post_type'] ) {
			return $data;
		}
		$status = isset( $data['post_status'] ) ? (string) $data['post_status'] : '';
		if ( in_array( $status, array( 'trash', 'auto-draft', 'inherit' ), true ) || self::$untrashing ) {
			return $data;
		}

		$post_id  = isset( $postarr['ID'] ) ? (int) $postarr['ID'] : 0;
		$previous = $post_id > 0 ? (string) get_post_field( 'post_name', $post_id, 'raw' ) : '';

		$posted = self::posted_slug( $post_id );
		if ( null !== $posted ) {
			$raw = $posted;
		} else {
			$source = is_array( $unsanitized_postarr ) && isset( $unsanitized_postarr['post_name'] ) ? $unsanitized_postarr['post_name'] : ( $postarr['post_name'] ?? '' );
			$raw    = is_string( $source ) ? wp_unslash( $source ) : '';
		}

		$problem = '';
		if ( '' === $raw ) {
			$problem = 'empty';
		} elseif ( ! self::is_valid_slug( $raw ) ) {
			$problem = 'invalid';
		} elseif ( self::slug_in_use( $raw, $post_id ) ) {
			$problem = 'duplicate';
		}

		if ( '' === $problem ) {
			$data['post_name'] = $raw;
			return self::require_title_and_start( $data, $status, $post_id, $postarr );
		}

		// Keep the previous name (never the junk WordPress derived from the title).
		$data['post_name'] = self::is_valid_slug( $previous ) ? $previous : '';

		$publishing = in_array( $status, array( 'publish', 'future', 'private' ), true );
		if ( $publishing ) {
			$data['post_status'] = 'draft';
			self::$forced_draft  = true;
		}

		if ( 'empty' === $problem ) {
			if ( $publishing ) {
				self::flash( 'error', '代稱是必填欄位。請填入代稱後再發布；活動已存為草稿。' );
			}
		} elseif ( 'invalid' === $problem ) {
			self::flash(
				'error',
				sprintf(
					'代稱「%s」格式不正確：只能使用小寫英文字母、數字與連字號，不可以連字號開頭或結尾，最多 100 個字元。%s',
					self::shorten( $raw, 60 ),
					$publishing ? '活動已存為草稿。' : '代稱沒有被儲存。'
				)
			);
		} else {
			self::flash(
				'error',
				sprintf(
					'代稱「%s」已被另一場活動使用，請改用其他代稱。%s',
					$raw,
					$publishing ? '活動已存為草稿。' : '代稱沒有被儲存。'
				)
			);
		}

		return self::require_title_and_start( $data, $status, $post_id, $postarr );
	}

	/**
	 * Publishing needs a title and a valid start time (spec 10.2, both required). Without them the event
	 * goes back to draft with a notice, the same way a bad 代稱 does. Drafts are never blocked.
	 *
	 * @param array  $data    Post data (post_status may already have been pulled back to draft).
	 * @param string $status  The status the save asked for.
	 * @param int    $post_id Post ID (0 for a programmatic insert).
	 * @param mixed  $postarr Sanitized post array.
	 * @return array
	 */
	private static function require_title_and_start( array $data, string $status, int $post_id, $postarr ): array {
		if ( ! in_array( $status, array( 'publish', 'future', 'private' ), true ) ) {
			return $data;
		}

		$problems = array();
		if ( '' === trim( wp_strip_all_tags( isset( $data['post_title'] ) ? (string) $data['post_title'] : '' ) ) ) {
			$problems[] = '活動標題是必填欄位。請填入標題後再發布；活動已存為草稿。';
		}
		if ( ! self::will_have_start_time( $post_id, is_array( $postarr ) ? $postarr : array() ) ) {
			$problems[] = '開始時間是必填欄位。請設定有效的開始時間後再發布；活動已存為草稿。';
		}
		if ( empty( $problems ) ) {
			return $data;
		}

		$data['post_status'] = 'draft';
		self::$forced_draft  = true;
		foreach ( $problems as $message ) {
			self::flash( 'error', $message );
		}
		return $data;
	}

	/**
	 * Will this event have a valid start time once the save finishes? The meta is written after the post
	 * data filter runs, so this mirrors what save_post() is about to store.
	 *
	 * - Our meta box form: a blank field clears the time; a malformed one keeps the stored time.
	 * - A programmatic insert (no ID yet) writes its meta afterwards, so nothing can be checked here: pass.
	 *   public_event() and the list column still keep such a row off the front end and flag it.
	 * - Any other update (Quick Edit, bulk edit, wp_update_post): the stored time.
	 *
	 * @param int   $post_id Post ID.
	 * @param array $postarr Sanitized post array.
	 * @return bool
	 */
	private static function will_have_start_time( int $post_id, array $postarr ): bool {
		$key = self::META_PREFIX . 'starts_at_utc';
		if ( isset( $postarr['meta_input'] ) && is_array( $postarr['meta_input'] ) && array_key_exists( $key, $postarr['meta_input'] ) ) {
			return '' !== self::clean_utc( is_string( $postarr['meta_input'][ $key ] ) ? $postarr['meta_input'][ $key ] : '' );
		}
		if ( $post_id <= 0 ) {
			return true;
		}

		$stored = self::clean_utc( self::meta( $post_id, 'starts_at_utc' ) );
		if ( ! self::has_valid_nonce( $post_id ) ) {
			return '' !== $stored;
		}
		$fields = self::posted_fields();
		if ( ! isset( $fields['starts_local'] ) || ! is_string( $fields['starts_local'] ) ) {
			return '' !== $stored;
		}
		$local = trim( $fields['starts_local'] );
		if ( '' === $local ) {
			return false;
		}
		$timezone = self::meta( $post_id, 'display_timezone' );
		if ( isset( $fields['display_timezone'] ) && is_string( $fields['display_timezone'] ) && self::is_valid_timezone( trim( $fields['display_timezone'] ) ) ) {
			$timezone = trim( $fields['display_timezone'] );
		} elseif ( ! self::is_valid_timezone( $timezone ) ) {
			$timezone = self::DEFAULT_TIMEZONE;
		}
		if ( '' !== self::local_to_utc( $local, $timezone ) ) {
			return true;
		}
		return '' !== $stored; // Malformed input: save_post() keeps the old time.
	}

	/**
	 * The slug typed into our meta box, or null when this request is not our (verified) form.
	 *
	 * @param int $post_id Post being saved.
	 * @return string|null
	 */
	private static function posted_slug( int $post_id ): ?string {
		if ( ! self::has_valid_nonce( $post_id ) ) {
			return null;
		}
		$fields = self::posted_fields();
		if ( ! array_key_exists( 'slug', $fields ) || ! is_string( $fields['slug'] ) ) {
			return null;
		}
		return $fields['slug'];
	}

	/**
	 * Does this request carry a valid nonce from our meta box for this post?
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 */
	private static function has_valid_nonce( int $post_id ): bool {
		if ( $post_id <= 0 || ! isset( $_POST[ self::NONCE_NAME ] ) || ! is_string( $_POST[ self::NONCE_NAME ] ) ) {
			return false;
		}
		if ( ! isset( $_POST['post_ID'] ) || (int) $_POST['post_ID'] !== $post_id ) {
			return false;
		}
		$nonce = sanitize_text_field( wp_unslash( $_POST[ self::NONCE_NAME ] ) );
		return false !== wp_verify_nonce( $nonce, self::NONCE_ACTION . $post_id );
	}

	/**
	 * The unslashed array of posted event fields (empty when absent). Call only after the nonce check.
	 *
	 * @return array
	 */
	private static function posted_fields(): array {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- callers verify the nonce first.
		if ( ! isset( $_POST[ self::FIELD_KEY ] ) || ! is_array( $_POST[ self::FIELD_KEY ] ) ) {
			return array();
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized field by field in save_post().
		return wp_unslash( $_POST[ self::FIELD_KEY ] );
	}

	/**
	 * Does another event (any status except trash and auto-draft) already use this slug?
	 *
	 * @param string $slug    Slug.
	 * @param int    $exclude Post ID to ignore.
	 * @return bool
	 */
	private static function slug_in_use( string $slug, int $exclude ): bool {
		global $wpdb;
		$found = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = %s AND ID <> %d AND post_status NOT IN ('trash', 'auto-draft') LIMIT 1",
				self::POST_TYPE,
				$slug,
				$exclude
			)
		);
		return null !== $found && '' !== $found;
	}

	/**
	 * After a forced draft, make the redirect say "draft saved" instead of "published".
	 *
	 * @param string $location Redirect URL.
	 * @param int    $post_id  Post ID.
	 * @return string
	 */
	public static function filter_redirect_location( $location, $post_id ) {
		if ( self::$forced_draft && self::POST_TYPE === get_post_type( (int) $post_id ) ) {
			$location = add_query_arg( 'message', 10, $location );
		}
		return $location;
	}

	/* ------------------------------------------------------------------ */
	/* Save                                                                 */
	/* ------------------------------------------------------------------ */

	/**
	 * Save the meta box fields.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 * @return void
	 */
	public static function save_post( $post_id, $post = null ): void {
		// Quick Edit, REST and programmatic saves do not carry our nonce: nothing to do.
		if ( ! isset( $_POST[ self::NONCE_NAME ] ) ) {
			return;
		}
		$post_id = (int) $post_id;
		if ( ! self::has_valid_nonce( $post_id ) ) {
			return;
		}
		if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || wp_is_post_revision( $post_id ) ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$in = self::posted_fields();
		$p  = self::META_PREFIX;

		// Lists.
		update_post_meta( $post_id, $p . 'performers', self::text_lines( isset( $in['performers'] ) ? $in['performers'] : '', 50, 100 ) );
		update_post_meta( $post_id, $p . 'programme', self::text_lines( isset( $in['programme'] ) ? $in['programme'] : '', 100, 200 ) );
		update_post_meta( $post_id, $p . 'description', self::text_block( isset( $in['description'] ) ? $in['description'] : '', 5000 ) );

		// Time zone, then start time (needs the zone).
		$timezone = self::meta( $post_id, 'display_timezone' );
		if ( ! self::is_valid_timezone( $timezone ) ) {
			$timezone = self::DEFAULT_TIMEZONE;
		}
		if ( isset( $in['display_timezone'] ) && is_string( $in['display_timezone'] ) ) {
			$candidate = trim( $in['display_timezone'] );
			if ( self::is_valid_timezone( $candidate ) ) {
				$timezone = $candidate;
			} else {
				self::flash( 'warning', sprintf( '時區「%s」不是有效的 IANA 時區，已沿用「%s」。', self::shorten( $candidate, 60 ), $timezone ) );
			}
		}
		update_post_meta( $post_id, $p . 'display_timezone', $timezone );

		if ( isset( $in['starts_local'] ) && is_string( $in['starts_local'] ) ) {
			$local = trim( $in['starts_local'] );
			if ( '' === $local ) {
				update_post_meta( $post_id, $p . 'starts_at_utc', '' );
				if ( 'publish' === get_post_status( $post_id ) ) {
					self::flash( 'warning', '這場活動尚未設定開始時間，設定之前不會顯示在前台。' );
				}
			} else {
				$utc = self::local_to_utc( $local, $timezone );
				if ( '' === $utc ) {
					self::flash( 'error', sprintf( '開始時間「%s」格式不正確，已保留原本的時間。', self::shorten( $local, 40 ) ) );
				} else {
					update_post_meta( $post_id, $p . 'starts_at_utc', $utc );
				}
			}
		}

		// Whitelists.
		$statuses = self::status_labels();
		$status   = isset( $in['status'] ) && is_string( $in['status'] ) ? $in['status'] : '';
		if ( isset( $statuses[ $status ] ) ) {
			update_post_meta( $post_id, $p . 'status', $status );
		} else {
			self::flash( 'warning', '活動狀態不在允許的清單內，已保留原本的狀態。' );
		}
		update_post_meta( $post_id, $p . 'media_kind', isset( $in['media_kind'] ) && 'audio' === $in['media_kind'] ? 'audio' : 'video' );
		update_post_meta( $post_id, $p . 'available_modes', self::clean_modes( isset( $in['available_modes'] ) ? $in['available_modes'] : array() ) );

		// Flags and source.
		$is_demo = ! empty( $in['is_demo'] );
		update_post_meta( $post_id, $p . 'is_demo', $is_demo ? '1' : '0' );
		update_post_meta( $post_id, $p . 'replay_available', ! empty( $in['replay_available'] ) ? '1' : '0' );

		$source = isset( $in['source_type'] ) && is_string( $in['source_type'] ) ? $in['source_type'] : 'not_configured';
		if ( 'demo' === $source && ! $is_demo ) {
			self::flash( 'warning', '來源類型「示範」需要同時勾選「示範活動」，已改存為「尚未設定」。' );
			$source = 'not_configured';
		} elseif ( 'hls' === $source && $is_demo ) {
			self::flash( 'warning', '示範活動只能使用「示範」來源，已改存為「尚未設定」。' );
			$source = 'not_configured';
		} elseif ( 'iframe' === $source ) {
			self::flash( 'warning', '串流服務播放器（iframe）尚未開放，已改存為「尚未設定」。' );
			$source = 'not_configured';
		} elseif ( 'demo' !== $source && 'hls' !== $source ) {
			$source = 'not_configured';
		}
		update_post_meta( $post_id, $p . 'source_type', $source );

		// HLS playlists (M2-PLAN B1): https on an admin-approved host; a refused value keeps the old one.
		foreach ( array( 'binaural', 'atmos' ) as $mode ) {
			$field = 'source_hls_' . $mode;
			if ( ! isset( $in[ $field ] ) || ! is_string( $in[ $field ] ) ) {
				continue;
			}
			$url = trim( $in[ $field ] );
			if ( '' === $url ) {
				update_post_meta( $post_id, $p . $field, '' );
				continue;
			}
			$error = self::stream_url_error( $url );
			if ( '' !== $error ) {
				self::flash( 'error', $error );
				continue;
			}
			update_post_meta( $post_id, $p . $field, $url );
		}

		// Product.
		$product_id = isset( $in['product_id'] ) ? absint( $in['product_id'] ) : 0;
		if ( $product_id > 0 && 'product' !== get_post_type( $product_id ) ) {
			self::flash( 'warning', sprintf( '商品 ID %d 不是這個網站上的商品；購票連結將改用下方填寫的網址。請確認此環境的商品 ID。', $product_id ) );
		}
		update_post_meta( $post_id, $p . 'product_id', $product_id );

		if ( isset( $in['product_url'] ) && is_string( $in['product_url'] ) ) {
			$url = trim( $in['product_url'] );
			if ( '' === $url ) {
				update_post_meta( $post_id, $p . 'product_url', '' );
			} else {
				$clean = self::clean_http_url( $url );
				if ( '' === $clean ) {
					self::flash( 'error', '購票連結必須是 http 或 https 網址，已保留原本的連結。' );
				} else {
					update_post_meta( $post_id, $p . 'product_url', $clean );
				}
			}
		}

		if ( 'publish' === get_post_status( $post_id ) && empty( self::clean_modes( isset( $in['available_modes'] ) ? $in['available_modes'] : array() ) ) ) {
			self::flash( 'info', '尚未勾選任何聆聽模式，前台會顯示「即將開放」。' );
		}

		// Homepage featured card (0.2.0). Unticking clears it only when this event is the featured one and the
		// form had the box (a screen opened before 0.2.0 has none and must not clear it).
		$featured = (int) Settings::get()['featured_event'];
		if ( ! empty( $in['featured'] ) ) {
			if ( $featured !== $post_id && ! Settings::set_featured_event( $post_id ) ) {
				self::flash( 'error', '無法設為首頁精選，請重新整理頁面後再試一次。' );
			} elseif ( 'publish' !== get_post_status( $post_id ) ) {
				self::flash( 'warning', '這場活動已設為首頁精選，但尚未發布；發布之前首頁不會顯示它。' );
			}
		} elseif ( $featured === $post_id && ! empty( $in['featured_shown'] ) ) {
			Settings::set_featured_event( 0 );
		}
	}

	/* ------------------------------------------------------------------ */
	/* List columns                                                         */
	/* ------------------------------------------------------------------ */

	/**
	 * Columns of the event list.
	 *
	 * @param array $columns Default columns.
	 * @return array
	 */
	public static function list_columns( $columns ): array {
		$out = array();
		if ( isset( $columns['cb'] ) ) {
			$out['cb'] = $columns['cb'];
		}
		$out['title']         = '活動';
		$out['wg_live_slug']  = '代稱';
		$out['wg_live_start'] = '開始時間';
		$out['wg_live_state'] = '活動狀態';
		$out['wg_live_demo']  = '示範';
		$out['wg_live_src']   = '來源';
		$out['wg_live_home']  = '首頁精選';
		if ( isset( $columns['date'] ) ) {
			$out['date'] = $columns['date'];
		}
		return $out;
	}

	/**
	 * Cell content for the custom columns.
	 *
	 * @param string $column  Column key.
	 * @param int    $post_id Post ID.
	 * @return void
	 */
	public static function list_column_content( $column, $post_id ): void {
		$post = get_post( (int) $post_id );
		if ( ! $post instanceof WP_Post ) {
			return;
		}
		$data = self::get_event_data( $post );

		switch ( $column ) {
			case 'wg_live_slug':
				if ( self::is_valid_slug( $post->post_name ) ) {
					printf( '<code>%s</code> <span class="wg-live-admin__flag wg-live-admin__flag--ok">有效</span>', esc_html( $post->post_name ) );
				} else {
					$shown = '' === (string) $post->post_name ? '（未設定）' : self::shorten( rawurldecode( (string) $post->post_name ), 30 );
					printf( '<code>%s</code> <span class="wg-live-admin__flag wg-live-admin__flag--bad">無效：不會公開</span>', esc_html( $shown ) );
				}
				break;
			case 'wg_live_start':
				if ( '' === $data['starts_at_utc'] ) {
					if ( 'publish' === $post->post_status ) {
						echo '— <span class="wg-live-admin__flag wg-live-admin__flag--bad">未設定：不會公開</span>';
					} else {
						echo '—';
					}
					break;
				}
				try {
					$utc = new DateTimeImmutable( $data['starts_at_utc'], new DateTimeZone( 'UTC' ) );
					echo esc_html( $utc->setTimezone( new DateTimeZone( $data['display_timezone'] ) )->format( 'Y-m-d H:i' ) . ' ' . $data['display_timezone'] );
				} catch ( \Exception $e ) {
					echo '—';
				}
				break;
			case 'wg_live_state':
				$labels = self::status_labels();
				echo esc_html( $labels[ $data['status'] ] );
				break;
			case 'wg_live_demo':
				echo $data['is_demo'] ? '是' : '—';
				break;
			case 'wg_live_src':
				if ( 'hls' === $data['source_type'] ) {
					echo 'HLS 串流';
				} elseif ( 'demo' !== $data['source_type'] ) {
					echo '尚未設定';
				} else {
					echo 'audio' === $data['media_kind'] ? '示範音訊' : '示範影片';
				}
				break;
			case 'wg_live_home':
				echo (int) Settings::get()['featured_event'] === (int) $post->ID ? '<span class="wg-live-admin__flag wg-live-admin__flag--ok">首頁精選</span>' : '—';
				break;
		}
	}

	/* ------------------------------------------------------------------ */
	/* Notices that survive a redirect                                      */
	/* ------------------------------------------------------------------ */

	/**
	 * Queue an admin notice for the current user (shown on the next admin page).
	 *
	 * @param string $type    error|warning|info|success.
	 * @param string $message Plain text.
	 * @return void
	 */
	public static function flash( string $type, string $message ): void {
		$user = get_current_user_id();
		if ( $user <= 0 ) {
			return;
		}
		if ( ! in_array( $type, array( 'error', 'warning', 'info', 'success' ), true ) ) {
			$type = 'info';
		}
		$key   = self::NOTICE_TRANSIENT . $user;
		$queue = get_transient( $key );
		if ( ! is_array( $queue ) ) {
			$queue = array();
		}
		foreach ( $queue as $item ) {
			if ( is_array( $item ) && isset( $item[1] ) && $item[1] === $message ) {
				return;
			}
		}
		$queue[] = array( $type, $message );
		set_transient( $key, array_slice( $queue, -20 ), 5 * MINUTE_IN_SECONDS );
	}

	/**
	 * Print and clear the queued notices.
	 *
	 * @return void
	 */
	public static function print_notices(): void {
		$user = get_current_user_id();
		if ( $user <= 0 ) {
			return;
		}
		$key   = self::NOTICE_TRANSIENT . $user;
		$queue = get_transient( $key );
		if ( ! is_array( $queue ) || empty( $queue ) ) {
			return;
		}
		delete_transient( $key );
		foreach ( $queue as $item ) {
			if ( ! is_array( $item ) || ! isset( $item[0], $item[1] ) ) {
				continue;
			}
			printf(
				'<div class="notice notice-%1$s is-dismissible"><p>%2$s</p></div>',
				esc_attr( (string) $item[0] ),
				esc_html( (string) $item[1] )
			);
		}
	}

	/* ------------------------------------------------------------------ */
	/* Value helpers                                                        */
	/* ------------------------------------------------------------------ */

	/**
	 * A stored meta value as a string.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $key     Key without prefix.
	 * @return string
	 */
	private static function meta( int $post_id, string $key ): string {
		if ( $post_id <= 0 ) {
			return '';
		}
		$value = get_post_meta( $post_id, self::META_PREFIX . $key, true );
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * A stored boolean ('1' / '0', also true / 1).
	 *
	 * @param int    $post_id Post ID.
	 * @param string $key     Key without prefix.
	 * @return bool
	 */
	private static function meta_bool( int $post_id, string $key ): bool {
		if ( $post_id <= 0 ) {
			return false;
		}
		$value = get_post_meta( $post_id, self::META_PREFIX . $key, true );
		return true === $value || 1 === $value || '1' === $value;
	}

	/**
	 * A stored list of strings.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $key     Key without prefix.
	 * @return string[]
	 */
	private static function meta_list( int $post_id, string $key ): array {
		if ( $post_id <= 0 ) {
			return array();
		}
		$value = get_post_meta( $post_id, self::META_PREFIX . $key, true );
		if ( is_string( $value ) && '' !== $value ) {
			$value = array( $value );
		}
		if ( ! is_array( $value ) ) {
			return array();
		}
		$out = array();
		foreach ( $value as $item ) {
			if ( is_scalar( $item ) ) {
				$item = trim( (string) $item );
				if ( '' !== $item ) {
					$out[] = $item;
				}
			}
		}
		return $out;
	}

	/**
	 * Whitelist and order listening modes.
	 *
	 * @param mixed $value Stored or posted value.
	 * @return string[]
	 */
	private static function clean_modes( $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}
		$out = array();
		foreach ( array_keys( self::mode_labels() ) as $mode ) {
			if ( in_array( $mode, $value, true ) ) {
				$out[] = $mode;
			}
		}
		return $out;
	}

	/**
	 * A "Y-m-d\TH:i:s\Z" string, or '' when it is not a real UTC timestamp.
	 *
	 * @param string $value Candidate.
	 * @return string
	 */
	private static function clean_utc( string $value ): string {
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $value ) ) {
			return '';
		}
		$parsed = DateTimeImmutable::createFromFormat( 'Y-m-d\TH:i:s\Z', $value, new DateTimeZone( 'UTC' ) );
		if ( false === $parsed || $parsed->format( 'Y-m-d\TH:i:s\Z' ) !== $value ) {
			return '';
		}
		return $value;
	}

	/**
	 * Convert a datetime-local value in a zone to the stored UTC string ('' when invalid).
	 *
	 * @param string $local    "Y-m-d\TH:i" or "Y-m-d\TH:i:s".
	 * @param string $timezone IANA zone.
	 * @return string
	 */
	private static function local_to_utc( string $local, string $timezone ): string {
		try {
			$zone = new DateTimeZone( $timezone );
		} catch ( \Exception $e ) {
			return '';
		}
		foreach ( array( 'Y-m-d\TH:i', 'Y-m-d\TH:i:s' ) as $format ) {
			$parsed = DateTimeImmutable::createFromFormat( '!' . $format, $local, $zone );
			if ( false === $parsed || $parsed->format( $format ) !== $local ) {
				continue;
			}
			$year = (int) $parsed->format( 'Y' );
			if ( $year < 2000 || $year > 2100 ) {
				return '';
			}
			return $parsed->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d\TH:i:s\Z' );
		}
		return '';
	}

	/**
	 * Accept only absolute http(s) URLs. Returns '' when the value is not one.
	 *
	 * @param string $url Candidate.
	 * @return string
	 */
	public static function clean_http_url( string $url ): string {
		$url = trim( $url );
		if ( '' === $url || strlen( $url ) > 2048 || 1 !== preg_match( '#^https?://#i', $url ) ) {
			return '';
		}
		$clean = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( '' === $clean ) {
			return '';
		}
		$host = wp_parse_url( $clean, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $clean : '';
	}

	/**
	 * Split a textarea into a clean list of single-line strings.
	 *
	 * @param mixed $value      Posted value.
	 * @param int   $max_items  Maximum items.
	 * @param int   $max_length Maximum characters per item.
	 * @return string[]
	 */
	private static function text_lines( $value, int $max_items, int $max_length ): array {
		if ( ! is_string( $value ) ) {
			return array();
		}
		$out = array();
		// Not "\R": without the /u modifier it matches the byte 0x85, which is inside many CJK characters.
		foreach ( preg_split( '/\r\n|\r|\n/', $value ) as $line ) {
			$line = trim( sanitize_text_field( $line ) );
			if ( '' === $line ) {
				continue;
			}
			$out[] = self::shorten( $line, $max_length, '' );
			if ( count( $out ) >= $max_items ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Plain multi-line text (tags stripped, newlines kept, normalized to "\n").
	 *
	 * @param mixed $value      Posted value.
	 * @param int   $max_length Maximum characters.
	 * @return string
	 */
	private static function text_block( $value, int $max_length ): string {
		if ( ! is_string( $value ) ) {
			return '';
		}
		$value = str_replace( array( "\r\n", "\r" ), "\n", $value );
		return self::shorten( trim( sanitize_textarea_field( $value ) ), $max_length, '' );
	}

	/**
	 * Multibyte-safe truncation.
	 *
	 * @param string $value  Text.
	 * @param int    $length Maximum characters.
	 * @param string $suffix Appended when truncated.
	 * @return string
	 */
	private static function shorten( string $value, int $length, string $suffix = '…' ): string {
		if ( function_exists( 'mb_substr' ) && function_exists( 'mb_strlen' ) ) {
			return mb_strlen( $value, 'UTF-8' ) > $length ? mb_substr( $value, 0, $length, 'UTF-8' ) . $suffix : $value;
		}
		return strlen( $value ) > $length ? substr( $value, 0, $length ) . $suffix : $value;
	}
}
