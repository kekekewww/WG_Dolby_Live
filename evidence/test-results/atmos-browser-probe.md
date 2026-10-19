# Dolby Atmos test file: format check and browser decode probe (lab, 2026-10-19)

Lab evidence only. This is **not** a Dolby Atmos rendering test and does not change the home-theatre / device compatibility
table, which stays 尚待測試 until someone listens on real devices (`evidence/test-results/manual-devices.md`, spec §13.2, M2
end-to-end validation). The test file is the studio's master and is not in the repository, the ZIP or any tunnel.

## The file

`11-NightClub 1960_WG_DolbyAtmos_MP4.mp4`, supplied by the user, 154,301,489 bytes, 6:03.9.

| Item | Value | How |
|---|---|---|
| Container | MP4, brands `mp42`, `dby1` | ffprobe |
| Video | H.264 High, 1920x1080, 24 fps, about 2.6 Mbps | ffprobe |
| Audio | E-AC-3 (Dolby Digital Plus), profile "Dolby Digital Plus + Dolby Atmos", 48 kHz, 768 kbps | ffprobe |
| Atmos signalling | `dec3` box: one independent substream, bsid 16, acmod 7 + LFE (5.1 bed), `flag_ec3_extension_type_a` = 1 (JOC present), `complexity_index_type_a` = 16 | parsed from the MP4 (ETSI TS 102 366 Annex F) |
| Decode | the whole audio track decodes with 0 errors | `ffmpeg -v error ... -f null -` |

Bed levels over the whole track (ffmpeg decodes the 5.1 bed only; the JOC object layer is not rendered by ffmpeg):

| Channel | Peak dBFS | RMS dBFS |
|---|---|---|
| Front left | -2.5 | -24.9 |
| Front right | -2.0 | -25.6 |
| Centre | -10.9 | -32.8 |
| LFE | -15.7 | -38.0 |
| Surround left | -2.9 | -26.3 |
| Surround right | -1.2 | -26.5 |

Every bed channel carries signal and nothing reaches 0 dBFS.

## Browser decode probe

Served on 127.0.0.1 only (Range-capable), played from 60 s after a real click, per-channel levels read through Web Audio
(`ChannelSplitter` + analysers) for 5 s. Windows 11, temporary browser profiles (never the user's own).

| Browser | `canPlayType('video/mp4; codecs="avc1.640028, ec-3"')` | MSE | What happened |
|---|---|---|---|
| Microsoft Edge 155 | probably | yes | Plays with sound: 6 decoded channels (peaks 0.28 / 0.32 / 0.11 / 0.05 / 0.23 / 0.21), mixed to the 2-channel output |
| Google Chrome 155 | "" | no | **Picture plays, no sound, no error** (0 audio bytes decoded) |
| Brave 155 | "" | no | **Picture plays, no sound, no error** (0 audio bytes decoded) |
| Playwright Chromium 156 | "" | no | Picture plays, no sound, no error |
| Firefox 157 | "" | no | Picture plays, no sound, no error (`mozHasAudio` false) |
| Playwright WebKit 27.2 (Windows) | probably | no | Not measured: this build has no `AudioContext`. Playwright WebKit is not Safari |

## In the player (after the silent-audio guard, commit 2240cef and later)

Dist harness on localhost with `WG_DEV_ATMOS_FILE` pointing at the file and the default type
`video/mp4; codecs="avc1.640028, ec-3"`; Atmos mode chosen, 開始聆聽 pressed, state read after 6 s.

| Browser | Result |
|---|---|
| Edge 155 | Plays `local-atmos.mp4`: 5.4 s in, 546,816 audio bytes decoded, 目前播放：Dolby Atmos |
| Playwright Chromium 156 (Chrome / Brave engine) | No silent picture: 「目前環境無法播放這個音訊版本」 with 改用耳機 Binaural and 聆聽說明, the media is released (paused, no source) |

The e2e suite covers the same behaviour with a self-generated E-AC-3 fixture (`tests/e2e/unsupported-audio.spec.ts`).

## What this means

- The file is a valid Dolby Atmos (DD+ JOC) delivery and its 5.1 bed is clean.
- Chrome, Brave and Firefox cannot decode Dolby Digital Plus. Without a guard they play the picture silently and report no
  error, so the player must detect it (feature detection on the declared codecs, plus a check that audio is actually
  decoded) and show the spec §6 不支援來源 state 「目前環境無法播放這個音訊版本」 with 切換模式 and 查看說明.
- Edge decodes the DD+ bed. Whether the Atmos objects are rendered spatially depends on the output path (for example
  Windows with a Dolby Atmos-capable endpoint), which a headless probe cannot observe.
- Safari on Apple devices is the expected Atmos path (Spatial Audio on supported headphones and speakers); it must be
  checked by a person on real devices.
