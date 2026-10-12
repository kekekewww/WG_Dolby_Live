# Chosen design: hybrid A + C (2026-10-12)

The user picked the hybrid after reviewing A · Gallery, B · Console and C · Programme (`docs/design/directions/*.md`, mockups in `dev/mockups/`). This file is binding for the visual implementation. Where it is silent, follow **A** (`a-gallery.md`). The only C elements adopted are the ones listed under "From C".

## From A · Gallery (the base)
- Palette, type roles and scale are A §2–§3: Paper `#f0f5fa`, Mist `#c0c8d0`, Night `#111111`, Studio Yellow `#f0d62b` (hover `#c2a903`), Ink on Yellow `#000`, and Live Green `#7ddc9a`, used only as the dot before 演出中. Noto Sans TC 500 for headings and 300 for body at 17 px or more; Karla 500 for UI, numerals, dates and buttons; nothing below 14 px.
- Content sits directly on the site's photographic background. There are no card boxes, no dashed borders and no hairline section rules; space separates sections.
- Yellow appears on exactly two things per view: its one primary action, and the chosen listening mode. Links are underlined Paper that turn yellow on hover. Secondary actions are quiet text buttons that still hit the 44 px target.
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
Audio events do not get a 16:9 slab. From 768 px the poster is a square cover (280-336 px) with the title, status and mode label to its right; the mode panels and the one yellow Start (or, once playing, the one dark bar) follow directly below, so both panels and Start are in the first viewport at 1440x1000. On a phone the cover (at most 36vw, max 160 px) sits beside the status line and title, and the spec 5.3 order is kept. Video events keep the 16:9 stage. The demo poster keeps its text inside the central square so the crop does not cut it.

## Host colours: inherit-first (inherit-colors, 2026-10-12)
Spec 2.2 / 3.5: the outer page keeps the site's background and text. Text that sits on the host background (headings, body, status, meta, programme, card text, links, quiet buttons, badges, the featured card) uses the host's colour: `--wg-text`, `--wg-link` and the focus ring are `currentColor`. Secondary text is `color-mix(in srgb, currentColor 85%, transparent)` inside `@supports` (Safari 15.4 has no color-mix and keeps full strength); veils, hairlines and the error tint (`--wg-danger-text`) follow the same rule with neutral grey / currentColor fallbacks. Link and quiet-button hover thickens the underline instead of turning yellow (yellow text is unreadable on a light host); programme numerals use `--wg-accent-text` (accent mixed with the text colour). Own surfaces keep explicit colours: stage and cover, the dark control bar (engaged states, Paper inside), dialog and sheet, date tile, poster placeholder, yellow buttons (two-tone focus ring), dev panel. Mist is now `#ccd3da` so it still reads on a 72% Night bar over a white host.
Harness: `?host=light` (docs/design/site-mock.md); gates: `tests/e2e/host-contrast*.spec.ts`.
