# Video as the primary media kind (2026-10-13)

Decisions (by the user): every concert is streamed with video; the M1 demo plays a real video (`demo-video-1.mp4` binaural, `demo-video-2.mp4` atmos, H.264 + AAC, 960x540, 30 s); real HLS / iframe streams stay M2. Nothing was committed or pushed; no remote site was touched.

## Files changed

**PHP (plugin/wg-live)**
- `includes/class-playback-provider.php`: demo source per media kind. Video events get the bundled mp4 (`video/mp4`, `?ver=`); audio events keep the mp3 and the `demo_audio_*` media-library overrides, which no longer apply to video. Resolution order unchanged; a missing file is `not_ready` / `source_not_configured`.
- `includes/class-events.php`: default media kind video (data fallback, admin select lists 影片 first and selects it for a new event, save sanitizer `'audio' === $in ? 'audio' : 'video'`).
- `includes/class-public-data.php`: `mediaKind` defaults to `video`.
- `includes/class-settings.php`: note on the 示範音訊 section that the two pickers apply to audio events only.
- `readme.txt`, `assets/demo/LICENSE-demo.txt` (already updated by the orchestrator): wording.
- `scripts/seed-demo.php`: the four seeded events are `media_kind` `video` (featured stays `demo-live`).

**Client / UI**
- `src/boot.ts`: `raw.mediaKind === 'audio' ? 'audio' : 'video'`.
- `src/styles/player.css`: the video layout (below). CSS stays within budget: `wg-live.css` 8.6 / 30 KiB gzip, JS 31.7 / 100 KiB.
- `dev/core.mjs`, `dev/harness.ts`, `dev/mock-rest.ts`: harness playback returns the mp4 for video events and the mp3 for audio events (`DEMO_VIDEO_FILES`, `.mp4` -> `video/mp4`). `sendFile` (shared by the Vite harness and `dev/serve-dist.mjs`) already answers Range with 206 / 416 and suffix ranges; now covered by a unit test for both mp4 files.

**Packaging / tooling**
- `scripts/package.mjs`: narrow exception for exactly `assets/demo/demo-video-<digit>.mp4`; every other mp4/webm/mov stays excluded; `isTextEntry` stays false for mp4.
- `scripts/check-artifact.mjs`: allowlist accepts those two files, both are in `REQUIRED_FILES`, and the forbidden-extension rule has the same exact-path exception.
- `package.json`: `demo:video`. `CLAUDE.md`: command list.

**Docs**: `docs/design/HYBRID.md` (new "Player: video layout" section with the measurements), `docs/implementation/M1-PLAN.md` (D7, `media_kind` default, playback step 7, test row), `docs/deploy/STAGING.md` section 6 and `PRODUCTION.md` steps 6 and 7 (媒體類型 影片, default). Not touched: `evidence/test-results/manual-devices.md`, the 2026-10-13 handover record.

**Tests**
- Unit: `check-artifact.test.ts` (an mp4 anywhere else or under another name is rejected; the two demo videos are accepted and required; ship / skip lists; ZIP reproducibility and binary-untouched checks), `core/boot.test.ts` (default kind), `views/player.test.ts` (one `<video playsinline>` in the stage, poster, no audio, audio override renders `<audio>` + cover, fullscreen only for video), `components/player-controls.test.ts`, `dev-harness.test.ts` (video and audio descriptors, Range for the mp4).
- e2e: new `video.spec.ts` (3 dev projects) and `video.dist.spec.ts` (built bundle); `layout.spec.ts` has the video above-the-fold block next to the audio one; helpers gain `media`, `DEMO_MEDIA`, `asAudioEvent()` (boot config + playback descriptor of one event turned into audio); the other specs were moved from `<audio>` / `TONE` to `<audio, video>` / `DEMO_MEDIA`.
- Integration: `wp.ts` (fixtures default to video), `pages.spec.ts`, `elementor.spec.ts`, `admin-events.spec.ts` (new event form defaults to video, saved meta is `video`), `dev-tools.spec.ts`, `public-data.spec.ts` (video event -> `video/mp4` + `demo-video-N.mp4?ver=`; audio fixture -> `audio/mpeg` + `demo-tone-N.mp3`; empty or unknown stored kind reads as video).

