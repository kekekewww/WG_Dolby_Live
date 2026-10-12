# Review: tooling and release (build, package, check:artifact, lint, harness, load test, seed)

Independent read-only review of commit `bc1e150`. Scope: `scripts/**`, `vite.config.ts`, `playwright*.config.ts`, `eslint.config.js`, `.wp-env.json`, `package.json`, `dev/**`, checked against M1-PLAN rev 2 (§3.3, §5, §7.1 to §7.4), the spec (§11, §13.5, §15.1, §18.3, §19) and CLAUDE.md. No repository file was changed apart from this report.

How the findings were verified:
- All in-scope files were read in full. So were the contracts they implement: `class-public-data.php`, `class-playback-provider.php`, `class-entitlement.php`, `wg-live.php`, the templates, `class-assets.php` (version use), `docs/deploy/STAGING.md` and `PRODUCTION.md`, and the tooling, integrate, e2e, wp-integration and deploy-docs reports.
- Probes ran in a scratch directory and imported the repo modules. They wrote nothing into the repo:
  - `checkCss()` on crafted selectors;
  - `shouldShip()` on crafted paths;
  - `createZip()` run twice on the real plugin directory. Both runs gave the same bytes as `artifacts/wg-live-0.1.0.zip`, SHA-256 `daa85230…`;
  - `checkZip()` on in-memory variants of the real ZIP;
  - `isAllowedRequest()` on crafted URLs;
  - `eslint --print-config` on a report path.
- `node scripts/check-artifact.mjs` was run on the existing artifact and passed all 10 rows.

Nothing below repeats an item that M1-PLAN or the reports record as an accepted decision. Those include the mock's `no-store` caching, the demo `*.mp3` pattern, the featured entry deviation, PHP 8.2 in wp-env while linting 7.4/8.3, and the alpha PHPCompatibility pins.

## Findings (most severe first)

| # | Sev | File:line | Finding |
|---|---|---|---|
| 1 | High | `scripts/build-info.mjs:20-24, 65-70`; `scripts/package.mjs:180-199` | The build commit ignores uncommitted changes. The shipped artifact names a commit that contains no code. |
| 2 | Medium | `scripts/check-artifact.mjs:133-138, 164-172`; `scripts/package.mjs:64-76`; `.wp-env.json:6` | A ZIP that is missing required runtime files passes every gate, and no test ever installs the ZIP. |
| 3 | Medium | `scripts/package.mjs:39, 64-68`; `scripts/check-artifact.mjs:46, 151-162` | The allowlist checks directories, not file types. `includes/`, `templates/` and `licenses/` ship any file type, and check-artifact reuses the same function. |
| 4 | Medium | `scripts/check-artifact.mjs:243-261`; `scripts/package.mjs:172-179`; `plugin/wg-live/wg-live.php:18-19` | `WG_LIVE_VERSION` is never checked, although the comment in `wg-live.php` says check:artifact covers it. |
| 5 | Low | `scripts/check-css-scope.mjs:98-107, 129-132` | The sibling-combinator rule can be bypassed through `:is()`/`:where()`. |
| 6 | Low | `playwright.config.ts:43-48` | Every e2e run, including `test:e2e:dev`, rebuilds and empties the dist folder that wp-env is serving. |
| 7 | Low | `playwright.integration.config.ts:26, 37, 43-44` | A new `*.state.spec.ts` file is silently never run. |
| 8 | Low | `eslint.config.js:15-24` | `playwright-report-integration/` is not ignored, so `npm run lint` fails after a failed integration run. |
| 9 | Low | `eslint.config.js:36-37, 79-84` | The D12 markup-sink bans do not apply to the shipped `assets/admin/admin.js`. |
| 10 | Low | `scripts/seed-demo.php:33, 412-427, 455-471` | The seed script has no environment or opt-in guard. `setup` changes the front page, theme and permalinks on any site it is run against. |

