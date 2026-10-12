# Direction C · Programme

Status: mockups only (`dev/mockups/c-programme/`). Nothing in `src/` or `plugin/` changed. Served by `npm run dev` (Vite), for example `/dev/mockups/c-programme/events.html`.

## 1. Idea in one paragraph

The site stays dark and photographic. On top of it the Live area is set like a printed concert programme: **type does the work, dates are the structure, and the one thing you "hold" is a ticket.** Every event is led by a big date block (month small, day numeral large, weekday and time small) in Karla figures; titles are Noto Sans TC. The events page is a schedule (a cover for the featured event, then rows). The player page reads like opening the booklet: title spread (date block, title, performers), the numbered programme as the prominent content, and the listening controls on a compact paper "ticket stub" with notched edges. Paper objects (date tiles, the ticket) are the only light surfaces; everything else is type on the ground.

## 2. Palette (6 named colours, all from the measured site)

| Name | Hex | Origin | Used for |
|---|---|---|---|
| Night | `#111111` | Astra colour 7/8, the photo overlay colour | ink on paper, text on yellow, fill of the primary button on paper |
| Paper | `#f0f5fa` | measured body text colour | text on the ground, and the paper of date tiles and the ticket |
| Marquee | `#f0d62b` | brand yellow (logo, Astra 0, Elementor accent) | the live date tile (cover and player), primary button on the ground, programme numerals, focus ring on dark |
| Brass | `#c2a903` | Astra 1, measured hover | hover fill only; never text on paper (2.2:1) |
| Smoke | `#c0c8d0` | `--wg-text-muted` (theme-bridge, NEW, 11.2:1 on #111) | secondary text on the ground |
| Slate | `#334155` | Astra 3 | secondary text on paper (9.3:1 on Paper) |

Rule: **primary button = yellow fill on the ground; Night fill with a yellow label on paper** (yellow on Paper is 1.4:1, so the button edge would vanish). The hairline colour is the measured `rgba(208,213,219,.5)` and is used in one place (FAQ). No blue or green status colours: status is a text chip (live = yellow fill, scheduled = outlined, ended = muted outlined).

## 3. Type roles and scale

Only fonts the live site already loads: Karla **400 only** (the real site loads no other Karla weight, so no bold or 500 Karla anywhere), Noto Sans TC 200 to 700.

| Role | Face | Desktop / mobile (px) | Weight |
|---|---|---|---|
| Page title `Live` | Karla (Latin) | 56 / 44 | 400 |
| Subtitle 線上音樂會 | Noto Sans TC | 22 / 20 | 500 |
| Cover day numeral (ink on the yellow live tile) | Karla figures | 152 / 88 | 400 |
| Player day numeral | Karla figures | 112 / 88 | 400 |
| Row day numeral | Karla figures | 60 / 56 | 400 |
| Cover title / player h1 | Noto Sans TC | 40 / 28 and 40 / 30 | 500 |
| Row title | Noto Sans TC | 24 / 21 | 500 |
| Section heading (精選活動, 節目單, 聆聽方式) | Noto Sans TC | 26 / 22 | 500 |
| Programme item | Noto Sans TC | 24 / 20, numerals Karla 36 / 28 | 500 |
| Body | Noto Sans TC | 17 / 17 | 400 |
| Small (notes, chips, tile captions) | Noto Sans TC | 14 / 14 | 400 |

Line height 1.65 body, 1.2 titles, 0.9 numerals. Numerals use `font-variant-numeric: tabular-nums`.

## 4. Layout concept and wireframes

Container 1140 (the site), 20px gutters on mobile. Section rhythm 72 desktop and 48 mobile. Radius 3px everywhere (the site's), no shadows, no gradients.

### 4.1 Events, desktop (1440)

```
Live                                                  (56, white underline as on the site's "Store")
線上音樂會
以耳機或家庭劇院，聆聽維光音樂的現場演出。

精選活動
┌──────────────┐  [演出中] [介面示範]
│ 2026年10月   │  【介面示範】錄音室現場音樂會 Live          (40)
│     12       │  演出者：示範樂手 A、示範樂手 B
│  (yellow     │  聆聽模式：耳機 Binaural    家庭劇院 Dolby Atmos
│   tile)      │  [體驗播放介面]  [活動簡介]   登入
│ 週一 14:29   │
│ 台北時間     │
└──────────────┘

聆聽方式
本站提供兩種聆聽方式…
耳機聆聽 · Binaural              家庭劇院 · Dolby Atmos       (two text columns, no boxes)
使用耳機聆聽…                    適用於經確認的…
一般耳機即可…                    請先閱讀支援條件…
閱讀完整聆聽說明

其他活動
┌─────┐  【介面示範】即將開始的音樂會 [介面示範]   [尚未開始]
│10月 │  演出者：示範樂手 C
│ 15  │  距離開始：3 天
│週四 │  聆聽模式：…                             [查看活動]
│14:49│
└─────┘
┌─────┐  【介面示範】已結束的音樂會 …
│ 05  │  (outlined tile = ended)                   [查看活動資訊]
└─────┘

常見問題  (rows with a rule: the only rules)
```

### 4.2 Events, mobile (390)

```
Live / 線上音樂會 / intro
精選活動
┌─────────────────────────┐
│ 10月  12     週一 14:29 │  tile becomes a horizontal band (yellow):
│ 2026         台北時間   │  numeral left, weekday/time/zone right
└─────────────────────────┘
[演出中] [介面示範]
title (28)   performers   modes
[體驗播放介面]   (full width)
[活動簡介]       (full width, outlined)
登入
聆聽方式 (stacked text)
其他活動: tile (72 wide) + text; CTA full width under the text
```

### 4.3 Player, desktop, before start (1440)

```
┌ title spread + programme (7/12) ──────────┐  ┌ ticket (5/12, paper, notched) ┐
│ [演出中] [介面示範]                        │  │ 選擇聆聽模式                  │
│ ┌────┐ 【介面示範】錄音室現場音樂會 Live   │  │ (o) 耳機聆聽 · Binaural 已選取│
│ │ 12 │ 演出者：示範樂手 A、示範樂手 B      │  │     說明 / 輔助說明           │
│ └────┘                                     │  │ ( ) 家庭劇院 · Dolby Atmos    │
│ 活動資訊                                   │  │     說明 / 輔助說明           │
│ 這是介面示範活動…                          │  │ 閱讀聆聽說明與支援條件        │
│ 節目單                                     │  │ (notch) · · · · · · (notch)   │
│ 01  示範曲目 一                            │  │ [      開始聆聽      ]        │
│ 02  示範曲目 二                            │  │ 已選擇：Binaural              │
│ 03  示範曲目 三                            │  │ 操作示範音訊，非 Binaural／…  │
│ 節目單為預定內容，不代表…                  │  └───────────────────────────────┘
│ 聆聽說明                                   │
└────────────────────────────────────────────┘
```

### 4.4 Player, desktop, playing

```
same left column                                ┌ ticket ─────────────────────────┐
                                                │ 目前播放：Binaural      (22, 500)│
                                                │ 模式標示只代表所選的音訊版本…    │
                                                │ [切換模式]                       │
                                                │ (notch) · · · · · · · · (notch)  │
                                                │ [  暫停  ]  [靜音]               │
                                                │ 音量 ──●────  [返回直播]         │
                                                │ 操作示範音訊，非 Binaural／…     │
                                                └──────────────────────────────────┘
```

### 4.5 Player, mobile (390), order follows spec 5.3

```
[演出中] [介面示範]
┌───────────────────────┐
│ 10月 12   週一 14:29  │  tile as a band: numeral + caption
└───────────────────────┘
title (30)
演出者：…
ticket (full width)   before start: options stacked, perforation, Start, labels
                      playing: 目前播放, 切換模式, perforation, 暫停 + 靜音 + 音量
活動資訊 / 節目單 01 02 03 / 聆聽說明
```

The site's fixed Backer Plan banner (80px, 190px on mobile) is the only fixed element; nothing here is pinned to the bottom.

## 5. Principles

1. Dates are structure. A date block always has the same parts in the same order, at three sizes (cover, player, row). Weekday and time are always small; the numeral is the one large Karla element on a page.
2. Light surfaces mean "an object": date tiles and the ticket. Status shows on the tile (yellow = live, paper = upcoming, outlined = ended) and always also as a text chip.
3. Numbering only where order is real: the programme (01 02 03). Never on cards, steps or modes.
4. One button system: primary (yellow, or Night on paper), secondary (1px outline, the site's own "Read more" button), tertiary (underlined text link). Heights 48 / 44 / link with a 44px target.
5. Keep the site: 3px radius, Noto Sans TC and Karla, brand yellow, the dark photo; no new colour except Smoke (already in theme-bridge).
6. Nothing decorative implies a capability: no waveform, no "ON AIR" pulse, no track highlight, no Dolby badge. The playing state is text (目前播放：Binaural) and a pause button.
7. The perforation (notches and a dotted line) appears once, on the ticket. No other dashed or dotted borders; disabled is shown by muted fill and the visible reason text.

## 6. Review of the first draft against the brief and the AI-design traps

Changes made after reviewing the first draft of this plan:

| Trap or brief item | First draft | Changed to |
|---|---|---|
| Cream + serif + terracotta | Serif Noto Serif TC titles "to feel printed" | No serif (it would also ship a font). Paper is the cool site text colour `#f0f5fa`; no warm tones |
| Near-black + acid accent | Yellow numerals on every row | Yellow only on the cover numeral, live tile, primary buttons, programme numerals and focus ring on dark |
| Broadsheet hairlines | A rule under every row, double rule under headings | No rules in the schedule; spacing and date blocks give the structure. Only the FAQ keeps rules (an accordion needs them) plus the site's own underline under the page title |
| SaaS card kit | Every event a rounded dark card with a poster | Rows are not cards. The only boxes are the date tile (size and fill vary with role and status) and the ticket |
| ALL-CAPS eyebrows | Small "PROGRAMME" / "TICKET" labels | Removed; real copy headings only (節目單, 活動資訊) |
| `A · B · C` meta strings | Player meta kept `演出者：… · 2026年…` | Performers and date separated; the date lives in the tile. The only `·` left are in the spec-pinned mode names |
| Monospace data labels | Considered mono for times | Karla figures with tabular numerals |
| `→` on buttons | none | none |
| Dashed borders (a reason the current UI looked bad) | Dashed demo badge and dashed disabled button kept | Solid demo badge; disabled has no dashed border; the ticket perforation is the single exception |
| Brief: no zero-radius everything | | 3px radius throughout |
| Brief: programme list prominent | Programme under the description at 17px | 24px titles with 36px Karla numerals directly under the title spread |
| Spec 2.4 | | No gradients, glass, shadows or particles; paper is flat |

## 7. Critique of the first screenshots, and the improvement pass

Screenshots: `<scratchpad>/directions/c-programme/` (`events|player|player-playing` x `desktop|mobile`, full page, plus `-fold` captures that include the Backer Plan banner, and three focus close-ups). Compared with `evidence/design-baseline` home, store and biography at 1440 and 390.

What works against the live site: header, 3px radius, Karla and Noto Sans TC, brand yellow and the dark photo are untouched; the white underline under `Live` repeats the site's divider under `Store`; the yellow date tile has the same colour and weight as the Backer Plan banner, so it reads as site furniture. The whole player (title, programme, ticket) fits the 1440x1000 first screen above the banner (ticket ends at y=900, banner starts at y=920).

Found and fixed in the pass:

1. The player title broke mid-phrase and its leading full-width bracket pushed it right of the performers line: now `text-wrap: balance` and `text-spacing-trim: trim-start` (progressive; browsers without them keep the old look).
2. The Listening Guide heading missed the section-heading rule (it sits one wrapper deeper) and crowded its lead sentence: fixed.
3. `聆聽模式：` and its values were 18px apart: tightened to 8px.
4. Text links (`閱讀完整聆聽說明`, `查看更多說明`) were 25px tall: now 44px targets. A script then checked all six pages: no interactive element under 44px, no text under 14px, no horizontal scroll.
5. Ghost links had 4px side padding that pulled them off the text edge: removed.
6. On 390px the two schedule rows showed full-width paper bars: now compact blocks (only the cover and the player title keep the full-width band).

Known trade-offs, not fixed:

- On 390x844 the start or pause button sits just under the first screen once the 190px Backer Plan banner is counted (the ticket starts at y=455 while playing). The order follows spec 5.3 (title, controls, mode, info); the banner is dismissible and scrolling is normal on a phone. A shorter mobile band would gain about 30px if the studio wants the button higher.
- Rows show `10月` and the numeral only; the year is in the cover and player blocks and in the screen-reader text of every block. Add the year to row blocks if events more than a year apart are expected.
- The poster slot is not drawn. When a poster exists, show it as an optional 3:2 image beside the cover text and above the programme on the player page; the date block carries the layout without it.
- Contrast (relative luminance): Night on Marquee 12.91, Marquee on Night (primary button on paper) 12.91, Slate on Paper 9.44, Night on Paper 17.22, Smoke on the lightest possible ground `#4c4c4c` 5.08, Marquee on `#4c4c4c` 5.87.

## 8. Porting notes

Nothing here was applied to `src/` or `plugin/`. The mockup CSS is written to replace `events.css`, `player.css`, the events part of `help.css`, `featured.css`, and the badge, button and disabled rules of `base.css`. `theme-bridge.css` only gains `--wg-paper`, `--wg-ink`, `--wg-slate`, `--wg-font-figure`, `--wg-rule`.

Styles to change

| File | Change |
|---|---|
| `src/styles/theme-bridge.css` | add the five tokens above; keep every existing token |
| `src/styles/base.css` | demo badge solid not dashed; disabled button loses the dashed border (muted fill instead); `.wg-live__btn` min-height 48 for card and ticket buttons; ghost padding 0 |
| `src/styles/events.css`, `featured.css` | replace card, list, guide and FAQ rules with the events part of `dev/mockups/c-programme/style.css` |
| `src/styles/player.css` | replace with the player part (grid 1fr / 436px, ticket face and stub, mode cards, programme list) |
| `src/styles/responsive.css` | the two breakpoints (767, 1023) live inline in each block; the file can shrink |

DOM changes (small; class names and ids used by tests stay)

1. `src/util/time.ts`: `formatEventDateTime` also returns parts (`month`, `day`, `weekday`, `clock`, `zoneLabel`) so a date block can be built; `full` and `machine` stay.
2. New `src/components/date-block.ts` (about 30 lines): a `<time datetime>` with a visually hidden full string and four `aria-hidden` spans; variants `cover`, `player`, `row` and a status modifier `live | upcoming | over`. Used by `event-card.ts` and `views/player.ts`.
3. `event-card.ts`: the poster slot is replaced by the date block (poster becomes optional, see trade-offs); wrap meta, title, performers, countdown and modes in `.wg-live__event-card-info`; the modes list is plain inline text (same class names); the details toggle uses the secondary variant, login stays ghost, all card buttons 48px.
4. `views/events.ts`: no structural change (title, featured, guide, others, FAQ is the spec order). The underline under `Live` is CSS only.
5. `views/player.ts`: no stage poster art for audio (`createStageArt` stays for video); the status panel and the entitlement panel move from the head into the ticket stub, after the controls; the head becomes the badge row plus a hero (date block, h1 with demo badge, performers line). The `演出時間` line in the info section and the head meta string with `·` go (the date block is the date). The info section keeps heading, description and programme.
6. `components/player-shell.ts`: `controlsSlot` gets two wrappers, `.wg-live__ticket-face` (mode selector, then mode bar) and `.wg-live__ticket-stub` (controls, status panel, entitlement panel). The mode bar must come before the transport controls in the DOM so that `目前播放：…` and `切換模式` form the face while playing; before start the same bar shows `已選擇：…` under the options. The media element and the focus handling do not change.
7. `listening-guide.ts`, `mode-selector.ts`, `player-controls.ts`: no new elements; the radio mark is drawn in CSS from `[data-selected]`.
8. Programme list: `ul.wg-live__programme-list` becomes `ol` (the numbers are CSS counters, screen readers get real list numbering).

Behaviour kept: no autoplay, one media element, Space/K scope, announcements. The dev panel keeps its own dashed box (dev only, never on production).

Open for the orchestrator: add the year to row blocks or not; sticky ticket on desktop (not done); what the date tile shows for `intermission` (now: yellow like `live`, only `live` is drawn).
