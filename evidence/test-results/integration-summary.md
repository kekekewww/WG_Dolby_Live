# Integration results (wp-env, real WordPress, M1)

## Latest run: 2026-10-17, commit 6757e6c (video default + audit fixes), wp-env inside WSL2

| Item | Value |
|---|---|
| Command | `npm run test:integration:wsl` |
| Stack | WordPress 7.1.3, PHP 8.2.34, Astra 4.14.0, Elementor 4.3.4, WooCommerce 11.2.1, wg-live 0.1.0 (unchanged) |
| Result | **183 passed, 1 skipped, 0 failed** (Chromium and WebKit, including all chained state projects) in 29.7 min. The skip is the lab CWV test on WebKit (Chromium only). |
| Clean ZIP install | `npm run test:zip-install` on `wg-live-0.1.0.zip`, 1,482,788 B, SHA-256 `e1464d9e49b40063aeb62357d2284715605183f140dc34eebe9cee4ebd3f9944` (clean build of 6757e6c): all checks passed |

New since 2026-10-13:
- Video is the default media kind (4d55486): `/playback` returns `video/mp4` + `demo-video-N.mp4` for video events and `audio/mpeg` + `demo-tone-N.mp3` for audio events.
- `settings.state.spec.ts`: an approved `demo_audio_binaural` attachment is served for an audio event only; a video event still gets the bundled mp4. (In the state project because the setting is global.)
- `deactivate.state.spec.ts`: Cart and the Checkout form rendered with an item in the cart, plugin on and off, with no wg-live asset or markup; no order is placed and the cart is cleared afterwards (`evidence/screenshots/integration/cart-checkout-with-item-*.json`).
- Lab LCP / CLS on wp-env (Chromium, no throttling, cold context, median LCP of 3, max CLS; lab data, not field data; `evidence/screenshots/integration/lab-cwv-chromium-state-deactivate.json`):

| Page | Plugin on | Plugin off |
|---|---|---|
| Home | LCP 260 ms, CLS 0 | LCP 268 ms, CLS 0 |
| `/live/` | LCP 584 ms, CLS 0.071 | LCP 244 ms, CLS 0 |
| `/live/listen/?wg_event=demo-live` | LCP 620 ms, CLS 0.056 | LCP 220 ms, CLS 0 |

  Home is the meaningful increment (the plugin adds only the featured-card CSS there). With the plugin off, the Live pages show the raw shortcode text, so their "off" column is not a like-for-like baseline. The CLS on `/live/` and the player page is deterministic: the client mount replaces the PHP placeholder. Both are within spec §13.4 (LCP ≤ 2.5 s, CLS ≤ 0.1).

---

## Run: 2026-10-13, commit a1152e4 (hybrid redesign plus test fixes), wp-env inside WSL2

| Item | Value |
|---|---|
| Command | `npm run test:integration:wsl` |
| Stack | WordPress 7.1.3, PHP 8.2.34, Astra 4.14.0, Elementor 4.3.4, WooCommerce 11.2.1, wg-live 0.1.0 (unchanged) |
| Result | **174 passed, 0 failed** (Chromium and WebKit, including all chained state projects) in 18.2 min. `admin-events.spec.ts` and `public-data.spec.ts` were then run again on both browsers: 80 passed in 11.2 min |
| Clean ZIP install | `npm run test:zip-install`: installed with WP-CLI into a throwaway WordPress 7.1.3 / PHP 8.2.34 / Twenty Twenty-Five with its own database, activated, then uninstalled. All checks passed (see below) on the a1152e4 build and again on the 4ba0f99 build (`wg-live-0.1.0.zip`, SHA-256 `0513088e1368e732f46fadd247ef965b98fc3f5b0b2cd9e44004d667d1a7c556`). `plugin/` and `src/` are the same in both commits |

