# Report: tooling-skeleton

## Files created or changed

- package.json, package-lock.json: all required scripts; exact (-E) devDependencies: typescript 6.0.3, vite 8.3.4, vitest 5.0.3, jsdom 29.1.1, eslint 10.12.0, @eslint/js 10.0.1, typescript-eslint 8.71.1, globals 17.13.0, @playwright/test 1.64.0, @wordpress/env 11.17.0, fflate 0.8.3, plus @types/node 22 (added: Node typings are needed for dev/ and scripts; the transitive copy was v26).
- tsconfig.json: strict, noUncheckedIndexedAccess, lib DOM+ES2022, bundler resolution, noEmit, allowJs (so tests can import scripts/check-css-scope.mjs), allowImportingTsExtensions.
- vite.config.ts: default build = lib/iife `WGLive` -> plugin/wg-live/assets/dist/wg-live.js + wg-live.css; `--mode featured` = src/featured.ts -> wg-live-featured.css (emptyOutDir false; JS chunk dropped by a post plugin, build-info.mjs also removes strays). Target `['es2020','safari15']`, cssTarget safari15, no sourcemaps. Also holds the vitest config (jsdom, tests/unit/**/*.test.ts) and appType mpa.
- eslint.config.js: flat config; bans innerHTML/outerHTML/insertAdjacentHTML/document.write/writeln (and destructured innerHTML/outerHTML) in src/ and dev/ with an M1-PLAN D12 message.
- playwright.config.ts, playwright.integration.config.ts, .wp-env.json (port 8888, testsPort 8889, config WP_DEBUG/WP_DEBUG_DISPLAY/WP_ENVIRONMENT_TYPE, mapping `wp-content/wg-live-scripts` -> ./scripts).
- dev/index.html (events), dev/listen.html (player), dev/help.html, dev/stub.html (link placeholder), dev/site-chrome.css (aggressive global rules), dev/harness.ts (BootConfig builder), dev/mock-rest.ts (Vite plugin), dev/assets/poster-demo.svg.
- scripts/build-info.mjs, scripts/check-css-scope.mjs (exports `checkCss`, `isScopedSelector`, `findCssFiles`, `stripComments`), scripts/lint-php.mjs.
- src/main.ts (placeholder, `window.WGLive = { mountAll }`), src/featured.ts, src/styles/{base,featured}.css (one real declaration each so the minifier keeps them), src/fixtures/demo-events.ts.
- tests/unit/smoke.test.ts, tests/unit/check-css-scope.test.ts (10 cases).
- .gitkeep in tests/e2e, tests/integration, evidence/{design-baseline,screenshots,test-results}, plugin/wg-live/assets/dist (dist is gitignored and wiped by emptyOutDir; the build recreates it).
- docs/implementation/M1-PLAN.md: appended a "Pinning WordPress and PHP" note at the end of section 7.

## Verification

| Command | Result |
|---|---|
| npm run typecheck | pass |
| npm run lint (eslint + css scope) | pass |
| npm run test:unit | pass, 2 files / 12 tests |
| npm run build | pass; dist has wg-live.js, wg-live.css, wg-live-featured.css, build-info.json (no featured JS) |
| node scripts/check-css-scope.mjs --dist | pass |
| npm run dev + node fetch probe | pass: /wp-json/wg-live/v1/events, events/:slug (200, 404 `wg_live_not_found`), playback (demo, mode_unavailable, event_not_found, 400 on bad params, `no-store`), /dev/listen.html carries a BootConfig with 3 events; `/`, `/listen.html`, `/help.html` alias the dev pages; /demo/ blocks path traversal. Dev server stopped afterwards. |
| Playwright smoke (scratch script) | chromium, firefox and webkit all mount "wg-live ready (player)" with no page errors |
| npx playwright install chromium firefox webkit | pass |
| npm run lint:php | pass in both Docker images (php:7.4-cli, php:8.3-cli). Verified with a temp valid file (ok) and a temp broken file (exit 1); temp files removed. No .php files exist yet, so it currently prints "no .php files". |

## Decisions and notes

- Vite 8 (rolldown) uses `build.lib.fileName` (function) and `build.lib.cssFileName` (checked via context7 and vite typings). Use `build.rolldownOptions` not `rollupOptions` if anyone needs it.
- IIFE global: the bundle is `var WGLive=(function(e){...})`, so `window.WGLive` ends up as the module namespace (which exposes `mountAll`), not the object main.ts assigns. Both expose `mountAll`. Real main.ts should keep exporting everything it wants on `WGLive`.
- Vite leaves a `/*$vite$:1*/` marker in library CSS; build-info.mjs strips it.
- Harness URLs: pages live under /dev/ (root stays the repo root so src/ resolves). `/`, `/index.html`, `/listen.html`, `/help.html` are aliased. Playwright's baseURL is http://localhost:5174. Playwright's webServer probes /dev/index.html.
- BootConfig is injected at request time (token `__WG_LIVE_CONFIG:<view>__` in the pages), so event start times are recomputed per request.
- Fixtures: ids 9001 (live, both modes), 9002 (scheduled, +3 days, both modes), 9003 (ended, binaural only); all sourceKind 'demo'. Poster is /demo/poster-demo.svg, served from plugin/wg-live/assets/demo/ first, then dev/assets/.
- /demo/demo-tone.m4a returns 404 until `npm run demo:audio` (another agent) generates it; Range requests are supported once it exists.
- Imports reachable from vite.config.ts (dev/*, src/fixtures, src/types) use explicit `.ts` extensions to silence Vite's native config loader warning. Other src files do not need this.
- WordPress core and PHP are not pinned in .wp-env.json (see M1-PLAN section 7 note). `npm run wp:start` was not run (needs Docker pulls of WordPress images); only the JSON was written.
- Playwright report/test output dirs (`playwright-report`, `test-results`) are in .gitignore already.

## Open problems

None blocking. npm audit reports 9 vulnerabilities (3 critical) in transitive dependencies of @wordpress/env; dev-only, not addressed.
