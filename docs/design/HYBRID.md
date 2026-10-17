# Chosen design: hybrid A + C (2026-10-12)

The user picked the hybrid after reviewing A · Gallery, B · Console and C · Programme (`docs/design/directions/*.md`, mockups in `dev/mockups/`). This file is binding for the visual implementation. Where it is silent, follow **A** (`a-gallery.md`). The only C elements adopted are the ones listed under "From C".

## From A · Gallery (the base)
- Palette, type roles and scale are A §2–§3: Paper `#f0f5fa`, Mist `#c0c8d0`, Night `#111111`, Studio Yellow `#f0d62b` (hover `#c2a903`), Ink on Yellow `#000`, and Live Green `#7ddc9a`, used only as the dot before 演出中. Noto Sans TC 500 for headings and 300 for body at 17 px or more; Karla 500 for UI, numerals, dates and buttons; nothing below 14 px.
- Content sits directly on the site's photographic background. There are no card boxes, no dashed borders and no hairline section rules; space separates sections.
- Yellow appears on exactly two things per view: its one primary action, and the chosen listening mode. Links are underlined Paper; on hover the underline thickens and the colour stays `currentColor` (see "Host colours: inherit-first" below, which supersedes the earlier yellow hover). Secondary actions are quiet text buttons that still hit the 44 px target.
- Events page: the featured event is a wide hero (poster plus details), and the other events form an aligned grid of equal-height cards with the actions pinned to the bottom. The guide and the FAQ are plain columns and rows.
- Player: the stage (poster) is the hero, with the title and status integrated around it. There is **one dark control bar** (Night, 72% over the photo): play/pause (yellow), mute, volume (only where supported), 目前播放 text, and 切換模式. Status messages render inline, never as an alert box. Mode choice uses two large selectable panels with a clear selected state (yellow edge plus a "已選取" text label, not colour alone).
- Spec §5.3 mobile order is kept: title and status, stage, controls, current mode, switch, programme/info, help. That overrides A's "stage first on mobile".

## From C · Programme (the one bold element)
- **Date tile**: a yellow `#f0d62b` tile with ink text. It shows the month and year (small), the day as a big Karla numeral, then the weekday, time and 台北時間. It appears on the featured hero, on every event card (small size) and on the homepage featured card, and it is decorative-redundant: the full date text stays available to screen readers through the existing `<time datetime>`.
  - Status variants: live or doors open is solid yellow; scheduled is a Paper outline; ended or cancelled is a muted outline. The status text label is always present.
- **Numbered programme**: the 節目單 list on the player uses large Karla numerals (01, 02…) in yellow, because the programme order is a real sequence. The note 「節目單為預定內容…」 stays.

## Explicitly NOT adopted
- C's white "ticket" control card and its notches or perforation. Controls stay in A's dark bar.
- B's brushed panels, nested boxes and channel-strip lamps.

## Placeholder posters (demo only)
Replace A's teal panel with the cream disc. The new demo posters (`plugin/wg-live/assets/demo/poster-demo*.svg` and the fixture/harness posters) are on-brand: a dark photographic-toned field (Night to `#2b2b2b`) with a thin yellow accent and the text 「介面示範 · WG Studio Live」 / 「操作示範，非正式演出」, at 16:9 and 1:1. No gradients that read as tech washes, no glow. An event with no poster shows the same composition, so cards never show an empty tone block.

## Also in scope (so all states share the system)
- Switch dialog and mobile bottom sheet; failed, reconnecting and play_blocked states; entitlement panels; the dev panel (clearly labelled, quiet, dev only).
- Help page: the same type scale, the compatibility table restyled, no boxes.
- Homepage `[wg_live_featured]` card (PHP template plus `featured.css`): poster, date tile, title, 「介面示範」 badge and one yellow CTA.

## Unchanged
Behaviour, copy (spec §5–§6 strings), accessibility rules, CSS scoping (`.wg-live` / `.wg-live-featured` only) and the bundle budgets (JS ≤ 100 KiB, CSS ≤ 30 KiB gzip).

## Player: audio-only layout (hybrid-polish, spec 5.3)
Audio events do not get a 16:9 slab. From 768 px the poster is a square cover (280-336 px) with the title, status and mode label to its right; the mode panels and the one yellow Start (or, once playing, the one dark bar) follow directly below, so both panels and Start are in the first viewport at 1440x1000. On a phone the cover (at most 36vw, max 160 px) sits beside the status line and title, and the spec 5.3 order is kept. Video events use the video layout below. The demo poster keeps its text inside the central square so the crop does not cut it.

