# Review: UI, DOM safety and accessibility (views, components, dom.ts, styles, i18n)

Independent, read-only review at commit bc1e150. Scope: `src/views/**`, `src/components/**`, `src/dom.ts`, `src/styles/**`, `src/i18n/**`, checked against `docs/implementation/M1-PLAN.md` (rev 2), `src/types.ts`, the spec (§2.4, §5, §6, §7, §9.4) and `CLAUDE.md`. I read the state selectors (`src/state/model.ts`), the coordinator's public methods and `src/main.ts` only where the in-scope code depends on them.

Every finding below has a concrete failure scenario. Each was reproduced against the **built** bundle (`node dev/serve-dist.mjs`; `plugin/wg-live/assets/dist/*` is newer than every file in `src/`) with throwaway Playwright probes in the session scratchpad. No repository file other than this report was written. Accepted M1 limitations from the plan and the `reports/*.md` decisions are not repeated here.

## Findings (most severe first)

### 1. Medium: the player page scrolls horizontally on iPad portrait (768 to about 880 px), and the time overflows at 320 px

- **Where:** `src/styles/base.css:173-175` (`.wg-live :where(time) { white-space: nowrap; }`). Used by `src/views/player.ts:246` (header meta) and `src/views/player.ts:258` (`.wg-live__info-when`). `player.css:469` has no override. `events.css:175` has one for cards only.
- **Failure:** from 768 px the info block moves into the one-third aside column (`player.css` `grid-template-columns: minmax(0,2fr) minmax(0,1fr)`), which is about 230 px wide. The full date `2026年10月11日（日）05:55 台北時間` is 292 px wide at 17 px and cannot wrap.
- **Measured** (`scrollWidth` > `clientWidth`, built bundle):

  | Page | 768 px | 820 px |
  |---|---|---|
  | live event | 806 | 841 |
  | scheduled | 806 | 841 |
  | ended | 797 | 832 |

- **At 320 px:** the two `<time>` elements end at 299 and 316 px while the column ends at 296 px. That causes horizontal scroll whenever the theme gutter is under 20 px. Elementor's outer padding is 10 px, so this breaks WCAG 1.4.10 reflow.
- **Rule broken:** spec §7.1 「不能撐出橫向捲軸」. iPad (Safari-first) portrait is exactly this width range.
- **Fix:** give `.wg-live__player-meta time` and `.wg-live__info-when time` the card rule (`white-space: normal; word-break: keep-all`), or drop the global `nowrap`.

### 2. Medium: focus drops to `<body>` when the focused control hides itself (Start on failure, 重試, 改用耳機 Binaural, 重新載入…, entitlement 重試)

- **Where:**
  - `src/components/player-controls.ts:287` (`primary.hidden = action.kind === 'hidden'` for `failed`);
  - `src/components/status-panel.ts:183-186` (retry, reload and fallback hide as soon as the status leaves `failed`);
  - `src/components/entitlement-panel.ts:73` (the whole panel hides while `retryEntitlement()` sets `unknown`).
  - No view-level fallback exists. Only the switch dialog restores focus (`dialog.ts`).
- **Failure:** this was reproduced. A keyboard user presses Enter on 開始聆聽 and the load fails (decode fault). `document.activeElement` becomes `BODY` and the button is `hidden`. The same user then presses Enter on 重試 and `activeElement` is `BODY` again. The recovery buttons sit in the header above the player, so sequential navigation continues from the hidden button's old position (the radios), away from 重試. Screen-reader users lose their place on every failure. The player-controls comment promises that focus survives Start → loading → Pause; it doesn't survive Start → failed. This is a 2.4.3 focus-order problem.
- **Fix:** before hiding a focused control, move focus to the status heading (`statusPanel.heading`, already `tabindex="-1"`). Or keep the primary button rendered with `aria-disabled` in `failed`, and move focus to the heading when a status-panel or entitlement action is clicked.

### 3. Medium: for `mode_unavailable`, the status-panel 切換模式 opens a dialog whose confirm does nothing

- **Where:**
  - `src/views/player.ts:164` (`onSwitchMode: openSwitchDialog`);
  - `src/views/player.ts:151-157` (opens even while `selecting`);
  - `src/views/player.ts:142` (confirm calls `controller.switchMode`);
  - `src/state/coordinator.ts:923` (`switchMode` returns early unless the status is `playing|paused|reconnecting|failed|switching`).
- **Failure:** this was reproduced. The playback REST answers `{kind:'not_ready', reason:'mode_unavailable'}` for Atmos. That happens, for example, with a page-cached bootstrap after an admin removed Atmos.
  1. The status reads 目前環境無法播放這個音訊版本, and the only action is 切換模式, with the status still `selecting`.
  2. Clicking it opens the native dialog.
  3. Confirm closes it. The status stays `selecting`, Atmos stays checked, no source is loaded, and the same message and button come back.
