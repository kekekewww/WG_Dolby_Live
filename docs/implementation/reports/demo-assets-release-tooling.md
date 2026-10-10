# Report: demo-assets-release-tooling

## Files created
- scripts/generate-demo-audio.mjs: ffmpeg (spawnSync, arg arrays) synthesis of 30 s quiet stereo material (4-chord sine/2nd-harmonic progressions, slow per-voice L/R pan, inter-channel detune). Peak is measured with volumedetect and normalised to -18 dBFS, then 2 s qsin fade in/out. Temp WAVs live in os.tmpdir and are removed.
- plugin/wg-live/assets/demo/: demo-tone.m4a (AAC-LC 128k, 44.1k, +faststart, 478 KB), demo-tone.mp3 (470 KB), demo-tone-1.mp3 (copy of demo-tone.mp3), demo-tone-2.mp3 (different progression), poster-demo.svg (1600x900, flat dark warm grey, generic font stacks, no gradients, no fake spectrum), LICENSE-demo.txt.
- scripts/package.mjs: exports shouldShip, collectFiles, parsePluginVersion, parseStableTag, createZip, packagePlugin; CLI writes artifacts/wg-live-<v>.zip + .sha256. Also asserts build-info.json version equals package.json.
- scripts/check-artifact.mjs: exports checkEntries, checkZip, findNewestZip, constants. Checks: single root/names/sorted, wg-live.php, forbidden entries, exact dist file set + build-info SHA-256s (M1-PLAN 7.3 item 4), dev strings in js/css/php, CSS scope (checkCss from check-css-scope.mjs), gzip budgets (js 100 KiB, summed CSS 30 KiB), version equality (package.json, header, Stable tag, build-info, zip name), .sha256 match.
- scripts/seed-demo.php: idempotent by slug (demo-live, demo-upcoming, demo-ended), PHP 7.4 syntax, ABSPATH guard first.
- tests/unit/check-artifact.test.ts: 20 tests (check-artifact pass/fail cases, allowlist, packagePlugin on a temp fake repo incl. reproducibility; temp dirs removed).

## Verification
- npm run demo:audio: pass. ffprobe: all 30.000 s, aac LC / mp3, 44100 Hz, 2 ch, 128 kbps. volumedetect max: m4a -18.0 dB, mp3 -18.5 dB, mp3-2 -18.5 dB. m4a has moov before mdat.
- npm run test:unit: pass (32 tests total, 20 mine).
- npm run lint: pass (eslint + css scope).
- node scripts/lint-php.mjs: pass on php:7.4-cli and 8.3-cli (1 file: seed-demo.php).
- E2E CLI on a temp fake repo (real demo + dist files, fake wg-live.php/readme.txt): package.mjs then check-artifact.mjs, all 9 checks PASS, exit 0. Temp dir removed. In the real repo package.mjs fails with the clear "wg-live.php not found" message (plugin not written yet); check-artifact exits 2 with no zip.
- npm run typecheck: FAIL, not mine: dev/harness.ts(40) BootConfig is missing featuredEventSlug and heading (src/types.ts changed or harness stale).

## Decisions / open problems
1. Conflict: task says demo-tone.m4a + demo-tone.mp3; M1-PLAN D7 says demo-tone-1.mp3 (binaural) and demo-tone-2.mp3 (atmos). Both sets are produced (about 1.9 MB total in the ZIP). Drop whichever set is not used. dev/mock-rest.ts uses /demo/demo-tone.m4a.
2. seed-demo.php stores array meta (performers, programme, available_modes) as native PHP arrays (WP serialises them) and booleans as 1/0. The PHP agent's Events::get_event_data must read them that way; M1-PLAN does not specify the storage format. Single place to change: wg_live_seed_events/wg_live_seed_upsert.
3. WP-CLI rejects unknown assoc args for eval-file, so "mode=demo" (positional) is the documented form; "--mode=demo" in $args and env WG_LIVE_SEED_MODE=demo also work. Not run inside wp-env (plugin and stack do not exist yet), only php -l checked. With mode=demo the option is merged but wg_live_settings_meta (version/updated_at) is not bumped.
4. Budget: CSS 30 KiB is applied to the sum of gzipped shipped CSS (per task), stricter than the plan's per-file figure.
5. Seeded post_status is publish; Events' slug validation filter must not reject programmatic saves (no POST data).
