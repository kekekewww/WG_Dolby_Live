# Fix report: UI group

Findings: ui-a11y UI-01 to UI-09 (UI-03 handler side), spec-compliance F8 (= UI-09), F9. Not committed.

## Per finding

| Finding | Result | Change |
|---|---|---|
| UI-01 `<time>` nowrap overflow | fixed | `src/styles/player.css`: `.wg-live .wg-live__player-meta time, .wg-live .wg-live__info-when time { white-space: normal; word-break: keep-all }`. Global nowrap untouched. Playwright check added in `tests/e2e/layout.spec.ts` (320, 768, 820, 834 px; live, scheduled, ended; verified to fail without the rule). |
| UI-02 focus drops to body | fixed | `src/views/player.ts`: `keepFocus()` records the focused element before each render and, if it was inside the view (not the dialog) and is no longer focusable, moves focus to the status heading (tabindex -1, the dialog's fallback). Covers Start, 重試, 重新載入, 改用耳機 Binaural and the entitlement 重試. |
| UI-03 switch action (handler side) | fixed | `onStatusSwitch` in `player.ts`: in idle/selecting it calls `controller.selectMode(selectSwitchTarget(state))` directly (no dialog) and focuses the new radio. Otherwise it opens the dialog. `openSwitchDialog` now takes the target from `selectSwitchTarget` when status is `failed` (after a failed switch the target is the last good mode). |
| UI-04 repeated failure not announced | fixed, changed approach | Fixed in `src/main.ts` `createAnnouncer` (not a view file; it is the only place the dedupe lives). Narrower than the suggested fix: `lastWritten` is reset only when an immediate message discards a different queued one. The suggested "reset whenever anything is queued" would also re-announce plain A, B, A bursts, which the documented dedupe contract forbids. |
| UI-05 poll rebuilds info DOM | fixed | `renderEventDetails` compares a content key (title, performers, startsAt, displayTimezone, description, programme) instead of object identity. |
| UI-06 event-status announcements | fixed, changed approach | Done in the view only: `announce()` tracks the last event status. The idle/selecting fallback message of `selectAnnouncement` is dropped unless the status changed; live to intermission while engaged is announced (non-urgent). `model.ts selectAnnouncement` was NOT changed, because `model.test.ts` and `coordinator.test.ts` pin its idle/selecting behaviour. |
| UI-07 no modes says "choose a mode" | fixed | New `statusCopy.player.modesPending` (聆聽模式即將公布). `player-controls.ts startReason` and `model.ts selectStatusMessage` (idle/selecting hint only) use it when `availableModes` is empty. |
| UI-08 Space shortcut | fixed (docs/aria only) | Help row is now `K` only: 「焦點在播放器內（輸入欄位除外）時，切換播放與暫停。在「暫停」或「繼續播放」按鈕上，也可按 Enter 或 Space。」. `aria-keyshortcuts` removed from the `.wg-live__player` group; the primary button keeps `Space K`. The unreachable Space branch in `handlePlayerKeydown` is left as harmless. Existing assertions that encoded the old claim were updated (`player-shell.test.ts`, `gating.spec.ts`). |
| UI-09 / F8 尚未確認 | fixed | Sentence removed from `copy-help.ts`; `help.spec.ts` no longer asserts it (test renamed). Note: spec 9.4 and CLAUDE.md still say to show 尚未確認 when support is unclear; rendering that state is an M2 feature, not done. |
| F9 dev panel | NOT fixed | The retry limit cannot be shown because `injectFault` is one-shot in `coordinator.ts` (`takeFault`), and the stale select needs either a sticky `DevFault` (a `src/types.ts` contract change) or a consumed signal from the coordinator. Both are outside my files. Recommended: the docs-only fix, change `docs/deploy/STAGING.md` F08 to verify the retry limit with devtools Network > Offline and use the dev panel only for F09 and the decode/unsupported faults. |

State-group requests also handled: `status-panel.ts` retry fallback now requires `entitlement === 'entitled'` (PS-6), and the switch action uses `selectSwitchTarget` (PS-3).

## Outside the owned list (minimal, needed by the findings)

- `src/main.ts`: `createAnnouncer` (UI-04).
- `src/state/model.ts`: one line in `selectStatusMessage` (UI-07). `selectSwitchTarget` is only consumed.
- `tests/unit/core/main.test.ts`: UI-04 regression test.

## Tests added

- `tests/unit/views/player.test.ts`: block "review fixes (ui-a11y)" (14 tests: UI-02 x4, UI-03 x4, UI-05 x2, UI-06 x3, UI-07, UI-08). 10 of the new tests were confirmed to fail against the unfixed `player.ts` and `status-panel.ts`.
- `tests/unit/components/status-panel.test.ts` (PS-6 fallback, UI-07), `player-controls.test.ts` (UI-07), `views/help.test.ts` (UI-08, UI-09), `core/main.test.ts` (UI-04).
- e2e: `layout.spec.ts` (UI-01 reflow, 12 tests); `help.spec.ts` and `gating.spec.ts` assertions updated.

## Gates

- `npm run typecheck`: pass.
- `npm run lint` (eslint + css-scope): pass.
- `npx vitest run --maxWorkers=2`: 36 files, 1120 tests pass. With default workers, `tests/unit/load-test.test.ts > does not follow a redirect to another origin or to a playback URL` failed twice under CPU load but passes alone and with 2 workers (timing flake, scripts domain, not touched by this group).
- `npx playwright test --project=harness-dev-chromium`: 202 passed. Firefox/WebKit and harness-dist were not run.
