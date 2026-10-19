#!/usr/bin/env bash
# Clean-install check of the wg-live ZIP (spec 14.2 / 19.3) on the running wp-env stack (WSL2):
# a throwaway WordPress in /var/www/html/zipcheck with its own database, built from the dev site's core
# files (nothing is downloaded). Installs the ZIP with WP-CLI (the same Plugin_Upgrader path as the admin
# uploader), activates, probes, uninstalls, and removes the install and its database on exit.
#
# Usage: npm run test:zip-install [-- artifacts/wg-live-x.y.z.zip]   (default: the newest artifacts/wg-live-*.zip)
# Needs the wp-env dev site on :8888 (npm run wp:start:wsl). Runs from Git Bash, WSL or Linux. Local only:
# it touches nothing but the throwaway install. Every line starting with FAIL is a failed check.
set -euo pipefail
export MSYS_NO_PATHCONV=1
LOG=$(mktemp)
exec > >(tee "$LOG") 2>&1
ZIP="${1:-$(ls -t artifacts/wg-live-*.zip 2>/dev/null | head -1)}"
[ -f "$ZIP" ] || { echo "zip-install-check: no ZIP (run npm run package first, or pass its path)" >&2; exit 2; }

LINE=$(docker ps --format '{{.Names}}	{{.Ports}}' | grep -E ':8888->80' | grep 'wordpress-1' | head -1 || true)
[ -n "$LINE" ] || { echo "zip-install-check: no wp-env WordPress container on :8888 (npm run wp:start:wsl)" >&2; exit 2; }
WPC=${LINE%%	*}
CLI=${WPC%wordpress-1}cli-1
DIR=/var/www/html/zipcheck
URL=http://localhost:8888/zipcheck
DB=wp_zipcheck
CLI_UID=$(docker exec "$CLI" id -u)
echo "containers: $WPC, $CLI (cli uid $CLI_UID)"
echo "zip sha256: $(sha256sum "$ZIP" | cut -d' ' -f1)  $(basename "$ZIP")"

cleanup() {
  docker exec "$CLI" wp db query "DROP DATABASE IF EXISTS $DB" --path=/var/www/html >/dev/null 2>&1 || true
  docker exec -u 0 "$WPC" rm -rf "$DIR" || true
}
trap 'cleanup; rm -f "$LOG"' EXIT
cleanup

echo "== copy core files (no download)"
docker exec -u 0 "$WPC" sh -c "mkdir -p $DIR/wp-content/plugins && cd /var/www/html && cp -r wp-admin wp-includes $DIR/ && for f in *.php; do [ \"\$f\" = wp-config.php ] || cp \"\$f\" $DIR/; done && cp -r wp-content/themes $DIR/wp-content/"
SRC=$ZIP
if command -v cygpath >/dev/null 2>&1; then SRC=$(cygpath -w "$ZIP"); fi
docker cp "$SRC" "$WPC:$DIR/wg-live.zip"
# Core's update checks (wp_version_check / wp_update_plugins / wp_update_themes) run during WP-CLI install and list and
# log a PHP warning whenever wordpress.org is unreachable, which made this check flaky. Answer those requests locally
# with an empty 200, so core never touches the network. Every other outbound request stays blocked
# (WP_HTTP_BLOCK_EXTERNAL below), so the plugin under test still has to work offline.
docker exec -i -u 0 "$WPC" sh -c "mkdir -p $DIR/wp-content/mu-plugins && cat > $DIR/wp-content/mu-plugins/zipcheck-offline.php" <<'PHP'
<?php
add_filter(
	'pre_http_request',
	static function ( $pre, $args, $url ) {
		$host = (string) wp_parse_url( (string) $url, PHP_URL_HOST );
		if ( 'api.wordpress.org' === $host || 'downloads.wordpress.org' === $host ) {
			return array( 'headers' => array(), 'body' => '', 'response' => array( 'code' => 200, 'message' => 'OK' ), 'cookies' => array(), 'filename' => null );
		}
		return $pre;
	},
	10,
	3
);
PHP
docker exec -u 0 "$WPC" chown -R "$CLI_UID" "$DIR"

docker exec -i "$CLI" sh -s <<SH
set -e
cd $DIR
P=/var/www/html
# No outbound HTTP and no auto-updates: core's wordpress.org update checks otherwise write network warnings to debug.log
# (seen as flaky FAILs), and the plugin itself must not need the network to install, activate or serve its pages.
printf "%s\n" "define( 'WP_DEBUG', true );" "define( 'WP_DEBUG_LOG', '$DIR/debug.log' );" "define( 'WP_DEBUG_DISPLAY', false );" "define( 'WP_ENVIRONMENT_TYPE', 'production' );" "define( 'WP_HTTP_BLOCK_EXTERNAL', true );" "define( 'AUTOMATIC_UPDATER_DISABLED', true );" \
  | wp config create --dbname=$DB --dbuser="\$(wp config get DB_USER --path=\$P)" --dbpass="\$(wp config get DB_PASSWORD --path=\$P)" --dbhost="\$(wp config get DB_HOST --path=\$P)" --skip-check --extra-php >/dev/null
