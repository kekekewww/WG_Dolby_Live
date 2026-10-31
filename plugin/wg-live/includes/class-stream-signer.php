<?php
/**
 * Stream URL signing (M2-PLAN B2, decision D4).
 *
 * A playlist URL leaves the server only through /playback, after the ticket check, and only after a
 * signer turned it into a short-lived URL. Production never hands out unsigned URLs unless the site
 * owner set WG_LIVE_ALLOW_UNSIGNED_STREAMS to true in wp-config.php (a documented risk: a leaked URL
 * then plays for anyone). Secrets live only in wp-config.php constants, never in options or meta.
 *
 * @package WG_Live
 */

namespace WG_Live;

defined( 'ABSPATH' ) || exit;

/**
 * Turns a stored playlist URL into the URL a viewer may fetch until $expires_at.
 */
interface Stream_Signer {

	/**
	 * Sign a URL.
	 *
	 * @param string $url        Stored playlist or player URL.
	 * @param int    $expires_at Unix time the URL stops working.
	 * @return string The URL to hand out, or '' to refuse.
	 */
	public function sign( string $url, int $expires_at ): string;
}

/**
 * Hands the URL back unchanged. Used outside production, or in production only behind the explicit
 * WG_LIVE_ALLOW_UNSIGNED_STREAMS escape hatch.
 */
final class Unsigned_Signer implements Stream_Signer {

	/**
	 * Sign a URL (no-op).
	 *
	 * @param string $url        URL.
	 * @param int    $expires_at Ignored.
	 * @return string
	 */
	public function sign( string $url, int $expires_at ): string {
		unset( $expires_at );
		return $url;
	}
}

/**
 * Picks the signer for this site.
 */
final class Stream_Signers {

	/**
	 * Default show length when WG_LIVE_TOKEN_TTL is not set.
	 */
	const DEFAULT_SHOW = 4 * HOUR_IN_SECONDS;

	/**
	 * Margin added to the show length so a token never expires before the encore.
	 */
	const MARGIN = 30 * MINUTE_IN_SECONDS;

	/**
	 * The signer to use, or null when this site must not hand out stream URLs at all.
	 *
	 * Order: the provider signer once its constants are defined (M2-PLAN B3b, blocked on the provider's
	 * algorithm and test vector), else unsigned outside production or with the escape hatch, else none.
	 *
	 * @return Stream_Signer|null
	 */
	public static function current(): ?Stream_Signer {
		if ( 'production' !== wp_get_environment_type() || self::unsigned_allowed() ) {
			return new Unsigned_Signer();
		}
		return null;
	}

	/**
	 * Is the production escape hatch on? Only the boolean true counts.
	 *
	 * @return bool
	 */
	public static function unsigned_allowed(): bool {
		return defined( 'WG_LIVE_ALLOW_UNSIGNED_STREAMS' ) && true === constant( 'WG_LIVE_ALLOW_UNSIGNED_STREAMS' );
	}

	/**
	 * Token lifetime in seconds: the show length (WG_LIVE_TOKEN_TTL, default 4 h) plus 30 minutes.
	 *
	 * Events store no end time, so the length is a site-wide constant. A token outliving the show is
	 * acceptable; one expiring mid-show is not (the client re-resolves, but that is a recovery path).
	 *
	 * @param int $event_id Event ID (kept for a per-event length later).
	 * @return int
	 */
	public static function ttl( int $event_id ): int {
		unset( $event_id );
		$show = self::DEFAULT_SHOW;
		if ( defined( 'WG_LIVE_TOKEN_TTL' ) ) {
			$value = constant( 'WG_LIVE_TOKEN_TTL' );
			if ( is_int( $value ) && $value >= HOUR_IN_SECONDS && $value <= DAY_IN_SECONDS ) {
				$show = $value;
			}
		}
		return $show + self::MARGIN;
	}

	/**
	 * One line for the deploy-info screen. Never includes a secret or a URL.
	 *
	 * @return string
	 */
	public static function describe(): string {
		$signer = self::current();
		if ( null === $signer ) {
			return '未設定（正式站將不提供播放）';
		}
		if ( $signer instanceof Unsigned_Signer ) {
			return 'production' === wp_get_environment_type()
				? '未設定：WG_LIVE_ALLOW_UNSIGNED_STREAMS 已開啟，正式站提供未簽章網址（有外流風險）'
				: '未設定（非正式站使用未簽章網址；正式站將不提供播放）';
		}
		return '已設定';
	}
}
