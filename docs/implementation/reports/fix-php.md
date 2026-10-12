# Fix report: group php

Scope: plugin/wg-live/**, tests/unit/php-*.test.ts. Nothing committed.

## Findings

| Finding | Result |
|---|---|
| php-security/F1 (Elementor second do_shortcode pass) | Fixed as suggested. `Public_Data::encode_config()` escapes `[` and `]` to `[` / `]` inside JSON string literals only (array brackets untouched). New `Shortcodes::defuse_brackets()` (`[` and `]` to `&#91;` / `&#93;`) wraps every text output, the poster alt, and the href/src URLs in `templates/featured.php`. |
| php-security/F2 (unescaped colour in notice) | Fixed: `esc_html( self::shorten( $raw, 20 ) )` in `Settings::sanitize()`. Other notices checked: none interpolate user input. |
| php-security/F3 and spec-compliance/F10 (attachment slug clash) | Fixed: `Settings::find_page()` queries `post_type IN ('page','attachment')`, same parent and status filter, `ORDER BY (post_type='page') DESC` so pages win. Applied to all three pages, not only `live` (an attachment under an existing live page is also a real clash). Preview row appends "，媒體庫檔案" for attachments. Preview and handler share `page_conflicts()`, so one change covers both. |
| spec-compliance/F12 (account link order) | Fixed per orchestrator decision (a): `Site_Links::wc_or_override()` (renamed from `override_or_wc`) uses the WooCommerce page first, only when active and published, else the override, else null. Same order for `store`; `contact` is unchanged. Section help text in settings updated. |
| spec-compliance/F3 and F4 | Changed approach per decision (b), not the review's "no force-draft" suggestion. New `Events::require_title_and_start()` runs on both exits of `filter_insert_post_data`: publish/future/private with an empty (tag-stripped) title or no valid start time becomes draft plus an error notice, using the same `forced_draft` / redirect mechanism as the slug rule. It also flashes when the slug already forced a draft. `will_have_start_time()` mirrors `save_post()`: with the form, a blank field clears the time (blocked), a malformed value keeps the stored time (passes if one is stored); Quick Edit / `wp_update_post` use the stored time; `meta_input` is honoured. A programmatic insert with no ID cannot carry meta yet, so it is not blocked. Otherwise the wp-env fixtures and `seed-demo.php` would break. Also added the review's defence for legacy and programmatic rows: warning text "設定之前不會顯示在前台", a list-column flag "未設定：不會公開" for published events, and a featured-selector suffix. `public_event()` stays strict (`startsAt` non-null contract). |

## Tests added

`tests/unit/php-review-fixes.test.ts` (15 tests). PHP source-shape guards for each fix, since PHP cannot run in vitest.

Behaviour was also checked in Docker (php:7.4 and php:8.3, WP-stub harness in the session scratchpad):
- `encode_config` round-trips via `json_decode`, brackets are escaped only inside strings, and no `[x` sequence remains.
- 13 `filter_insert_post_data` cases behave as designed: form with and without title or start, garbage start with and without a stored time, draft not blocked, bad slug plus empty title gives both notices, programmatic insert passes, update with and without a stored start, `meta_input` present or blank.

## Gates

typecheck ok; lint ok; test:unit 34 files / 1062 tests pass; lint:php ok (php -l 7.4 and 8.3, PHPCompatibilityWP).

## Needs follow-up outside my ownership

- `tests/integration/settings.state.spec.ts` lines 83-91 still assert the old order (override beats WooCommerce). With WooCommerce active, `links.account` is now `/my-account/`. Needs update (the override is used only without WooCommerce or an unpublished page). Not run: wp-env integration needs the stack.
- M1-PLAN line ~152 and any doc describing "override wins" should be changed to the spec 10.4 order. No deviation row is needed any more.
- A new integration test for empty-title / no-start publish via the admin form would be good (form path: `publishWithoutScript`).