## Video layout (section D), measured

Harness `/dev/listen.html?wg_event=demo-live-binaural-atmos&chrome=live`, Chromium. Screenshots: `evidence/screenshots/video/` (`<size>-idle.png`, `-idle-full.png`, `-playing.png` for 1440x1000, 1280x800, 1024x768, 768x1024, 390x844, 360x800).

| Viewport | Stage | Mode panels (top-bottom) | Start (top-bottom) |
| --- | --- | --- | --- |
| 1440x1000 (before) | 160, 121, 1120x630 | 1090-1315 | 1396-1444 |
| **1440x1000** | 160, 121, **672x378** (60% of the content width, left; head at 171-449 on the right) | **573-798** (both) | **871-919** (fixed site banner starts at 920) |
| 1024x768 | 593x333 | 528-782 | 855-903 |
| 768x1024 (stacked) | 728x410 | 867-1151 | 1232-1280 |
| **390x844** | 350x197 under the title | **645-888** / 904-1147 | 1228-1280 |
| 360x800 | 320x180 | 628-871 / 887-1130 | 1211-1263 |

From 1024 px the player is a grid `1.65fr / 1fr`: stage left, head right, panels and the one yellow Start directly below; after Start the dark bar sits at 531-611, 32 px under the row. 768-1023 px and phones keep the stacked spec 5.3 order. No horizontal scroll at 320 / 360 / 390 / 768 / 820 / 834 (existing specs, now on a video player). The stage stays the largest element (asserted).

## Gates

| Gate | Result |
| --- | --- |
| `npm run check` | pass: typecheck, lint, 39 test files / 1164 unit tests, build, package (31 files, includes both mp4), check:artifact ok |
| `npm run lint:php` | ok (17 files, PHP 7.4 + 8.3, PHPCompatibilityWP) |
| `npx playwright test --workers=6` | 703 passed, 44 skipped (conditional `test.skip` in existing specs; the new specs add none), 0 failed |
| `npm run wp:start:wsl` + `npm run test:integration:wsl` | 178 passed, 0 failed (22.5 min) |
| `npm run test:zip-install` | ok |
| `npm run wp:stop:wsl` | stopped; nothing left on 8888 / 8889 / 5174 / 5175 |

## Findings and notes

- Playwright WebKit reports the element's layout size as `videoWidth` (673 at a 673 px stage, 760 at a 760 px stage), not the file's 960. `video.spec.ts` therefore asserts 960x540 on Chromium and Firefox, and on WebKit a non-zero 16:9 picture plus a canvas check that the current frame is a real picture (more than 3 colours). Chromium and the dist run assert 960 exactly.
- A mid-run Firefox failure (`browserContext.close: Protocol error ... _maybeDontRestoreTabs`) hit two `gating.spec.ts` tests once in a partial run; it is a Firefox teardown crash, not an assertion, and did not recur in the full run.
- The "目前播放 only after the new source plays" test records every label change with the element state: during a switch the label may read a switching text, but `目前播放：Dolby Atmos 音軌` first appears only when `currentSrc` is `demo-video-2.mp4`, the element is playing and `readyState >= 2`.
- On the harness the fixed site banner (80 px desktop) starts at 920; Start (bottom 919) stays clear of it at 1440x1000. At 1280x800 Start is below the fold (only 1440x1000 is required, as for audio).

## Not done / open

- Real devices: video playback in real Safari / iOS Safari (inline playback, range requests against the production host, fullscreen) is untested; Playwright WebKit is not Safari. The device compatibility table stays 尚待測試.
- The settings-page note is covered by PHP lint and the existing settings specs only; no spec asserts its text.
- Real HLS / iframe streams, ticket checks and stream protection are M2 and untouched.
