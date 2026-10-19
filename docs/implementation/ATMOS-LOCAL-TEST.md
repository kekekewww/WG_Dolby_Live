# Local Atmos test hook (dev only)

Plays the studio's Dolby Atmos master through the live demo event's ATMOS mode, from where the file lives. It exists to see how a real E-AC-3 JOC file behaves in each browser. It is **not** Atmos rendering validation.

## Never commit, copy, package, upload or tunnel the file

The file is the studio's master (`...WG_DolbyAtmos_MP4.mp4`, about 154 MB). The hook only streams it, with Range support, from the path you give it, to the local harness on `localhost`. Do not copy it into the repo, the plugin ZIP, staging or production, and do not expose the harness through a tunnel (ngrok, cloudflared, port forwarding). `tests/` and the ZIP never contain it; the unit test of the hook uses a temp file of fake bytes.

## How to run

PowerShell, from the repo root:

```powershell
$env:WG_DEV_ATMOS_FILE = 'C:\Users\kevin\Downloads\11-NightClub 1960_WG_DolbyAtmos_MP4.mp4'
# optional, default shown:
# $env:WG_DEV_ATMOS_TYPE = 'video/mp4; codecs="avc1.640028, ec-3"'
npm run dev            # Vite harness:  http://localhost:5173/dev/listen.html?wg_event=demo-live-binaural-atmos
# or the built bundle:
npm run build; npm run serve:dist   # http://localhost:<port>/dev/dist/listen.html?wg_event=demo-live-binaural-atmos
```

Then choose 家庭劇院 (Atmos) and press the start button. The environment variable is read on every request, so unsetting it (or pointing it at a missing file) puts the harness back to the bundled demo video with no restart of the page logic. The harness still binds only `localhost`; the hook adds no listener.

What the hook changes: the live demo event's ATMOS descriptor from `GET /wp-json/wg-live/v1/playback` becomes `{ kind: 'demo', url: '/demo/local-atmos.mp4', mimeType: WG_DEV_ATMOS_TYPE }`. Binaural, the other events and the public event data (no source URLs) are unchanged. The mock REST is dev-only; PHP and the ZIP are not touched.

`WG_DEV_ATMOS_TYPE` matters: with `codecs="...ec-3"` the browser can answer `canPlayType` honestly; with a bare `video/mp4` Chrome and Firefox say "maybe", start the picture, and only the silent-audio guard (below) catches the missing sound.

## What the studio file does in each browser (measured 2026-10-19)

The file: H.264 High 1080p24 plus E-AC-3 JOC (Dolby Digital Plus with Dolby Atmos, dec3 complexity index 16), 5.1 (side) bed, 768 kbps, 48 kHz. It decodes cleanly with ffmpeg.

| Browser | `canPlayType('video/mp4; codecs="avc1.640028, ec-3"')` | Result |
|---|---|---|
| Edge 155 | `probably` (MSE true) | decodes 6 channels |
| Chrome 155, Brave 155 | `""` | picture plays, **no audio, no MediaError** |
| Playwright Chromium 156, Firefox 157 | `""` | picture plays, no audio, no MediaError |
| Playwright WebKit 27.2 | `probably` | audio not measured (no AudioContext in that build) |

Consequences in the player:
- With codecs in the type, Chrome, Firefox and Brave stop at the `canPlayType` check: 不支援來源 (「目前環境無法播放這個音訊版本」) at once.
- With a bare type, the element plays the picture silently. The native-media adapter then checks once per load, after 1.5 s of playback, `webkitAudioDecodedByteCount === 0` (Chromium) or `mozHasAudio === false` (Firefox) and reports `unsupported` (fatal, no retries). Engines without either property stay "unknown": nothing is reported.
- The state is the same 不支援來源 state in both cases: 改用耳機 Binaural (the mode switch for an Atmos failure, spec 5.4) and 聆聽說明 are offered; the last mode that really played stays 「目前播放」 / last good.

## What this is not

- Playing the file in Edge proves the browser decodes the E-AC-3 JOC bed (6 channels). It does **not** prove object-based Atmos rendering. Object rendering needs Apple Spatial Audio or a Dolby-enabled output chain (AirPlay to a certified receiver, a Dolby-enabled TV or soundbar app, and so on).
- The Atmos device compatibility table in the help view stays **尚待測試** until a real device test is recorded. No "Atmos certified" or "7.1.4 connected" label is ever shown.
- Delivery of real Atmos streams (HLS/DASH packaging, DRM, entitlement) is M2.
