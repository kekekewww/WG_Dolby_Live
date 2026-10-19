# Silent-Atmos guard, CLS and laptop fold (2026-10-20)

Scope: four items from the orchestrator's spec. Nothing committed or pushed. The studio's Atmos master was only ever read from its original path by the local dev server (Range streaming); it was not copied into the repo, ZIP, wp-env or any tunnel.

## 1. Silent-audio guard (done)

Problem: Chrome, Brave, Firefox (and Playwright's Chromium/Firefox) return `canPlayType` `""` for E-AC-3, but with a bare `video/mp4` mimeType the element plays the picture with no audio and no MediaError.

- `src/adapters/native-media.ts`: once per `load()`, on the element's own `timeupdate` (no timer), when the element is playing (not paused or seeking) and `currentTime >= 1.5 s`, `mediaIsSilent()` decides. Positive evidence only: Firefox `mozHasAudio === false`, or Chromium `webkitAudioDecodedByteCount === 0` while `webkitVideoDecodedByteCount > 0`. The video counter is required because Playwright's WebKit defines both counters and leaves them at 0 (first version without it produced a false `unsupported` in WebKit after 1.5 s; caught by the e2e run and fixed at the root). No property, or counters that do not count: unknown stays unknown. The adapter emits `error {unsupported, fatal}` and pauses the element if nobody else did.
- `src/state/coordinator.ts`, `src/state/reducer.ts`: a source that already reported `playing` and is then reported silent never was "good", so `attempt/failed` carries `restoreGood`: `lastGoodMode` and `activeMode` go back to what played before the attempt (null for a first start). A failed switch therefore keeps the previous mode and 目前播放 unchanged. No retry (unsupported is not retried).
- `src/components/status-panel.ts`: the 聆聽說明 link is shown for every `unsupported` failure (start and switch). The mode switch offered is the existing one: 改用耳機 Binaural for an Atmos failure (spec 5.4, M1-PLAN 6.6), 切換模式 for a Binaural failure. The orchestrator's text says 切換模式 for both; for Atmos the repo's contract already offers the Binaural fallback instead, and a duplicate would contradict the plan, so e2e asserts 改用耳機 Binaural there. Decision for the orchestrator if 切換模式 must also appear.
- Contract doc: `docs/implementation/M1-PLAN.md` 6.5 table gets the new row; D1 gets the skeleton change.
- Fixture: `tests/fixtures/media/eac3-test.mp4` (147 KB, 6 s, 320x180 H.264 + E-AC-3 5.1, ffmpeg, README with the command). Not in the ZIP (checked: 0 matches). The harness serves it as `/demo/eac3-test.mp4` (`dev/core.mjs` DEMO_DIRS).
- Tests: unit (adapter: counter 0 with video bytes, mozHasAudio false, missing property, both 0, audio-only, bytes > 0, waits 1.5 s, paused/seeking, once per load, no double report; coordinator: silent first start and silent switch; status panel: help link only for unsupported). e2e `tests/e2e/unsupported-audio.spec.ts`: codecs mimeType, bare mimeType, switch from Binaural; decided by `canPlayType` feature detection per engine. Chromium and Firefox: 不支援來源, 改用耳機 Binaural + 聆聽說明, no retry, no further request, fallback plays; WebKit: plays past the guard.
- Real master, local probe (Chromium 156, Firefox 157, WebKit): bare type: Chromium and Firefox play the picture for about 1.5 s, then `failed` E-SRC-01 with 改用耳機 Binaural + 聆聽說明; with codecs: `failed` immediately; WebKit plays both (counters 0, not judged).

## 2. Local Atmos test hook (done)

`dev/core.mjs`: `WG_DEV_ATMOS_FILE` (existing file) makes the live demo event's ATMOS descriptor `{kind:'demo', url:'/demo/local-atmos.mp4', mimeType: WG_DEV_ATMOS_TYPE | 'video/mp4; codecs="avc1.640028, ec-3"'}`; `/demo/local-atmos.mp4` streams the file with Range (`createReadStream`, content type without codecs). Unset: unchanged. No new bind. `dev/serve-dist.mjs` logs when it is on. Docs: `docs/implementation/ATMOS-LOCAL-TEST.md` (how to run, browser table, not Atmos rendering validation, never commit/tunnel). Unit test with a temp file: `tests/unit/local-atmos-hook.test.ts`.

## 3. CLS (done)

Cause (sources from PerformanceObserver): the site footer (visible at y 743-800 while the 480 px skeleton was up) is pushed out of the viewport at mount; impact 57/800 x distance 1.

Fix: skeleton reserves about one viewport, `clamp(480|560px, 100svh - 120px, 960px)` (`src/styles/base.css`, `responsive.css`; px fallback first). Lab CLS, wp-env, Chromium, 1280x800: /live/ 0.071 -> 0.000, player 0.047 (orchestrator: 0.056) -> 0.000, guide 0.071 -> 0.000; also 0.000 at 1366x768, 1024x768, 390x844, 1440x1000; 16/16 repeated samples of /live/ and the player page at 0.000. One stray 0.032 shift of the Astra header (not plugin DOM) appeared once in about 8 samples of the guide page, so the integration assertion is `< 0.02` (was 0.1) on the three measured pages. Harness CLS test also `< 0.02` (measures 0.0000).

## 4. Laptop fold (done, with one caveat)

`src/styles/player.css`, `@media (min-width: 1024px) and (max-height: 900px)`, video only: the stage column is `max(420px, min(62.3%, (100vh - reserve) * 16/9))` (reserve 449 px, 474 px below 1200 px wide), tighter panel/legend/help-link spacing and line height. No copy removed, phone order unchanged, 1440x1000 unchanged.

| Viewport | Stage | Panels | Start | Before (Start) |
| --- | --- | --- | --- | --- |
| 1366x768 | 123,121 567x319 | 491-659 | 708-756 | worse than 871-919 |
| 1280x800 | 80,121 624x351 | 523-691 | 740-788 | 871-919 |
| 1440x1000 | 160,121 672x378 | 573-798 | 871-919 | unchanged |
| 1024x768 (extra) | 20,121 523x294 | 466-660 | 708-756 | 855-903 |

Caveat: the harness's fixed 80 px banner (live site Backer Plan bar) starts at 688 (768) and 720 (800), so Start is inside the viewport but covered until the banner is dismissed or the page scrolls. Clearing it would need a stage under 420 px wide; judged a worse trade (documented in HYBRID.md). Tests: `tests/e2e/layout.spec.ts` laptop-fold cases for 1280x800, 1366x768, 1024x768. Screenshots regenerated in `evidence/screenshots/video/` for those three sizes; HYBRID.md table updated.

## Gates

The machine was at 100% CPU from other projects during the runs (an unrelated Vite held :5174, so `WG_E2E_DEV_PORT=5184`); load caused the retries noted below.

1. `npm run check`: typecheck, eslint and css-scope clean; vitest 40 files / 1197 tests passed (run with `VITEST_MAX_WORKERS=3`: with the default worker count vitest hit "Timeout waiting for worker" on the overloaded machine and reported only 9 files); build, package (ZIP 1.41 MiB, sha256 d77bc65cc4960b09d200616f0c7c2e130704d782e51ea7aedaa8968fb8734616, 0 test or fixture files inside) and check:artifact passed; core JS 32.2/100 KiB, CSS 9.0/30 KiB gzip.
2. `npm run lint:php`: ok (17 files, PHP 7.4 and 8.3).
3. `npx playwright test --workers=6` (783 tests, Chromium, Firefox, WebKit, dist): 721 passed, 48 skipped, 14 failed. All 14 were WebKit tests that start media or open a page, timing out while the machine was saturated (page or browser closed, currentTime 0). Rerun of exactly those 14: 14 passed. Clean rerun of the whole WebKit project at 3 workers: 225 passed, 25 skipped, 0 failed. Chromium and Firefox had no failures in the full run.
4. wp-env in WSL: `test:integration:wsl` first run 144 passed, 1 failed (a WebKit admin-events spec hit its 240 s timeout under load; the chained state specs then did not run). Full rerun at 3 workers: 183 passed, 1 skipped, 0 failed, including the lab CWV test with the new `< 0.02` assertion: Home, /live/ and the player page CLS 0.0000 with the plugin on and off (LCP 276, 328, 364 ms on). `test:zip-install`: first two runs passed every functional check but failed "debug.log is not empty" because WordPress core's own update checks to api.wordpress.org timed out (not plugin code; PHP in the container reaches the network); third run ok. `wp:stop:wsl` done; no stray node, vite or browser processes left.

Open items: the 切換模式 wording for Atmos failures (see 1); Start is covered by the harness's fixed banner at 768/800 px heights (see 4); the guard cannot judge audio-only elements or WebKit/Safari (counters do not count there), which remain "unknown" by design; real Safari and Edge-with-hardware results stay in the device test records (the Atmos compatibility table remains 尚待測試).
