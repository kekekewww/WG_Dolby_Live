# php-admin report (resumed run)

## Files
- `plugin/wg-live/includes/class-events.php`: CPT `wg_live_event` (D13 caps via `Plugin::cap()`), meta box with every field incl. the visible required 代稱 input, `wp_insert_post_data` slug filter, `save_post` rules, `get_event_data`, `is_public`, `is_valid_slug` (D modifier, max 100), list columns (slug validity flag), flash notices that survive the redirect.
- `plugin/wg-live/includes/class-settings.php`: Settings API page (modes, page dropdowns, featured event, link overrides, FAQ and compatibility repeaters, support note, demo audio pickers, style overrides, uninstall opt-in with confirm), `sanitize()` (server-side validation, META_OPTION bump on every save), Deployment info screen, Create suggested pages preview + `admin_post_wg_live_create_pages`.
- `plugin/wg-live/uninstall.php`: literal names, opt-in only, all statuses incl. trash/auto-draft, both options, `_wg_live_demo_approved` flag, per-site on multisite; never touches attachments, pages, users, products, orders.
- `plugin/wg-live/assets/admin/admin.js`, `admin.css`: plain JS/CSS, enqueued only on the plugin screens with `filemtime` versions; CSS scoped under `.wg-live-admin` (and `.wg-live-admin__*`).
- `tests/unit/slug-pattern-sync.test.ts`: PHP `SLUG_PATTERN` and `SLUG_MAX_LENGTH` equal the TS constants; `SLUG_REGEX` uses `/D`.
- `eslint.config.js`: only change is a new block giving `plugin/wg-live/assets/admin/**/*.js` browser globals (+ `wp`, `jQuery`), sourceType script.

## Changes in this resumed run
- Runbook labels aligned: top menu "Live 活動"; submenus 設定 / 部署資訊 / 建立建議頁面; settings field 部署模式 (section renamed 運作模式); event checkbox 示範活動; source option 示範; uninstall opt-in 解除安裝時刪除資料.
- eslint browser globals for admin.js; fixed TS strict error in the sync test.

## Gate results
- `npm run lint:php`: ok (php -l on 7.4 and 8.3, PHPCS + PHPCompatibilityWP 7.4-).
- `npm run lint` (eslint . + CSS scope): ok. `admin.css` also verified with `checkCss(..., {blocks:['wg-live-admin']})`: no violations (the CLI scope check only walks `src/styles`).
- `npm run test:unit`: 33 files, 1007 tests passed. `npm run typecheck`: clean.
- Runtime smoke on the wp-env tests site (WP-CLI, plugin mounted): valid slug publishes; missing slug, duplicate and `"slug\n"` are forced to draft with no `-2`; trash/untrash keeps the slug; form save stores UTC time, whitelisted modes, rejects `javascript:` product URL, `'1'/'0'` booleans; sanitize accepts/rejects as per 4.3 (verified without evidence → pending, hex colours, mailto contact); settings/deploy/create-pages pages render with no PHP notices; `uninstall.php` opt-in deletes events (incl. trash), options and approval flag and keeps attachments and pages; without opt-in it deletes nothing. Test data cleaned up and settings options restored.
- Not run: browser-driven end-to-end of the admin screens in this run (earlier attempt left screenshots in the scratchpad only), `wp.media` picker against a real media library.

## Requests
- None blocking. `scripts/check-css-scope.mjs` could also scan `plugin/wg-live/assets/admin` with `blocks: ['wg-live-admin']` (tooling owner).

## Contract issues
- The seed script writes `wg_live_settings` with `update_option` under WP-CLI where `admin_init` does not run, so the sanitizer is not involved; the stored shape (page ids, featured_event, deployment_mode) is exactly what `Settings::get()` accepts. If the sanitizer does run outside the settings form it keeps missing keys (non-form mode) and requires `Plugin::cap()`.
- Page-binding validation requires an existing non-trashed `page`; featured event requires a non-trashed `wg_live_event`.
