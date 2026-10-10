# Report: state

Plan 6.2-6.8 implemented with the cross-module API exactly as listed in the task (names, signatures).

## Files (all LF)

- `src/state/transitions.ts`: `PLAYER_TRANSITIONS` table, `canTransition`, status groups (`WATCHED_STATUSES`, `hasPlaybackIntent`, `SELECTABLE_STATUSES`).
- `src/state/model.ts`: `GateKind`, `Gate`, `createInitialState`, `selectGate`, `selectCanStart`, `selectStatusMessage`, `selectModeLabel`, `selectEntitlementPanel`, `selectErrorActions`, `selectAnnouncement`, `selectPrimaryCta`, `orderEvents`. Extras: `isUrgentAnnouncement(state)` (play_blocked and failures: the view should pass `{ immediate: true }`), `isBlockingGate`, `normalizeSource`, `publicErrorCode`.
- `src/state/reducer.ts`: pure `reduce(state, action)` and the `Action` union. Every status change goes through the transition table; a refused move returns the same object (no spurious notification).
- `src/state/coordinator.ts`: `createPlayerController(deps)` plus `CoordinatorDeps` and the policy constants (`RETRY_DELAYS_MS`, `LOAD_TIMEOUT_MS`, ...).
- `src/state/event-poller.ts`: `startEventPoller` (`POLL_INTERVAL_MS`, `POLL_MAX_BACKOFF_MS` exported).
- `src/state/page-registry.ts`: `pageRegistry.register / notifyLoading` (+ `size()` for tests).
- `tests/unit/state/{helpers,model,reducer,coordinator,event-poller}.test.ts`: 213 tests (FakeAdapter implements the real `PlaybackAdapter`; fake providers with per-call holds; `vi.useFakeTimers()`).

## Gates

