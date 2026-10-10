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
	<p class="wg-live-featured__text"><?php echo esc_html( $args['fallback'] ); ?></p>
	<?php if ( 'empty' === $wg_state && ! empty( $args['live_url'] ) ) : ?>
	<p class="wg-live-featured__actions"><a class="wg-live-featured__link" href="<?php echo esc_url( $args['live_url'] ); ?>"><?php echo esc_html( $args['live'] ); ?></a></p>
	<?php endif; ?>
</section>
	<?php
	return;
endif;

$wg_title_id = (string) $args['id'] . '-title';
$wg_heading  = in_array( $args['heading'], array( 'h2', 'h3' ), true ) ? $args['heading'] : 'h2';
$wg_poster   = $args['poster'];
$wg_cta      = $args['cta'];
$wg_time     = $args['time'];
?>
<section class="wg-live-featured wg-live-featured--event wg-live-featured--<?php echo esc_attr( $args['status'] ); ?>" aria-labelledby="<?php echo esc_attr( $wg_title_id ); ?>">
	<?php if ( is_array( $wg_poster ) ) : ?>
	<div class="wg-live-featured__media">
		<img class="wg-live-featured__poster" src="<?php echo esc_url( $wg_poster['url'] ); ?>" width="<?php echo esc_attr( (string) $wg_poster['width'] ); ?>" height="<?php echo esc_attr( (string) $wg_poster['height'] ); ?>" alt="<?php echo esc_attr( $wg_poster['alt'] ); ?>"<?php echo ! empty( $wg_poster['srcset'] ) ? ' srcset="' . esc_attr( $wg_poster['srcset'] ) . '"' : ''; ?><?php echo ! empty( $wg_poster['srcset'] ) && ! empty( $wg_poster['sizes'] ) ? ' sizes="' . esc_attr( $wg_poster['sizes'] ) . '"' : ''; ?> loading="lazy" decoding="async">
	</div>
	<?php endif; ?>
	<div class="wg-live-featured__body">
		<<?php echo esc_html( $wg_heading ); ?> class="wg-live-featured__title" id="<?php echo esc_attr( $wg_title_id ); ?>"><?php echo esc_html( $args['title'] ); ?><?php if ( ! empty( $args['is_demo'] ) ) : ?> <span class="wg-live-featured__badge wg-live-featured__badge--demo"><?php echo esc_html( $args['demo_badge'] ); ?></span><?php endif; ?></<?php echo esc_html( $wg_heading ); ?>>
		<p class="wg-live-featured__meta"><span class="wg-live-featured__badge wg-live-featured__badge--status"><?php echo esc_html( $args['status_label'] ); ?></span><?php if ( '' !== $wg_time['full'] ) : ?> <time class="wg-live-featured__time" datetime="<?php echo esc_attr( $args['machine_time'] ); ?>"><?php echo esc_html( $wg_time['full'] ); ?></time><?php endif; ?></p>
		<?php if ( '' !== $args['text'] ) : ?>
		<p class="wg-live-featured__text"><?php echo esc_html( $args['text'] ); ?></p>
		<?php endif; ?>
		<?php if ( ! empty( $args['replay_pending'] ) ) : ?>
		<p class="wg-live-featured__note"><?php echo esc_html( $args['replay_pending'] ); ?></p>
		<?php endif; ?>
		<?php if ( ! empty( $wg_cta['href'] ) ) : ?>
		<p class="wg-live-featured__actions"><a class="wg-live-featured__cta" href="<?php echo esc_url( $wg_cta['href'] ); ?>" aria-describedby="<?php echo esc_attr( $wg_title_id ); ?>"><?php echo esc_html( $wg_cta['label'] ); ?></a></p>
		<?php endif; ?>
	</div>
</section>