### 1. High: the build commit ignores uncommitted changes, and the artifact names a commit with no code

`gitCommit()` runs `git rev-parse --short HEAD` and records the result as-is. It never checks for a dirty working tree; it only falls back to `'uncommitted'` when git fails. Neither `package.mjs` nor `check-artifact.mjs` compares `build-info.commit` with HEAD, rejects `'uncommitted'`, or checks that the dist was built from the current source. `package.mjs` only checks that the dist matches `build-info.json`, which is self-consistency, not freshness.

This is happening in the current release. `artifacts/wg-live-0.1.0.zip` → `assets/dist/build-info.json` has `"commit": "e4dfc15"`, built at `2026-10-10T18:01:02Z`. The code was committed 38 s later as `bc1e150` (`02:01:40+08:00`). `e4dfc15` holds only the spec, `CLAUDE.md` and the dotfiles. The admin「部署資訊」screen shows this value as 建置 commit (`class-settings.php:1334`). DEPLOY-RECORD and HANDOVER take their "Git commit" field from it (spec §18.3). Nobody can rebuild or audit the shipped ZIP from the recorded commit, which breaks the §19 requirement「開發者能重現建置」.

There is also a second gap. A developer who edits `src/` and runs `npm run package` without `npm run build` ships the old bundle, and package and check:artifact both pass.

`builtAt` also makes the build non-reproducible. Every `npm run build` rewrites `build-info.json`, so the ZIP's SHA-256 changes even when the commit and the three bundle hashes are identical. If the staging-approved ZIP is lost, rebuilding the same commit cannot reproduce the approved SHA (STAGING §0 requires the same SHA).

**Fix:**
- Record `git status --porcelain` (excluding `plugin/wg-live/assets/dist`) and write `commit: "<sha>-dirty"` or `dirty: true`.
- Make `package.mjs` refuse a dirty or `'uncommitted'` build unless an explicit `--allow-dirty` flag is passed. Also make it refuse when `build-info.commit` differs from HEAD.
- Derive `builtAt` from the commit time (`git log -1 --format=%cI`), or move it out of the shipped file.
- Re-run build and package for 0.1.0 from the clean `bc1e150`.

### 2. Medium: a ZIP missing required runtime files passes every gate

check-artifact requires only `wg-live/wg-live.php`, the four dist files and a readme with a Stable tag. Each of these in-memory variants of the real artifact passed all 10 checks:
- without `includes/class-events.php`;
- without both `assets/demo/demo-tone-*.mp3`;
- without `assets/admin/admin.js`, `uninstall.php`, `templates/player.php` and `templates/partials/container.php`.

Several things make this a real gap:
- `wg-live.php:35-43` `require_once`s nine include files.
- `Playback_Provider::BUNDLED` needs both MP3s. When they are missing, demo playback quietly becomes `source_not_configured`.
- `shouldShip()` drops any file outside the allowlist without a warning (`package.mjs:75`). For example, a future `languages/*.mo`, `assets/img/*` or `assets/admin/*.svg` would disappear from the ZIP.
- Integration tests run against the source bind mount (`.wp-env.json:6`), not the ZIP. No test installs the artifact.

So nothing checks the one artifact that actually ships. Concrete scenario: an update uploaded through 外掛 → 上傳 ("Replace current with uploaded") swaps the files of a plugin that is already active. A missing include then gives a site-wide fatal error on the next request. The activation sandbox does not run in this path.

**Fix:**
- Add a required-file manifest to check-artifact: every `require_once` target parsed from `wg-live.php`, `uninstall.php`, `templates/{events,player,help,featured}.php` and `templates/partials/container.php`, both demo MP3s, the poster, `LICENSE-demo.txt`, and `assets/admin/admin.{js,css}`.
- Make `package.mjs` list every skipped non-dot file and fail on files it does not recognize.
- Optionally, add an integration job that installs the ZIP with `wp plugin install <zip> --force` in `tests-cli`.