Fixes in this round (tests and packaging only, no plugin change):
1. **Fixture leaks.** `deleteEventsByPrefix()` queried `post_status => 'any'`, which leaves out trash, so each run left one more `it-pred-*-trashed__trashed-N` event (37 had built up). It also matched only titles that start with the prefix, and the F13 fixtures are titled `【it-f13-…】春季音樂會`; when saved with an empty 代稱 they have no post_name. The helper now searches every status and matches the prefix anywhere in the title. After a full run the dev site holds only the four seeded demo events.
2. **Crashed-run accounts.** `admin-events.spec.ts` now removes `it-admin-<project>-*` and `it-editor-<project>-*` users left by a run that never reached `afterAll`. The editor login is scoped to the project, so Chromium and WebKit never delete each other's account.
3. **Reproducible ZIP (4ba0f99).** Two clean builds of a1152e4 hashed differently: `poster-demo.svg` had CRLF in one working copy (Git stores LF, so `git status` was clean). `package.mjs` now stores shipped text files with LF and `check:artifact` rejects CRLF; a build in a fresh checkout of 4ba0f99 gives the same SHA-256 as the one above.

Clean install checks (`scripts/zip-install-check.sh`):

| Check | Result |
|---|---|
| `wp plugin install wg-live-0.1.0.zip`, then `wp plugin activate wg-live` | Installed and activated, version 0.1.0 |
| Activation changes no pages, published pages, menus, theme, front page or rewrite rules | Same before and after |
| Deployment mode right after activation | `disabled` |
| CPT `wg_live_event`, shortcodes `wg_live` and `wg_live_featured`, REST `wg-live/v1/events`, `events/<slug>`, `playback` | All registered |
| `[wg_live_featured]` output | No `<script>` |
| HTTP through Apache: site, `?rest_route=/wg-live/v1/events` (`{"events":[]}` in disabled mode), `wg-live.js`, `wg-live-featured.css` | All 200 |
| Deactivate and uninstall | Plugin folder removed; settings kept (`delete_data_on_uninstall` is off by default) |
| `WP_DEBUG_LOG` during install, activation, requests and uninstall | Empty: no notice, warning, deprecation or error |

---

## Run: 2026-10-12, review fixes, wp-env inside WSL2

| Item | Value |
|---|---|
| Command | `npm run test:integration:wsl`: syncs to `~/wg-live` in WSL2, then runs Playwright from Windows (see `docs/implementation/WSL.md`) |
| Stack | WordPress 7.1.3, PHP 8.2.34, Astra 4.14.0, Elementor 4.3.4, WooCommerce 11.2.1, wg-live 0.1.0 |
| Result | **174 passed, 0 failed** (Chromium and WebKit, including all chained state projects) in 18.3 min |
| Speed | 0.6–1.2 s per WordPress request, against 5–25 s with wp-env on the Windows filesystem. A full run takes about 10–18 min instead of about 3 h. |

Fixes made during this run:
1. **Product bug, F1 follow-up.** `Shortcodes::defuse_brackets()` used `&#91;`/`&#93;`. WordPress's `do_shortcode()` ends with `unescape_invalid_shortcodes()`, which turns exactly those back into `[`/`]`. The featured-card title `[gallery]` was therefore still expanded by Elementor's second pass. The function now uses hex `&#x5B;`/`&#x5D;`, confirmed in the running WordPress. The unit test and the integration test were updated.
2. **Test helper.** wp-login's `wp_attempt_focus()`, which focuses and selects the username 200 ms after load, could swap the typed values on WebKit. A new shared `fillLoginForm()` waits for that focus and verifies both fields.
3. **Test environment.** wp-env names the site after the checkout folder (`wg-live` for the WSL mirror), so two specs that matched a bare `/wg-live/` against whole pages failed. The seed now sets `blogname` to "WG Studio Dev", and those assertions match only the plugin's own output.

---