- **Result:** the plan §6.7 recovery (目前環境無法播放這個音訊版本 + 切換模式) is a dead control. The dialog also says 「目前模式為 Dolby Atmos 音軌…切換時播放可能會短暫中斷」 although nothing is playing. `render()` (`player.ts:315`) also closes the dialog on the next state notification, because `!engaged`.
- **Fix:** when the player isn't engaged (`idle`, `selecting`), have the status-panel action call `controller.selectMode(other)` directly with no dialog, and move focus to the newly checked radio.

### 4. Medium: a repeated failure after 重試 is never announced, and the 正在連接音訊 announcement is swallowed

- **Where:** the contract in `src/views/types.ts:9` ("identical consecutive messages are dropped"), implemented in `src/main.ts:59-64` (`lastWritten`) and `src/main.ts:83-90` (an immediate message clears the pending one). It is driven by `src/views/player.ts:321-329`.
- **Failure:** this was reproduced, with only one mutation in the live region.
  1. The decode fault fails and the region announces 「播放失敗：目前環境無法播放這個音訊版本」 immediately.
  2. The user presses 重試. The view queues 「正在連接音訊」 (750 ms coalescing).
  3. The retry fails again within 750 ms. The urgent message clears the pending loading text, then `write()` drops it because it equals `lastWritten`.
- **Result:** after pressing 重試 the screen-reader user hears nothing at all, and focus has also been dropped (finding 2). The same thing happens for a second `play_blocked` (「請點擊開始聆聽」). Plan §6.10 requires failures and `play_blocked` to be announced at once.
- **Fix:** compare against the last message the view **requested**, not the last one written. Or reset `lastWritten` whenever a newer message is queued. For a forced repeat, clear the region and then set the text in the next frame.

### 5. Medium: every 60 s poll rebuilds the info and programme DOM even when nothing changed

- **Where:** `src/views/player.ts:234` (`if (lastEvent === data) return;` is an identity check), `player.ts:248` and `player.ts:275` (`replaceChildren`). The poller and `syncEvent` (`src/state/coordinator.ts:760`) dispatch a freshly parsed `PublicEvent` object on every poll.
- **Failure:** this was reproduced. One `visibilitychange` poll with unchanged data replaced `.wg-live__info-body`'s first paragraph and the `.wg-live__programme-list` (old nodes disconnected, one childList mutation). The `<audio>` stayed the same element.
- **Effect:** a screen-reader user reading the description or 節目單 with the virtual cursor loses the position once a minute, and a text selection being copied is cleared. Plan §6.6 says nodes keep a stable identity across renders.
- **Fix:** compare the rendered fields (title, performers, startsAt, displayTimezone, description, programme) instead of the object identity, or make `syncEvent` keep the previous object when the payload is equal.

### 6. Low: live-region event-status announcements miss `live ↔ intermission` during playback and invent a 「活動狀態更新」 that never happened

- **Where:** `src/state/model.ts:460-485` (`selectAnnouncement`), consumed by `src/views/player.ts:321-329`.
- **Failure 1:** this was reproduced. While `playing`, the dev panel switches the event to `intermission`. The status detail shows 演出中場休息, but the live region stays 「目前播放：Binaural」 and records no mutation, because the `playing` branch never looks at the event status. The same happens while `paused`, `loading` or `switching`. Plan §6.10 lists event-status changes as announced.
- **Failure 2:** this was reproduced. Playback fails and the user then picks the other mode (status `selecting`). The region announces 「活動狀態更新：演出中」 although the event status did not change. The idle/selecting branch derives the "update" from the player state.
- **Fix:** announce the event status only when `state.event.status` differs from the previously seen value. Track that value in the view, separately from the player message.

### 7. Low: an event with no listening modes tells the user to 「請先選擇聆聽模式」 while both options are disabled

- **Where:** `src/components/player-controls.ts:69` (`startReason` returns `noMode`) and the status title (`src/i18n/copy-status.ts:42`, via `model.ts` idle branch).
- **Failure:** this was reproduced with `availableModes: []`, which plan §4.2 explicitly allows (shown as「即將開放」).
  - The demo row of the CTA table still links the card (體驗播放介面) to the player.
  - Both radios are disabled with 即將開放.
  - The status heading and the Start reason both read 請先選擇聆聽模式, an instruction the user cannot follow.
- **Fix:** when `availableModes` is empty, show the「聆聽模式即將公布」wording (from `copy-events.ts`) as the status and the Start reason.

### 8. Low: the Space shortcut can never fire, and the Help page describes a focus position that doesn't exist

