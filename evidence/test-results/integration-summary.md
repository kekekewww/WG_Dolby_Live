# Integration results (wp-env, real WordPress, M1)

Run: 2026-10-10 to 2026-10-11, Windows 11, Docker Desktop, Node 22.17, `@playwright/test` 1.64.0 (Chromium and WebKit; WebKit is not Safari).
Config: `playwright.integration.config.ts` (`npm run test:integration`). HTML report: `playwright-report-integration/index.html` (git-ignored).

## Environment (both wp-env instances)

| Item | Version |
|---|---|
| WordPress | 7.1.3 (`WordPress/WordPress#7.1.3`) |
| PHP | 8.2.34 |
| Astra (theme, active) | 4.14.0 |
| Elementor | 4.3.4 (free; Elementor Pro is not installed) |
| WooCommerce | 11.2.1 |
| wg-live | 0.1.0, mounted from `./plugin/wg-live`, active |
| dev site `:8888` | `WP_ENVIRONMENT_TYPE=local` |
| tests site `:8889` | `WP_ENVIRONMENT_TYPE=production` (seeded by the same afterStart script) |

Activation of wg-live, and every deactivate/activate cycle in the specs, printed no PHP notice, warning or deprecation (checked on the WP-CLI output, and the Apache container log had none after the full seed).

## Result

| Phase | Chromium | WebKit |
|---|---|---|
| Read-only and fixture specs (parallel) | 68 passed | 68 passed |
| State-changing specs (one file at a time) | 12 passed | 12 passed |
| **Total** | **80 passed** | **80 passed** |

0 failed, 0 skipped. The suite was run as one `npm run test:integration` invocation up to its first failing state spec (144 passed, an assertion on the path of a draft page that was too strict, fixed in the spec), and the five state projects that had not run yet were then run one by one with `--no-deps` (all passed). Total wall time about 3 h, because every uncached WordPress request takes 5 to 25 s on this machine (the WordPress files sit on a 9p mount).

Also re-run after the `src/main.ts` fix: `npm run typecheck`, `npm run lint`, `npm run lint:php`, `npm run test:unit` (1012 tests), `npm run build`, `npm run package`, `npm run check:artifact`, and the harness e2e suite (586 passed, 2 skipped as before).

## What the specs prove

| Spec | Covers |
|---|---|
| `pages.spec.ts` | Events, player and help pages mount on the bound pages with the versioned assets; F02 direct link, unknown or malformed slug, non-demo event without source; F11 reload, back, forward, `wg_mode` pre-selection; both modes play the demo audio on the real page; confirmed mode switch keeps one `<audio>`; the bootstrap has no source URL, meta or password. |
| `elementor.spec.ts` | F14: the Elementor page has one container and one media element; `WGLive.mountAll/mountWithin` and the `elementor/frontend/init` event add no element, no second `play()` and no duplicate listener; a simulated re-render destroys the old instance silently; in the real Elementor editor (preview frame) the widget mounts once, assets load once, dev tools show on `local`, and both a widget re-render and a shortcode change leave exactly one mount; `?elementor-preview` enqueues the app and card styles once. |
| `dev-tools.spec.ts` | Dev panel and no-cache headers on `local`; on `production` no panel for visitors, no query parameter (`debug`, `paid`, `dev`, ...) changes anything, no panel for a logged-in admin on the front end, in `?elementor-preview`, or in the real Elementor editor. |
| `public-data.spec.ts` | Public predicate: draft, pending, private, password, trashed, wrong post type, invalid (percent-encoded) 代稱, and no-start-time rows are excluded from the bootstrap, REST list, REST single, playback and the `event` shortcode attribute (also in an Elementor widget), for guests and admins. REST whitelist: exact PublicEvent keys, no `source_type`, meta, attachment URL or password; `Cache-Control: public, max-age=30`, identical for admin and guest, GET only. Playback: only the bundled demo URL, `no-store, no-cache, private`, past `Expires`, resolution order (mode, entitlement, source), 400 on bad arguments. |
| `featured.spec.ts` | Homepage card is server-rendered (works without JavaScript), loads no `wg-live.js`, no player stylesheet, no REST call, no media; no overflow at 360 px; unrelated pages load no plugin asset. |
| `admin-events.spec.ts` | F13 in the real admin: a Chinese title never becomes a 代稱; empty 代稱 stays draft with a notice (browser hint and server rule); valid 代稱 publishes and converts the start time to UTC; the Chinese-titled event plays in both modes; invalid start time keeps the old value; `source_type` demo on a non-demo event and M2 types are refused; duplicate 代稱 never gets a `-2`; 8 malformed 代稱 values revert a published event to draft and keep its name; bad product URLs refused; a form post without the plugin nonce changes nothing; a programmatic publish without 代稱 becomes draft; an Editor-role user gets 403 on every plugin screen and on the create-pages handler. |
| `disabled.state.spec.ts` | Mode `disabled` hides events on REST list and single, playback, the page bootstrap of four pages, the rendered events, player and Elementor pages and the homepage card (fallback text, no link) at once; help stays available; each save bumps the settings version and records the admin; demo brings everything back. |
| `settings.state.spec.ts` | Host-mismatch warning for a foreign account URL, event buy link and FAQ text link; link overrides reach the pages and fall back to WooCommerce My Account; non-http(s) links refused; draft, trashed, password-protected, missing and unset featured events give the fallback card; create-suggested-pages lists conflicts and offers no form, refuses in the handler when a conflict appears after the form was shown, creates three drafts with the right shortcodes and parent, never publishes, and replaces bindings only with the second confirmation. |
| `deactivate.state.spec.ts` | F15: after deactivation Shop, My Account, Cart, Checkout, Sample Page and Home render, Live pages show the raw shortcode text (documented in `docs/deploy/ROLLBACK.md`), the REST routes are gone, events, options, pages, menus, theme and rewrite rules are untouched, reactivation restores everything without touching settings. Regression: 7 desktop (1280 px) and 3 mobile (390 px) full-page screenshots, plugin on versus off, 0 differing pixels on every page in both browsers (`evidence/screenshots/integration/regression-*.json`). |

## Not covered

- Real-device Safari, Atmos devices, the compatibility table (still 尚待測試).
- WordPress staging environment type (only `local` and `production` exist in wp-env; the staging-plus-admin gate in D17 is not exercised).
- Elementor Pro, other Elementor versions, real cache or optimizer plugins, multisite, uninstall with `delete_data_on_uninstall`.
- Firefox (not part of the integration projects).
- `/playback` media load and the 300-stream load test (M2, §13.5).
