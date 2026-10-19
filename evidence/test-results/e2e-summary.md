# E2E results (Playwright harness, M1)

## Latest run: 2026-10-20, commit 593dde1 (silent-Atmos guard, no layout jump, laptop fold; the build of ZIP db4330c1)

Command: `WG_E2E_DEV_PORT=5184 npx playwright test --workers=6` (another project held 5174). Result: **735 passed, 48 skipped,
0 failed** in 7.2 min, first attempt. The 48 skips are the same expected ones as on 2026-10-17.

New since 2026-10-17:
- `unsupported-audio.spec.ts`: an Atmos source with E-AC-3 audio (self-generated fixture `tests/fixtures/media/eac3-test.mp4`)
  in an engine that cannot decode it shows 「目前環境無法播放這個音訊版本」 with 改用耳機 Binaural and 聆聽說明 instead of a
  silent picture, both with codecs in the type (refused before playback) and with a bare `video/mp4` (caught by the
  silent-audio guard after 1.5 s of playback); Binaural then plays. In engines that decode it, it plays.
- `layout.spec.ts`: at 1366x768 and 1280x800 both mode panels and Start are in the first viewport for video events
  (Start 708-756 / 740-788); the player CLS assertion is now < 0.02 (measured 0).
- `network.spec.ts`: after a failed switch the error code is shown once (small print), not repeated in the status line.
- Real Atmos file in the real player: see `atmos-browser-probe.md`.

Earlier runs of 2240cef (same features, before the error-code fix) had 2-14 WebKit playback stalls / timeouts under heavy
machine load from other projects; each passed when rerun, and this run had none.

---

## Run: 2026-10-17, commit 6757e6c (video default + audit fixes; the build of ZIP e1464d9e)

