# Review: player state machine, coordinator, adapters and boot (state, adapters, main.ts)

Independent, read-only review at commit bc1e150. Scope: `src/state/**` (coordinator, reducer, transitions, model, event-poller, page-registry), `src/adapters/**` (native-media, demo, hls, iframe, inert, factory, providers, entitlement-placeholder) and `src/main.ts`. I checked them against `docs/implementation/M1-PLAN.md` (rev 2, mainly §3.2 and §6.2 to §6.10), `src/types.ts`, the spec (§5.3, §5.4, §6, §9 and the §13.1 F-rows) and `CLAUDE.md`. I read `src/views/player.ts`, `src/components/{player-controls,status-panel,dialog}.ts`, `src/boot.ts` and `src/util/capabilities.ts` only where the in-scope code depends on them.

**Method.** I reproduced each coordinator and poller finding with throwaway Vitest probes. They ran from the session scratchpad against the real `src/state/*` and the repo's own test doubles (`tests/unit/state/helpers.ts`). The probe output is quoted under each finding. This report is the only repository file I wrote. I left out accepted M1 limitations: the gesture loss on an uncached resolve-then-play path, `stop()` not aborting the prefetch or entitlement fetch, the no-progress clock starting only after the first `playing`, and `stop()` clearing `lastGoodMode` (`reports/state.md`, interpretations 1 and 2).

## Summary

| # | Severity | Area | Finding |
|---|---|---|---|
| 1 | Medium | coordinator | A switch, retry or reload whose descriptor is not cached has no load timeout and no exit. The old audio is already torn down and every control is disabled. |
| 2 | Medium | coordinator / reducer | A network error while the user has paused (or after `play_blocked`) schedules an automatic retry that calls `play()` without a user gesture. |
| 3 | Medium | model / coordinator | The `switch_mode` recovery action does nothing in `selecting` (`mode_unavailable`). After a failed Atmos→Binaural switch it re-tries the mode that failed. |
| 4 | Low | coordinator / providers | A descriptor prefetch that never settles is never re-issued. Start stays on 「確認播放來源中」 with no error and no retry. |
| 5 | Low | event-poller | One hung `events/{slug}` request stops polling for the life of the page, so ended or cancelled is never applied. |
| 6 | Low | coordinator | `retry()` and `reloadLastGood()` skip the gate and entitlement checks that `start()` and `switchMode()` apply. |
| 7 | Low | coordinator / reducer | The `source_not_configured` pin survives same-status polls. When the status changes, a stale `nextGate` skips the re-prefetch. |
| 8 | Low | event-poller / coordinator / main | When a root is removed without a later mount call, a player that is paused, selecting or failed is never destroyed. |
| 9 | Low | main.ts | The guard against a second copy of the bundle does not protect player views, because their mount waits for the async volume probe. |

## Findings (most severe first)

### 1. Medium: an uncached switch, retry or reload has no load timeout and no way out

- **Where:**
  - `src/state/coordinator.ts:637-669` (`runAfterResolve`): it tears down the old adapter (line 641) and dispatches `switching`/`loading` (line 644), then waits on `fetchDescriptor()` (line 648) with no clock.
  - `src/state/coordinator.ts:677`: `syncWatchdog()` arms only when `current !== null`, so the 20 s load timeout (plan §6.5) never runs during the resolve phase.
  - `src/adapters/providers.ts:76-90`: `getJson()` has no timeout.
