<?php
/**
 * The homepage card, rendered in PHP only (plan D2, 6.10). No script, no player, no media.
 *
 * States: "disabled" (text only), "empty" (fallback text and a link to Live), "event" (the card).
 * Every value is escaped here; URLs go through esc_url().
 *
 * @package WG_Live
 *
 * @var array $args Model from WG_Live\Shortcodes::featured_model(), plus heading and id.
 */

defined( 'ABSPATH' ) || exit;

$wg_state = (string) $args['state'];

if ( 'event' !== $wg_state ) :
	?>
<section class="wg-live-featured wg-live-featured--empty">
	<p class="wg-live-featured__text"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['fallback'] ) ); ?></p>
	<?php if ( 'empty' === $wg_state && ! empty( $args['live_url'] ) ) : ?>
	<p class="wg-live-featured__actions"><a class="wg-live-featured__link" href="<?php echo \WG_Live\Shortcodes::defuse_brackets( esc_url( $args['live_url'] ) ); ?>"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['live'] ) ); ?></a></p>
	<?php endif; ?>
</section>
	<?php
	return;
endif;

$wg_title_id = (string) $args['id'] . '-title';
$wg_badge_id = (string) $args['id'] . '-demo';
$wg_heading  = in_array( $args['heading'], array( 'h2', 'h3' ), true ) ? $args['heading'] : 'h2';
$wg_poster   = $args['poster'];
$wg_cta      = $args['cta'];
$wg_time     = $args['time'];
$wg_tile     = isset( $args['tile'] ) && is_array( $args['tile'] ) ? $args['tile'] : null;
$wg_is_demo  = ! empty( $args['is_demo'] );
$wg_status   = (string) $args['status'];
$wg_label_by = $wg_title_id . ( $wg_is_demo ? ' ' . $wg_badge_id : '' );

// Date tile variant: live and doors open are solid yellow, scheduled a Paper outline, ended and cancelled a muted outline.
if ( in_array( $wg_status, array( 'live', 'doors_open', 'intermission' ), true ) ) {
	$wg_variant = 'live';
} elseif ( 'scheduled' === $wg_status ) {
	$wg_variant = 'scheduled';
} else {
	$wg_variant = 'over';
}
?>
<section class="wg-live-featured wg-live-featured--event wg-live-featured--<?php echo esc_attr( $wg_status ); ?>" aria-labelledby="<?php echo esc_attr( $wg_label_by ); ?>">
	<div class="wg-live-featured__media">
		<div class="wg-live-featured__poster-frame">
			<?php if ( is_array( $wg_poster ) ) : ?>
			<img class="wg-live-featured__poster" src="<?php echo \WG_Live\Shortcodes::defuse_brackets( esc_url( $wg_poster['url'] ) ); ?>" width="<?php echo esc_attr( (string) $wg_poster['width'] ); ?>" height="<?php echo esc_attr( (string) $wg_poster['height'] ); ?>" alt="<?php echo \WG_Live\Shortcodes::defuse_brackets( esc_attr( $wg_poster['alt'] ) ); ?>"<?php echo ! empty( $wg_poster['srcset'] ) ? ' srcset="' . esc_attr( $wg_poster['srcset'] ) . '"' : ''; ?><?php echo ! empty( $wg_poster['srcset'] ) && ! empty( $wg_poster['sizes'] ) ? ' sizes="' . esc_attr( $wg_poster['sizes'] ) . '"' : ''; ?> loading="lazy" decoding="async">
			<?php else : ?>
			<div class="wg-live-featured__placeholder" aria-hidden="true">
				<span class="wg-live-featured__placeholder-bar"></span>
				<span class="wg-live-featured__placeholder-title"><?php if ( $wg_is_demo ) : ?><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['demo_badge'] ) ); ?> · <?php endif; ?><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['poster_brand'] ) ); ?></span>
				<?php if ( $wg_is_demo ) : ?>
				<span class="wg-live-featured__placeholder-note"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['poster_note'] ) ); ?></span>
				<?php endif; ?>
			</div>
			<?php endif; ?>
		</div>
		<?php if ( null !== $wg_tile ) : ?>
		<div class="wg-live-featured__tile wg-live-featured__tile--<?php echo esc_attr( $wg_variant ); ?>" aria-hidden="true">
			<span class="wg-live-featured__tile-month"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $wg_tile['month'] ) ); ?></span>
			<span class="wg-live-featured__tile-day"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $wg_tile['day'] ) ); ?></span>
			<span class="wg-live-featured__tile-when"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $wg_tile['when'] ) ); ?></span>
			<span class="wg-live-featured__tile-zone"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $wg_tile['zone'] ) ); ?></span>
		</div>
		<?php endif; ?>
	</div>
	<div class="wg-live-featured__body">
		<p class="wg-live-featured__meta"><span class="wg-live-featured__badge wg-live-featured__badge--status"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['status_label'] ) ); ?></span><?php if ( $wg_is_demo ) : ?> <span class="wg-live-featured__badge wg-live-featured__badge--demo" id="<?php echo esc_attr( $wg_badge_id ); ?>"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['demo_badge'] ) ); ?></span><?php endif; ?></p>
		<<?php echo esc_html( $wg_heading ); ?> class="wg-live-featured__title" id="<?php echo esc_attr( $wg_title_id ); ?>"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['title'] ) ); ?></<?php echo esc_html( $wg_heading ); ?>>
		<?php if ( '' !== $wg_time['full'] ) : ?>
		<p class="wg-live-featured__when<?php echo null !== $wg_tile ? ' wg-live-featured__visually-hidden' : ''; ?>"><time class="wg-live-featured__time" datetime="<?php echo esc_attr( $args['machine_time'] ); ?>"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $wg_time['full'] ) ); ?></time></p>
		<?php endif; ?>
		<?php if ( '' !== $args['text'] ) : ?>
		<p class="wg-live-featured__text"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['text'] ) ); ?></p>
		<?php endif; ?>
		<?php if ( ! empty( $args['replay_pending'] ) ) : ?>
		<p class="wg-live-featured__note"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $args['replay_pending'] ) ); ?></p>
		<?php endif; ?>
		<?php if ( ! empty( $wg_cta['href'] ) ) : ?>
		<p class="wg-live-featured__actions"><a class="wg-live-featured__cta" href="<?php echo \WG_Live\Shortcodes::defuse_brackets( esc_url( $wg_cta['href'] ) ); ?>" aria-describedby="<?php echo esc_attr( $wg_title_id ); ?>"><?php echo \WG_Live\Shortcodes::defuse_brackets( esc_html( $wg_cta['label'] ) ); ?></a></p>
		<?php endif; ?>
	</div>
</section>
