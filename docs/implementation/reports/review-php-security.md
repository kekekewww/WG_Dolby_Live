# Review: PHP plugin security and correctness (wg-live, commit bc1e150)

Independent read-only review of `plugin/wg-live/**` and `scripts/seed-demo.php` against M1-PLAN rev 2, `src/types.ts`, CLAUDE.md and the implementation reports. No repository file other than this one was changed.

## Method

- I read every PHP file, template, `uninstall.php`, `readme.txt`, `assets/admin/admin.js` and `admin.css`, the demo license and poster, `assets/dist/build-info.json` and `scripts/seed-demo.php`. I scanned the shipped `wg-live.js` for sinks (`innerHTML`, `eval`, `postMessage(*)`, `localhost`) and found none.
- I checked WordPress core behaviour against the pinned core in the local wp-env checkout (WordPress 7.1.3): `settings_errors()`, `do_shortcode()`, the order of the `the_content` filters, `wp_unique_post_slug()`, `wp_get_nocache_headers()` and REST header handling. I checked Elementor behaviour against the pinned Elementor 4.3.4: `Frontend::apply_builder_in_content()`, `remove_content_filters()`, the Shortcode widget and the page-templates `print_callback()`.
- `php -l` passes for every in-scope file on `php:7.4-cli` (Docker, read-only mount).
- I reproduced the shortcode tag scan in `php:8.3-cli` with the exact `encode_config()` flags and the escaping of spaces.
- I did not report items that are recorded as accepted: invalid-slug edits unpublish a published event (wp-integration), untrash skips the slug filter (plan 4.2), the `events` endpoint is public while the pages are drafts (deploy-docs), the featured-card fallback (wp-integration), a 30 s public cache on `events*` (plan 5), and the Elementor element-cache setting (plan 7.5).

## Findings (most severe first)

### 1. [Medium] Elementor runs `do_shortcode` a second time over the rendered output, so admin plain text in the bootstrap JSON and the featured card is expanded as shortcodes

- **Where:** `includes/class-public-data.php:328-337` (`encode_config`), `templates/featured.php:42,45` (title and text).
- **Mechanism:**
  - On an Elementor page, `Frontend::apply_builder_in_content()` (on `the_content` at priority 9) replaces the content with the builder HTML. It removes only `wpautop`, `shortcode_unautop` and `wptexturize`.
  - Core `do_shortcode` (priority 11) therefore runs again over the HTML that the Shortcode widget already produced. This includes our `<script type="application/json">` bootstrap and the PHP-rendered featured card.
  - `encode_config()` escapes `<`, `>`, `&`, quotes and spaces, but not `[` / `]`. Its own comment shows that it guards against later content filters, yet it covers only `convert_smilies`.
  - Every production page uses this path: PRODUCTION.md step 3 and NAV-HOMEPAGE.md put the three Live pages and the homepage card in Elementor Full Width pages, each with a Shortcode widget.