- **Failure:**
  - While Binaural is playing, the user opens 切換模式 and confirms before the `prepareSwitch('atmos')` prefetch answers. This happens with a slow `/playback`: it is uncached PHP, and the 300-viewer load is the expected case. The result is `descriptors.get('atmos') === undefined` → `runAfterResolve`.
  - The Binaural adapter is destroyed at once (silence) and the status is `switching`. If the request stalls (a PHP-FPM queue, or a mobile connection that dies silently), nothing ends it until the server or browser gives up, which can take 60–300 s or longer.
  - The user has no way out during that time:
    - the primary button is `busy`/disabled (`player-controls.ts:41-42`);
    - pause is refused in `switching` (`togglePlay`, line 895);
    - Space/K are ignored;
    - the 切換模式 trigger is `aria-disabled`;
    - the selector is hidden;
    - `selectErrorActions` is empty.

  The same applies to the 改用耳機 Binaural fallback when its microtask prefetch has not finished, and to `retry()` when the descriptor is not cached.
- **Probe:** `P3 status switching oldDestroyed true timers 0 adapters 1` after 120 s of fake time, and `togglePlay()` was a no-op.
- **Rule broken:** plan §6.5 (load timeout 20 s) and spec §13.1 F08 「有上限重試與手動操作，不無限轉圈」.
- **Fix:** arm a resolve timer in `runAfterResolve`, or let the watchdog run with `current === null` while a resolve is pending, using the same `LOAD_TIMEOUT_MS`. On expiry, abort `actionAbort` and treat it as a `network`/`resolve` failure (`E-NET-03`), which ends in `failed` with 重試. Optionally keep the old adapter alive until the new descriptor arrives.

### 2. Medium: a network error while paused auto-plays without a user gesture

- **Where:**
  - `src/state/coordinator.ts:397-399`: `failAttempt()` schedules a retry for any `network` code, whatever the player status.
  - `src/state/coordinator.ts:422-445`: `scheduleRetry()` calls `runAttempt(ctx, false)`, which calls `adapter.play()` at line 627. The `online` listener (lines 441-444) can fire it early.
  - `src/state/reducer.ts:204-212` with `src/state/transitions.ts:21`: these accept `paused → reconnecting`.
- **Failure:**
  - The user pauses the demo (`togglePlay`). With `preload='auto'` the element keeps downloading.
  - The phone loses connectivity, for example in a subway. The element fires `error` (MediaError 2, or anything while `navigator.onLine === false`), and the native adapter reports `{code:'network'}`.
  - The coordinator moves `paused → reconnecting` and, after 2 s or on the `online` event, creates a new adapter and calls `play()`. Audio starts again in the user's pocket, and this repeats up to 3 times.
  - The same path runs after `play_blocked`, where plan §6.3 says 「no automatic retry」 and only the user's click may call `play()`.
