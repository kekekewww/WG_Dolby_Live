<?php
/**
 * Public data: the PublicEvent whitelist, the REST routes (plan 5) and the page bootstrap (plan 3.1).
 *
 * Nothing here ever carries a source URL, a credential, user data or raw post meta. Every place
 * that exposes an event goes through Events::is_public(), and everything is empty while the
 * deployment mode is "disabled" (plan D16).
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Public events, REST routes and the bootstrap config.
 */
final class Public_Data {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	const REST_NAMESPACE = 'wg-live/v1';

	/**
	 * Cache-Control for the public event routes (plan 5). The data never varies by user.
	 *
	 * @var string
	 */
	const CACHE_PUBLIC = 'public, max-age=30';

	/**
	 * Listening modes.
	 *
	 * @var string[]
	 */
	const MODES = array( 'binaural', 'atmos' );

	/**
	 * Event statuses (spec 6 whitelist).
	 *
	 * @var string[]
	 */
	const STATUSES = array( 'scheduled', 'doors_open', 'live', 'intermission', 'ended', 'cancelled' );

	/**
	 * Default display zone.
	 *
	 * @var string
	 */
	const DEFAULT_ZONE = 'Asia/Taipei';

	/**
	 * Alt text of the bundled demo poster.
	 *
	 * @var string
	 */
	const DEMO_POSTER_ALT = '介面示範用海報（非實際活動）';

	/**
	 * Per-request cache of published_events().
	 *
	 * @var array|null
	 */
	private static $events_cache = null;

	/**
	 * Hook the REST routes.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/* ------------------------------------------------------------------ */
	/* Predicates                                                          */
	/* ------------------------------------------------------------------ */

	/**
	 * Is the platform switched on? Deployment mode "demo" is the only enabled mode in M1.
	 *
	 * @return bool
	 */
	public static function is_enabled() {
		$settings = Settings::get();
		return isset( $settings['deployment_mode'] ) && in_array( $settings['deployment_mode'], array( 'demo', 'live' ), true );
	}

	/**
	 * Is this a valid event slug? Delegates to the one shared check, Events::is_valid_slug()
	 * (shared pattern, 1-100 characters, strict end anchor so a trailing newline is rejected).
	 *
	 * @param mixed $slug Candidate.
	 * @return bool
	 */
	public static function is_valid_slug( $slug ) {
		return Events::is_valid_slug( $slug );
	}

	/**
	 * Is this an IANA time zone identifier PHP knows?
	 *
	 * @param mixed $zone Candidate.
	 * @return bool
	 */
	public static function is_known_zone( $zone ) {
		return Events::is_valid_timezone( $zone );
	}

	/**
	 * The slug pattern without anchors, for the REST route regex (WordPress adds its own).
	 *
	 * @return string
	 */
	public static function slug_route_pattern() {
		return trim( Events::SLUG_PATTERN, '^$' );
	}

	/**
	 * Find a publicly visible event by slug.
	 *
	 * @param mixed $slug Candidate slug.
	 * @return \WP_Post|null
	 */
	public static function find_event_by_slug( $slug ) {
		if ( ! self::is_valid_slug( $slug ) ) {
			return null;
		}
		$posts = get_posts(
			array(
				'post_type'           => Events::POST_TYPE,
				'name'                => $slug,
				'post_status'         => 'publish',
				'posts_per_page'      => 1,
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
			)
		);
		$post  = empty( $posts ) ? null : $posts[0];
		return ( $post instanceof \WP_Post && Events::is_public( $post ) ) ? $post : null;
	}

	/* ------------------------------------------------------------------ */
	/* PublicEvent                                                         */
	/* ------------------------------------------------------------------ */