### 3. Medium: the allowlist checks directories, not file types, and check-artifact is not independent

`shouldShip()` returns `true` for:
- any top-level `*.php`;
- anything under `includes/`, `templates/` and `licenses/`, unless `EXCLUDED_EXT` (`ts|tsx|map|woff2?|ttf|otf|eot|zip|sql|log`) matches.

Probe results: these all ship:
- `includes/x.php.bak`, `includes/class-x.php~`
- `includes/dump.sql.gz`
- `includes/secret.json`
- `includes/x.phar`
- `includes/Thumbs.db`
- `templates/notes.md`
- `licenses/a.exe`
- a top-level `phpinfo.php`
- `LICENSE-keys.pem`

check-artifact's own allowlist row calls the same `shouldShip()`, and its `FORBIDDEN_EXT` is the same list. So it cannot catch a packager mistake, and in-memory ZIPs with `includes/class-settings.php.bak`, `includes/backup.sql.gz` and `includes/credentials.json` passed.

Spec §15.1 excludes raw databases, test recordings, host backups and credentials. A `.php.bak` copy is served as plain text by most hosts, which discloses source. A stray DB dump inside the plugin folder becomes publicly downloadable from `/wp-content/plugins/wg-live/includes/`.

**Fix:**
- Allow by extension per directory:
  - `includes/` and `templates/`: `*.php` only;
  - `licenses/`: `*.txt` and `*.md`;
  - top level: an explicit list (`wg-live.php`, `uninstall.php`, `readme.txt`, `LICENSE*`).
- Give check-artifact its own independent allowlist (a literal expected-path pattern table) instead of importing `shouldShip`.
- Add `gz|tgz|tar|7z|bak|orig|swp|sqlite|db|webm|mp4|mov|pem|key|env|phar` to the forbidden extensions in both scripts.

### 4. Medium: `WG_LIVE_VERSION` is never checked

`wg-live.php:18` says to keep the version in sync with package.json, the readme and build-info.json, and claims check:artifact covers it. The versions row actually compares package.json, the header `Version:`, the readme Stable tag, build-info.json and the ZIP name. It never reads `define( 'WG_LIVE_VERSION', … )`, and neither does package.mjs.

A ZIP whose define was changed to `'0.0.9'` passed all checks. The constant feeds:
- the「外掛版本」row of the deployment screen (`class-settings.php:1329`), which STAGING §3 step 5 compares with the ZIP name;
- `BootConfig.pluginVersion` (`class-public-data.php:303`);
- the cache-busting `?ver=` of the demo media (`class-playback-provider.php:132`);
- the asset `ver` fallback (`class-assets.php:166`).

After a version bump that misses the define, a new demo MP3 keeps its old `?ver` and stays cached. The deployment screen also shows the wrong version.

**Fix:** parse the `WG_LIVE_VERSION` define in `package.mjs` (throw on mismatch) and add it as a sixth source in the check-artifact versions row.

### 5. Low: the sibling-combinator rule can be bypassed through `:is()`/`:where()`

`isRoot` is true only when the first compound has a root class **and no `__` class**. `rootTestClasses` also collects every class inside `:is()`/`:where()`, so adding any element class inside the pseudo turns the sibling check off. Confirmed with `checkCss()` (zero violations each):

- `:is(.wg-live, .wg-live__x) + p { … }`: matches the root container, so the rule styles the host element right after the plugin.
- `.wg-live:is(.wg-live__nope, *) ~ p { … }`
- `.wg-live:where(:not(.wg-live__x)) ~ p { … }`

A "lobotomized owl" spacing rule such as `:is(.wg-live__section, .wg-live) + * { margin-top: … }` is a realistic way to write this by accident. It would add margin to the Elementor widget that follows the shortcode on every bound page. M1-PLAN §3.3 makes this checker the authoritative gate on the built CSS.