- **Where:** `src/components/player-controls.ts:132`, `src/components/player-shell.ts:56` (`aria-keyshortcuts="Space K"` on the group), `src/i18n/copy-player.ts:55` and `src/i18n/copy-help.ts:110`.
- **Failure:** every focusable node inside `.wg-live__player` is activatable: radios, buttons, the range input and links. The `<audio>`/`<video>` has no `controls` and the stage isn't focusable, so the Space branch is unreachable. `tests/e2e/keyboard.spec.ts` "Space and K on a non-interactive element" adds a tabindex to the stage to make it pass.
- **Copy:** the Help row 「焦點在播放器內、且不在按鈕或輸入欄位上時，切換播放與暫停」 is wrong both ways. No such position exists, and K *does* toggle while focus is on a button.
- **Fix:** make the stage a focusable, labelled region (`tabindex="0"`), or drop Space from `aria-keyshortcuts` and from the Help row. Reword K as 「焦點在播放器內（輸入欄位除外）」.

### 9. Low: the Help page promises a 「尚未確認」 state that the UI never renders

- **Where:** `src/i18n/copy-help.ts:39`.
- **Failure:** the text says 「無法確認時，畫面會顯示「尚未確認」」. No view, component or copy entry ever outputs 尚未確認 (searched `src/`). Unknown or unsupported cases render 目前環境無法播放這個音訊版本 instead. A user who follows the Help page is told about a state they will never see. §9.4 asks for 尚未確認 instead of a definite verdict.
- **Fix:** remove the sentence, or add the 尚未確認 state where support is unclear.

## Checked and found clean

- **DOM sinks:** no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in scope.
- **Attributes:** `h()` rejects `on*` and `srcdoc`. `href`, `src`, `poster`, `cite`, `action` and `formaction` go through `safeUrl`, and `srcset` goes through `safeSrcset`. The direct `setAttribute('poster', …)` in `player.ts:225` uses a `safeUrl` result. Every admin string is rendered with `textContent`.
- **Media element identity:** one `<audio>`/`<video>` is created in `player-shell.ts`, with `preload="none"`, no `autoplay`, `controls` or `<source>`, and `playsinline` for video. It was never recreated across renders, switches or polls (probe: same node).
- **Radio group:** `fieldset`/`legend`, one `name`, and the name includes the verbatim action text. 已選取 is a text marker plus an inset ring (not colour only). Unavailable options are disabled and only reference 「即將開放」 while it is shown.
- **Dialog:** native `showModal()`. Escape, cancel and backdrop only close; confirm calls `switchMode` synchronously. Focus returns to the trigger or to the status heading (`tabindex="-1"`), and the trigger uses `aria-disabled`. The dialog lives outside `.wg-live__player`, so the shortcut listener never sees its keys. The bottom sheet uses `100dvh` with a `100vh` fallback and `env(safe-area-inset-bottom)`.
- **Live region:** single `role=status` outside the `aria-busy` subtree. The countdown is plain text, refreshed every 30 s, and never placed in a live region.
- **Contrast:** recomputed from the tokens, every pair passes:

  | Pair | Ratio |
  |---|---|
  | `--wg-text-muted` on `#1b1b1b` | 10.2:1 |
  | info on `#111` | 10.4:1 |
  | danger on `#111` | 8.3:1 |
  | success on `#111` | 11.3:1 |
  | mode-card border on the controls surface | 3.05:1 |
  | `--wg-border` on `#111` | 3.96:1 |
  | black on accent | 14.4:1 |

- **Target sizes:** primary 48 px, secondary 44 px. Range input and FAQ summaries 44 px. Standalone text links are at least 24 px high.
- **Motion:** reduced motion is covered by a universal override (including the dialog sheet animation and the skeleton), and `featured.css` has its own. Forced colors keep borders, selection and focus.
- **CSS scoping:** every selector starts with `.wg-live`/`.wg-live-featured`. Keyframes are `wg-live-*`. No `:root`, `html`, `body`, `@import` or `@font-face`. `[hidden]` is enforced with `!important` across the player view, and the events-view `[hidden]` cases have explicit rules.
- **Copy fidelity:** the §5.1, §5.2 and §6 strings are verbatim (checked byte for byte against the spec): the mode titles, descriptions, helpers and actions, the intro, 連線暫時中斷，正在重新連線, 目前環境無法播放這個音訊版本, 暫時無法確認觀看資格, 改用耳機 Binaural, the demo media notice, 已選擇：Dolby Atmos 音軌 and 目前播放：Binaural.
- **No fake capabilities:** no spectrum, viewer counts, Dolby badges or device or "certified" labels. Mute, volume, 返回直播 and fullscreen render only from adapter capabilities, and volume is hidden where it can't be set. The demo badge is inside the card and title accessible names.
