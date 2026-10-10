<?php
/**
 * The root container of every view (plan 3.1).
 *
 * The JSON bootstrap is already encoded with JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT,
 * so it cannot close the script element or carry markup. The live region is empty here and sits
 * outside the aria-busy subtree; the script fills it.
 *
 * @package WG_Live
 *
 * @var array $args view, id, config_json, noscript.
 */

defined( 'ABSPATH' ) || exit;

$wg_view     = (string) $args['view'];
$wg_noscript = $args['noscript'];
?>
<div class="wg-live wg-live--<?php echo esc_attr( $wg_view ); ?>" data-wg-live-view="<?php echo esc_attr( $wg_view ); ?>" id="<?php echo esc_attr( (string) $args['id'] ); ?>">
	<script type="application/json" class="wg-live__config"><?php echo $args['config_json']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON encoded with the HEX flags, see Public_Data::encode_config(). ?></script>
	<noscript>
		<p><?php echo esc_html( $wg_noscript['message'] ); ?></p>
		<?php if ( ! empty( $wg_noscript['detail'] ) ) : ?>
		<p><?php echo esc_html( $wg_noscript['detail'] ); ?></p>
		<?php endif; ?>
		<?php if ( ! empty( $wg_noscript['links'] ) ) : ?>
		<ul>
			<?php foreach ( $wg_noscript['links'] as $wg_link ) : ?>
			<li><a href="<?php echo esc_url( $wg_link['href'] ); ?>"><?php echo esc_html( $wg_link['label'] ); ?></a></li>
			<?php endforeach; ?>
		</ul>
		<?php endif; ?>
	</noscript>
	<div class="wg-live__sr-status" role="status" aria-atomic="true"></div>
	<div class="wg-live__mount" aria-busy="true"><div class="wg-live__skeleton wg-live__skeleton--<?php echo esc_attr( $wg_view ); ?>"></div></div>
</div>