## Earlier run (2026-10-10 to 2026-10-11, wp-env on the Windows filesystem)

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
| `pages.spec.ts` | Events, player and help pages mount on the bound pages with the versioned assets; F02 direct link, unknown or malformed slug, non-demo event without source; F11 reload, back, forward, `wg_mode` pre-selection; both modes play the demo on the real page (since 4d55486 a video event: `demo-video-N.mp4` in one `<video>`; an audio event plays `demo-tone-N.mp3`); a confirmed mode switch keeps one media element; the bootstrap has no source URL, meta or password. |
| `elementor.spec.ts` | F14: the Elementor page has one container and one media element; `WGLive.mountAll/mountWithin` and the `elementor/frontend/init` event add no element, no second `play()` and no duplicate listener; a simulated re-render destroys the old instance silently; in the real Elementor editor (preview frame) the widget mounts once, assets load once, dev tools show on `local`, and both a widget re-render and a shortcode change leave exactly one mount; `?elementor-preview` enqueues the app and card styles once. |
| `dev-tools.spec.ts` | Dev panel and no-cache headers on `local`; on `production` no panel for visitors, no query parameter (`debug`, `paid`, `dev`, ...) changes anything, no panel for a logged-in admin on the front end, in `?elementor-preview`, or in the real Elementor editor. |
| `public-data.spec.ts` | Public predicate: draft, pending, private, password, trashed, wrong post type, invalid (percent-encoded) 代稱, and no-start-time rows are excluded from the bootstrap, REST list, REST single, playback and the `event` shortcode attribute (also in an Elementor widget), for guests and admins. REST whitelist: exact PublicEvent keys, no `source_type`, meta, attachment URL or password; `Cache-Control: public, max-age=30`, identical for admin and guest, GET only. Playback: only the bundled demo URL, `no-store, no-cache, private`, past `Expires`, resolution order (mode, entitlement, source), 400 on bad arguments. |
| `featured.spec.ts` | Homepage card is server-rendered (works without JavaScript), loads no `wg-live.js`, no player stylesheet, no REST call, no media; no overflow at 360 px; unrelated pages load no plugin asset. |
| `admin-events.spec.ts` | F13 in the real admin: a Chinese title never becomes a 代稱; empty 代稱 stays draft with a notice (browser hint and server rule); valid 代稱 publishes and converts the start time to UTC; the Chinese-titled event plays in both modes; invalid start time keeps the old value; `source_type` demo on a non-demo event and M2 types are refused; duplicate 代稱 never gets a `-2`; 8 malformed 代稱 values revert a published event to draft and keep its name; bad product URLs refused; a form post without the plugin nonce changes nothing; a programmatic publish without 代稱 becomes draft; an Editor-role user gets 403 on every plugin screen and on the create-pages handler. |
| `disabled.state.spec.ts` | Mode `disabled` hides events on REST list and single, playback, the page bootstrap of four pages, the rendered events, player and Elementor pages and the homepage card (fallback text, no link) at once; help stays available; each save bumps the settings version and records the admin; demo brings everything back. |
| `settings.state.spec.ts` | Host-mismatch warning for a foreign account URL, event buy link and FAQ text link; link overrides reach the pages and fall back to WooCommerce My Account; non-http(s) links refused; draft, trashed, password-protected, missing and unset featured events give the fallback card; create-suggested-pages lists conflicts and offers no form, refuses in the handler when a conflict appears after the form was shown, creates three drafts with the right shortcodes and parent, never publishes, and replaces bindings only with the second confirmation. |
| `deactivate.state.spec.ts` | F15: after deactivation Shop, My Account, Cart, Checkout, Sample Page and Home render (until 6757e6c the Checkout entry was an empty cart redirected to Cart; since then a separate test renders Cart and the Checkout form with an item in the cart, plugin on and off), Live pages show the raw shortcode text (documented in `docs/deploy/ROLLBACK.md`), the REST routes are gone, events, options, pages, menus, theme and rewrite rules are untouched, reactivation restores everything without touching settings. Regression: 7 desktop (1280 px) and 3 mobile (390 px) full-page screenshots, plugin on versus off, 0 differing pixels on every page in both browsers (`evidence/screenshots/integration/regression-*.json`). |

## Not covered

- Real-device Safari, Atmos devices, the compatibility table (still 尚待測試).
- WordPress staging environment type (only `local` and `production` exist in wp-env; the staging-plus-admin gate in D17 is not exercised).
- Elementor Pro, other Elementor versions, real cache or optimizer plugins, multisite, uninstall with `delete_data_on_uninstall`.
- Firefox (not part of the integration projects).
- `/playback` media load and the 300-stream load test (M2, §13.5).
