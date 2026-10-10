# Report: tooling-rev2

Brings build, test, lint and package tooling in line with M1-PLAN rev 2 (D3, D7, D11, D15, 2.0, 3.3, 7, 7.3).

## Files created or changed

Toolchain and config
- `package.json`, `package-lock.json`: `engines` (`>=22.13 <23 || ^24 || >=26`), `browserslist` (D15), exact devDeps `postcss 8.5.29`, `postcss-selector-parser 7.1.6`, `eslint-plugin-compat 7.0.2`, `@axe-core/playwright 4.13.0`. New scripts: `test:e2e:dev`, `test:e2e:dist`, `serve:dist`. `test:e2e` is still `playwright test` and runs every project.
- `.nvmrc` (`22`), `.npmrc` (`save-exact=true`, `fund=false`).
- `vite.config.ts`: D15 `target` + `cssTarget`, `copyPublicDir:false`, `cssCodeSplit` only for the featured build. Build 2 now uses the D3 entry `{ 'wg-live-featured': 'src/styles/featured.css' }` with `formats: ['es']` (`src/featured.ts` is no longer used; the empty JS chunk Rolldown emits is still dropped by the post plugin). `emptyOutDir` stays per mode. Vitest `setupFiles`.
- `tests/setup/vitest.setup.ts`: polyfills `HTMLDialogElement.show/showModal/close`, safe `HTMLMediaElement.play/pause/load` (writable, so `vi.spyOn` works), `matchMedia`.
- `eslint.config.js`: `eslint-plugin-compat` (flat/recommended, browserslist from package.json) on `src/**` and `dev/client/**`; D12 bans: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `srcdoc`, `document.write/writeln`, destructured `innerHTML/outerHTML/srcdoc`, `setAttribute('on…')` / `setAttributeNS(null,'on…')` / template-literal names, plus `no-eval`, `no-implied-eval`, `no-new-func`. Verified with a probe file.
- `playwright.config.ts`: projects `harness-dev-chromium`, `harness-dev-firefox`, `harness-dev-webkit` (ignore `*.dist.spec.ts`, baseURL :5174) and `harness-dist` (chromium, only `*.dist.spec.ts`, baseURL :5175); two `webServer` entries (Vite dev; `npm run build && node dev/serve-dist.mjs`).
- `.wp-env.json`, `scripts/wp-env-setup.mjs` (afterStart: runs the seed `setup` in `cli` and `tests-cli`).
- `phpcs.xml.dist` (new, repo root).

Scripts
- `scripts/check-css-scope.mjs`: rewritten on postcss + postcss-selector-parser, all 3.3 rules (see below). Exports `checkCss(css, file, {blocks})`, `isScopedSelector`, `findCssFiles`, `DEFAULT_BLOCKS`. `--dist` kept.
- `scripts/build-info.mjs`: exports `writeBuildInfo`, fixed set {wg-live.js, wg-live.css, wg-live-featured.css}, fails when one is missing, removes every other file in dist, records only the fixed files.
- `scripts/package.mjs`: allowlist per 7.3 (dist = exactly the 4 files; `assets/admin/**/*.{js,css}`; demo = `*.mp3`, `poster-demo.svg`, `LICENSE-demo.txt`, no `.m4a`); `entryNameProblem()`; verifies the dist hashes against `build-info.json` before zipping.
- `scripts/check-artifact.mjs`: gzip level 9 via `zlib.gzipSync`; per-page budgets (player: `wg-live.js` <= 100 KiB, `wg-live.css` <= 30 KiB; homepage: `wg-live-featured.css` <= 30 KiB, each separately); new `allowlist` check (every ZIP entry must pass `shouldShip`); empty path segments rejected. `assets/admin/*.css` may also use the BEM block `.wg-live-admin`; dist CSS may not.
- `scripts/lint-php.mjs`: see "PHP lint" below.
- `scripts/generate-demo-audio.mjs`, `scripts/seed-demo.php`: see below.