**Fix:** for each argument of `:is()`/`:where()` in the first compound, run the root test separately. If any argument is a root compound and a `+`/`~` follows, reject.

### 6. Low: every e2e run rebuilds the dist folder that wp-env is serving

Playwright starts every `webServer` entry for any `--project` selection. So `npm run test:e2e:dev`, which runs only the dev projects, still runs `npm run build`.

Build #1 has `emptyOutDir: true`, so it deletes `plugin/wg-live/assets/dist/*`. That folder is the one wp-env bind-mounts. While the two Vite builds and `build-info.mjs` run, WordPress sees no build: `Assets::is_build_present()` is false, nothing is enqueued, and the missing-build notice appears. An integration run in progress at that moment fails; on Windows a full integration run takes about 3 hours (wp-integration report). The rebuild also rewrites `build-info.json`.

**Fix:**
- Build into a temporary directory and swap it in atomically.
- Or start the dist server only when `harness-dist` is selected, for example through an env flag set by `test:e2e:dist`/`test:e2e`.
- At minimum, document that e2e must not run while wp-env integration is running.

### 7. Low: a new state spec file is silently never run

The read-only projects ignore `**/*.state.spec.ts`. The state projects match only the hard-coded names `disabled`, `settings` and `deactivate`. A new file such as `pages.state.spec.ts` matches no project. Playwright reports no error, and the suite stays green with that file's tests never executed. The three existing files are covered today.

**Fix:** build `STATE_FILES` from `readdirSync('tests/integration')`, or add a catch-all state project that fails when it finds any unlisted file.

### 8. Low: `playwright-report-integration/` is not ignored by ESLint

The `ignores` list has `playwright-report/**` but not `playwright-report-integration/**`. `eslint --print-config playwright-report-integration/trace/sw.bundle.js` returns a config, so the path is linted. `playwright-report/...` returns `undefined`.

The integration config uses `trace: 'retain-on-failure'`. When any trace exists, Playwright's HTML reporter copies the trace viewer bundles into `<report>/trace/` (checked in `node_modules/playwright/lib/runner/index.js`). After one failed integration test, `npm run lint` (`eslint .`) lints minified third-party JS that has no globals configured. It fails with `no-undef` and similar errors, which blocks the lint gate for reasons unrelated to the code.

**Fix:** add `'playwright-report-integration/**'` and `'blob-report/**'` to `ignores`.

### 9. Low: the D12 sink bans do not cover the shipped admin JS

The `no-restricted-properties`/`no-restricted-syntax` block (innerHTML, outerHTML, insertAdjacentHTML, srcdoc, document.write, `setAttribute('on…')`) applies only to `src/**/*.ts` and `dev/**/*.ts`. The block for `plugin/wg-live/assets/admin/**/*.js` sets only globals.

`admin.js` ships in the ZIP and handles admin-entered FAQ and compatibility rows. Writing `rows.insertAdjacentHTML('beforeend', …)` or setting `el.innerHTML = value` there passes `npm run lint`. The current file is clean: it uses `template.content.cloneNode` and `setAttribute` on attribute values only.

**Fix:** add `'plugin/wg-live/assets/admin/**/*.js'` to the D12 block's `files`.

### 10. Low: the seed script has no environment or opt-in guard

`seed-demo.php` checks only `ABSPATH`. With `setup`, it acts on whatever site `wp eval-file` points at:
- it runs `switch_theme('astra')`;
- it changes the permalink structure and calls `flush_rewrite_rules(true)` with `got_rewrite` forced, which rewrites `.htaccess`;
- it sets `show_on_front=page` and `page_on_front` to a new「WG Live Home」page, replacing the current homepage (production is ID 8);
- it turns off `woocommerce_coming_soon`;
- it **publishes** `live`, `live/listen`, `live/help`, `live-elementor` and four events. One of them, `pending-source`, is a non-demo「直播中」test event.
- it sets `deployment_mode=demo`.

