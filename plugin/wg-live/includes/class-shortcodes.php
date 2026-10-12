<?php
/**
 * Shortcodes (plan 4.1, 3.1, 6.8, 6.10, spec 8.4).
 *
 *   [wg_live view="events|player|help" event="slug" heading="h1|h2"]
 *       The container for the TypeScript views: the JSON bootstrap, a noscript fallback, an empty live
 *       region and a fixed-height skeleton. Returns HTML, never echoes.
 *   [wg_live_featured]
 *       The homepage card, rendered entirely in PHP. No JavaScript, no player, no media.
 *
 * Every viewer-facing string used by the PHP templates lives in the constants below. They repeat
 * strings from src/i18n/copy-*.ts, and tests/unit/php-copy-sync.test.ts fails when the two drift.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Shortcode rendering.
 */
final class Shortcodes {

	/* ---- copy shared with src/i18n (kept in sync by tests/unit/php-copy-sync.test.ts) ---- */

	const DEMO_BADGE         = '介面示範';
	const DISABLED_TITLE     = '線上音樂會尚未開放';
	const DISABLED_DETAIL    = '請稍後再回來查看，或前往首頁。';
	const FEATURED_FALLBACK  = '線上音樂會資訊即將公布';
	const NOT_FOUND_TITLE    = '找不到這場活動';
	const NOT_FOUND_DETAIL   = '這場活動可能已下架，或連結有誤。';
	const BOOT_ERROR         = 'Live 介面暫時無法載入';
	const BOOT_ERROR_HINT    = '請重新整理頁面，或稍後再試。';
	const NOSCRIPT           = '需要啟用 JavaScript 才能使用線上音樂會。';
	const CTA_VIEW_DETAILS   = '查看活動資訊';
	const CTA_DEMO           = '體驗播放介面';
	const CTA_ENTER          = '進入聆聽';
	const CTA_VIEW_EVENT     = '查看活動';
	const REPLAY_PENDING     = '回放資訊待公布';
	const LINK_EVENTS        = '返回活動列表';
	const LINK_HELP          = '聆聽說明';
	const LINK_CONTACT       = '聯絡我們';
	const LINK_HOME          = '回首頁';
	const TIME_ZONE_TAIPEI   = '台北時間';

	/**
	 * Event status labels (statusCopy.eventStatus).
	 *
	 * @var array<string,string>
	 */
	const STATUS_LABELS = array(
		'scheduled'    => '尚未開始',
		'doors_open'   => '即將開放',
		'live'         => '演出中',
		'intermission' => '中場休息',
		'ended'        => '已結束',
		'cancelled'    => '已取消',
	);

	/* ---- PHP-only copy ---- */

	const LINK_LIVE          = '前往 Live';
	const DUPLICATE_PLAYER   = '同一個頁面只能放置一個播放器。';
	const NOTICE_BAD_VIEW    = '[wg_live] 的 view 屬性只能是 events、player 或 help。';

	/**
	 * Weekday characters, Sunday first.
	 *
	 * @var string[]
	 */
	const WEEKDAYS = array( '日', '一', '二', '三', '四', '五', '六' );

	/**
	 * Whitelisted views.
	 *
	 * @var string[]
	 */
	const VIEWS = array( 'events', 'player', 'help' );

	/**
	 * Has this request already rendered a player view? (plan 6.8)
	 *
	 * @var bool
	 */
	private static $player_rendered = false;

	/**
	 * Container counter for unique ids.
	 *
	 * @var int
	 */
	private static $instance_count = 0;

