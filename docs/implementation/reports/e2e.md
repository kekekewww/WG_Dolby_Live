# Report: e2e (Playwright specs for M1-PLAN 7.4)

## Result

`npx playwright test --workers=6`: **586 passed, 2 skipped, 0 failed, 0 flaky** (6.4 min), run twice with the same result after the last source change (an earlier run at the default 16 workers had 8 Firefox crashes, see Requests). HTML report: `D:/Developing/WG-Dolby-Stream/playwright-report/index.html` (git-ignored; open with `npx playwright show-report`).

| Project | Passed | Skipped | Failed |
|---|---|---|---|
| harness-dev-chromium | 190 | 0 | 0 |
| harness-dev-firefox | 190 | 0 | 0 |
| harness-dev-webkit | 188 | 2 (WebKit cannot route-abort media) | 0 |
| harness-dist (Chromium, built bundle) | 18 | 0 | 0 |

Summary copy for the evidence folder: `evidence/test-results/e2e-summary.md`.

## Files (all in `tests/e2e/`, LF)

- `helpers.ts`: `Player` locator object, `gotoPlayer/gotoView`, request recorder, `rewriteBootConfig` (page.route rewrite of the BootConfig JSON for states the harness flags do not offer), media-element tracker, `blockFirstPlay`, `breakModeUrl`, `watchErrors`, `scanWgLive` (axe, `.wg-live` only, WCAG 2.2 AA tags), `horizontalOverflow`. `expect` is exported with a 15 s default timeout.
- `css-probe.ts`: computed-style probes for the hostile `dev/site-chrome.css` and the stylesheet scope scan (dev and dist).
- `events.spec.ts` (F01), `gating.spec.ts` (F02, F10, F12, dev-panel gating D17, plain-permalink root), `playback.spec.ts` (F03, F04, F05, F07), `rapid-clicks.spec.ts` (F06), `autoplay.spec.ts` (F09), `network.spec.ts` (F08), `keyboard.spec.ts`, `mount.spec.ts`, `help.spec.ts`, `css-isolation.spec.ts`, `layout.spec.ts`, `a11y.spec.ts`.
- `bundle.dist.spec.ts` (harness-dist): `WGLive` global has exactly `mountAll/mountWithin/version`, skeleton replaced, `mountAll()` twice and an Elementor-style `mountWithin` re-render leave one media element and one listener set, CSS via `<link>` and JS via `<script defer>` with `?ver=<12 hex of build-info>`, no dev-server request, demo plays and switches, dev panel ships inert (absent with `devTools:false`), homepage loads `wg-live-featured.css` only (no JS), every shipped rule scoped, hostile chrome cannot restyle the bundle, axe on the shipped CSS, lab LCP/CLS.

## Coverage against plan 7.4

| Row | Where | Notes |
|---|---|---|
| F01 list / empty / featured order / demo badge / CTA labels | events.spec | also `?featured=`, single event, disabled, heading=h1, FAQ, countdown outside any live region, 購票/登入 hidden for ended |
| F02 direct player, unknown slug | gating.spec | 7 invalid slug forms, repeated param, fixed event wins, no request for unknown slug |
| F03/F04 select -> start -> currentTime advances; 已選擇 -> 目前播放; demo notice | playback.spec | notice shown before and during playback, both modes; `preload=none`, no autoplay, no controls attribute |
| F05 switch | playback.spec | currentSrc changes, `emptied -> loadstart -> playing` order, no `error`, old URL gets no further request (Chromium/Firefox), one element |
| F06 rapid clicks | rapid-clicks.spec | every element that ever calls `play()` is tracked: 1 element, 1 audible |
| F07 pause/resume | playback.spec, keyboard.spec | same source, same single media request |
| F08 network failure | network.spec | `page.clock` drives the 2 s / 5 s / 10 s ladder: exactly 4 media requests, then `failed`, then manual 重試; failed switch offers 重新載入 Binaural; Atmos failure offers 改用耳機 Binaural; route-abort variant on Chromium/Firefox; dev-panel faults |
| F09 autoplay blocked | autoplay.spec | first `play()` rejects NotAllowedError: 請點擊開始聆聽, no auto retry, one click resumes without a new descriptor request |
| F10 states | gating.spec | all six event statuses and four entitlement states through the real dev panel; disabled; `not_configured` event; `devTools:false` has no panel |
| F12 unknown wg_mode | gating.spec | invalid / uppercase / empty / markup / repeated / not offered by the event / remembered mode / blocked localStorage |
| a11y | a11y.spec, bundle.dist.spec | axe on every view and state, open dialog and open dev panel: zero serious/critical (and zero minor); headings, single live region, 48/44 px targets, reduced motion, forced colors, 200% text |
| keyboard | keyboard.spec | see below |
| layout | layout.spec | 360x800 and 390x844 on 12 view states, long unbroken text, bottom sheet, wide layout, CLS |
| CSS isolation | css-isolation.spec | computed styles of every element in `.wg-live` vs the hostile chrome; the chrome keeps its own look |
| §13.4 lab CWV | bundle.dist.spec | events LCP ~0.1 s / CLS 0, player LCP ~0.1 s / CLS 0 (local, unthrottled, lab only) |