Even without `setup`, it publishes the four events. Run once on a staging copy of production, it re-points the homepage and makes test events public. CLAUDE.md requires explicit authorization for publishing and for overwriting existing pages.

An environment-type guard alone will not work, because the wp-env tests site is deliberately `production`.

**Fix:** require an opt-in that only wp-env sets, for example `defined('WG_LIVE_SEED_ALLOWED') && WG_LIVE_SEED_ALLOWED` added to `.wp-env.json` `config`. Refuse to run otherwise.

## Checked, no defect found

- **ZIP layout and reproducibility of the packaging step.**
  - Single `wg-live/` root, forward slashes, sorted entries, no directory entries.
  - The fixed DOS mtime is TZ-independent: fflate uses local-time getters, `new Date(2020,0,1)` is local, and no extended-timestamp extra field is written.
  - `createZip()` gives identical bytes on repeated runs and matches the shipped artifact. `entryNameProblem()` and check row 1 reject backslashes, drive letters, `..`, empty segments and absolute names.
  - The `.sha256` file is in `sha256sum -c` format and LF-terminated.
- **check-artifact rows 4 and 6 to 10** behave as M1-PLAN §7.3 specifies. That covers the exact dist set with hashes, dev strings, CSS scope on the shipped CSS (with `.wg-live-admin` only under `assets/admin/`), gzip-9 per-page budgets, the versions it does read, and the checksum.
- **load-test guard.**
  - `--target` and `--approved` are mandatory, including for `--dry-run`. The target must be an origin with no credentials, path or query.
  - Every URL, including redirect targets, goes through `isAllowedRequest()`. Each of these was refused:
    - `rest_route=/wg-live/v1/play%62ack`, `/wp-json/.../events%2F..%2Fplay%62ack` and `/events/../playback`;
    - PHP's `rest.route` → `rest_route` key mangling (the page-query allowlist rejects it);
    - `/live/?rest_route=/wp/v2/users`, any query on REST routes, `/assets/demo/` and media extensions in any case.
  - A media `Content-Type` response stops the run.
  - The tool never requests `/playback`. 300 page-load VUs is the ceiling, and 300 streams is out of reach by construction.
- **lint-php.**
  - Node finds the PHP files under `plugin/` and `scripts/` (17, including `seed-demo.php`) and fails when there are none.
  - The container `find … -print0 | xargs -0 -n1 php -l` count must equal the Node count, on both 7.4 and 8.3.
  - The Docker paths use forward slashes and no shell runs on the host. `phpcs.xml.dist` covers the plugin and the seed script.
- **build-info.mjs and vite.config.ts.**
  - The fixed set is enforced and stray files are removed. The Vite CSS marker is stripped before hashing.
  - Build #2 uses `emptyOutDir: false` and drops its JS. `copyPublicDir: false` and `sourcemap: false` are set, and the D15 targets are applied to both builds.
- **dev mock REST and harness vs the real PHP.**
  - Resolution order follows §5.1, including entitlement before source. Disabled behaves as D16. `wg_live_not_found` comes back as 404. Both REST root forms are handled, and the bootstrap's escaping matches the PHP flags.
  - The remaining differences have no effect at runtime, because the client validates before it requests:
    - `playback?event=0`: the mock answers 200 `event_not_found` where WP answers 400 (`minimum: 1`);
    - uppercase or over-100-character slugs: the mock answers 404 `rest_no_route` where WP answers 400;
    - the mock serves events unsorted, but the client sorts them;
    - the mock returns a relative demo URL where WP returns an absolute one with `?ver=`.
  - `serve-dist.mjs` serves only the files named in build-info, rejects path traversal and uses the same `?ver=` (first 12 hex characters) as `class-assets.php`.
- **wp-env.** Core, PHP, theme and plugin zips are pinned. The tests site is `production` for the D17 test. The `scripts/` mapping exposes `seed-demo.php` over HTTP, but its `ABSPATH` guard makes a direct request exit.
