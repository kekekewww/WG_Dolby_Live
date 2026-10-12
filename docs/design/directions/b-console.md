# Direction B · Console

Status: design exploration, not implemented in `src/`. Mockups: `dev/mockups/b-console/{events,player,player-playing,player-idle}.html` + `style.css` (served by `npm run dev`, http://localhost:5174/dev/mockups/b-console/events.html).
Screenshots: `C:/Users/kevin/AppData/Local/Temp/claude/D--Developing-WG-Dolby-Stream/6c158215-c414-4aa4-a105-138ba6b5860c/scratchpad/directions/b-console/`.

## 1. Idea

The studio's own world is a Dolby Atmos mixing room: racks of gear, a transport, a monitor controller with a lit button for the active source. The page keeps the site's identity (dark photo, Noto Sans TC, brand yellow, 3px buttons) and adds exactly one bold thing: **the player stage is a hardware faceplate**: a matte near-black panel with a recessed display, two channel-strip toggles and a labelled transport. Everything else (events, guide, FAQ, info column) is quiet: flat rack-unit strips, no outlines, no shadows.

One rule carries the whole system: **a lit lamp means "on"**. A lamp is a 10px flat circle, brand yellow when lit, a dark ring when not. It marks the selected listening mode, the live event, the muted state, and playing. It is static (no glow, no pulse, no animation) and is always paired with text (`已選取`, `演出中`, `播放中`), so it is never the only signal (spec 7.2).

## 2. Palette (starting from the measured site tokens)

| Name | Hex | Origin | Use |
|---|---|---|---|
| Brand yellow | `#f0d62b` | measured (logo, Astra colour 0, links) | primary button, lit lamp, focus ring, links |
| Yellow dark | `#c2a903` | measured (hover) | button/link hover |
| Text | `#f0f5fa` | measured | all body text, 15.7:1 on chassis |
| Muted | `#b4bcc6` | new (theme-bridge uses `#c0c8d0`) | captions, helper text, 9.0:1 on chassis, 7.3:1 on a key |
| Chassis | `#1b1b1e` | new, one step above the `#111` overlay | stage panel, rack-unit strips; edge `#323237` |
| Plate | `#111112` | new, recessed bays inside the chassis | display window, strips bay, transport bay |
| Key | `#2b2b30` | new | secondary button / unselected channel key; bottom edge `#0b0b0c` |

Black text on yellow is 14.4:1 (measured). Danger `#ff8a80` is used only for the `已取消` status text.
No second accent: the amber of the brief is the brand yellow; a separate orange would not belong to the site.

## 3. Type roles and scale

Noto Sans TC for everything (what Elementor content uses on the site; Karla has no CJK), weights 400 and 500 only. No monospace, no all-caps, no letter-spacing tricks.

| Role | Size / line | Weight | Where |
|---|---|---|---|
| Page title | 38/1.3 (28 mobile), measured | 500 | `Live`, player title |
| Section | 22/1.3 (20 mobile) | 500 | 精選活動, 聆聽方式, 其他活動, 常見問題, 活動資訊 |
| Unit title | 20/1.35 (featured 28) | 500 | event rows, featured event |
| Readout | 22/1.35 (19 mobile) | 500 | player status line in the display |
| Body | 17/1.65 measured, 16 in dense units | 400 | descriptions |
| Silkscreen caption | 14/1.4 | 500, muted | printed labels on the faceplate: 選擇聆聽模式, 播放控制, 音量, 目前聆聽模式; field labels 演出者, 演出時間, 聆聽模式 |
| Small | 14/1.5 | 400 | helpers, notes (never below 14) |

Spacing 4/8/12/16/24/32/48 (spec 3.6). Radius 3px (measured button radius) for every control and unit; the panel is 4px. Targets: 52px play, 48px other primary, 44px secondary.

## 4. Layout

### Events, desktop (1140 container)

```
Live                                              (38px)
線上音樂會                                         (20px)
以耳機或家庭劇院，聆聽維光音樂的現場演出。

精選活動                                          (section)
+--------------------------------------------------------------+
| [ poster 16:9 in a   ]  ● 演出中   [介面示範]                 |
| [ recessed window    ]  【介面示範】錄音室現場音樂會 Live      |
| [                    ]  演出者   示範樂手 A、示範樂手 B        |
| [                    ]  演出時間 2026年10月12日（一）14:34 …   |
| [                    ]  聆聽模式 [耳機 Binaural][家庭劇院 …]   |
|                         [體驗播放介面]  [活動簡介]  登入       |
+--------------------------------------------------------------+

聆聽方式
耳機聆聽 · Binaural             家庭劇院 · Dolby Atmos   (two plain columns)
說明 / 注意                      說明 / 注意             閱讀完整聆聽說明

其他活動  (session schedule: 1U strips, 2px apart, no rules)
+---------------+---------------------------+----------+------------------+
| 2026年10月15日 | 【介面示範】即將開始的音樂會 | ○ 尚未開始 | [體驗播放介面]    |
| （四）         | 演出者 示範樂手 C           |          | [活動簡介]  登入  |
| 14:54 台北時間 | 聆聽模式 耳機 / 家庭劇院    |          |                  |
+---------------+---------------------------+----------+------------------+
| 2026年10月5日  | 【介面示範】已結束的音樂會   | ○ 已結束  | [查看活動資訊]    |
+---------------+---------------------------+----------+------------------+

常見問題   (details strips)           查看更多說明
```

### Events, mobile (390)

```
Live / 線上音樂會 / intro
精選活動
+--------------------------+
| [poster 16:9, full]      |
| ● 演出中 [介面示範]       |
| 【介面示範】錄音室…        |
| 演出者  …                 |
| 演出時間 …                |
| 聆聽模式 [..] [..]        |
| [   體驗播放介面   ]      |
| [   活動簡介       ]      |
| 登入                      |
+--------------------------+
聆聽方式 (stacked)
其他活動
+--------------------------+
| ○ 尚未開始               |
| 2026年10月15日（四）      |
| 14:54 台北時間            |
| 【介面示範】即將開始…     |
| 演出者 / 聆聽模式         |
| [   體驗播放介面   ]      |
| [   活動簡介  ]  登入     |
+--------------------------+
```

### Player, pre-start, desktop

```
【介面示範】錄音室現場音樂會 Live  [介面示範]                       活動資訊
● 演出中   演出者 …   演出時間 …                                    說明文字…
+--------------------------------------------------------------+   演出時間 …
| .----------------------------------------------------------. |   節目單
| | [poster 240x135]  ● 演出中                                | |   01 示範曲目 一
| |                   按下「開始聆聽」即可播放                | |   02 示範曲目 二
| |                   操作示範音訊，非 Binaural／Atmos 驗證素材| |   03 示範曲目 三
| '----------------------------------------------------------' |   節目單為預定內容…
| 選擇聆聽模式                          閱讀聆聽說明與支援條件 |   聆聽說明
| .--------------------------.  .--------------------------.  |
| | ● 耳機聆聽 · Binaural    |  | ○ 家庭劇院 · Dolby Atmos |  |   (channel-strip toggles:
| | 說明 / 注意               |  | 說明 / 注意               |  |    lamp + pressed key)
| | [選擇耳機模式    已選取] |  | [選擇家庭劇院模式       ] |  |
| '--------------------------'  '--------------------------'  |
| 播放控制                       目前聆聽模式                   |
| [ ▶ 開始聆聽 ]                 ● 已選擇：Binaural             |
|                                模式標示只代表所選的音訊版本…  |
+--------------------------------------------------------------+
```

### Player, playing, desktop (mode strips are hidden by the real component while playing)

```
+--------------------------------------------------------------+
| .----------------------------------------------------------. |
| | [poster]   ● 演出中                                       | |
| |            播放中                                          | |
| |            操作示範音訊，非 Binaural／Atmos 驗證素材        | |
| '----------------------------------------------------------' |
| 播放控制                                      音量            |
| [ ❚❚ 暫停 ]  [ 靜音 ]                         ----[]-------- |
| 目前聆聽模式                                                  |
| ● 目前播放：Binaural                          [ 切換模式 ]    |
| 模式標示只代表所選的音訊版本，不代表已確認裝置的輸出方式。      |
+--------------------------------------------------------------+
```

### Player, mobile (390): one column in spec 5.3 order

```
title + badge
● 演出中  演出者 / 演出時間 (labelled lines, not a '·' string)
+--------------------------+
| [poster 112] ● 演出中     |   display: compact thumbnail left,
|              按下「開始…」 |   readout right
| 操作示範音訊，非 …        |
| 選擇聆聽模式   閱讀說明    |
| +----------------------+ |
| | ● 耳機聆聽 · Binaural | |   strips stack
| | [選擇耳機模式  已選取] | |
| +----------------------+ |
| | ○ 家庭劇院 · Dolby…   | |
| +----------------------+ |
| 播放控制                  |
| [   ▶ 開始聆聽        ]  |   full-width 52px
| 目前聆聽模式              |
| ● 已選擇：Binaural        |
+--------------------------+
活動資訊 / 節目單 below
```
Playing (mobile): readout, then `[ ❚❚ 暫停 ]` full width, `[靜音]` + volume fader on one line, then `● 目前播放：Binaural` with `[切換模式]`.

## 5. Principles

1. One bold idea: the stage panel. Everything else is flat and quiet.
2. A lit lamp means "on", always with text beside it. Static, no glow.
3. Controls are labelled the way gear is: a small printed caption above each group (these reuse existing copy: 播放控制, 音量, 目前聆聽模式).
4. One button system: primary (yellow, black text), secondary (dark key with a bottom edge), link (yellow text). Nothing dashed, nothing outlined-only.
5. Rack units are fills, not outlines: 2px gaps between strips, no hairline rules, no shadows except the faceplate's hard edge.
6. Real facts only: no meter, no spectrum, no level readout, no numbers that imply capability. The fader's value is its position; the demo notice stays visible in both modes.
7. Same markup, new skin: class names of the real components are kept; DOM changes are listed in section 8.

## 6. Review of the first draft against the brief and the generic-AI-design traps

The first draft had these problems; each was changed before building.

| Draft | Problem | Change |
|---|---|---|
| Brushed-metal texture on every panel and strip | Skeuomorphic kit, noisy, "everything is a hardware widget" | Texture only on the stage chassis, at ~2% opacity; strips and rows are flat fills |
| Rack-ear screws in the panel corners, `CH 1` / `CH 2` badges on the strips | Kitsch, and the badges are invented all-caps/mono data labels | Both removed; strips keep only the real copy |
| Status tones as coloured dots (blue info, amber warning, red error) | SaaS status-dot kit; colour carries meaning | Binary lamp (lit/unlit) plus text; only `已取消` text uses danger colour |
| Poster thumbnails in every schedule row | Rows without a poster (the ended event) leave holes, rows become uneven | Poster only on the featured unit (spec 5.1 asks for it there only); rows are text-only |
| Meta lines like `演出者：A、B · 2026年…` | The `A · B · C` meta-string trap | Labelled field pairs (演出者 / 演出時間 / 聆聽模式) in a two-column grid; `·` remains only inside the spec-pinned mode names |
| Hairline rules between schedule rows | Broadsheet hairlines | 2px gaps between flat strips (rack units), no rules |
| Four card styles (featured card, guide cards, rows, FAQ cards) | SaaS card kit | Featured = one unit, guide = plain columns, schedule = strips, FAQ = strips; no identical rounded cards, no soft shadows, no gradients |
| Mute/transport icons drawn as glyph set | Icon kit | Only play/pause get a CSS-drawn symbol (it is a transport); everything else is text |
| A pill-shaped demo badge with glow | Neon/HUD | Flat plate, tinted yellow fill, yellow text, solid, no dashes |

Remaining honest risks: near-black plus yellow is the site's own identity, not an imported accent, but it is the "near-black + acid accent" shape; it is kept restrained (yellow appears only on the primary action, lit lamps, links and focus). The chassis is only one step lighter than the page overlay, so against the bright part of the photo it reads as an object by its edge, not by contrast; checked in the screenshots.

## 7. Accessibility notes

Contrast computed for the mockup colours: text on chassis 15.7:1, muted 9.0:1 (8.3:1 on the pressed strip), yellow on chassis 11.8:1, yellow text on the demo plate 8.4:1, black on yellow 14.4:1, danger text 7.5:1, lamp ring 3.3:1 against the chassis (decorative: text always accompanies it). Focus ring 2px brand yellow, 2px offset, on every control (the radio's ring is drawn on its strip). Selection = lamp + pressed key + the text `已選取`. `prefers-reduced-motion`: the only transitions are colour, 200ms. 48/52px primary and 44px secondary targets; the fader thumb is 30px tall and the track is a 44px-high hit area.

## 8. Porting notes

Styles (new file set replaces the skin, keeps the structure):
- `src/styles/theme-bridge.css`: add `--wg-chassis`, `--wg-chassis-edge`, `--wg-plate`, `--wg-key`, `--wg-key-edge`, `--wg-lamp-on` (= `--wg-accent`), `--wg-lamp-off`. Keep all existing tokens; change `--wg-text-muted` to `#b4bcc6` only if the 17px muted text on the photo needs it (not required).
- `src/styles/base.css`: restyle `.wg-live__btn--secondary` (dark key, no outline), `--ghost` (link), `.wg-live__badge` (lamp + text instead of pills; `--demo` solid plate not dashed). Disabled button: no dashed border, use a flat dark key with muted text.
- `src/styles/player.css`: the faceplate (`.wg-live__player` chassis + plates), strips (`.wg-live__mode-*`), transport, volume fader, modebar; remove the status box styling (`border-inline-start`, `dashed`).
- `src/styles/events.css`: featured unit, schedule strips (grid areas on `.wg-live__event-card-body`), guide columns, FAQ strips.
- `src/styles/dev-panel.css`: unchanged (dev only), but it should sit under the chassis visually, not inside.

DOM changes, kept small:
1. `components/status-panel.ts`: render the status section inside `.wg-live__stage` (after `.wg-live__stage-art`, as the display readout) instead of in `.wg-live__player-head`. The entitlement panel stays in the head. Alternative with no DOM move: absolutely not recommended (focus order and live region would diverge from the visual order).
2. `components/player-shell.ts` (stage): wrap the art and the readout in `.wg-live__display` (a recessed window).
3. `components/player-controls.ts`: add a visible caption element (`<span class="wg-live__caption">`) before each group: 播放控制 (exists as aria-label), 目前聆聽模式 (exists as aria-label), 音量 (the existing `<label>`). No new copy.
4. `components/mode-selector.ts`: put a `<span class="wg-live__lamp" aria-hidden="true">` before `.wg-live__mode-title` inside the label (the lamp is purely visual; selection is exposed by the radio and the `已選取` text). Marker `已選取` stays.
5. `components/event-card.ts`: (a) add the label `演出時間` to the `when` line (copy exists: `playerCopy.info.dateLabel`); (b) split `formatEventDateTime` into a date part and a time part (`<span class="wg-live__when-date">`, `<span class="wg-live__when-time">`) so the schedule column can break after the date; (c) badge: add a `<span class="wg-live__lamp" aria-hidden="true">` inside status badges; (d) remove the `·`-joined meta in `views/player.ts` (`.wg-live__player-meta`): render two labelled spans.
6. Programme list (`.wg-live__programme-list`): CSS counter, `01`, `02`, `03`; no DOM change.
7. No change to state, adapters, ids, aria wiring, hidden-attribute logic, or copy. The play button glyph is CSS (`data-action` / `[data-status]`), no new element.

## 9. Critique of the first screenshots and the improvement pass

Compared with the live-site shots (biography, store, home at 1440 and 390) and the brief.

What held up: the site identity (photo, header, yellow, 3px radius, the short title underline) carries over; the faceplate is the only loud object; one button system; selection is lamp + pressed key + `已選取`; no dashed borders, no outlines, no meters.

What was wrong in the first render, and what changed:
1. **Host-theme margins leaked** (`body.wgm p/ul/h2` margins beat the `:where()` resets): paragraphs and lists were spaced far apart and the schedule strips were indented 48px. Fixed with a two-class reset under `.wg-live__mount`. This is the same hostile-theme case the real `base.css` already handles for its own classes; the new files must keep the two-class form.
2. **Mode legend drawn on the fieldset edge** (the rendered `<legend>` straddles the border). Fixed: floated legend, so it is an ordinary block above the strips.
3. **Schedule rows were cramped**: the action block (3 controls in a row) squeezed the title column and wrapped the mode tags. Now actions are a 2-row block (primary, then key + link) in a 184px column.
4. **Pre-start bays were unequal and half empty**: the transport bay got half the width for a single button. In `idle`/`selecting` it now hugs its content and the monitor bay takes the rest; while playing it grows to fill the row.
5. **Horizontal overflow at 390** (a `nowrap` date+time in the event card). Fixed; checked scrollWidth = viewport at 390, 820 and 1440 for all four pages.
6. **Mobile display**: the notice wrapped beside the thumbnail; the status line now sits next to the poster and the demo notice spans the full width.
7. Readout 22px to 24px for the status line.

Known limits and honest notes:
- Full-page screenshots show the photo only for the first viewport height because the site background is `attachment: fixed`; this is a capture artefact of the mock, not of the design.
- The brushed texture (an inline SVG noise, about 0.4KB) is faint at 1x; it reads as matte metal. If it looks dirty on a real display or costs paint time on low-end phones, drop `--wg-brushed` and the panel is still correct.
- The stage panel is only one step lighter than the page overlay, so against the bright part of the photo it reads by its black edge and inset highlight rather than by contrast. Acceptable; it does not use glow or shadow to cheat.
- Not covered by static pages: dialog (切換模式) styling, error/reconnecting/unsupported states, entitlement panel, help view. The same plates and key buttons apply; the status line in the display is where error copy goes (use `--wg-danger` text, plus the retry key).
- Layout is checked in Chromium only (no WebKit/Firefox pass, no real Safari). The fader uses both `::-webkit-slider-*` and `::-moz-range-*` pseudo-elements and has not been looked at in Firefox or Safari.
- Poster is the demo placeholder SVG; real posters will change how heavy the display and featured unit feel.