Keyboard: Space on a button toggles exactly once; K and Space on the player region toggle; modifiers, the volume slider and anything outside the player never toggle or `preventDefault`; Space/K never start playback; dialog opens from the keyboard, focus enters it, Tab never reaches the page behind, Escape closes it and focus returns to 切換模式; confirm by keyboard ends with focus on the trigger or status heading; full keyboard-only session; focus rings visible.

## Product fixes made (src/, minimal)

1. **Failed network state said "正在重新連線"** (found by F08). After the 3 retries the status title and announcement still read 連線暫時中斷，正在重新連線 while nothing was retrying, and the Help page promises「無法播放，請重試」. `src/i18n/copy.ts` gets `failedCopy()` (network -> `statusCopy.player.failed`, otherwise `errorCopy`), used in `src/state/model.ts` for the failed title; the failed announcement for a network error is the same text. Unit tests that pinned the old text were updated (`model.test.ts`, `status-panel.test.ts`, `views/player.test.ts`) and `copy.test.ts` gained a `failedCopy` test. `errorCopy('network')` (the 斷線 row of spec section 6) is unchanged.
2. **Long unbroken text overflowed the player on phones** (found by layout.spec). A long performer name, title word or pasted URL widened the whole player view (implicit auto grid tracks use min-content). `src/styles/player.css`, `dialog.css`, `dev-panel.css`: grid containers without explicit columns now use `grid-template-columns: minmax(0, 1fr)`, and `.wg-live__player-meta` gets `min-width: 0; overflow-wrap: anywhere`. Built CSS is still 5.5 KiB gzip.

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (eslint + CSS scope) | pass |
| `npm run test:unit` | pass, 33 files, 1009 tests (the "first run after npm ci" failure from the integrate report did not reproduce in my runs) |
| `npm run build` | pass (wg-live.js 100.67 kB, 31.17 kB gzip) |
| `npm run package`, `npm run check:artifact`, `check-css-scope --dist` | pass (js 30.2/100 KiB, css 5.5/30, featured 1.7/30 gzip) |
| `npx playwright test --workers=6` | pass, see above |
| `npm run lint:php` | not run (no PHP touched) |

## Requests

1. **`playwright.config.ts`: set `workers` (for example `workers: process.env.CI ? 2 : 6`).** With the default (16 workers on this 32-core machine) Firefox instances crash or hang ("RenderCompositorSWGL failed mapping default framebuffer", `Browser.removeBrowserContext` errors): 8 Firefox tests failed on one run, all unrelated to the product, and all passed on rerun with `--workers=6`. I used `--workers=6` everywhere and did not edit the config.
2. `package.json` `test:e2e*` scripts could pass `--workers` for the same reason if the config is left alone.

## Contract issues / limits

- **WebKit (Playwright) cannot observe or intercept media element requests**: not in `page.on('request')`, not in `page.route`, not in resource timing. So request-count assertions (F05 "old URL gets no further requests", single request on resume) run on Chromium and Firefox only (`mediaRequestsObservable`); WebKit still asserts `currentSrc`, event order, element count and audibility. F08 uses a REST descriptor rewrite to a missing file (a real 404 media failure) so it runs in all three; the literal "route abort on the media URL" variant runs on Chromium and Firefox (2 skips on WebKit).
- Timers are not shortened by a harness flag: `page.clock.install()` + `runFor()` drives the retry ladder.
- Not covered here (outside this task, still open): wp-env integration (F11, F13 to F15, §13.3 screenshot diff, Elementor preview), real-device Safari (`evidence/test-results/manual-devices.md`), `mediaKind: 'video'` (no video event in the harness), bfcache `pageshow persisted`, `online`-event early retry (unit-tested only), hls/iframe (M2).
- Plan D3 still names `src/styles/featured.css` as the featured build entry; the real entry is `src/featured.ts` (kept, build #2 uses it). Not edited.
- The mode picker is a radio input overlaying the card: specs use `getByRole('radio', { name: /選擇耳機模式/ })`.
