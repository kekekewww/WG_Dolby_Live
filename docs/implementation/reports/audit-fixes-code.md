# Audit fixes (code and tests), 2026-10-17

Scope: the 11 code/test items of the 2026-10-17 audit. Nothing committed or pushed; no remote site touched. Docs were edited by another agent (see audit-fixes-docs.md).

## Items

| # | Audit | Status | What |
|---|---|---|---|
| 1 | #1 fullscreen | done | New `.wg-live__theater` wrapper (stage + controls slot) is the fullscreen element (`PlayerShell.theater`, `PlayerControlsOptions.fullscreenRoot`). `display: contents` outside fullscreen, so the existing grid/flex layout is unchanged. `:is(:fullscreen, :-webkit-full-screen)` CSS: stage takes the remaining height, `object-fit: contain` (16:9 letterbox), bar sits under the picture. iPhone path (`webkitEnterFullscreen` on the `<video>`) kept. Button label follows `fullscreenchange` (全螢幕 / 結束全螢幕, new copy key `exitFullscreen`). Stage is `tabindex=-1`, so a click on the picture keeps focus in the player group and K/Space keep working. Same `<video>` element throughout. |
| 2 | #4 ZIP margin | done | Clips re-encoded: CRF 30 -> 38, AAC 96 -> 64 kbps (960x540, 24 fps, Main, 30 s, faststart, bitexact, seed 1 unchanged). `MAX_BYTES` 1536 -> 420 KiB. Two generator runs give identical md5. `check-artifact.mjs` has a hard `zip size` row: <= 1.75 MiB (`ZIP_MAX_BYTES`), unit-tested just under and just over. M1-PLAN 7.3 item 11 added. |
| 3 | #6 stale audio copy | done | wg-live.php header ("test video and audio"), admin 來源 column by `media_kind` (示範影片 / 示範音訊), demo-mode description in class-settings.php covers video. The spec-fixed notice is untouched. |
| 4 | #11 video name | done | `<video aria-label="${title}・播放舞台">` (new `playerCopy.stage.videoLabel`), refreshed in `renderEventDetails` when a poll changes the title; never on the stage div. Unit test (view) + a11y e2e. |
| 5 | #12 CLS test | done | Guarded with `PerformanceObserver.supportedEntryTypes.includes('layout-shift')`; skips with a reason on Firefox/WebKit. |
| 6 | #16 accent label | done | '強調色（主要按鈕、已選取的聆聽模式）'. |
| 7 | #17 square poster | done | `git mv` to `dev/assets/`, `(?:-square)?` dropped from package.mjs and check-artifact.mjs, LICENSE-demo.txt updated (also AAC 64 kbps), allowlist unit tests reject it, harness test that it lives only in dev/assets. readme.txt never mentioned it. |
| 8 | #9 checkout | done | New test in deactivate.state.spec.ts: fixture product added with `?add-to-cart=ID`, /cart/ and /checkout/ with the plugin on and off: forms/blocks rendered (both are blocks on this WooCommerce), checkout did not redirect, place-order control present (never clicked), no wg-live markup/DOM node/request on either page. Sessions table cleared afterwards (0 rows asserted). Evidence JSON per project. |
| 9 | #18 override | done, moved | In `settings.state.spec.ts`, not public-data.spec.ts: the setting is global, and public-data runs in parallel projects that read audio-event playback. Covers unapproved (ignored), approved (returned for the audio event, only for the chosen mode), video event always the bundled mp4, restore + attachment deleted. |
| 10 | #8a lab CWV | done | New test in deactivate.state.spec.ts (Chromium only, WebKit skips), cold context per sample, 3 samples, median LCP / max CLS, plugin on and off. Asserts LCP > 0 and < 30 s, CLS < 0.1 with the plugin on. |
| 11 | #10 banner | done | layout.spec.ts: status prompt (請先選擇聆聽模式) bottom <= banner top at 390x844 and 360x800; positions recorded as annotations. Layout order unchanged. |

## Lab CWV on wp-env (lab data, Chromium, no throttling, cold cache, median LCP of 3, max CLS; NOT field data)

