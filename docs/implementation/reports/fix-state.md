# Fix report: state group (PS-1 ... PS-9, spec F7, selector side of UI-03 / PS-3)

Files changed: `src/state/coordinator.ts`, `src/state/model.ts`, `src/state/event-poller.ts`, `src/main.ts`,
`src/adapters/entitlement-placeholder.ts`; tests in `tests/unit/state/` (new `coordinator-review.test.ts`,
`event-poller.test.ts`, `helpers.ts`), `tests/unit/adapters/factory-entitlement.test.ts`, `tests/unit/core/main.test.ts`.

Process note: the work was first sent to `codex-lane --tier sol` (gpt-6.1-sol, write mode) as requested. Codex could not start any process in this
environment (`helper_unknown_error: setup refresh had errors`) and changed nothing, so the fixes were made directly.

| Finding | Result |
|---|---|
| PS-1 | Fixed, changed approach. One timeout in `fetchDescriptor` (`DESCRIPTOR_TIMEOUT_MS` = 12 s, inner AbortController) covers the resolve phase of switch/retry/reload as well as prefetch. On expiry the existing `error` path runs: `failed`, E-NET-03, 重試. No second timer in `runAfterResolve`; stop/destroy/abort clear it. |
| PS-2 | Fixed per decision (e). `failAttempt`: a network error while `paused` (user pause or play_blocked) tears the adapter down, keeps `paused`, and records the attempt (`pausedResume`). The next click of `togglePlay` re-attaches the cached source and plays in the same call stack (gesture kept). No timer, no `online` auto-play. Source recovery is therefore lazy (at the click), not eager. |
| PS-3 | Fixed. New selector `selectSwitchTarget(state)` (the other mode than the failing one, only if offered). `switch_mode` for `mode_unavailable` uses it; after a failed switch it is not listed when `reload_last_good` already targets the same mode. `switchMode()` in idle/selecting delegates to `selectMode()` and clears `failureOrigin`. View side: see below. |
| PS-4 | Fixed, same timeout as PS-1. A stalled prefetch becomes `error` after 12 s (selected mode: 重試; other mode: entry removed, can be re-issued). |
| PS-5 | Fixed. `POLL_TIMEOUT_MS` = 15 s; the request is raced against the timeout (a provider that ignores the signal cannot hang the chain), failure goes through the backoff path; `stop()` clears the guard. |
| PS-6 | Fixed. `retry()` (except the prepare-failure branch) and `reloadLastGood()` require gate open + entitled. `selectErrorActions` drops `retry`, `reload_last_good` and the failed-branch `switch_mode` unless entitled. |
| PS-7 | Fixed. The gate is recomputed after `prepare/clear_not_ready` and the branch uses it. A poll whose `sourceKind` differs from the previous one also re-asks even if the status is unchanged. Case (a) with an unchanged sourceKind keeps the documented sticky pin (not changed). |
| PS-8 | Fixed without a view change, changed approach. The poller dispatches `wg-live:detached` on `document` when its root is gone; `main.ts` listens and runs `sweepDetached()`, which calls the view's `destroy()`. (`onOrphaned` was not added: nothing would use it.) |
| PS-9 | Fixed as suggested: `mountRoot` sets `data-wg-live-mounted="pending"` synchronously and skips any root that has the attribute. |
| F7 | Fixed without a view change. `EntitlementPlaceholder.setEvent()` added; the coordinator calls it (optional hook) with each polled event before fetching the entitlement. |
| UI-03 selector side | Covered by PS-3. |

## Tests added
- `coordinator-review.test.ts` (24): PS-1 (3), PS-4 (2), PS-2 (5), PS-3/UI-03 (5), PS-6 (4), PS-7 (3), F7 (2).
- `event-poller.test.ts`: PS-5 (3), PS-8 (1). `main.test.ts`: PS-8 (2), PS-9 (2). `factory-entitlement.test.ts`: F7 (2).
- `helpers.ts`: optional `entitlementProvider` in `HarnessOptions`.

## Gates
`npm run typecheck` pass; `npm run lint` pass (incl. css-scope); `npx vitest run` 36 files / 1099 tests pass.

## Needs view-group change (not done, outside ownership)
1. `src/views/player.ts` `openSwitchDialog` / `currentModeForSwitch`: when status is not playing/paused/reconnecting, use `selectSwitchTarget(state)`
   (exported from `src/state/model.ts`) as the target. For idle/selecting call `controller.selectMode(target)` directly instead of opening the
   dialog, and move focus to the checked radio (UI-03). `controller.switchMode(target)` now also works in idle/selecting, so the dialog path is safe.
2. `src/components/status-panel.ts:180`: the fallback `if failed && wanted.size === 0 then add('retry')` should also require `state.entitlement === 'entitled'`
   (the coordinator now refuses the retry, but the button would still show).
3. Not required: the player view still builds `createEntitlementPlaceholder(boot.events)`; the coordinator updates it, so no change is needed.