- **Probe:** `P6 status after error while paused reconnecting`, then after 2 s `adapters 2 playCalls last 1`.
- **Rule broken:** `CLAUDE.md` 「Never autoplay; start playback only after a user gesture」, spec §13.1 F07 (the state must follow the user's operation), and plan §6.3 (play_blocked: no automatic retry).
- **Fix:** in `failAttempt()`, when `state.player.status === 'paused'`, do not call `scheduleRetry`. Either go to `failed` (manual 重試), or tear down and stay `paused` with a flag so the next `togglePlay` reloads the descriptor-cached source inside the click.

### 3. Medium: the 切換模式 recovery action is dead in `selecting` and targets the failed mode after a failed switch

- **Where:**
  - `src/state/model.ts:409`: `selectErrorActions` offers `switch_mode` for `notReady === 'mode_unavailable'` while the status is `idle`/`selecting`.
  - `src/state/model.ts:451`: it also offers `switch_mode` for `failed` + `unsupported` + Binaural.
  - `src/state/coordinator.ts:923`: `switchMode()` accepts only `playing|paused|reconnecting|failed|switching`.
  - The action carries no target. The view derives one from `activeMode ?? lastGoodMode ?? loadedMode ?? selectedMode` (`views/player.ts:147-149`), and `activeMode` is not cleared by `attempt/switch` or `attempt/failed` (`reducer.ts:155-164`, `214-223`).
- **Failure A (dead action):**
  - The server answers `not_ready/mode_unavailable` for the selected Atmos. Plan §5.1 step 3 does this when the bootstrap `availableModes` is stale.
  - The panel shows 「目前環境無法播放這個音訊版本」 + 切換模式. Clicking it opens the dialog "Atmos → Binaural", and confirm calls `switchMode('binaural')`.
  - `switchMode` returns at once in `selecting`, so the dialog closes and nothing changes.
  - Probe: `P1 status selecting selected atmos notReady mode_unavailable adapters 0`.
- **Failure B (wrong target):**
  - Atmos is playing, and the user switches to Binaural, which fails `unsupported`.
  - The actions are `['reload_last_good','switch_mode']`, with `activeMode` still `atmos`. 切換模式 opens "Atmos → Binaural", and confirm re-tries the Binaural that just failed instead of going to Atmos.
  - Probe: `P1b failed err binaural unsupported active atmos lastGood atmos ... actions [ 'reload_last_good', 'switch_mode' ]`.
- **Rule broken:** spec §6 「不支援來源 … 切換模式」 and plan §6.7 (`mode_unavailable` → 切換模式). The prescribed recovery action either does nothing or repeats the failure.
- **Fix:** give the action its target: `{ kind: 'switch_mode', mode: other(error.mode ?? selectedMode) }`. In `idle`/`selecting`/`failed`-without-adapter, run it as `selectMode(target)` (no dialog). Alternatively, make `switchMode()` delegate to `selectMode()` when there is no adapter and no playback intent. Clear `activeMode` on `attempt/failed`, or derive "current" from `lastGoodMode` when `confirmedPlaying` is false.

### 4. Low: a prefetch that never settles blocks Start for that mode with no retry

- **Where:**
  - `src/state/coordinator.ts:309`: `prefetch()` returns while `prefetching.has(mode)`.
  - `src/state/coordinator.ts:314`: the entry is removed only when the promise settles.
  - `src/state/coordinator.ts:333-342`: `ensurePrepared()`, `selectMode()` and `syncEvent()` all go through this dedupe.
  - `src/adapters/providers.ts:76-90`: `getJson()` has no timeout.
- **Failure:**
  - The preselected Binaural prefetch at mount stalls, for example on a mobile network change. The player stays `selecting` with `preparedMode === null`, and the start reason says 「確認播放來源中」.
  - Re-clicking the Binaural radio, switching to Atmos and back, or an event-status change all hit the dedupe, so no new request is ever made.
  - No error surfaces, so no 重試 is offered. Binaural cannot be started until the network stack gives up, which is browser-dependent, or until a reload.
- **Probe:** `P2 calls binaural 1 canStart false status selecting` after 600 s and three re-selections.
- **Fix:** give descriptor fetches a timeout (an `AbortController` aborted by `setTimeout`; `AbortSignal.timeout` is above the Safari 15.4 floor). Treat the timeout as `error` so the existing `prepare/failed` → 重試 path applies. Alternatively, let `selectMode()` of the same mode abort and re-issue a prefetch that is older than N seconds.

### 5. Low: one hung poll request ends polling for good

- **Where:**
  - `src/state/event-poller.ts:78-84`: `inFlight = true` before `await provider.get()`, and the next poll is scheduled only in `finally` (line 102).
  - `src/state/event-poller.ts:108`: `refreshNow()` (visibilitychange, pageshow) returns while `inFlight`.
- **Failure:** a single `events/{slug}` request that never answers leaves no timer and blocks every refresh. The player then never learns that the event went `ended`/`cancelled` or back to `scheduled`. Plan §6.4 stop rules and the 「本場演出已結束」 gate never apply, so the demo keeps playing after the concert is over.
- **Probe:** `P7 calls after 1h 1 timers 0` (after visibilitychange and `refreshNow()`).
- **Fix:** abort the poll after a timeout (for example 15 s) so it goes through the existing backoff path, or let `refreshNow()` abort a request older than the timeout.

### 6. Low: `retry()` and `reloadLastGood()` bypass the gate and entitlement checks

- **Where:** `src/state/coordinator.ts:933-950` and `959-966`. Compare `start()` (line 837, `selectCanStart`) and `switchMode()` (line 924, `gateKind() === 'open' && entitlement === 'entitled'`).
- **Failure:**
  - On staging with the dev panel (plan §5.6): playback fails with `decode`, so the status is `failed` and 重試 is shown.
  - The tester sets the simulated entitlement to `guest`. The panel shows 「請先登入」 next to 重試.
  - 重試 starts playback from the cached descriptor.
  - Probe: `P4 entitlement guest actions [ 'retry' ]` → `P4 after retry status loading adapters 2`.
- **Why it matters:** the coordinator's own rule is "Start is enabled only when gate 7 + entitled + prepared" (plan §6.2), and D6 says unknown or denied never lets playback through. The dev panel is meant to verify exactly these states, and the M2 entitlement provider plugs into this same coordinator.
- **Fix:** apply the `switchMode` guard (`gateKind() === 'open' && state.entitlement === 'entitled'`) in `retry()` and `reloadLastGood()`. `selectErrorActions` should then drop `retry`/`reload_last_good` when entitlement is not `entitled`.

### 7. Low: the `source_not_configured` pin is never re-checked on same-status polls, and a status change skips the re-prefetch

- **Where:**
  - `src/state/reducer.ts:85`: `event/set` keeps `source = 'not_configured'` while `notReady === 'source_not_configured'`.
  - `src/state/coordinator.ts:768`: the early return when status and gate are unchanged.
  - `src/state/coordinator.ts:767, 780-781`: `nextGate` is computed before `prepare/clear_not_ready` and then used to choose between `abortEntitlement()` and `fetchEntitlement()`/`ensurePrepared()`.
- **Failure:**
  - The server answers `source_not_configured` for an event the bootstrap calls `demo`. This happens with a page-cached player page, or when the admin changes the source between page load and click.
  - (a) After the admin fixes it, polls with the same status keep the pin. 「播放來源尚未開放」 stays until reload. Probe: `P5c same-status poll gate not_configured`.
  - (b) When the status does change (live→intermission), the pin clears and the gate is `open`. But the stale `nextGate` (`not_configured`) takes the `abortEntitlement()` branch, and `stopInternal()`'s `ensurePrepared()` ran while the gate was still blocking. No prefetch is issued and Start stays disabled with nothing in flight. Probe: `P5b gate open notReady null calls 0 prepared null canStart false`.
- **Fix:** recompute the gate after `prepare/clear_not_ready`, using `gateKind()` again for the branch. Clear (or re-ask about) a `source_not_configured` pin when a poll's `sourceKind` is `demo`, not only on a status change.

### 8. Low: a detached player that is not on a timer is never destroyed

- **Where:**
  - `src/state/event-poller.ts:59-63`: `orphaned()` stops only the poller. Nothing tells the view or the controller.
  - `src/state/coordinator.ts:214-221`: `alive()` runs only from the watchdog tick and the retry timer, which are not armed in `idle`/`selecting`/`paused`/`failed`.
  - `src/main.ts:139-144`: `sweepDetached()` runs only inside `mountAll()`/`mountWithin()`.
- **Failure:**
  - In the Elementor editor the user deletes the player widget, or any script swaps that DOM out, while the player is paused or selecting. No `element_ready` (and so no sweep) follows.
  - The poller notices on its next tick and stops itself. The controller stays registered in `pageRegistry`, together with its view, its listeners, the descriptors and the media element, which still holds `src` with `preload='auto'` when paused.
  - When playing, the browser pauses a removed media element (`pause` → `paused`, watchdog disarmed), so this case ends the same way.
  - Plan §3.2 says the coordinator and the poller destroy themselves when the root is disconnected.
- **Fix:** give the poller an `onOrphaned` callback that runs the view's `teardown()`. Alternatively, have `main.ts` destroy the registry entry when any of its timers sees `!root.isConnected`.

### 9. Low: the double-bundle guard is ineffective for player views

- **Where:** `src/main.ts:196-220`. The guard checks `data-wg-live-mounted === '1'` (line 199), but for `view === 'player'` that attribute is set only in `finishMount()` (line 188), after `probeVolumeControl()` resolves (line 216, a `setTimeout`).
- **Failure:**
  - Two copies of `wg-live.js` run, which is the "double enqueue, optimizer quirks" case the comment names. Both `<script defer>` copies execute before either probe settles, so both register and mount the same player root.
  - The second `finishMount()` calls `mount.replaceChildren()` and drops the first view's DOM. The first copy's controller, poller (duplicate `events/{slug}` polling), entitlement and prefetch requests stay alive, because its root is still connected. It keeps announcing into the same `.wg-live__sr-status`.
  - The events and help views mount synchronously, so the guard works for them only.
- **Fix:** mark the root synchronously in `mountRoot()` (for example `data-wg-live-mounted="pending"`) and skip any root that already has the attribute.

## Checked and found consistent with the plan

- **Start invariant (plan §6.3):**
  - `start()`, `switchMode()` with a cached descriptor, `retry()`/`reloadLastGood()` with a cached descriptor, the play_blocked resume, and the Space/K resume all run `teardown → factory → load() (not awaited) → play()` in one synchronous stack.
  - The `pageRegistry.notifyLoading()` and subscriber renders in between are synchronous.
  - `native-media.load()` assigns `src` synchronously.
- **Single adapter:**
  - One `current` per controller. Every new attempt calls `teardownCurrent()` first (listeners off, then the attempt `AbortController`, then `destroy()`).
  - The `owners` WeakMap stops a superseded adapter from resetting the element.
  - `pageRegistry` stops other controllers on `loading`/`switching`, including automatic retries.
  - Stale `pause` events after a switch are filtered by `media.paused`.
- **Classification and dedupe (plan §6.5):**
  - Classification happens in one place, `failAttempt()`, and `errorHandled` makes the `error` event, the `load()` rejection and the `play()` NotSupportedError count once.
  - AbortError is benign. Only `network` is retried: 2/5/10 s, at most 3 times, with the budget reset after 30 s of continuous `playing`. The `online` early retry is cleaned up.
- **stop()/destroy():**
  - Both bump `requestId`, abort the action fetch, clear the retry timer, the `online` listener and the watchdog, and destroy the adapter. The native `destroy()` removes listeners first, then `pause()`, `removeAttribute('src')` and `load()`.
  - `destroy()` also aborts prefetches and entitlement, clears subscribers and unregisters.
  - No adapter callback can reach state after teardown (`current !== cur` guards).
- **Event-status rules (plan §6.4):**
  - ended/cancelled stops.
  - scheduled/doors_open with playback intent stops and keeps `selectedMode`.
  - live↔intermission leaves the adapter alone.
  - doors_open→live never auto-starts.
  - The dev override survives polls, and `null` re-runs the rules.
- **Entitlement fail-closed:**
  - A provider error or an unknown shape becomes `unavailable`, and stale answers are dropped by the request counter.
  - Server `not_entitled`/`entitlement_unavailable` flips the client state closed.
  - The placeholder never grants a non-demo event.
- **Poller:** a single `setTimeout` chain, 60 s up to 300 s backoff, nothing while hidden, an immediate refresh on visible or `pageshow.persisted`, listeners removed on `stop()`.
- **main.ts:**
  - `WeakMap` + `Set` registry. A sweep runs at the start of `mountAll`/`mountWithin`, and remounts are idempotent.
  - Elementor `wire()` is identity-checked and wrapped in try/catch, on both the native and the jQuery `elementor/frontend/init`.
  - `pagehide` → `stop()`, `pageshow.persisted` → `refresh()`, and there are no `unload`/`beforeunload` handlers.