| Page | Plugin on | Plugin off |
|---|---|---|
| Home | LCP 664 ms, CLS 0.0000 | LCP 420 ms, CLS 0.0000 |
| /live/ | LCP 1156 ms, CLS 0.0712 | LCP 488 ms, CLS 0.0000 |
| /live/listen/?wg_event=demo-live | LCP 832 ms, CLS 0.0564 | LCP 560 ms, CLS 0.0000 |

Finding: with the plugin on, /live/ and the player page shift by 0.07 and 0.06 (identical in all 3 samples, so deterministic: the client mount replaces the PHP placeholder). It passes the 0.1 bound but is not zero; worth a look before staging. Evidence: evidence/screenshots/integration/lab-cwv-*.json.

## Banner measurements (mock Backer Plan banner, dev harness, idle)

| Viewport | Banner top | Status prompt bottom | First mode panel | Visible above banner | Start top |
|---|---|---|---|---|---|
| 390x844 | 654 | 338 | 645-888 | 9 px | 1228 |
| 360x800 | 610 | 338 | 628-871 | 0 px (fully under) | 1211 |

Start is below the fold on both; only the status prompt is guaranteed above the banner (what the test asserts).

## Gates

- `npm run check`: typecheck, eslint + css-scope, 1176 unit tests in 39 files, build, package, check:artifact all green. ZIP 1,482,790 B (was 2,049,527 B); `zip size` row 1.41 / 1.75 MiB.
- `npm run lint:php`: ok (php -l on 7.4 and 8.3, PHPCS + PHPCompatibilityWP).
- Playwright e2e (`--workers=6`): 704 passed, 7 failed, 48 skipped in the first run. All 7 failures were WebKit "Page crashed / Target crashed" under load (machine CPU was 50-77% from other processes); the same 7 passed on `--last-failed --workers=2` (7/7). Total 711 passed, 0 failing assertions. Skips 44 -> 48: +2 CLS (Firefox, WebKit) and +2 for the new fullscreen test (non-Chromium).
- Integration (WSL wp-env, `test:integration:wsl`): 183 passed, 1 skipped (lab CWV on WebKit), 0 failed, 19.3 min.
- `npm run test:zip-install`: ok. `wp:stop:wsl` done.

## Clip and ZIP sizes

| File | Before | After |
|---|---|---|
| demo-video-1.mp4 | 641,889 B | 418,709 B (409 KiB) |
| demo-video-2.mp4 | 646,796 B | 419,784 B (410 KiB) |
| wg-live-0.1.0.zip | 2,049,527 B | 1,482,790 B |

Frame at 12 s looked at (evidence/screenshots/video/frame-demo-video-1.png): captions, title and timecode are crisp. Fullscreen look: evidence/screenshots/video/fullscreen-chromium.png.

## Other changes (outside the 11 items, needed to run the gates)

- `playwright.config.ts`: `DEV_PORT` can be set with `WG_E2E_DEV_PORT` (default still 5174). Port 5174 was held by another project's Vite server (D:\Developing\Paris, not ours, left running); with `reuseExistingServer` Playwright would have attached to it, and it answers 200 for any path. I ran the suite with `WG_E2E_DEV_PORT=5184`.
- `vite.config.ts`: vitest `testTimeout` / `hookTimeout` 30 s (were 5 s / 10 s). The git/node-spawning tests and the HTTP-server hook timed out at 7-10 s on the busy machine; a hang still fails.
- `tests/unit/dev-harness.test.ts`: the dist-server `afterAll` calls `server.closeAllConnections()` first (tests leave fetch bodies unread, which held the sockets and made `close()` hang).

## Open

- Fullscreen: Playwright cannot press the browser's own Esc; the test leaves with the button and with `document.exitFullscreen()` (what Esc does to the page). Safari iPhone fullscreen (native player takes over) still needs a real device.
- The Firefox/WebKit fullscreen path is not exercised in e2e (skipped); unit tests cover all toggle branches.
- /live/ and player CLS of about 0.06-0.07 (above).