	/**
	 * Register the shortcodes and the cache-control hook.
	 *
	 * @return void
	 */
	public static function init() {
		add_shortcode( 'wg_live', array( __CLASS__, 'render_live' ) );
		add_shortcode( 'wg_live_featured', array( __CLASS__, 'render_featured' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_prevent_caching' ), 1 );
	}

	/* ------------------------------------------------------------------ */
	/* [wg_live]                                                           */
	/* ------------------------------------------------------------------ */

	/**
	 * [wg_live] callback.
	 *
	 * @param array|string $atts Shortcode attributes.
	 * @return string HTML.
	 */
	public static function render_live( $atts ) {
		$atts = shortcode_atts(
			array(
				'view'    => 'events',
				'event'   => '',
				'heading' => 'h2',
			),
			is_array( $atts ) ? $atts : array(),
			'wg_live'
		);

		$view = strtolower( trim( (string) $atts['view'] ) );
		if ( ! in_array( $view, self::VIEWS, true ) ) {
			return self::editor_notice( self::NOTICE_BAD_VIEW );
		}
		$heading = 'h1' === strtolower( trim( (string) $atts['heading'] ) ) ? 'h1' : 'h2';

		// The "event" attribute must name a publicly visible event. While the platform is disabled
		// nothing is public, so the attribute is not resolved and the client shows the disabled message.
		$fixed      = null;
		$event_attr = trim( (string) $atts['event'] );
		if ( '' !== $event_attr && Public_Data::is_enabled() ) {
			$post = Public_Data::find_event_by_slug( $event_attr );
			if ( null === $post ) {
				return self::render_message( $view, self::NOT_FOUND_TITLE, self::NOT_FOUND_DETAIL );
			}
			$fixed = (string) $post->post_name;
		}

		// One player per page: a second player view is replaced by a notice.
		if ( 'player' === $view ) {
			if ( self::$player_rendered ) {
				return self::render_message( $view, self::DUPLICATE_PLAYER, null );
			}
		}

		// A missing build is a readable message, never a fatal error.
		if ( ! Assets::enqueue_app() ) {
			return self::render_message( $view, self::BOOT_ERROR, self::BOOT_ERROR_HINT );
		}
		if ( 'player' === $view ) {
			self::$player_rendered = true;
		}

		if ( Plugin::dev_tools_enabled() ) {
			self::prevent_caching();
		}

		$config = Public_Data::boot_config( $view, $fixed, $heading );
		++self::$instance_count;

		return self::load_template(
			$view,
			array(
				'view'        => $view,
				'id'          => 'wg-live-' . self::$instance_count,
				'config_json' => Public_Data::encode_config( $config ),
				'noscript'    => self::noscript_model( $view, $config ),
			)
		);
	}

	/**
	 * Content of the <noscript> fallback: a message and plain links.
	 *
	 * @param string $view   View.
	 * @param array  $config Bootstrap config.
	 * @return array{message:string,detail:?string,links:array<int,array{href:string,label:string}>}
	 */
	private static function noscript_model( $view, array $config ) {
		$links   = $config['links'];
		$enabled = 'demo' === $config['deploymentMode'];
		$items   = array();

		if ( $enabled ) {
			if ( 'events' !== $view ) {
				$items[] = array( $links['events'], self::LINK_EVENTS );
			}
		} else {
			$items[] = array( $links['home'], self::LINK_HOME );
		}
		if ( 'help' !== $view ) {
			$items[] = array( $links['help'], self::LINK_HELP );
		}
		$items[] = array( $links['contact'], self::LINK_CONTACT );

		$out = array();
		foreach ( $items as $item ) {
			if ( is_string( $item[0] ) && '' !== $item[0] ) {
				$out[] = array(
					'href'  => $item[0],
					'label' => $item[1],
				);
			}
		}

		if ( ! $enabled && 'help' !== $view ) {
			return array(
				'message' => self::DISABLED_TITLE,
				'detail'  => self::DISABLED_DETAIL,
				'links'   => $out,
			);
		}
		return array(
			'message' => self::NOSCRIPT,
			'detail'  => null,
			'links'   => $out,
		);
	}

	/* ------------------------------------------------------------------ */
	/* [wg_live_featured]                                                  */
	/* ------------------------------------------------------------------ */

	/**
	 * [wg_live_featured] callback. Server-rendered, no JavaScript.
	 *
	 * @param array|string $atts Shortcode attributes.
	 * @return string HTML.
	 */
	public static function render_featured( $atts ) {
		$atts = shortcode_atts(
			array( 'heading' => 'h2' ),
			is_array( $atts ) ? $atts : array(),
			'wg_live_featured'
		);
		$heading = strtolower( trim( (string) $atts['heading'] ) );
		$heading = in_array( $heading, array( 'h2', 'h3' ), true ) ? $heading : 'h2';

		// Late fallback for pages the request-time check did not recognize (for example a card inside an Elementor widget).
		Assets::enqueue_featured();

		++self::$instance_count;
		$model            = self::featured_model();
		$model['heading'] = $heading;
		$model['id']      = 'wg-live-featured-' . self::$instance_count;

		return self::load_template( 'featured', $model );
	}

	/**
	 * View model of the featured card (plan 6.10).
	 *
	 * state "disabled": text only. state "empty": fallback text plus a link to Live.
	 * state "event": the card.
	 *
	 * @return array
	 */
	public static function featured_model() {
		$links = Site_Links::all();
		$model = array(
			'state'    => 'empty',
			'fallback' => self::FEATURED_FALLBACK,
			'live_url' => $links['events'],
			'live'     => self::LINK_LIVE,
		);

		if ( ! Public_Data::is_enabled() ) {
			$model['state']    = 'disabled';
			$model['live_url'] = null;
			return $model;
		}

		$event = Public_Data::featured_event();
		if ( null === $event ) {
			return $model;
		}

		$status = $event['status'];
		$cta    = self::primary_cta( $event, $links );

		$model['state']           = 'event';
		$model['title']           = $event['title'];
		$model['is_demo']         = $event['isDemo'];
		$model['demo_badge']      = self::DEMO_BADGE;
		$model['status']          = $status;
		$model['status_label']    = self::STATUS_LABELS[ $status ];
		$model['time']            = self::format_time( $event['startsAt'], $event['displayTimezone'] );
		$model['machine_time']    = $event['startsAt'];
		$model['text']            = self::excerpt( $event['description'], 80 );
		$model['poster']          = $event['poster'];
		$model['cta']             = $cta;
		$model['replay_pending']  = ( 'ended' === $status && $event['replayAvailable'] ) ? self::REPLAY_PENDING : null;
		return $model;
	}

	/**
	 * Primary CTA, the first matching row of the plan 6.1 table wins.
	 * The featured card cannot expand details, so those rows link to the events page.
	 *
	 * @param array $event PublicEvent.
	 * @param array $links Site links.
	 * @return array{label:string,href:?string}
	 */
	public static function primary_cta( array $event, array $links ) {
		$status = $event['status'];
		$player = Site_Links::player_url( $event['slug'] );
		$player = '' === $player ? null : $player;

		if ( 'cancelled' === $status || 'ended' === $status ) {
			return array(
				'label' => self::CTA_VIEW_DETAILS,
				'href'  => $links['events'],
			);
		}
		if ( ! empty( $event['isDemo'] ) && 'demo' === $event['sourceKind'] ) {
			return array(
				'label' => self::CTA_DEMO,
				'href'  => $player,
			);
		}
		if ( 'doors_open' === $status || 'live' === $status || 'intermission' === $status ) {
			return array(
				'label' => self::CTA_ENTER,
				'href'  => $player,
			);
		}
		return array(
			'label' => self::CTA_VIEW_EVENT,
			'href'  => $links['events'],
		);
	}

	/**
	 * Event time in the event's own zone, e.g. 2026年10月24日（六）19:30 台北時間 (plan 6.1).
	 *
	 * @param string $iso  ISO 8601 UTC.
	 * @param string $zone IANA zone.
	 * @return array{date:string,time:string,zone:string,full:string}
	 */
	public static function format_time( $iso, $zone ) {
		$zone = Public_Data::is_known_zone( $zone ) ? $zone : Public_Data::DEFAULT_ZONE;
		$tz   = new \DateTimeZone( $zone );
		$ts   = strtotime( (string) $iso );
		if ( false === $ts ) {
			return array(
				'date' => '',
				'time' => '',
				'zone' => '',
				'full' => '',
			);
		}

		$weekday = self::WEEKDAYS[ (int) wp_date( 'w', $ts, $tz ) ];
		$date    = wp_date( 'Y', $ts, $tz ) . '年' . wp_date( 'n', $ts, $tz ) . '月' . wp_date( 'j', $ts, $tz ) . '日（' . $weekday . '）';
		$time    = wp_date( 'H:i', $ts, $tz );
		$label   = ( 'Asia/Taipei' === $zone ) ? self::TIME_ZONE_TAIPEI : (string) wp_date( 'T', $ts, $tz );

		return array(
			'date' => $date,
			'time' => $time,
			'zone' => $label,
			'full' => $date . $time . ' ' . $label,
		);
	}

	/**
	 * Short plain text, at most $max characters including the ellipsis.
	 *
	 * @param string $text Plain text.
	 * @param int    $max  Maximum length.
	 * @return string
	 */
	public static function excerpt( $text, $max ) {
		$text = trim( (string) preg_replace( '/\s+/u', ' ', (string) $text ) );
		if ( mb_strlen( $text, 'UTF-8' ) <= $max ) {
			return $text;
		}
		return rtrim( mb_substr( $text, 0, $max - 1, 'UTF-8' ) ) . '…';
	}

	/* ------------------------------------------------------------------ */
	/* Caching                                                             */
	/* ------------------------------------------------------------------ */

	/**
	 * Tell page caches not to store this response (plan D17: responses rendered with dev tools on).
	 *
	 * @return void
	 */
	public static function prevent_caching() {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		if ( ! headers_sent() ) {
			nocache_headers();
		}
	}

	/**
	 * template_redirect: send the no-cache headers before output starts, on the pages that will
	 * render the dev panel. Does nothing unless dev tools are enabled for this request.
	 *
	 * @return void
	 */
	public static function maybe_prevent_caching() {
		if ( ! Plugin::dev_tools_enabled() ) {
			return;
		}
		$ids = Assets::bound_page_ids();
		$hit = ! empty( $ids ) && is_page( $ids );
		if ( ! $hit && is_singular() ) {
			$post = get_queried_object();
			$hit  = $post instanceof \WP_Post && has_shortcode( $post->post_content, 'wg_live' );
		}
		if ( $hit ) {
			self::prevent_caching();
		}
	}

	/* ------------------------------------------------------------------ */
	/* Output helpers                                                      */
	/* ------------------------------------------------------------------ */

	/**
	 * Protect already-escaped HTML text from a second shortcode pass.
	 *
	 * Page builders (Elementor) run do_shortcode() again over a Shortcode widget's output. A bare [tag]
	 * typed into an event title or poster alt text would be expanded there, so the brackets become
	 * HEX character references, which browsers render as the same characters. Not the decimal
	 * &#91;/&#93;: do_shortcode() ends with unescape_invalid_shortcodes(), which turns exactly those back
	 * into [ and ] across the whole output, so they would not survive the very pass they guard against.
	 *
	 * @param string $escaped Output of esc_html() / esc_attr() / esc_url().
	 * @return string
	 */
	public static function defuse_brackets( $escaped ) {
		return str_replace( array( '[', ']' ), array( '&#x5B;', '&#x5D;' ), (string) $escaped );
	}

	/**
	 * Render a template and return the HTML.
	 *
	 * @param string $name Template name (events|player|help|featured).
	 * @param array  $args Template arguments.
	 * @return string
	 */
	private static function load_template( $name, array $args ) {
		$file = WG_LIVE_DIR . 'templates/' . $name . '.php';
		if ( ! in_array( $name, array( 'events', 'player', 'help', 'featured' ), true ) || ! is_readable( $file ) ) {
			return '';
		}
		ob_start();
		include $file;
		$html = (string) ob_get_clean();
		// Drop the indentation between tags so content filters that run later find nothing to rewrite.
		return trim( (string) preg_replace( '/>\s*\n\s*</', '><', $html ) );
	}

	/**
	 * A static message in the container, without a mount point (the client ignores it).
	 *
	 * @param string      $view   View.
	 * @param string      $title  Message.
	 * @param string|null $detail Second line.
	 * @return string
	 */
	private static function render_message( $view, $title, $detail ) {
		$html  = '<div class="wg-live wg-live--' . esc_attr( $view ) . '"><div class="wg-live__boot-error">';
		$html .= '<p class="wg-live__boot-error-title">' . esc_html( $title ) . '</p>';
		if ( null !== $detail && '' !== $detail ) {
			$html .= '<p class="wg-live__boot-error-hint">' . esc_html( $detail ) . '</p>';
		}
		return $html . '</div></div>';
	}

	/**
	 * A hint for people who can edit the page (an invalid shortcode attribute). Visitors see nothing.
	 *
	 * @param string $message Message.
	 * @return string
	 */
	private static function editor_notice( $message ) {
		if ( ! current_user_can( Plugin::cap() ) ) {
			return '';
		}
		return '<p>' . esc_html( $message ) . '</p>';
	}
}
