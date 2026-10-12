# hybrid-polish report

## Changed
- src/styles/player.css: audio-only compact layout. Stage is a 1:1 cover (`--pl-cover` clamp(280px,24vw,336px); phone min(36vw,160px)). `.wg-live__player` becomes a grid for `[data-media-kind=audio]`: >=768 cover | head, controls full width underneath (pre-start: selector + Start; engaged: the one dark bar 32px under the row); phone: head is `display: contents`, cover sits right of status line + title, performers/date, status and controls run full width. DOM order unchanged (head, stage, controls); media element stays inside `.wg-live__stage`. Video keeps 16:9. Text-only cover (no poster) uses a smaller, line-clamped title.
- plugin/wg-live/assets/demo/poster-demo.svg: text moved inside the central 900x900 so the square crop keeps it.
- src/styles/featured.css: empty/disabled state is a deliberate section (30/26px sentence, padding) and, in the empty state, the link to Live is the one yellow 48px button; forced-colors border added.
- dev/featured-card.mjs (new): renders the markup of templates/featured.php (event, empty, disabled) for the harness; strings/weekdays/status labels are READ from class-shortcodes.php.
- dev/serve-dist.mjs: `<!--WG_LIVE_DIST:featured-card-->` token; `featuredCardFor()`. home.html and stress-home.html use it. Default = live demo event card; `?featured=<slug>` other event, `?featured=none` or unknown slug = empty state, `?harness=disabled` = text only.
- tests/e2e/layout.spec.ts: compact cover specs (chromium/firefox/webkit): 1440x1000 both mode panels + Start inside the viewport, cover 280-340 square and beside the title, bar right under the cover+title row after Start, video keeps 16:9; 390x844 first panel inside viewport, cover <=40vw square beside the title, no horizontal scroll.
- tests/e2e/bundle.dist.spec.ts: home variants (event card default, empty = sentence + link to Live, disabled = text only, no sideways scroll at 390).
- tests/unit/featured-harness.test.ts (new, 9 tests): harness markup vs featured.php (class names both ways, parent > child structure, copy, three states, date format, home.html variants).
- docs/design/HYBRID.md: short note on the audio layout.

## Verified (spec 16.2)
PHP unchanged and already correct: empty = FEATURED_FALLBACK + link (`'empty' === state && live_url`), disabled = text only (featured_model sets live_url null).

## Measured (chromium, harness)
1440x1000: cover 336x336 at y=121; mode panels top 559; Start top 865 (bottom 913). 390x844: cover 140x140 beside title; first panel top 485; 820x1000: cover 280, panels 500, Start 834.

## Gates
npm run check ok (sizes: js 31.7/100, css 8.3/30, featured 2.5/30 KiB gzip); lint ok; vitest 1151 pass; playwright all projects 638 pass, 2 skipped (pre-existing). lint:php not run (no PHP changed).

## Notes / open
- Phone: status message sits between the cover row and the bar (head dissolves into the grid); the bar is not directly under the cover on phone, only on >=768.
- A real 16:9 poster with text near its edges would be cropped by the square cover (object-fit: cover, centre). PublicEvent has no square variant; M2/admin may want one.
- Not committed.