Dev harness (`dev/`)
- `dev/core.mjs` (new): framework-free core shared by Vite and the dist server (plain `.mjs`, `// @ts-check`): fixtures, BootConfig builder, stateless mock REST, `/demo/*` serving.
- `dev/harness.ts` (typed re-exports), `dev/mock-rest.ts` (Vite plugin wrapper).
- `dev/serve-dist.mjs`, `dev/dist/{index,listen,help,home}.html` (new).
- `dev/{index,listen,help}.html`: live region markup like the PHP container; notes list the variants.

Assets and evidence
- `plugin/wg-live/assets/demo/`: `demo-tone-1.mp3`, `demo-tone-2.mp3` regenerated; `demo-tone.m4a` and `demo-tone.mp3` deleted; `LICENSE-demo.txt` updated.
- `evidence/design-baseline/`: 105 PNG -> WebP.

Tests (all `tests/unit`): `check-css-scope.test.ts` (14), `check-artifact.test.ts` (26), `build-info.test.ts` (7), `smoke.test.ts` (rewritten for the real entry), `dev-harness.test.ts` (15, new).

## Key decisions

- CSS checker (3.3): the first compound of every selector must contain a whole-token class matching `wg-live`, `wg-live--*`, `wg-live__*`, `wg-live-featured`, `wg-live-featured--*` or `wg-live-featured__*` (`:is()`/`:where()` count only when every argument is itself scoped). `+`/`~` directly after a root compound is rejected (`.wg-live--x`, `.wg-live-featured`; element-to-element siblings are fine). `html`, `body`, `:root`, a bare `*` and `&` are rejected anywhere in a selector. Names of `@keyframes`, `@property` (`--wg-live-`), `@counter-style`, `@layer` and named `@container` need the `wg-live-` prefix. `@font-face`, `@import`, `@namespace`, `@page` and every unlisted at-rule (including `@scope`) fail; `@charset` is allowed. Rules inside `@media/@supports/@container/@layer/@starting-style` are checked recursively with correct line numbers. **CSS nesting is rejected** (plain CSS sources, flat build output); this reverses the old checker, which allowed it.
- `playwright.config.ts` has four projects instead of one `harness-dev` with three browsers, because a Playwright project has exactly one browser. Spec files for `harness-dist` must be named `*.dist.spec.ts`.
- `.npmrc` has no `engine-strict`: `@wordpress/env@11.17.0` pulls `@php-wasm/cli-util@3.1.57`, which declares `node >=24.18, npm >=11.16`, so `engine-strict=true` makes `npm ci` fail on Node 22.17.
- Harness variants are query parameters on any harness page: `?harness=disabled|plain|nodev` (comma separated), `?featured=<slug>`, `?heading=h1`, `?fixed=<slug>`. `disabled` makes BootConfig `deploymentMode:'disabled'`, `events: []`, and switches `rest.root` to `/disabled/wp-json/wg-live/v1/` (the mock answers like D16 under that prefix, so no server state is needed). `plain` switches to `/index.php?rest_route=/wg-live/v1/` (also under `/disabled/`).
- Mock REST follows 5.1 step by step, including the entitlement step: `entitled` only for a demo event with a demo source, otherwise `entitlement_unavailable`. Responses are `Cache-Control: no-store` (the plan says `public, max-age=30` for the real routes; the harness avoids stale data between tests).
- Harness fixtures live in `dev/core.mjs` (4 events: the 3 demo events plus `pending-source-live`, a non-demo `live` event with `sourceKind: 'not_configured'`), not in `src/fixtures/demo-events.ts`, because the dist server cannot import `.ts`.
- Demo audio: piece 1 is C major (Cmaj7-Am7-Fmaj7-G6, sine voices); piece 2 is A minor (Am9-Fmaj7-Cmaj7-Em7-Dm9, five chords, triangle-like voices, 3.1 Hz tremolo, faster pan). Both 30.00 s, stereo, 44.1 kHz, 96 kbps MP3, 2 s fades. See verification.
- `seed-demo.php setup`: pages and the front page are only created or updated when this script created them (post meta `_wg_live_seed=setup`). A foreign page at `live`, `live/listen`, `live/help`, `live-elementor` or `wg-live-home` stops the run with a clear error instead of being overwritten. The home page is `wg-live-home` ("WG Live Home", `[wg_live_featured]`) and becomes `page_on_front`. Added a non-demo seeded event `pending-source` (not_configured). No product is created.
- PHPCompatibility: `PHPCompatibilityWP 2.x` rests on `PHPCompatibility 9.3.5` (2019), which only knows PHP up to 8.0. The pinned pair `phpcompatibility-wp 3.0.0-alpha2` + `php-compatibility 10.0.0-alpha2` + `paragonie 2.0.0-alpha2` (+ phpcs 3.13.6, phpcsutils 1.2.3, installer 1.2.1) adds the 8.1-8.5 sniffs. They are alpha releases; replace with the stable 3.x when it ships.

