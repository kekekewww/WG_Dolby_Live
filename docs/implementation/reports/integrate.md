# Report: integrate

## Changes

- `src/dom.ts`: the `safeUrl` fallback base is now `https://wg-live.invalid/` instead of `http://localhost/`. `check:artifact` "dev strings" failed on the old value (php-core request).
- `dev/site-chrome.css`: the fake site body is now dark (`#111111`, text `#f0f5fa`) like the measured live site. Headings are lighter and `.site-note` has dark text. The aggressive global rules are unchanged. The old cream background made the plugin's light text unreadable in the harness (player-view open item).
- `scripts/check-css-scope.mjs`: `npm run lint` now also scans `plugin/wg-live/assets/admin/*.css`, with `.wg-live-admin` allowed as a scope block (php-admin request; same rule as check-artifact).
- `docs/implementation/design-baseline.md`: screenshot references are now `.webp` (decision 9). The remaining `.png` mentions are site logo file names.
- `CLAUDE.md`: the "no code yet" and "planned commands" text is updated.
- `src/featured.ts` is kept (decision 8). Build #2 still uses it: the entry is `{ 'wg-live-featured': 'src/featured.ts' }`, so theme-bridge tokens are bundled into `wg-live-featured.css` (php-core).
- No other source changes. The state lint errors, the slug-sync typecheck error and the admin.js ESLint globals were already fixed.

## Gates (run after a real `npm ci`)

| Gate | Result |
|---|---|
| `npm ci` | ok (npm audit reports vulnerabilities in dev dependencies, not addressed) |
| `npm run typecheck` | pass |
| `npm run lint` | pass (eslint + CSS scope: src and admin) |
| `npm run test:unit` | pass, 33 files and 1007 tests (4 runs) |
| `npm run build` | pass: wg-live.js 100.6 kB, wg-live.css 35 kB, wg-live-featured.css 7.1 kB |
| `npm run lint:php` | pass (17 files, php 7.4 and 8.3, PHPCompatibilityWP 7.4-) |
| `npm run package` | pass: 28 entries, `artifacts/wg-live-0.1.0.zip` + `.sha256` |
| `npm run check:artifact` | pass, all 10 checks; gzip sizes: js 30.2/100 KiB, css 5.5/30 KiB, featured 1.7/30 KiB |
| `check-css-scope --dist` | pass (13 files) |

The first `test:unit` run right after `npm ci` had 1 failing test, and the cause is unknown. It passed in the 4 reruns, so it is probably a cold-start timeout.

## Browser smoke (throwaway Playwright scripts, nothing committed)

- Vite dev harness (`/dev/{index,help,listen}.html`), Chromium, Firefox and WebKit:
  - Events renders 4 cards with no overflow, help renders all sections, and there are no console errors, warnings, page errors or failed requests.
  - On the player page I chose the binaural radio and clicked 開始聆聽. `audio.currentTime` advanced to about 0.5 s, and the status read 「目前播放：Binaural」.
  - The switch dialog opened and confirmed. `currentSrc` changed from `demo-tone-1.mp3` to `demo-tone-2.mp3`, the page kept exactly one `<audio>`, and the status became 「目前播放：Dolby Atmos 音軌」.
- Built bundle (`dev/serve-dist.mjs`, `/dev/dist/*`), Chromium: the same flow passes with no errors.
- Real WordPress (wp-env at :8990, 390 px wide), Chromium and WebKit:
  - The homepage has the featured card and loads no `wg-live.js`.
  - `/live/` and `/live/help/` mount.
  - The player starts demo atmos playback with a single `<audio>`. The dev panel is present because the site is `local`.
  - There is no horizontal overflow and no console errors.
  - `/live-elementor/` renders no widget because Elementor is not installed in this throwaway environment.

## Cross-module checks

- **PHP `boot_config` vs BootConfig:** I fetched the three live pages' bootstraps and ran them through `readBootConfig`. The key sets are identical, events, links and help deep-equal, and nothing is dropped.
- **PHP REST vs providers:**
  - `parsePublicEvents` and `parsePublicEvent` returned the REST data unchanged.
  - `parsePlaybackSource` accepts `demo` and the `not_ready` reasons.
  - Status codes match plan 5: 400 for a bad mode or an uppercase slug, 404 `wg_live_not_found` for an unknown slug.
  - Playback sends no-store headers.
- **CSS class names:** every class in the PHP templates exists in CSS. The two exceptions are `wg-live__config` (a script element) and the `wg-live--{view}` modifier, which has no rule of its own. Every class built in TS has CSS or is a hook used next to a styled class.
- **Copy sync:** `php-copy-sync` and `slug-pattern-sync` pass.
- **ZIP contents:** `check:artifact` verifies the plan 7.3 rules, including the allowlist and hashes.

## Open / notes for the orchestrator

- `tests/e2e/` and `tests/integration/` contain no specs yet. The plan 7.4 matrix, the axe scans and the wp-env integration specs (F11 to F15, commerce screenshot comparison) still have to be written and run. wp-env was run only with a minimal throwaway config, which lacks Astra, Elementor and WooCommerce. The repo `.wp-env.json` was not started end to end.
- Playwright note for the e2e author: the mode picker is a radio input overlaying the card (`.wg-live__mode-input`). `click()` on the label span fails Playwright's hit-target check, so use `getByRole('radio')` or the input. A real mouse click works.
- Plan D3 names the featured entry `src/styles/featured.css`. The actual entry is `src/featured.ts`, which imports theme-bridge and featured CSS. This is a deviation, because a bare CSS entry produced `featured.css` and lacked the tokens. `M1-PLAN.md` was not edited.
- `Plugin::dev_tools_enabled()` under `production` and `staging` is still unverified live. The unit tests do not cover PHP.
- The orchestrator decisions 1 to 7 and 9 are already reflected in the state and tooling modules. I confirmed the Playwright project names in `playwright.config.ts`.