- **Failure scenario:**
  - An admin enters plain text that contains a bare registered tag in an FAQ answer, the support note, a programme line, a performer, an event title or an event description, for example `[wg_live_featured]`, `[gallery]`, `[products]` or `[woocommerce_cart]`.
  - On the Elementor page the second pass finds the tag inside the JSON string. `do_shortcode`'s tag scan `\[([^<>&/\[\]\x00-\x20=]++)` matches `gallery`; I confirmed this in `php:8.3-cli` against the encoded bootstrap. The pass injects HTML that contains raw `"`, `'` and newlines.
  - `JSON.parse` then fails, and the whole Live view on that page shows the boot error instead of the UI.
  - On the homepage, the same text in the event title or description becomes real markup inside the featured card. This breaks the "admin text is plain text, never markup" rule (D12, CLAUDE.md "escape all output").
  - Tags followed by an attribute are not matched, because the escaped ` ` ends the tag-name scan. The trigger is therefore a bare `[tag]`, which is narrow but realistic for free-text fields.
- **Fix:**
  - In `encode_config()`, also replace `[` with `[` and `]` with `]`. This is still valid JSON, and the client's `JSON.parse` restores the brackets.
  - In `featured.php`, output text as `str_replace( array( '[', ']' ), array( '&#91;', '&#93;' ), esc_html( $text ) )`. `do_shortcode`'s `unescape_invalid_shortcodes()` turns these back into literal brackets for display.
  - Add an integration case: an FAQ answer and an event title containing `[wg_live_featured]` on the Elementor test page.

### 2. [Low] Raw submitted colour value is echoed unescaped into a settings notice

- **Where:** `includes/class-settings.php:752`.
- **Mechanism:**
  - On an invalid colour, `sanitize()` calls `add_settings_error( …, sprintf( '顏色「%s」不是有效的十六進位色碼…', self::shorten( $raw, 20 ) ) )`.
  - `$raw` is the unsanitized POST value (`trim()` only).
  - Core `settings_errors()` prints `{$details['message']}` without escaping. I verified this in WordPress 7.1.3 `wp-admin/includes/template.php`, and `render_settings_page()` calls it.
  - It is the only notice that interpolates user input; every other notice uses integers or fixed text.
- **Failure scenario:**
  - An admin types `<a href=//x.example>` (20 characters) into a colour field, either directly or after the `maxlength=7` client limit is bypassed, and saves.
  - The returned settings page renders live markup inside the notice. With up to 20 characters this is HTML injection. Script execution is constrained by the length but is not prevented by the code.
  - The message sits in the site-global `settings_errors` transient for 30 s. On multisite, a site admin without `unfiltered_html` can therefore inject markup.
  - This breaks the "escape all output" rule.
- **Fix:** escape the fragment: `esc_html( self::shorten( $raw, 20 ) )`. The other notices are fixed text and can stay as they are.

### 3. [Low] The create-pages conflict check ignores attachments, so the published Live page silently becomes `/live-2/`

- **Where:** `includes/class-settings.php:1488-1518` (`find_page()` / `page_conflicts()`), used by both the preview screen and `handle_create_pages()`.
- **Mechanism:**
  - `find_page()` only looks at `post_type = 'page'`.
  - When a draft page is published, core `wp_unique_post_slug()` checks `post_type IN ( 'page', 'attachment' ) AND post_parent = %d` (WordPress 7.1.3 `post.php`).
  - The drafts keep `post_name = 'live'` only because drafts skip the uniqueness check.
- **Failure scenario:**
  - The media library holds an unattached file whose slug is `live`, for example `Live.jpg` uploaded for a banner.
  - The preview shows 「可建立」 for all three paths, and the handler creates the drafts.
  - When the operator publishes 「Live」 (PRODUCTION step 7), WordPress renames it to `live-2`. The area then lives at `/live-2/`, `/live-2/listen/` and `/live-2/help/`, while `/live/` serves the attachment.
  - Internal links still resolve through `get_permalink()`. But the URLs promised by the deploy docs, menus and announcements are wrong, and nothing warned the operator.
- **Fix:**
  - Include attachments in the top-level check: `post_type IN ('page','attachment') AND post_parent = 0` for `live`.
  - Report the conflict the same way as for pages.
  - Optionally list a conflicting top-level page named `listen` / `help` under the right parent once `live` exists.

## Notes (verified, not counted as M1 defects)

- **Entitlement seam user (M2 blocker, no M1 impact):**
  - `rest_playback()` passes `get_current_user_id()` to `Entitlement::check()`.
  - The client (`src/adapters/providers.ts`) sends no `X-WP-Nonce`, and WordPress REST cookie authentication without a nonce runs the request as user 0. The seam can therefore never see a logged-in viewer.
  - M1's `check()` ignores the user, so nothing breaks now. M2 must add a nonce, or another authentication path, before real ticket checks can work.
