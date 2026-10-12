# Direction A · Gallery

Status: plan reviewed, mockups built, screenshots critiqued and improved once. Nothing in `src/` or `plugin/` changed.

Mockups (served by `npm run dev`, Vite):
`/dev/mockups/a-gallery/events.html`, `player.html` (pre-start, Binaural chosen), `player-playing.html` (目前播放：Binaural).
All CSS is in `dev/mockups/a-gallery/style.css`, scoped under `.wg-live`, written against the class names of the real components.

## 1. Idea in one paragraph

The studio's own pages are editorial: big images with no frame, short headings, light type straight on the dim studio photo, one yellow action. Direction A copies that and adds nothing. Events and the player sit directly on the photographic background. The poster is the largest thing on every screen. Hierarchy comes from type size and space, not from boxes or rules. Yellow marks exactly two things: the one primary action of the view and the chosen listening mode.

## 2. Palette (six named values, all from the site unless marked NEW)

| Name | Hex | Use | Source |
|---|---|---|---|
| Paper | `#f0f5fa` | text, headings, secondary actions | measured body/h2 colour |
| Mist | `#c0c8d0` | secondary text (performers label, notes), 7.9:1 on `#303030`, 11.2:1 on `#111` | NEW (already `--wg-text-muted`) |
| Night | `#111111` | media stage, control bar, panels (as `rgba(17,17,17,.72)` over the photo) | measured (Astra colour 7, the 75% overlay) |
| Studio Yellow | `#f0d62b` | the primary button, the chosen mode, nothing else | measured brand yellow |
| Ink on Yellow | `#000000` | text on yellow, 14.4:1 | measured (WooCommerce / WPForms buttons) |
| Live Green | `#7ddc9a` | the dot before 演出中 only, always next to text | NEW (already `--wg-success`) |

Hover for yellow is the measured `#c2a903`. Links in the plugin are Paper with an underline, not yellow (yellow is reserved; hover turns them Studio Yellow). Error and cancelled states keep `--wg-danger` `#ff8a80`, not shown in these mockups.

## 3. Type roles and scale (no fonts shipped; the site loads both families)