## Player: video layout (video-default, 2026-10-13, spec 5.3)
Every concert is streamed with video, so the 16:9 stage is the usual case and video is the default media kind (`media_kind` default `video`). A full-width 16:9 stage put the mode panels at 1090 px and Start at 1396 px at 1440x1000, the same fold the user rejected for audio. The equivalent of the audio compact layout for video:
- **From 1024 px**: `.wg-live__player` is a grid, `minmax(0, 1.65fr) minmax(0, 1fr)`, gap `clamp(32px, 3vw, 40px)`. The 16:9 stage is the hero on the left (60% of the content width, the largest element); the head (status badge, 「介面示範」 tag, title, performers / date, status line, demo notice) sits to its right, vertically centred. The mode panels and the one yellow Start follow directly below the row (controls padding 20 px); once playing, the one dark bar sits 32 px under the row.
- **768-1023 px**: stage full width (16:9) under the head, as before; the first mode panel still starts inside a 768x1024 viewport.
- **Phone**: unchanged spec 5.3 order (title and status, stage, controls, current mode, switch, programme / info, help). The first mode panel starts inside the viewport rectangle at 390x844 and 360x800, but the harness's fixed bottom banner (the live site's Backer Plan bar, 190 px on phones) hides it: at 360x800 the banner top is at 610, so the whole first panel (628-871) is covered; at 390x844 the banner top is at 654, so only about 9 px of the panel (top 645) shows. What is above the banner on a phone is the title, the status prompt and the stage. The 190 px height is a screenshot estimate of the live site (`design-baseline.md`) and must be confirmed on staging; do not read "inside the viewport" as "visible" on a phone. The phone layout gates in `tests/e2e/layout.spec.ts` check the viewport rectangle only, not the banner.
- The fullscreen button stays video-only. Audio-only events keep the compact cover above (the harness overrides one event to `mediaKind: 'audio'` to test it).

Measured in the harness (`/dev/listen.html?wg_event=demo-live-binaural-atmos&chrome=live`, Chromium; screenshots in `evidence/screenshots/video/`):

| Viewport | Stage (x, y, size) | Head | Mode panels (top-bottom) | Start (top-bottom) |
| --- | --- | --- | --- | --- |
| 1440x1000 | 160, 121, 672x378 | 171-449, right of the stage | 573-798 (both) | 871-919 (the fixed site banner starts at 920) |
| 1280x800 | 80, 121, 673x379 | 171-450 | 574-798 | 871-919 (below the fold at 800) |
| 1024x768 | 20, 121, 593x333 | 148-427 | 528-782 | 855-903 |
| 768x1024 | 20, 118, 728x410 (stacked) | 528-765 | 867-1151 (top inside the viewport; banner is 80 px here, so it starts at 944 and about 77 px of the panel shows) | 1232-1280 |
| 390x844 | 20, 392, 350x197 (under the title) | 118-392 | 645-888 / 904-1147 (first top is inside the viewport, but the 190 px banner starts at 654, so about 9 px shows) | 1228-1280 |
| 360x800 | 20, 392, 320x180 | 118-392 | 628-871 / 887-1130 (inside the viewport rectangle but fully covered by the 190 px banner, which starts at 610) | 1211-1263 |

At 1440x1000 both panels and Start were at 1090 and 1396 before; they are now fully inside the first viewport and above the site's fixed bottom banner. After Start the dark bar is at 531-611 (stage bottom 499). Gates: `tests/e2e/layout.spec.ts` (video and audio blocks) and `tests/e2e/video.spec.ts`.

## Host colours: inherit-first (inherit-colors, 2026-10-12)
Spec 2.2 / 3.5: the outer page keeps the site's background and text. Text that sits on the host background (headings, body, status, meta, programme, card text, links, quiet buttons, badges, the featured card) uses the host's colour: `--wg-text`, `--wg-link` and the focus ring are `currentColor`. Secondary text is `color-mix(in srgb, currentColor 85%, transparent)` inside `@supports` (Safari 15.4 has no color-mix and keeps full strength); veils, hairlines and the error tint (`--wg-danger-text`) follow the same rule with neutral grey / currentColor fallbacks. Link and quiet-button hover thickens the underline instead of turning yellow (yellow text is unreadable on a light host); programme numerals use `--wg-accent-text` (accent mixed with the text colour). Own surfaces keep explicit colours: stage and cover, the dark control bar (engaged states, Paper inside), dialog and sheet, date tile, poster placeholder, yellow buttons (two-tone focus ring), dev panel. Mist is now `#ccd3da` so it still reads on a 72% Night bar over a white host.
Harness: `?host=light` (docs/design/site-mock.md); gates: `tests/e2e/host-contrast*.spec.ts`.
