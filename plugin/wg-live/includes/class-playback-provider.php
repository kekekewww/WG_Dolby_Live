<?php
/**
 * Server-side playback source resolution (plan 5.1).
 *
 * Order: deployment mode, event visibility, available mode, entitlement, source configuration,
 * event status. A source URL is only ever produced after every earlier step passed. In M1 the only
 * source is the approved demo media; hls and iframe are never emitted.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Playback sources.
 */
final class Playback_Provider {

	/**
	 * Bundled demo audio files per mode (plan D7). Used by audio events.
	 *
	 * @var array<string,string>
	 */
	const BUNDLED = array(
		'binaural' => 'demo-tone-1.mp3',
		'atmos'    => 'demo-tone-2.mp3',
	);

	/**
	 * Bundled demo video files per mode (plan D7). Used by video events, the default media kind.
	 *
	 * @var array<string,string>
	 */
	const BUNDLED_VIDEO = array(
		'binaural' => 'demo-video-1.mp4',
		'atmos'    => 'demo-video-2.mp4',
	);

	/**
	 * Resolve a PlaybackSource (the shape of the PlaybackSource union in src/types.ts).
	 *
	 * @param int    $event_id Event post ID.
	 * @param string $mode     binaural|atmos.
	 * @param int    $user_id  User ID (0 = guest).
	 * @return array
	 */
	public static function resolve( $event_id, $mode, $user_id ) {
		$event_id = (int) $event_id;

		// 1. Deployment mode.
		if ( ! Public_Data::is_enabled() ) {
			return self::not_ready( 'disabled' );
		}

		// 2. The event must be publicly visible.
		$post = $event_id > 0 ? get_post( $event_id ) : null;
		if ( ! $post instanceof \WP_Post || ! Events::is_public( $post ) ) {
			return self::not_ready( 'event_not_found' );
		}
		$data = Events::get_event_data( $post );

		// 3. The mode must exist and be offered for this event.
		$modes = isset( $data['available_modes'] ) && is_array( $data['available_modes'] ) ? $data['available_modes'] : array();
		if ( ! is_string( $mode ) || ! isset( self::BUNDLED[ $mode ] ) || ! in_array( $mode, $modes, true ) ) {
			return self::not_ready( 'mode_unavailable' );
		}

		// 4. Entitlement, before any source is looked at.
		$entitlement = Entitlement::check( $event_id, (int) $user_id );
		$status      = isset( $entitlement['status'] ) ? $entitlement['status'] : '';
		if ( 'entitled' !== $status ) {
			if ( 'guest' === $status || 'not_entitled' === $status ) {
				return self::not_ready( 'not_entitled' );
			}
			return self::not_ready( 'entitlement_unavailable' );
		}

		// 5. A demo source must be configured.
		$is_demo = ! empty( $data['is_demo'] );
		$type    = isset( $data['source_type'] ) ? $data['source_type'] : 'not_configured';
		if ( ! $is_demo || 'demo' !== $type ) {
			return self::not_ready( 'source_not_configured' );
		}

		// 6. Non-demo events must be live. Demo events skip this: the media is public test material
		// and the client gates by the (possibly simulated) status. In M1 step 5 already rejects every
		// non-demo event, so this is the guard for the M2 sources that will follow.
		$event_status = isset( $data['status'] ) ? $data['status'] : '';
		if ( ! $is_demo && 'live' !== $event_status && 'intermission' !== $event_status ) {
			return self::not_ready( 'event_not_playable' );
		}

		// 7. The demo source.
		$media_kind = isset( $data['media_kind'] ) && 'audio' === $data['media_kind'] ? 'audio' : 'video';
		$source     = self::demo_source( $mode, $media_kind );
		if ( null === $source ) {
			return self::not_ready( 'source_not_configured' );
		}
		return array(
			'kind'     => 'demo',
			'url'      => $source['url'],
			'mimeType' => $source['mimeType'],
		);
	}

	/**
	 * Build a not_ready result.
	 *
	 * @param string $reason NotReadyReason.
	 * @return array
	 */
	private static function not_ready( $reason ) {
		return array(
			'kind'   => 'not_ready',
			'reason' => $reason,
		);
	}

	/**
	 * The demo source for a mode and media kind. Audio events: the approved media-library attachment
	 * (settings demo_audio_*), else the bundled mp3. Video events: always the bundled mp4 (the audio
	 * pickers do not apply to them).
	 *
	 * @param string $mode       binaural|atmos.
	 * @param string $media_kind audio|video.
	 * @return array{url:string,mimeType:string}|null
	 */
	private static function demo_source( $mode, $media_kind ) {
		if ( 'audio' === $media_kind ) {
			$settings = Settings::get();
			$key      = 'demo_audio_' . $mode;
			$id       = isset( $settings[ $key ] ) ? (int) $settings[ $key ] : 0;
			if ( $id > 0 ) {
				$attachment = self::approved_attachment( $id );
				if ( null !== $attachment ) {
					return $attachment;
				}
			}
			$file = self::BUNDLED[ $mode ];
			$mime = 'audio/mpeg';
		} else {
			$file = self::BUNDLED_VIDEO[ $mode ];
			$mime = 'video/mp4';
		}

		if ( ! is_readable( WG_LIVE_DIR . 'assets/demo/' . $file ) ) {
			return null;
		}
		return array(
			'url'      => add_query_arg( 'ver', WG_LIVE_VERSION, WG_LIVE_URL . 'assets/demo/' . $file ),
			'mimeType' => $mime,
		);
	}

	/**
	 * An attachment that is audio, flagged approved by the plugin's own picker and not attached to a product.
	 * Re-checked here as well as on save, because the media library can change afterwards.
	 *
	 * @param int $id Attachment ID.
	 * @return array{url:string,mimeType:string}|null
	 */
	private static function approved_attachment( $id ) {
		$post = get_post( $id );
		if ( ! $post instanceof \WP_Post || 'attachment' !== $post->post_type ) {
			return null;
		}
		$mime = (string) get_post_mime_type( $post );
		if ( 0 !== strpos( $mime, 'audio/' ) ) {
			return null;
		}
		if ( '1' !== (string) get_post_meta( $id, '_wg_live_demo_approved', true ) ) {
			return null;
		}
		if ( $post->post_parent > 0 && 'product' === get_post_type( $post->post_parent ) ) {
			return null;
		}
		$url = wp_get_attachment_url( $id );
		if ( ! is_string( $url ) || '' === $url ) {
			return null;
		}
		return array(
			'url'      => $url,
			'mimeType' => $mime,
		);
	}
}