Command: `npx playwright test --workers=6` (all 4 projects). Windows 11, Node 22.17.0, `@playwright/test` 1.64.0. Result: **711 passed, 48 skipped, 0 failed** in 9.3 min, first attempt, no retry. (The implementer's earlier run of the same code had 7 WebKit "Page crashed" errors under machine load that passed on `--last-failed`; this run had none.)

The 48 skips are expected: 42 colour-contrast scans (`host-contrast.spec.ts`, Chromium only), 2 WebKit route-abort variants of F08, 2 player CLS measurements on Firefox and WebKit (no `layout-shift` entry type), 2 fullscreen tests on Firefox and WebKit (Chromium is the engine that drives element fullscreen in Playwright).

Since the 2026-10-13 run, video is the default event type (commit 4d55486) and the demo plays `demo-video-1.mp4` / `demo-video-2.mp4`:
- `video.spec.ts`, `video.dist.spec.ts`: one `<video>` in the stage, real frames decoded (960x540 on Chromium and Firefox; Playwright WebKit reports the element's layout size as `videoWidth`, so it checks a 16:9 frame), a confirmed switch swaps the clip and keeps one media element, the demo notice in both modes, fullscreen only for video.
- Fullscreen (Chromium): 全螢幕 puts the stage AND the control bar into fullscreen (`document.fullscreenElement` contains the video and the pause button), pause works inside it, the button reads 結束全螢幕, exit restores the page.
- `a11y.spec.ts`: the `<video>` has an accessible name.
- `layout.spec.ts`: video at 1440x1000 has both mode panels and Start in the first viewport; audio events (overridden with `asAudioEvent()`) keep the compact cover; phone checks are banner-aware (the status prompt sits above the mock Backer Plan banner at 390x844 and 360x800).

---

## Run: 2026-10-13, commit a1152e4 (hybrid redesign)

Command: `npx playwright test --workers=6` (all 4 projects). Windows 11, Node 22.17.0, `@playwright/test` 1.64.0. Result: **668 passed, 44 skipped, 0 failed** in 6.6 min, with no retry and no transient error.

| Project | Passed | Skipped | Failed |
|---|---|---|---|
| harness-dev-chromium | 227 | 0 | 0 |
| harness-dev-firefox | 206 | 21 | 0 |
| harness-dev-webkit | 204 | 23 | 0 |
| harness-dist | 31 | 0 | 0 |
| **Total** | **668** | **44** | **0** |

The skips are expected. 42 are the axe colour-contrast scans of `host-contrast.spec.ts`, which run in Chromium only. The other 2 are the WebKit route-abort variants of F08: Playwright cannot intercept WebKit media requests, so WebKit covers the same failure path through a 404 descriptor.

New since the review-fix run, with the hybrid design (`docs/design/HYBRID.md`):
- `layout.spec.ts`: on audio events (the only kind at the time), both mode panels and the Start button are in the first viewport at 1440x1000, and the spec 5.3 order holds on phones.
- `host-contrast.spec.ts` and `host-contrast.dist.spec.ts`: axe colour contrast on dark, dark-solid and light host sections (`?host=light`), on the dev harness and on the shipped CSS. Text that sits on the host keeps the host's colour (inherit-first).

---

## Run: 2026-10-12, after the review fixes

Command: `npx playwright test` (all 4 projects, 6 workers). Result: **622 passed, 2 skipped, 0 failed** in 13.0 min.
- **The 2 skips** are the WebKit route-abort variants of F08, as before.
- **3 transient infrastructure errors** occurred during the first run, while a wp-env image build saturated the machine: 1 Chromium "Target crashed" and 2 Firefox `NS_ERROR_CONNECTION_REFUSED` against the Vite dev server. All 3 passed on `--last-failed` (3/3 in 14.8 s), and none was an assertion failure.

---

## Earlier run (2026-10-10)

Run: 2026-10-10, Windows 11, Node 22.17, `@playwright/test` 1.64.0, `npx playwright test --workers=6`.
Scope: the Vite dev harness (`/dev/*.html`) in Chromium, Firefox and WebKit, and the built bundle (`/dev/dist/*.html`) in Chromium. Playwright WebKit is not Safari: real-device Safari results belong in `manual-devices.md`.
HTML report: `playwright-report/index.html` (git-ignored, regenerate with `npx playwright test`).

| Project | Tests | Passed | Skipped | Failed |
|---|---|---|---|---|
| harness-dev-chromium | 190 | 190 | 0 | 0 |
| harness-dev-firefox | 190 | 190 | 0 | 0 |
| harness-dev-webkit | 190 | 188 | 2 | 0 |
| harness-dist | 18 | 18 | 0 | 0 |
| **Total** | **588** | **586** | **2** | **0** |

The 2 skips: the "route abort on the media URL" variants of F08 on WebKit (Playwright cannot intercept WebKit media requests; the same failure path runs there through a 404 descriptor).

## What the specs prove

- F01 events list, empty state, featured order, demo badge, CTA labels; disabled mode.
- F02 direct player link, unknown/invalid slug -> 找不到這場活動 with a link back.
- F03/F04 each mode plays (currentTime advances), 已選擇 -> 目前播放, the demo notice is visible in both modes.
- F05 switch via the dialog: `currentSrc` changes, `emptied -> loadstart -> playing`, the old URL gets no further requests (Chromium/Firefox), still one media element.
- F06 rapid clicks (Start, switch, pause/resume): one media element, at most one audible source.
- F07 pause/resume keeps mode and source. F08 bounded retries (2 s, 5 s, 10 s), then failed with a manual retry; a failed switch keeps the last good mode. F09 autoplay blocked -> 請點擊開始聆聽 -> one click resumes. F10 all event statuses and entitlement states through the dev panel; `devTools:false` shows no panel. F12 invalid `wg_mode` ignored.
- Accessibility: axe (WCAG 2.2 AA tags) on every view, state, the open dialog and the dev panel, on the dev harness and on the shipped CSS: 0 serious or critical (and 0 minor) violations. Keyboard: Space/K scope, Escape and focus return, keyboard-only session, visible focus.
- Layout: no horizontal scroll at 360x800 and 390x844 on every view state, including long unbroken text; bottom-sheet dialog.
- CSS: the hostile global theme (`dev/stress.css`) changes nothing inside `.wg-live`, the plugin changes nothing outside it, every shipped rule is scoped.
- Built bundle: `WGLive` exposes only `mountAll/mountWithin/version`, remount is idempotent, CSS via `<link>`, JS via `<script defer>`, the homepage loads CSS only.
- Lab metrics (Chromium, local, unthrottled, not field data): events LCP ~0.1 s, CLS 0; player LCP ~0.1 s, CLS 0.

## Not covered by this run

wp-env integration specs (F11, F13 to F15, commerce screenshot diff, Elementor preview), real-device Safari and the Atmos device table (still 尚待測試), M2 items (real entitlement, hls/iframe, DRM, 300-stream load).

## Product bugs found and fixed while writing the specs

1. After the retries were used up, the failed state still said 連線暫時中斷，正在重新連線 (now 無法播放，請重試, as the Help page promises).
2. A long unbroken performer name, title word or pasted URL widened the whole player on phones (grid tracks now `minmax(0, 1fr)`).

## Reproduce

```bash
npx playwright test --workers=6          # all four projects (runs npm run build for harness-dist)
npm run test:e2e:dev -- --workers=6      # harness-dev-chromium/firefox/webkit
npm run test:e2e:dist                    # harness-dist
```

With the default worker count (half the cores) Firefox can crash on large machines; see the Requests in `docs/implementation/reports/e2e.md`.