## Verification (gates)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (eslint + src CSS scope) | pass |
| `npm run test:unit` | pass, 13 files / 215 tests (includes the other agents' tests present at the time) |
| `npm run build` | pass; `build-info.json` lists the 3 fixed files |
| `node scripts/check-css-scope.mjs --dist` | pass (12 CSS files) |
| `npm ci --dry-run` | pass (lockfile in sync). A real `npm ci` was not run so that `node_modules` was not wiped under the other agents. |
| `npm run lint:php` | pass: `seed-demo.php` on php:7.4-cli and php:8.3-cli, PHPCS + PHPCompatibilityWP 7.4-. Fails on zero files (no files = exit 2). Probe with `each()` / `utf8_encode()` in the plugin dir was reported and failed the gate, then removed. |
| `npm run demo:audio` + ffprobe/md5 | both `mp3 2ch 44100 Hz 96 kbps 30.00 s`; peak -18.5 / -18.4 dB; md5 `774d8951049ace1dafdb940df653eaec` vs `d75bc0f0db7adb053324d2c21c01c4a1`; zero-crossing rate per 4 s differs (about 790 vs 755, 597 vs 809 Hz) |
| Playwright, temporary specs (deleted afterwards) | `harness-dev-chromium/firefox/webkit` and `harness-dist` all pass: variants, both REST forms, Range on the MP3, built bundle mounts via `<link>` + `<script defer>`, no page errors |
| `npm run package` | expected failure: `plugin/wg-live/wg-live.php not found` (the PHP plugin is not written yet). The package/check pipeline is covered by the unit tests on a fake plugin. |
| wp-env (probe, see below) | pass |

## Pins

| What | Pin | Source |
|---|---|---|
| WordPress core | `WordPress/WordPress#7.1.3` | wordpress.org version-check API (latest stable 7.1.3, PHP 7.4+); git tag confirmed with `git ls-remote` |
| PHP (wp-env) | `8.2` | recorded known-good pair until the 3.1 inventory; the lint also covers 7.4 and 8.3 |
| Astra | `https://downloads.wordpress.org/theme/astra.4.14.0.zip` | themes API |
| Elementor | `https://downloads.wordpress.org/plugin/elementor.4.3.4.zip` (requires WP 6.8, PHP 7.4) | plugins API |
| WooCommerce | `https://downloads.wordpress.org/plugin/woocommerce.11.2.1.zip` (requires WP 7.0, PHP 7.4) | plugins API |
| PHPCS stack | see decisions above | packagist |
| Node / npm tools | `package.json` exact pins | npm |

Elementor Pro is not installed (no license). Re-pin core and PHP to the production values after the 3.1 inventory.

## Rename rule (design baseline screenshots)

Every screenshot in `evidence/design-baseline/` was converted from `*.png` to `*.webp` with the same base name (`home-1440x1000-chromium-first.png` -> `home-1440x1000-chromium-first.webp`; same pixel size, quality 80; 44.7 MB -> 5.8 MB). JSON files are untouched (they reference only site URLs, no local screenshot paths). `docs/implementation/design-baseline.md` still names `.png` in 7 places (not my file): replace `-first.png`, `-mid.png`, `-footer.png`, `-menu.png` with `.webp`.

## Requests (files I do not own)

1. `.gitignore`: nothing needed for PHPCS (cache is in `node_modules/.cache/wg-live-phpcs`). Consider adding `.cache/`, no action required.
2. `docs/implementation/design-baseline.md`: apply the rename rule above.
3. PHP/admin agent: `assets/admin/` may ship only `*.js` and `*.css` (other types are not on the package allowlist). Admin CSS must be scoped with `.wg-live-admin`, `.wg-live`, `.wg-live__*` or `.wg-live-featured` as the first class of each selector, with no nesting, no `:root/html/body`, no `@font-face`.
4. PHP agent: `Settings`' sanitize callback must accept the array that `seed-demo.php setup` writes with `update_option('wg_live_settings', …)` (keys `page_events`, `page_player`, `page_help`, `featured_event`, `deployment_mode`), and `wg_live_settings_meta` (`version`, `updated_at` as `Y-m-d H:i:s` UTC, `updated_by` 0).
5. PHP agent: events seeded by the script store booleans as `1`/`0` and lists as native arrays; slugs `demo-live`, `demo-upcoming`, `demo-ended`, `pending-source`.
6. E2E agent: dist specs must be named `*.dist.spec.ts`; project names are `harness-dev-chromium|firefox|webkit` and `harness-dist`; variants and fixture slugs are in `dev/core.mjs` (`pending-source-live` is the non-demo, not_configured event).
7. `src/featured.ts` is no longer a build entry (D3 entry is `src/styles/featured.css`); it can be deleted.

## Contract issues

- M1-PLAN 3.3 says the source check runs "without nesting". Implemented as: nesting is a violation. If a source file should be allowed to nest (Vite lowers it for Safari 15.4), the check needs a switch; not done.
- M1-PLAN 7.2 puts `env.tests.config` in `.wp-env.json`, which wp-env 11.17 still supports, but its README now prefers `--config` for parallel environments. Kept the plan's form.
- M1-PLAN 3.3 lists the scope classes as `.wg-live`, `.wg-live-featured`, `.wg-live__*`; the BEM modifier on the container (`.wg-live--player`) and `.wg-live-featured__*` are also accepted because the container template uses `wg-live--{view}`.
- `eslint-plugin-compat` only covers APIs in its data set; for example `Promise.withResolvers()` and `Object.groupBy()` are not flagged for Safari 15.4. ES built-ins beyond ES2022 are still limited by `tsconfig` `lib: ES2022`.

## wp-env probe

The real `.wp-env.json` could not be started as is (the PHP plugin has no `wg-live.php` yet). So the same pins (core 7.1.3, PHP 8.2, Astra 4.14.0, Elementor 4.3.4, WooCommerce 11.2.1, the `scripts/` mapping) were started from a throwaway config in the scratchpad, with a 20-line stub plugin that only registers the `wg_live_event` post type and the two shortcodes. Start took 400 s the first time (downloads). Then:

- `wp eval-file wp-content/wg-live-scripts/seed-demo.php setup` created Astra (activated), pretty permalinks (flushed once, .htaccess written), 4 events (#11-#14), pages live (#15), live/listen (#16), live/help (#17), live-elementor (#18), wg-live-home (#19, static front page), and the settings bindings.
- A second run: "0 created, 4 updated", "Astra already active", "permalinks already /%postname%/ (no flush)", settings "(unchanged)". Idempotent.
- HTTP 200 on `/`, `/live/`, `/live/listen/`, `/live/help/`, `/live-elementor/`, each showing its stub shortcode output; the Elementor document renders its Shortcode widget through Elementor 4.3.4 (container layout).
- The repo `.wp-env.json` was also loaded through wp-env's own config loader: development has `WP_ENVIRONMENT_TYPE=local`, tests has `production`; both use PHP 8.2, the pinned plugins/theme and the `wg-live-scripts` mapping; `afterStart` is `node scripts/wp-env-setup.mjs`.
- The probe environment was destroyed afterwards. NOT verified: `scripts/wp-env-setup.mjs` end to end (it runs the same command in `cli` and `tests-cli`), `npm run wp:start` with the real plugin, WooCommerce page creation interplay (it was installed and active, no conflict seen), the WP_DEBUG notice "translation loading for woocommerce triggered too early" comes from WooCommerce under WP 7.1 and is not ours.
