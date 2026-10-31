# Decision: Dolby Atmos stream only, no Binaural track (2026-11-01)

**Status:** decided by the product owner (the boss), relayed by the user on 2026-11-01. Code changes pending the checks below.

## Decision

- Each concert is streamed as **one Dolby Atmos stream** (E-AC-3 with JOC). No separate Binaural (stereo AAC) stream is delivered.
- The listening-mode choice (「聆聽方式」: 耳機 Binaural / 家庭劇院 Dolby Atmos) is removed from the site, because there is only one stream.
- **Apple devices (Safari):** the owner states Safari decodes DD+ JOC; on a home theater (e.g. 7.1.4) the Atmos reaches the right speakers, and on headphones Apple renders it to binaural, as Apple Music does.
- **Windows:** the owner states viewers should use **VLC** to play the stream, and that the audio works.

## Supersedes

- Spec §5 (two listening modes), M1-PLAN mode selector, M2-PLAN "one Binaural (AAC) and one Atmos (E-AC-3 JOC) playlist per event".
- CLAUDE.md rule "Don't block Binaural for non-Safari browsers" (there is no Binaural stream to offer).

## Observed test stream (2026-11-01, address kept out of the repo)

Live HLS, MPEG-TS segments, one rendition: H.264 1080p + E-AC-3 "Dolby Digital Plus + Dolby Atmos" (5.1 bed, 48 kHz), about 6.9 Mbps, plain http on an IP address.

## Checks before changing code

| Claim | Check | Result |
|---|---|---|
| Safari plays HLS E-AC-3 JOC in the browser | research | **Partly.** Apple's HLS authoring spec lists E-AC-3/Atmos for Macs from 2018 and iOS devices with A12+; older devices play E-AC-3 without Atmos. No Safari-specific statement found. Needs a real Apple device. |
| Headphones get a binaural render of the Atmos (not only a stereo downmix) | research | **Unconfirmed.** Apple documents Spatial Audio for its own apps; nothing found for web playback in Safari. Needs AirPods + Safari test. |
| Home theater gets Atmos over HDMI from Safari web playback | research | **Partly.** macOS Sequoia HDMI passthrough is documented for the TV, Music and QuickTime apps, not Safari. Needs a real test. |
| Chrome / Edge on Windows play the stream in the site player | shipped `wg-live-hls.js` in Playwright Chromium and Microsoft Edge on this PC, 2026-11-01 | **No.** Both report `ec-3` unsupported; hls.js stops with `manifestIncompatibleCodecsError` because the only variant is `avc1.640028,ec-3`, so neither video nor audio plays. (Recheck: the C4 Edge run decoded the E-AC-3 fixture; this run's Edge reports no E-AC-3 support.) |
| VLC on Windows plays the stream with audio | `D:\VLC\vlc.exe` headless, audio decoded to WAV, 2026-11-01 | **Yes, as 5.1.** VLC opened the stream and decoded 6 channels at 48 kHz with sound on every channel (mean -23 to -39 dB). That is the 5.1 bed; passing Atmos through to an AV receiver (VLC's HDMI/S/PDIF passthrough setting) was not tested. |

**Apple HLS Authoring Specification** ([source](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html)): rule 2.3 says stereo audio in AAC/HE-AAC **MUST** be provided; rule 2.6 says that when Dolby Digital Plus is offered to devices without it, Dolby Digital (AC-3) must also be provided. Dolby's delivery guidance also recommends a 5.1 fallback in the same manifest.

## Recommendation (for the owner) and answer

Recommended: keep one link but add a stereo AAC rendition inside the same master playlist, so Windows browsers play stereo instead of failing.

**Answer (2026-11-01): no stereo rendition. Only Dolby Atmos is streamed.** Windows users, and anyone whose playback fails, are told to use VLC with their personal link. The boss tests on real devices on 2026-11-02.

## What the plugin does (0.4.0)

| Area | Behaviour |
|---|---|
| Listening modes | Server offers only `atmos` (`Events::mode_labels()`); stored `binaural` values are dropped; admin shows one 「開放聆聽」 checkbox and only the Atmos HLS / provider-page fields. `?wg_mode=binaural` and `/playback` for binaural get no URL. |
| Player page | An event with one mode preselects it; no 聆聽方式 selector, no 切換模式. Playback still starts only on 開始聆聽. |
| Stage | Media type defaults to 音訊: the event thumbnail (featured image) on the stage and an `<audio>` element; video only when an event is saved as 影片. |
| Ticket holders' link | For an entitled viewer of a live HLS event, when the browser cannot play E-AC-3 (feature detection) or playback failed: 「取得我的播放連結」 asks `/playback` on a click (a fresh link per click), then shows the link, 複製連結, 在新分頁開啟 and the VLC / Safari steps. Never at page load, never in public data. Proposed copy, for approval. |
| Browsers | Chrome / Edge / Firefox on Windows: the page player refuses Atmos before any download (no E-AC-3) and shows the link panel. Safari: plays natively when the stream is https. |

The link is "one-time" only once the provider signs URLs (M2-PLAN B3b); until then it is the plain stream address and anyone holding it can play.

## Before the boss can test on the real site

The test stream is plain http on an IP address. On https://sounds.wgstudiomusic.com:

1. The page player cannot load it (browsers block http media on an https page), so only the link route works.
2. The plugin refuses http stream addresses in production and hands out no URL without a signer unless `WG_LIVE_ALLOW_UNSIGNED_STREAMS` is set in wp-config.php.
3. Real sources need deployment mode 「正式」, which turns on ticket checks: the tester needs a paid order for the event's ticket product.

Testing the boss's device claims needs none of this: open the stream address directly in Safari (Mac / iPhone / iPad with AirPods or HDMI to a receiver) or in VLC on Windows.

## Consequences to settle before go-live

- **Windows via VLC needs the stream address in the viewer's hands.** Today the plugin never shows a source URL; it hands one only to the player after the ticket check. A VLC path means showing an entitled viewer a short-lived signed address to paste into VLC, which the provider's URL signing (B3b) must support. Anyone holding that address can watch until it expires.
- **Browsers without E-AC-3** (Chrome, Brave, Firefox; Edge to be checked) get no playable audio from the site player. The page should say so plainly and point to Safari or VLC, never claim Atmos.
- The provider must still serve **https on a domain**; production refuses http stream addresses, and browsers block http media on https pages.