wp db create >/dev/null
PASS=\$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')
wp core install --url=$URL --title='wg-live ZIP check' --admin_user=zipcheck --admin_password="\$PASS" --admin_email=zipcheck@example.invalid --skip-email >/dev/null
echo "WordPress \$(wp core version), PHP \$(php -r 'echo PHP_VERSION;'), theme \$(wp theme list --status=active --field=name)"
echo "plugins before: \$(wp plugin list --field=name | tr '\n' ' ')"

SNAP='global \$wpdb; echo wp_json_encode( array( "pages" => (int) \$wpdb->get_var( "SELECT COUNT(*) FROM {\$wpdb->posts} WHERE post_type = \"page\"" ), "published_pages" => (int) \$wpdb->get_var( "SELECT COUNT(*) FROM {\$wpdb->posts} WHERE post_type = \"page\" AND post_status = \"publish\"" ), "menus" => count( wp_get_nav_menus() ), "theme" => get_stylesheet(), "show_on_front" => get_option( "show_on_front" ), "rewrite_rules_set" => (bool) get_option( "rewrite_rules" ) ) );'
echo "== install"
wp plugin install $DIR/wg-live.zip 2>&1 | tail -3
BEFORE=\$(wp eval "\$SNAP")
echo "== activate"
wp plugin activate wg-live 2>&1
AFTER=\$(wp eval "\$SNAP")
echo "site state before activation: \$BEFORE"
echo "site state after activation:  \$AFTER"
[ "\$BEFORE" = "\$AFTER" ] && echo "PASS activation changed no pages, menus, theme or front page" || echo "FAIL activation changed site state"
wp plugin list --name=wg-live --fields=name,status,version --format=csv | tail -1

echo "== probes"
wp eval '
\$s = get_option( "wg_live_settings", array() );
\$routes = array_keys( rest_get_server()->get_routes() );
\$ours = array_values( array_filter( \$routes, function ( \$r ) { return 0 === strpos( \$r, "/wg-live/" ); } ) );
\$checks = array(
  "deployment_mode is disabled after activation" => isset( \$s["deployment_mode"] ) && "disabled" === \$s["deployment_mode"],
  "wg_live_event post type registered" => post_type_exists( "wg_live_event" ),
  "shortcode wg_live registered" => shortcode_exists( "wg_live" ),
  "shortcode wg_live_featured registered" => shortcode_exists( "wg_live_featured" ),
  "REST events route" => in_array( "/wg-live/v1/events", \$ours, true ),
  "REST playback route" => in_array( "/wg-live/v1/playback", \$ours, true ),
  "built JS present" => file_exists( WP_PLUGIN_DIR . "/wg-live/assets/dist/wg-live.js" ),
  "featured shortcode renders without JS" => false === strpos( do_shortcode( "[wg_live_featured]" ), "<script" ),
);
foreach ( \$checks as \$label => \$ok ) { echo ( \$ok ? "PASS " : "FAIL " ) . \$label . "\n"; }
echo "routes: " . implode( " ", \$ours ) . "\n";
'
SH

echo "== HTTP (Apache serving the ZIP-installed copy)"
code() { curl -s -o /dev/null -w "%{http_code}" "$1"; }
echo "GET /zipcheck/                                  $(code "$URL/")"
echo "GET ?rest_route=/wg-live/v1/events              $(code "$URL/?rest_route=/wg-live/v1/events")  $(curl -s "$URL/?rest_route=/wg-live/v1/events" | head -c 160)"
echo "GET wg-live/assets/dist/wg-live.js              $(code "$URL/wp-content/plugins/wg-live/assets/dist/wg-live.js")"
echo "GET wg-live/assets/dist/wg-live-featured.css    $(code "$URL/wp-content/plugins/wg-live/assets/dist/wg-live-featured.css")"

docker exec -i "$CLI" sh -s <<SH
set -e
cd $DIR
echo "== deactivate and uninstall"
wp plugin deactivate wg-live 2>&1
wp plugin uninstall wg-live 2>&1
[ -d $DIR/wp-content/plugins/wg-live ] && echo "FAIL plugin folder still present" || echo "PASS plugin folder removed"
wp option get wg_live_settings --format=json >/dev/null 2>&1 && echo "settings kept after uninstall (delete_data_on_uninstall is off by default)" || echo "settings removed after uninstall"
echo "== PHP debug.log"
if [ -s $DIR/debug.log ]; then cat $DIR/debug.log; echo "FAIL debug.log is not empty"; else echo "PASS no PHP notice, warning, deprecation or error logged"; fi
SH
if grep -q '^FAIL' "$LOG"; then echo "zip-install-check: FAILED (see the FAIL lines)"; exit 1; fi
echo "zip-install-check: ok (the throwaway install and its database are removed on exit)"