| Role | Family and weight | Desktop / mobile |
|---|---|---|
| Page title (Live) | Noto Sans TC 500 | 38 / 28 px, line 1.3 (measured h2) |
| Event title, featured hero and player | Noto Sans TC 500 | 34 / 26 px |
| Section heading (精選活動, 聆聽方式…) | Noto Sans TC 500 | 26 / 22 px |
| Card title, mode panel title | Noto Sans TC 500 | 22 / 20 px |
| Body copy | Noto Sans TC 300 (the site's secondary weight; 200 is too thin on the photo) | 17 / 17 px, line 1.7 |
| UI text, meta, dates, buttons | Karla 500, Noto Sans TC falls in for CJK | 16-17 px |
| Small notes | Noto Sans TC 400 (never 300 below 17px) | 15 px, never below 14 |

Rules: no all caps, no letter-spacing tricks, numerals in dates come from Karla so they stay tidy, the demo notice is plain 15px text.

## 4. Layout concept

Content column is the site's 1140px. Section gap 96px (64px mobile), inside a section 24-32px. No borders anywhere except: the radio ring of a mode panel (it is the control), the yellow ring on the chosen panel, focus rings, and the site's own short bar under the page title. Posters have 0 radius, like every image on the live site.

Two button styles only: **Primary** (yellow, 48px high, 3px radius, Karla 500) and **Text** (Paper, underlined, 44px target, no box). Secondary actions (活動簡介, 登入, 切換模式, 靜音) are Text. Primary appears once per view; on the events page that is the featured event, so the cards in the grid use Text for the same CTA.

### Events, desktop (1440, content 1140)

```
 Live                                       <- 38px, short bar below (site's own mark)
 線上音樂會   (17/500)
 以耳機或家庭劇院，聆聽維光音樂的現場演出。

 精選活動                                   <- 26px
 +-----------------------------+   [dot] 演出中   介面示範
 |                             |   【介面示範】錄音室現場     <- 34px
 |   POSTER 16:9  (7/12)       |   音樂會 Live
 |                             |   演出者：示範樂手 A、示範樂手 B
 |                             |   2026年10月12日（一）14:29 台北時間
 +-----------------------------+   聆聽模式  耳機 Binaural   家庭劇院 Dolby Atmos
                                   [ 體驗播放介面 ]  活動簡介  登入   <- only yellow on page

 聆聽方式                                    <- 26px
 本站提供兩種聆聽方式…                       (lead, 17/300)
 耳機聆聽 · Binaural             家庭劇院 · Dolby Atmos     <- 2 columns, no boxes
 使用耳機聆聽…                    適用於經確認的播放裝置…
 一般耳機即可…(note)              請先閱讀支援條件…(note)
 閱讀完整聆聽說明

 其他活動
 +---------------------+   +---------------------+
 |  POSTER 16:9        |   |  POSTER (or quiet   |   equal heights; CTA is bottom aligned
 +---------------------+   |  tone if none)      |
 [dot] 尚未開始 介面示範    +---------------------+
 【介面示範】即將開始…       已結束 介面示範
 演出者：…                  【介面示範】已結束的…
 2026年10月15日（四）…      演出者：…  日期
 距離開始：3 天             聆聽模式  耳機 Binaural
 聆聽模式 …                  (flex spacer)
 體驗播放介面 (Text) 活動簡介  查看活動資訊 (Text)

 常見問題      (accordion rows, 52px, "+" marker; no rules)
```

Grid: two columns up to two cards; three columns when the list has three or more (`:has(> li:nth-child(3))`), one column below 768px.

### Events, mobile (390, 20px gutter)

```
 Live  / 線上音樂會 / intro
 精選活動
 [POSTER 16:9, full column width]
 [dot] 演出中  介面示範
 title (26px)
 演出者 / 日期 / 聆聽模式 (stacked)
 [ 體驗播放介面 ] (full width, 52px)
 活動簡介      登入   (Text, side by side)
 聆聽方式  (modes stacked, 40px apart)
 其他活動 (one column, each: poster, text, Text CTA)
 常見問題
```

### Player, pre-start, desktop

```
 +-------------------------------------------------------------+
 |                                                             |
 |     STAGE: poster, 5:2 crop (object-fit: cover), 1140 wide |
 |                                                             |
 +-------------------------------------------------------------+
 [dot] 演出中  介面示範
 【介面示範】錄音室現場音樂會 Live                       <- 34px
 演出者：示範樂手 A、示範樂手 B   2026年10月12日（一）14:29 台北時間
 按下「開始聆聽」即可播放                                 <- status as a plain line, 19px/500
 操作示範音訊，非 Binaural／Atmos 驗證素材                <- 15px, no box

 選擇聆聽模式                                             <- 22px
 ( ) 耳機聆聽 · Binaural             ( ) 家庭劇院 · Dolby Atmos
     使用耳機聆聽…                       適用於經確認的…
     一般耳機即可…                       請先閱讀支援條件…
     選擇耳機模式      已選取            選擇家庭劇院模式
   (selected: yellow dot + 2px yellow ring + the words 已選取)
 閱讀聆聽說明與支援條件

 [ 開始聆聽 ]    已選擇：Binaural                         <- the one yellow button
 活動資訊: description (left) | 節目單 (right)   聆聽說明
```

### Player, playing, desktop

```
 +-------------------------------------------------------------+
 |                        STAGE (poster)                       |
 +-------------------------------------------------------------+
 | [ 暫停 ]  靜音  音量 ----o----          目前播放：Binaural  切換模式 |   <- ONE bar, attached to the stage, Night surface
 +-------------------------------------------------------------+
 [dot] 演出中  介面示範
 【介面示範】錄音室現場音樂會 Live
 演出者… 日期
 播放中    操作示範音訊，非 Binaural／Atmos 驗證素材
 模式標示只代表所選的音訊版本，不代表已確認裝置的輸出方式。
 活動資訊 | 節目單
```

Only the controls the demo adapter can really perform are drawn: 暫停, 靜音, 音量. No 返回直播 (the demo track is not live), no 全螢幕 (audio).

### Player, mobile (390)

Pre-start: stage (16:9), caption (status dot, title 26px, performers, date, status line, demo notice), mode panels stacked (each 100% wide, min 96px), 開始聆聽 full width 52px, info below.
Playing: stage, then the bar as three rows inside one surface: row 1 暫停 (full width, 52px); row 2 靜音 + 音量 slider; row 3 目前播放：Binaural + 切換模式. Caption and info follow. Nothing is fixed to the bottom, so nothing competes with the site's Backer Plan banner (80px / 190px, z-index 999).

## 5. Principles

1. The poster is the page. It is always the biggest element and it is never framed.
2. One yellow thing per state: the primary button, or the chosen panel plus the primary button. Everything else is Paper.
3. Space separates, lines do not. A line may only exist if it is a control (radio ring, slider track, focus ring).
4. Two button styles. If a third seems necessary, the layout is wrong.
5. Copy, order and states come from the spec and `src/i18n`. The design adds no words and claims no capability.
6. 48px primary and 44px secondary targets; focus is a 2px Paper ring with 3px offset on everything; `prefers-reduced-motion` removes all transitions.
7. Dim by contrast, not by opacity: an ended event desaturates its poster; its text stays at full contrast.

## 6. Review of the plan against the brief and the AI-design traps

| Check | Finding | Change made to the plan |
|---|---|---|
| Brief: no boxes | First draft put the guide modes and FAQ rows in tinted cards. | Guide modes are plain columns; FAQ rows are plain 52px rows. Only the media object (stage + bar) and the selectable mode panels are surfaces, because they are functional. |
| Brief: hairline-free | First draft separated FAQ items and the info columns with 1px rules. | Removed; spacing only. The footer hairline and the short bar under the page title belong to the site. |
| Brief: yellow only for primary and selected | First draft used yellow for the 演出中 badge, text links and each card's CTA. | Status is a Paper dot-and-word (green dot for live). Links are underlined Paper. Card CTAs are Text; only the featured CTA is yellow. |
| Trap: SaaS card kit (identical rounded cards, soft shadow, gradient wash) | Equal-height grid of cards would read as the kit. | The "cards" have no surface, no radius, no shadow; only the poster (0 radius) and text. Equal height comes from the grid, the aligned CTA from a flex spacer. |
| Trap: near-black plus acid accent | Night plus yellow could read that way. | It is the site's own palette (measured). The yellow is used for one action and stays a warm brand yellow; the surround is the site photo, not flat black. Hover is the site's `#c2a903`. |
| Trap: cream, serif, terracotta | Not present: sans only, no warm paper tones. | none |
| Trap: broadsheet hairlines | Present in draft 1 (rules between sections). | Removed (see above). |
| Trap: ALL-CAPS eyebrows / monospace data labels | Draft 1 had a small "LIVE" label above the title. | Dropped. The status word with its dot is sentence-case, 16px Karla. No monospace anywhere. |
| Trap: "A · B · C" meta strings | The real player meta line joins performers and date with ' · '. | In the design they are two separate items on one line with a gap (CSS only needs `gap`; the ' · ' text node moves to a separator-free structure, see porting notes). The spec's own 「耳機聆聽 · Binaural」 names keep their '·'. |
| Trap: '→' on buttons | None. | none |
| Spec 2.4 | No gradient wash, glass, neon, particles, fake spectrum, Dolby badge. | The mock poster is a flat two-tone composition, and the bar is a flat surface. |
| Spec 5.3: mobile order is title, status, stage, controls | The brief puts title and status beneath the stage. | Chosen: stage first on all sizes. Flagged for decision in the hand-back (the alternative is a CSS-only `order` change on mobile). |

## 7. Critique and improvement pass

Screenshots: `C:/Users/kevin/AppData/Local/Temp/claude/D--Developing-WG-Dolby-Stream/6c158215-c414-4aa4-a105-138ba6b5860c/scratchpad/directions/a-gallery/` (`events`, `player`, `player-playing`, each `-desktop` and `-mobile`, full page, plus `-fold` shots with the Backer Plan banner). Compared with the baseline shots (home, biography, store at 1440 and 390) and the "before" shots.

What works (kept):
- It reads like a page of the studio's site: unframed images, Noto Sans TC headings at the measured scale, the short bar under the title, one yellow action. The "before" boxes, dashed borders and the alert box are gone.
- Events: the featured hero (poster 8/13, details 5/13) and the two-column grid line up on the left edge of the site's 1140 container; the CTAs in the grid sit on one line.
- Player, playing: stage and bar read as one media object, the only boxed thing on the page; targets are 48px (primary) and 44px (text buttons, slider). No overflow at 1440 or 390 (checked: scrollWidth equals clientWidth).

What changed in the improvement pass (first shots to second):
1. The unselected mode panel was invisible: a dark veil on near-black. Panels are now a light veil (`rgba(240,245,250,.08)`, selected .14 plus the yellow ring), so they read over the photo and over near-black.
2. The info block had stretched gaps because the programme spanned three grid rows. Paragraphs now sit in one `.wg-live__info-main` column.
3. The pre-start stage was 21:9 (480px) and pushed the mode panels below the fold. It is now 5:2 (448px), with tighter caption and panel padding. The panels start at about y=940 at 1440x1000; the start button is still below the fold (about y=1240). Accepted: the choice comes first, and a remembered mode is already selected.
4. The hero poster was widened from 7/12 to 8/13 (the poster should carry the page).
5. Lines broke inside words (錄音 / 室) with `text-wrap: balance`, so it was replaced by `pretty` (no one-character last line). One mid-word break remains in the hero title ("音 / 樂會") because CJK has no word spaces; check a real title on staging.
6. The FAQ list was narrowed to 720px so the plus sign stays near its question.

Known limits, not fixed:
- The quiet tone in the 已結束 card (the fixture has no poster) looks like a missing image. A real event should always have a poster; otherwise use a placeholder poster, do not leave the slot empty.
- The leading 【 of every demo title leaves a half-width gap at the left edge. `font-feature-settings: 'halt'` fixes it but also halves all other punctuation, so it is not applied.
- Full-page screenshots show the photo only in the first viewport (it is `background-attachment: fixed`); in a browser it stays behind the page.
- The poster art is mock-only (flat two-colour compositions, labelled 介面示範). Real posters are cropped by `object-fit: cover` (5:2 on desktop, 2:1 on tablet, 16:9 on phones), so key content should sit in the middle 5:2 band.
- Not tested: real devices, forced-colors mode, contrast over every part of the real photo.

## 8. Porting notes

Mostly CSS. Nothing here touches the TypeScript state model or the adapters.

| File | Change |
|---|---|
| `src/styles/theme-bridge.css` | Add `--wg-night`, `--wg-panel`, `--wg-panel-hover`, `--wg-panel-selected` (light veils), `--wg-font-ui` (Karla first). Set the body weight token to 300 for text of 17px and up (15px notes stay 400). Links become underlined Paper with a yellow hover (new `--wg-link-ui`, or change `--wg-link`). |
| `src/styles/base.css` | `.wg-live__btn` becomes the Text style; `--primary` is the only filled button; one shared focus ring (Paper, 2px, 3px offset); `text-wrap: pretty`. |
| `src/styles/events.css` | Replace card surfaces, borders and the dashed "over" state with the unframed card; featured grid 8fr/5fr; list grid 2 columns (3 with `:has(> li:nth-child(3))`); guide as plain columns; FAQ as plain rows with a plus/minus marker; non-featured cards render `--primary` as a Text button (CSS only). |
| `src/styles/player.css` | Stage 5:2 (2:1 below 1024px, 16:9 below 768px), 0 radius; caption under the stage; `order` rules driven by `[data-status]` (bar above the caption while loading, playing, paused, switching, reconnecting); mode panels as light-veil labels with a radio dot, yellow ring and 已選取; bar surface only in the engaged states. |
| `src/styles/responsive.css` | Phone rules from `dev/mockups/a-gallery/style.css` (stacked panels, full-width start button, three-row bar). |
| `src/styles/accessibility.css` | One focus rule, including `.wg-live__mode-input:focus-visible + .wg-live__mode-card`. |
| `src/styles/help.css` | Not designed here; reuse the plain-column rules (guide) and FAQ rows. |
| `src/styles/dev-panel.css` | Unchanged (never shown on production). |

DOM changes, most important first:
1. `src/views/player.ts`: move `head` (title, status, entitlement) inside `.wg-live__player`, between the stage and the controls; CSS `order` decides the final order. This puts the title under the stage as the brief asks, and **differs from spec 5.3's mobile order** (title and status before the stage). To keep spec order on phones, leave `head` first there and apply the reorder from 768px up.
2. `src/views/player.ts`: split `.wg-live__player-sub`. The status badge and the demo badge go in a `.wg-live__meta-row` before the title; performers and date become two `.wg-live__player-meta-item` spans (drop the ' · ' text node). The demo badge leaves the heading, so the heading gets `aria-labelledby` pointing at the title text and the badge.
3. `src/components/event-card.ts`: same move for the demo badge (out of the heading into `.wg-live__event-card-meta`, labelled by id). Mode chips stay a `ul` but are styled as plain text. Always render `.wg-live__event-card-media` (empty and `aria-hidden` when there is no poster) so grid rows stay aligned.
4. `src/components/status-panel.ts`: `createModeLabel` keeps label and note as two nodes; the note (模式標示只代表…) moves to the status block in the caption, so the control bar stays one row.
5. `src/views/player.ts`: wrap the description paragraphs and the date in `.wg-live__info-main` (the programme stays the second column).
6. `src/components/mode-selector.ts`: no DOM change; `.wg-live__mode-card::before` draws the radio dot.
7. Every link inside the plugin carries a class (for example `wg-live__link` on the help link in `player.ts`), because host themes style bare `a:hover` and `a:focus-visible` with more specificity than one class.

Not changed: copy, state model, adapters, entitlement, ARIA roles, the demo notice and the 介面示範 badge (both still shown in every state), the dev panel.

Open decisions: (a) title under the stage on phones (spec 5.3 vs the brief); (b) the 5:2 crop of posters on desktop; (c) underlined Paper links instead of the site's yellow links inside the plugin; (d) one yellow button per events page (the featured CTA), Text CTAs in the other cards.