| Gate | Result |
|---|---|
| `npm run test:unit` | pass: 33 files, 1007 tests (213 mine) |
| `npx tsc --noEmit` | no error in `src/state` or `tests/unit/state`. One error remains in `tests/unit/slug-pattern-sync.test.ts(14,10)` (not mine) |
| `npx eslint src/state tests/unit/state` | clean. `npm run lint` fails only in `plugin/wg-live/assets/admin/admin.js` (`document`/`window` not defined; php-admin's file) |
| `check-css-scope` (source) | pass |

## Behaviour decisions

- **Gate vs entitlement**: `selectGate` reads deployment, event, effective status (dev override included) and source only. Server `hls`/`iframe` is normalised to `not_configured` everywhere (`normalizeSource`); a `source_not_configured` answer pins `state.source` to `not_configured` until `prepare/clear_not_ready`.
- **Start** = gate `open` + `entitlement === 'entitled'` + `status === 'selecting'` + `preparedMode === selectedMode` + `notReady === null`. `preparedMode` is only ever `selectedMode` or `null` (set from the descriptor cache, never by `prepareSwitch`).
- **Start invariant**: `start()` runs destroy(old) -> factory -> `load()` (not awaited) -> `play()` in one synchronous call (tested by asserting the call log immediately after `start()` returns, no flush). If the descriptor is not cached (switch/retry of an uncached mode) it resolves first; that path cannot keep the gesture and is documented as best effort.
- **requestId**: every user action and every attempt bumps it and aborts the previous action's `AbortController`. Adapter signals are tied to the adapter instance (one per attempt) with a separate per-attempt `AbortController` for `load()`, so a pause/mute does not abort the load signal. A failure is classified once per attempt in `failAttempt()` (`errorHandled`), so the adapter's `error` event, the `load()` rejection and the `play()` rejection count once (the native-media adapter emits all three).
- **Classification** (plan 6.5) in one place: adapter `code`s pass through; `unknown` + `navigator.onLine === false` -> `network`; `play()` NotAllowedError -> play_blocked (paused, no timers, no retry; resume = `adapter.play()` directly); AbortError benign; NotSupportedError -> `network` when `readyState === 0` and `canPlayType` non-empty, else `unsupported`. The pre-load `canPlayType === ''` check is the adapter's (native-media does it); the coordinator only calls `canPlayType` on the NotSupportedError path, so jsdom's `''` does not break view tests.
- **Retries**: network only, 2/5/10 s, max 3 (`retry/wait` keeps `switching` for a switch, else `reconnecting`); early retry on `window` `online` when offline at failure; the failed adapter is destroyed before the wait. Budget resets after 30 s of continuous `playing`. A prefetch (descriptor) failure is not auto-retried: status `failed`, `E-NET-03`, `retry()` re-fetches and goes back to `selecting` without starting playback.
- **One interval watchdog** (500 ms, armed only for loading/playing/switching/reconnecting with an adapter, never while paused/play_blocked): load timeout 20 s; after the first `playing`, 3 s without `currentTime` progress -> `reconnecting`, 15 s -> network error (`E-NET-02`); `fatal:false` tolerated 15 s; a stalled player whose time advances again returns to `playing` even without an event. `waiting` restarts the 3 s grace.
- **Public codes**: `E-NET-01` media network, `E-NET-02` stall/load timeout, `E-NET-03` descriptor fetch, `E-DEC-01`, `E-SRC-01`, `E-CFG-01`, `E-ENT-01/02`, `E-PLY-01`, `E-UNK-01`.
- **updateEvent**: ignores another event id/slug; ended/cancelled -> stop; scheduled/doors_open while loading/playing/paused/switching/reconnecting/failed -> stop; entering a blocking gate stops; live<->intermission changes nothing; any status change clears `notReady`, refetches the entitlement (gates 0-4 pass only) and re-prepares. Dev `setEventStatus` override survives polls; `null` re-runs the rules against the real status.
- **Entitlement**: fetched at mount (if gates 0-4 pass), on status change and by `retryEntitlement()` (own `AbortController`); provider error -> `unavailable`; a server `not_entitled`/`entitlement_unavailable` not_ready flips the client state closed. Dev `setEntitlement` is stored inside the coordinator (no provider call), demo events only; `null` re-fetches.
- **DevControls**: `null` unless `boot.devTools`. `injectFault` fails the next attempt only (network goes through the normal retry, then works).
- **onModeRemembered**: once per start/switch on the first `playing` (not per network retry).

## Interpretations of the plan (please confirm)

1. **No-progress clock only after the first `playing`.** Plan 6.5 lists loading/switching among the statuses the 3 s/15 s rule applies to, but then the 15 s rule always beats the 20 s load timeout. Before the first `playing`, only the 20 s load timeout runs.
2. **`stop()` aborts the action controller (fetches started by start/switch/retry), clears timers and the adapter, but not the descriptor prefetch or the entitlement fetch** (they are not playback; aborting them on `pagehide` would leave Start disabled after a bfcache restore). `destroy()` aborts everything. `stop()` also clears `lastGoodMode` (nothing plays, so there is no switch to fail), which the plan's list does not name.
3. `selectMode()` is a no-op while playback is active (loading/playing/paused/switching/reconnecting); the view must use `prepareSwitch` + `switchMode`. `fallback_binaural` is `switchMode('binaural')`, which is also accepted from `failed`. `reload_last_good` is `reloadLastGood()`.
4. `selectAnnouncement` is a pure function of state, so `announce.switchSuccess` is not reachable; switch success reads `目前播放：<new mode>` (names the new mode). `switchFailed` is produced when `status === 'failed'` and `error.mode !== lastGoodMode`. Event-status changes while *playing* (live <-> intermission) are not announced (the status line changes); ended/cancelled/scheduled/doors_open and doors_open -> live are.
5. `orderEvents` ignores `nowMs` (kept for the signature; ordering uses status, so a skewed clock cannot reshuffle cards).
6. `selectPrimaryCta` falls back to a `details` CTA ("查看活動資訊") when `links.player` is null, rather than returning a link with no href.

## Requests

- **player-view**: on `ViewContext`, announce `selectAnnouncement(state)` when it changes and pass `{ immediate: true }` when `isUrgentAnnouncement(state)`; wire the poller as `onEvent: (e) => controller.updateEvent(e)` and call `poller.refreshNow()` from `ViewInstance.refresh`; call `controller.stop()` from `ViewInstance.stop` and `controller.destroy()` from `destroy`; map `selectErrorActions` values to: `retry` -> `retry()`, `reload_last_good` -> `reloadLastGood()`, `fallback_binaural` -> `switchMode('binaural')`, `switch_mode` -> open the dialog (call `prepareSwitch(other)` on open), `view_event`/`back_to_events` -> links.
- **tooling/test setup** (optional): none required. `tests/unit/components/helpers.ts` (not mine) builds its own fake controller, so it does not depend on the coordinator.
- **adapters**: nothing needed. The coordinator relies on `AdapterLoadError.detail` (`{code,fatal}`) and the `error` event carrying the same detail, as native-media already does.

## Contract issues

- Plan 6.4 `stop()` says "aborts fetches" without separating playback fetches from prefetches (see interpretation 2).
- Plan 6.5's 3 s/15 s rule vs the 20 s load timeout (interpretation 1).
- `src/types.ts` `PlayerController.start()` returns `Promise<void>`; it resolves when `play()` settles (not when playing is confirmed). Callers must use `subscribe`/state for the outcome.
