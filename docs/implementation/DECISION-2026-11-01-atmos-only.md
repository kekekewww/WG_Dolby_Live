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

## Recommendation (for the owner)

Keep **one link** and drop the listening-mode choice, but ask the provider to put a **stereo AAC rendition inside the same master playlist** next to the Atmos one. Apple devices with Atmos support pick Atmos by themselves; Windows browsers then play stereo instead of failing outright; nobody chooses a mode. Without it, every Chrome/Edge/Firefox viewer gets an error and must use VLC.

## Consequences to settle before go-live

- **Windows via VLC needs the stream address in the viewer's hands.** Today the plugin never shows a source URL; it hands one only to the player after the ticket check. A VLC path means showing an entitled viewer a short-lived signed address to paste into VLC, which the provider's URL signing (B3b) must support. Anyone holding that address can watch until it expires.
- **Browsers without E-AC-3** (Chrome, Brave, Firefox; Edge to be checked) get no playable audio from the site player. The page should say so plainly and point to Safari or VLC, never claim Atmos.
- The provider must still serve **https on a domain**; production refuses http stream addresses, and browsers block http media on https pages.