	/**
	 * Map an event to the PublicEvent whitelist (src/types.ts).
	 *
	 * Returns null when the event is not public, or when it has no valid start time (the client
	 * cannot display such an event and drops it).
	 *
	 * @param \WP_Post $post Event post.
	 * @return array|null
	 */
	public static function public_event( $post ) {
		if ( ! $post instanceof \WP_Post || ! Events::is_public( $post ) ) {
			return null;
		}
		$data   = Events::get_event_data( $post );
		$starts = isset( $data['starts_at_utc'] ) ? (string) $data['starts_at_utc'] : '';
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $starts ) || false === strtotime( $starts ) ) {
			return null;
		}

		$status = isset( $data['status'] ) && in_array( $data['status'], self::STATUSES, true ) ? $data['status'] : 'scheduled';
		$zone   = isset( $data['display_timezone'] ) && self::is_known_zone( $data['display_timezone'] )
			? $data['display_timezone']
			: self::DEFAULT_ZONE;
		$modes  = array();
		if ( isset( $data['available_modes'] ) && is_array( $data['available_modes'] ) ) {
			foreach ( self::MODES as $mode ) {
				if ( in_array( $mode, $data['available_modes'], true ) ) {
					$modes[] = $mode;
				}
			}
		}

		$is_demo     = ! empty( $data['is_demo'] );
		$source_type = isset( $data['source_type'] ) ? $data['source_type'] : 'not_configured';
		// Plan D5: 'demo' only for a demo event with a demo source while the plugin is enabled. M2-PLAN B3: a
		// real event's own type (never its URL) only in deployment mode "live"; /playback still decides.
		$source_kind = 'not_configured';
		if ( $is_demo && 'demo' === $source_type && self::is_enabled() ) {
			$source_kind = 'demo';
		} elseif ( ! $is_demo && in_array( $source_type, array( 'hls', 'iframe' ), true ) && 'live' === Settings::get()['deployment_mode'] ) {
			$source_kind = $source_type;
		}

		$poster = self::poster( $post, $is_demo );

		return array(
			'id'              => (int) $post->ID,
			'slug'            => (string) $post->post_name,
			'title'           => self::plain_text( $post->post_title ),
			'performers'      => self::plain_list( isset( $data['performers'] ) ? $data['performers'] : array() ),
			'description'     => self::plain_text( isset( $data['description'] ) ? $data['description'] : '' ),
			'startsAt'        => $starts,
			'displayTimezone' => $zone,
			'status'          => $status,
			'posterUrl'       => null === $poster ? null : $poster['url'],
			'mediaKind'       => ( isset( $data['media_kind'] ) && 'audio' === $data['media_kind'] ) ? 'audio' : 'video',
			'availableModes'  => $modes,
			'programme'       => self::plain_list( isset( $data['programme'] ) ? $data['programme'] : array() ),
			'productUrl'      => self::product_url( $data ),
			'replayAvailable' => ! empty( $data['replay_available'] ),
			'isDemo'          => $is_demo,
			'poster'          => $poster,
			'sourceKind'      => $source_kind,
		);
	}

	/**
	 * Public events: honors is_enabled(), sorted by start time. Cached per request.
	 *
	 * @return array[]
	 */
	public static function published_events() {
		if ( ! self::is_enabled() ) {
			return array();
		}
		if ( null !== self::$events_cache ) {
			return self::$events_cache;
		}

		$posts  = get_posts(
			array(
				'post_type'           => Events::POST_TYPE,
				'post_status'         => 'publish',
				'posts_per_page'      => 100,
				'orderby'             => 'ID',
				'order'               => 'DESC',
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
			)
		);
		$events = array();
		foreach ( $posts as $post ) {
			$event = self::public_event( $post );
			if ( null !== $event ) {
				$events[] = $event;
			}
		}
		usort(
			$events,
			static function ( $a, $b ) {
				return strcmp( $a['startsAt'], $b['startsAt'] );
			}
		);

		self::$events_cache = $events;
		return $events;
	}

	/**
	 * The slug of the settings' featured event when it is public (and has a valid start), else null.
	 *
	 * @return string|null
	 */
	public static function featured_event_slug() {
		$event = self::featured_event();
		return null === $event ? null : $event['slug'];
	}

	/**
	 * The settings' featured event as a PublicEvent, else null.
	 *
	 * @return array|null
	 */
	public static function featured_event() {
		$settings = Settings::get();
		$id       = isset( $settings['featured_event'] ) ? (int) $settings['featured_event'] : 0;
		if ( $id <= 0 ) {
			return null;
		}
		foreach ( self::published_events() as $event ) {
			if ( $event['id'] === $id ) {
				return $event;
			}
		}
		return null;
	}

	/* ------------------------------------------------------------------ */
	/* Bootstrap config (plan 3.1, BootConfig in src/types.ts)             */
	/* ------------------------------------------------------------------ */

	/**
	 * Build the JSON bootstrap for one container.
	 *
	 * @param string      $view    events|player|help.
	 * @param string|null $slug    Slug fixed by the shortcode "event" attribute.
	 * @param string      $heading h1|h2.
	 * @return array
	 */
	public static function boot_config( $view, $slug, $heading ) {
		$enabled = self::is_enabled();
		$zone    = (string) get_option( 'timezone_string', '' );
		if ( ! self::is_known_zone( $zone ) ) {
			$zone = self::DEFAULT_ZONE;
		}

		return array(
			'schema'            => 1,
			'pluginVersion'     => WG_LIVE_VERSION,
			'view'              => $view,
			'deploymentMode'    => $enabled ? Settings::get()['deployment_mode'] : 'disabled',
			'timezone'          => $zone,
			'rest'              => array(
				'root'     => rest_url( self::REST_NAMESPACE . '/' ),
				// M2-PLAN A2: the wp_rest nonce for logged-in viewers; null for guests. nonceUrl refreshes it.
				'nonce'    => is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : null,
				'nonceUrl' => admin_url( 'admin-ajax.php?action=rest-nonce' ),
			),
			// M2-PLAN C1: hls.js is its own file, loaded by the player only for an hls source.
			'assets'            => array(
				'hls' => Assets::script_url( 'wg-live-hls.js' ),
			),
			'links'             => Site_Links::all(),
			'fixedEventSlug'    => ( $enabled && self::is_valid_slug( $slug ) ) ? $slug : null,
			'featuredEventSlug' => $enabled ? self::featured_event_slug() : null,
			'heading'           => 'h1' === $heading ? 'h1' : 'h2',
			'events'            => self::published_events(),
			'help'              => self::help_content(),
			'devTools'          => Plugin::dev_tools_enabled(),
		);
	}

	/**
	 * Encode a bootstrap for <script type="application/json"> (plan 3.1 flags).
	 *
	 * Extra, still valid-JSON escapes protect the data from the_content filters that run after
	 * shortcodes: literal spaces and no-break spaces become \u escapes, so convert_smilies()
	 * (which needs whitespace around a smiley) cannot rewrite text inside the JSON, and square
	 * brackets inside strings become \u005b and \u005d, so a second do_shortcode() pass finds no [tag].
	 *
	 * @param array $config Bootstrap.
	 * @return string
	 */
	public static function encode_config( array $config ) {
		$json = wp_json_encode(
			$config,
			JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE
		);
		if ( ! is_string( $json ) ) {
			return '{}';
		}
		$json = str_replace( array( ' ', chr( 0xC2 ) . chr( 0xA0 ) ), array( '\u0020', '\u00a0' ), $json );

		// Page builders (Elementor) run do_shortcode() a second time over a Shortcode widget's output, which
		// would expand a bare [tag] typed into a title or FAQ answer. Inside JSON string literals the brackets
		// become \u005b and \u005d (valid JSON, same decoded value). JSON_HEX_QUOT guarantees that a string
		// literal holds no raw double quote, so the pattern cannot run past the end of a string. The
		// structural [ ] of arrays are outside string literals and stay as they are.
		$escaped = preg_replace_callback(
			'/"[^"]*"/',
			static function ( array $m ) {
				return str_replace( array( '[', ']' ), array( '\u005b', '\u005d' ), $m[0] );
			},
			$json
		);
		return is_string( $escaped ) ? $escaped : $json;
	}

	/**
	 * HelpContent from the settings (faq, compatibility table, support note).
	 *
	 * @return array{faq:array,compatibility:array,supportNote:string}
	 */
	public static function help_content() {
		$settings = Settings::get();

		$faq = array();
		if ( isset( $settings['faq'] ) && is_array( $settings['faq'] ) ) {
			foreach ( $settings['faq'] as $item ) {
				if ( ! is_array( $item ) || empty( $item['question'] ) || ! isset( $item['answer'] ) ) {
					continue;
				}
				$question = self::plain_text( $item['question'] );
				if ( '' === $question ) {
					continue;
				}
				$faq[] = array(
					'question' => $question,
					'answer'   => self::plain_text( $item['answer'] ),
				);
			}
		}

		$compatibility = array();
		if ( isset( $settings['compatibility'] ) && is_array( $settings['compatibility'] ) ) {
			foreach ( $settings['compatibility'] as $row ) {
				if ( is_array( $row ) ) {
					$compatibility[] = self::compatibility_row( $row );
				}
			}
		}

		return array(
			'faq'           => $faq,
			'compatibility' => $compatibility,
			'supportNote'   => self::plain_text( isset( $settings['support_note'] ) ? $settings['support_note'] : '' ),
		);
	}

	/* ------------------------------------------------------------------ */
	/* REST                                                                */
	/* ------------------------------------------------------------------ */

	/**
	 * Register wg-live/v1 routes. All are public GETs with strictly validated arguments.
	 *
	 * @return void
	 */
	public static function register_routes() {
		register_rest_route(
			self::REST_NAMESPACE,
			'/events',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_events' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/events/(?P<slug>' . self::slug_route_pattern() . ')',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_event' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'slug' => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( __CLASS__, 'validate_slug_arg' ),
					),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/entitlement',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_entitlement' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'event' => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 1,
					),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/playback',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_playback' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'event' => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 1,
					),
					'mode'  => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => self::MODES,
					),
				),
			)
		);
	}

	/**
	 * REST argument validator for the slug.
	 *
	 * @param mixed $value Value.
	 * @return bool
	 */
	public static function validate_slug_arg( $value ) {
		return self::is_valid_slug( $value );
	}

	/**
	 * GET events.
	 *
	 * @return \WP_REST_Response
	 */
	public static function rest_events() {
		$response = new \WP_REST_Response( array( 'events' => self::published_events() ), 200 );
		$response->header( 'Cache-Control', self::CACHE_PUBLIC );
		return $response;
	}

	/**
	 * GET events/{slug}.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function rest_event( $request ) {
		$not_found = new \WP_Error( 'wg_live_not_found', 'Event not found.', array( 'status' => 404 ) );
		if ( ! self::is_enabled() ) {
			return $not_found;
		}
		$post  = self::find_event_by_slug( $request->get_param( 'slug' ) );
		$event = null === $post ? null : self::public_event( $post );
		if ( null === $event ) {
			return $not_found;
		}
		$response = new \WP_REST_Response( array( 'event' => $event ), 200 );
		$response->header( 'Cache-Control', self::CACHE_PUBLIC );
		return $response;
	}

	/**
	 * GET entitlement?event=<id> (M2-PLAN A2). The viewer is the cookie user, which WordPress only sees when the
	 * request carries the wp_rest nonce. Never cached.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function rest_entitlement( $request ) {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		$result = Entitlement::check( (int) $request->get_param( 'event' ), get_current_user_id() );
		$body   = array( 'status' => $result['status'] );
		if ( 'unavailable' === $result['status'] ) {
			$body['reason'] = $result['reason'];
		}
		$response = new \WP_REST_Response( $body, 200 );
		foreach ( wp_get_nocache_headers() as $name => $value ) {
			if ( '' !== $value ) {
				$response->header( $name, $value );
			}
		}
		return $response;
	}

	/**
	 * GET playback?event=<id>&mode=<mode>. Never cached.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function rest_playback( $request ) {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		$result   = Playback_Provider::resolve(
			(int) $request->get_param( 'event' ),
			(string) $request->get_param( 'mode' ),
			get_current_user_id()
		);
		$response = new \WP_REST_Response( $result, 200 );
		foreach ( wp_get_nocache_headers() as $name => $value ) {
			if ( '' !== $value ) {
				$response->header( $name, $value );
			}
		}
		return $response;
	}

	/* ------------------------------------------------------------------ */
	/* Helpers                                                             */
	/* ------------------------------------------------------------------ */

	/**
	 * Plain text for JSON: tags stripped, entities decoded (the client uses textContent), newlines kept as \n.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	public static function plain_text( $value ) {
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		$text = wp_strip_all_tags( (string) $value );
		$text = html_entity_decode( $text, ENT_QUOTES, 'UTF-8' );
		$text = str_replace( array( "\r\n", "\r" ), "\n", $text );
		return trim( $text );
	}

	/**
	 * A list of plain strings without empty entries.
	 *
	 * @param mixed $values Raw list.
	 * @return string[]
	 */
	private static function plain_list( $values ) {
		$out = array();
		if ( is_array( $values ) ) {
			foreach ( $values as $value ) {
				$text = self::plain_text( $value );
				if ( '' !== $text ) {
					$out[] = $text;
				}
			}
		}
		return $out;
	}

	/**
	 * Product URL: a published product's permalink, else the validated product_url, else null (plan 4.2).
	 *
	 * @param array $data Event data.
	 * @return string|null
	 */
	private static function product_url( array $data ) {
		$product_id = isset( $data['product_id'] ) ? (int) $data['product_id'] : 0;
		if ( $product_id > 0 && 'product' === get_post_type( $product_id ) && 'publish' === get_post_status( $product_id ) ) {
			$url = get_permalink( $product_id );
			if ( is_string( $url ) && '' !== $url ) {
				return $url;
			}
		}
		if ( ! empty( $data['product_url'] ) && is_string( $data['product_url'] ) ) {
			$url = esc_url_raw( $data['product_url'], array( 'http', 'https' ) );
			if ( '' !== $url ) {
				return $url;
			}
		}
		return null;
	}

	/**
	 * Poster details (width/height for CLS, srcset for responsive images). Demo events without a
	 * poster use the bundled demo poster.
	 *
	 * @param \WP_Post $post    Event.
	 * @param bool     $is_demo Demo event?
	 * @return array|null PosterImage.
	 */
	private static function poster( \WP_Post $post, $is_demo ) {
		$thumb_id = (int) get_post_thumbnail_id( $post );
		if ( $thumb_id > 0 ) {
			$src = wp_get_attachment_image_src( $thumb_id, 'large' );
			if ( is_array( $src ) && ! empty( $src[0] ) && (int) $src[1] > 0 && (int) $src[2] > 0 ) {
				$srcset = wp_get_attachment_image_srcset( $thumb_id, 'large' );
				$sizes  = wp_get_attachment_image_sizes( $thumb_id, 'large' );
				return array(
					'url'    => (string) $src[0],
					'width'  => (int) $src[1],
					'height' => (int) $src[2],
					'alt'    => self::plain_text( get_post_meta( $thumb_id, '_wp_attachment_image_alt', true ) ),
					'srcset' => ( is_string( $srcset ) && '' !== $srcset ) ? $srcset : null,
					'sizes'  => ( is_string( $sizes ) && '' !== $sizes ) ? $sizes : null,
				);
			}
		}
		if ( $is_demo && is_readable( WG_LIVE_DIR . 'assets/demo/poster-demo.svg' ) ) {
			return array(
				'url'    => WG_LIVE_URL . 'assets/demo/poster-demo.svg',
				'width'  => 1600,
				'height' => 900,
				'alt'    => self::DEMO_POSTER_ALT,
				'srcset' => null,
				'sizes'  => null,
			);
		}
		return null;
	}

	/**
	 * Normalize one compatibility row (accepts camelCase or snake_case keys).
	 *
	 * @param array $row Stored row.
	 * @return array CompatibilityRow.
	 */
	private static function compatibility_row( array $row ) {
		$pick = static function ( array $keys ) use ( $row ) {
			foreach ( $keys as $key ) {
				if ( isset( $row[ $key ] ) && is_scalar( $row[ $key ] ) ) {
					return Public_Data::plain_text( $row[ $key ] );
				}
			}
			return '';
		};

		$state     = $pick( array( 'status' ) );
		$tested_at = $pick( array( 'testedAt', 'tested_at' ) );
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/D', $tested_at ) ) {
			$tested_at = '';
		}
		if ( 'verified' !== $state && 'not_working' !== $state ) {
			$state = 'pending';
		}
		// Plan 4.3: a result without a test date is shown as pending.
		if ( 'pending' !== $state && '' === $tested_at ) {
			$state = 'pending';
		}

		return array(
			'device'       => $pick( array( 'device' ) ),
			'os'           => $pick( array( 'os' ) ),
			'browser'      => $pick( array( 'browser' ) ),
			'outputPath'   => $pick( array( 'outputPath', 'output_path' ) ),
			'sourceFormat' => $pick( array( 'sourceFormat', 'source_format' ) ),
			'status'       => $state,
			'testedAt'     => ( 'pending' === $state || '' === $tested_at ) ? null : $tested_at,
			'notes'        => $pick( array( 'notes' ) ),
		);
	}
}
