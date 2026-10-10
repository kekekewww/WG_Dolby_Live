# E2E results (Playwright harness, M1)

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
- CSS: the hostile global theme (`dev/site-chrome.css`) changes nothing inside `.wg-live`, the plugin changes nothing outside it, every shipped rule is scoped.
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