- **Playback headers:**
  - `rest_playback()` copies `wp_get_nocache_headers()` into the response. Its `'Last-Modified' => false` entry is not dropped (only `''` is), so WordPress sends an empty `Last-Modified:` header. This is harmless.
  - On WordPress 6.3 to 6.x (the declared floor), guest responses get `no-cache, must-revalidate, max-age=0` without `no-store` / `private`. Pinned 7.1.3 always sends `no-store, private`. M1 responses do not vary by user. Re-check this in M2, when they will.

## Checked and OK

- **Capability and nonce on every write:**
  - Settings: `option_page_capability_` filter, a `current_user_can( Plugin::cap() )` check in `sanitize()`, and the options.php nonce.
  - Event save: the nonce is bound to the post ID and `$_POST['post_ID']`, and `edit_post` is checked; autosaves and revisions are skipped.
  - Slug filter: the posted slug is used only after the nonce is verified.
  - `admin_post_wg_live_create_pages`: requires `$cap` + `edit_pages`, calls `check_admin_referer`, re-checks conflicts, creates drafts only, redirects with `wp_safe_redirect`.
  - No `nopriv` handlers.
- **Escaping:**
  - The meta box, list columns, flash notices, the settings/deploy/create-pages screens, `featured.php` and `partials/container.php` all escape their output. The exceptions are finding 2, and the JSON, which is safe through the HEX flags.
  - Admin JS uses `textContent` and `<template>` only.
- **REST:**
  - All three routes are GET with `__return_true`.
  - The slug route re-validates its argument with `Events::is_valid_slug()` (`/D`, max 100), so uppercase gets a 400.
  - `playback` takes an integer `event` (minimum 1) and an enum `mode`.
  - `events*` send `public, max-age=30` and never vary by user. `playback` defines `DONOTCACHEPAGE` and sends the no-cache headers.
  - Disabled mode returns `[]`, a 404 and `not_ready/disabled` respectively.
- **Public predicate:**
  - `Events::is_public()` gates the bootstrap, both event routes, playback, entitlement, the featured event and the shortcode `event` attribute.
  - The PublicEvent whitelist carries no source URL, `source_type` or meta.
  - The demo source URL is produced only after the `Entitlement::check()` step (plan 5.1 order).
- **Demo approval:**
  - Approval is set only from the settings form (`option_page` check, `$cap`). It is re-checked on read (`Settings::normalize` → `audio_is_approved`, including the `woocommerce_uploads` path) and again in `Playback_Provider::approved_attachment()` (audio MIME, not a product child).
  - An approval is revoked when its ID is no longer used.
  - `_wg_live_demo_approved` is protected meta and cannot be set through custom fields or XML-RPC.
- **SQL:** all three raw queries are prepared, and the uninstall `LIKE` uses `esc_like`.
- **Uninstall:** `WP_UNINSTALL_PLUGIN` guard, opt-in only, literal names. It covers every status (including trash and auto-draft), works with the CPT unregistered, runs per site on multisite, and never touches attachments, pages, users, products or orders.
- **PHP 7.4 and namespaces:** `php -l` passes. No PHP 8-only syntax is used, and every class reference inside the namespace is fully qualified or imported.
- **Missing WooCommerce or Elementor:** only `function_exists('wc_get_page_id')`, constants and hooks are used, so neither causes a fatal error. A missing build gives a notice and a readable message.
- **Dev tools:** `production`, or an unset environment type, is always off, and `WG_LIVE_DEV_TOOLS === false` forces off. `staging` requires a logged-in user with `$cap`. No query parameter, cookie or option affects this.
- **Activation and deactivation:** activation only seeds the options with `add_option`; there are no flushes, pages or roles. Deactivation does nothing.
- **seed-demo.php:** has the ABSPATH guard and is idempotent. It only edits pages it created (`_wg_live_seed`), and it is not shipped in the ZIP.
