/**
 * Player coordinator (M1-PLAN 6.2-6.8): the async half of the state layer.
 *
 * - It is the ONLY owner of timers: the retry wait, the watchdog interval and the `online`
 *   listener. stop() clears all of them; destroy() also aborts every fetch.
 * - One adapter at a time. A new attempt destroys the old adapter first, then creates, loads and
 *   plays the new one in the same synchronous call stack (start invariant, plan 6.3).
 * - Every user action bumps `requestId` and aborts the previous action's fetches. Adapter signals
 *   are tied to the adapter instance (one per attempt), so a superseded adapter cannot touch
 *   the state, and a failure is classified once per attempt, in `failAttempt()` (plan 6.5).
 * - State changes only through the pure reducer.
 */
import type {
  AdapterErrorDetail,
  AdapterEvent,
  AppState,
  DevControls,
  DevFault,
  EntitlementProvider,
  EventProvider,
  EventStatus,
  ListeningMode,
  MediaHost,
  NotReadyReason,
  PlaybackAdapter,
  PlaybackSource,
  PlaybackSourceProvider,
  PlayerController,
  PlayerError,
  PlayerErrorCode,
  PublicEvent,
  AdapterEnv,
  AdapterFactory,
  BootConfig,
} from '../types';
import { createInitialState, isBlockingGate, publicErrorCode, selectCanStart, selectGate } from './model';
import { pageRegistry } from './page-registry';
import { reduce } from './reducer';
import type { Action } from './reducer';
import { WATCHED_STATUSES, hasPlaybackIntent } from './transitions';

/** An entitlement provider that mirrors event data on the client (the M1 placeholder) can follow polls. */
interface EventAwareEntitlementProvider extends EntitlementProvider {
  setEvent?(event: PublicEvent): void;
}

export interface CoordinatorDeps {
  boot: BootConfig;
  event: PublicEvent | null;
  host: MediaHost;
  env: AdapterEnv;
  adapterFactory: AdapterFactory;
  playbackProvider: PlaybackSourceProvider;
  entitlementProvider: EntitlementProvider;
  eventProvider: EventProvider;
  root: HTMLElement;
  preselect: ListeningMode | null;
  /** Called when a start/switch is confirmed playing, so the view can remember the mode (plan 6.3). */
  onModeRemembered?(mode: ListeningMode): void;
  /**
   * Called with every descriptor the server handed out, before any click (M2-PLAN C3): the view prepares what the
   * adapter will need, for an hls source the plugin's own hls.js file, so load() and play() stay in the click.
   */
  onSourceResolved?(source: Exclude<PlaybackSource, { kind: 'not_ready' }>): void;
}

/* ---- policy numbers (plan 6.5) ---- */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000];
export const MAX_RETRIES = 3;
export const LOAD_TIMEOUT_MS = 20_000;
export const STALL_GRACE_MS = 3_000;
export const STALL_FAIL_MS = 15_000;
export const BUDGET_RESET_MS = 30_000;
export const NON_FATAL_TOLERANCE_MS = 15_000;
/** A descriptor request that has not answered by now is a network failure (E-NET-03), never a silent hang. */
export const DESCRIPTOR_TIMEOUT_MS = 12_000;
const TICK_MS = 500;

type Playable = Exclude<PlaybackSource, { kind: 'not_ready' }>;
type AttemptKind = 'start' | 'switch';
type FailureVariant = 'media' | 'stall' | 'resolve';

interface AttemptCtx {
  kind: AttemptKind;
  mode: ListeningMode;
  source: Playable;
  /** onModeRemembered fires once per start/switch, however many network retries it took. */
  remembered: boolean;
}

/** Everything that belongs to the one live adapter. Replaced as a whole on every attempt. */
interface Current {
  adapter: PlaybackAdapter;
  ctx: AttemptCtx;
  attemptAbort: AbortController;
  offs: Array<() => void>;
  /** Failure already classified for this attempt (a media `error` and a play() rejection count once). */
  errorHandled: boolean;
  hasPlayed: boolean;
  /** lastGoodMode when this attempt began: what "last mode that actually played" means if the source turns out silent. */
  prevGood: ListeningMode | null;
  stalled: boolean;
  loadStartedAt: number;
  lastTime: number;
  lastProgressAt: number;
  playingSince: number | null;
  nonFatal: { code: AdapterErrorDetail['code']; since: number } | null;
}

type ResolveResult =
  | { ok: true; source: Playable }
  | { ok: false; reason: 'not_ready'; notReady: NotReadyReason }
  | { ok: false; reason: 'error' }
  | { ok: false; reason: 'aborted' };

const ENTITLEMENT_STATUSES = ['guest', 'not_entitled', 'entitled', 'unavailable'] as const;

function nowMs(): number {
  return Date.now();
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';
}

function isAbort(error: unknown): boolean {
  return errorName(error) === 'AbortError';
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const ADAPTER_CODES: readonly string[] = ['network', 'decode', 'unsupported', 'play_blocked', 'unknown'];

/** AdapterLoadError (adapters/native-media.ts) carries `detail`; any other rejection has none. */
function detailOf(error: unknown): AdapterErrorDetail | null {
  if (typeof error !== 'object' || error === null) return null;
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  if (typeof code !== 'string' || !ADAPTER_CODES.includes(code)) return null;
  return { code: code as AdapterErrorDetail['code'], fatal: (detail as { fatal?: unknown }).fatal !== false };
}

function notReadyToErrorCode(reason: NotReadyReason): PlayerErrorCode {
  switch (reason) {
    case 'source_not_configured':
      return 'not_configured';
    case 'not_entitled':
      return 'not_entitled';
    case 'entitlement_unavailable':
      return 'entitlement_unavailable';
    case 'mode_unavailable':
      return 'unsupported';
    case 'disabled':
    case 'event_not_found':
    case 'event_not_playable':
      return 'unknown';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

export function createPlayerController(deps: CoordinatorDeps): PlayerController & { dev: DevControls | null } {
  const { host, boot } = deps;

  let state: AppState = createInitialState(boot, deps.event, deps.preselect);
  const listeners = new Set<(s: AppState) => void>();
  let destroyed = false;

  /* ---- request ownership (plan 6.4) ---- */
  let requestId = 0;
  let actionAbort: AbortController | null = null;

  /* ---- the single live adapter ---- */
  let current: Current | null = null;
  let lastAttempt: { kind: AttemptKind; mode: ListeningMode } | null = null;
  /** 'prepare' = the descriptor fetch failed (retry re-fetches); 'attempt' = a load/play failed. */
  let failureOrigin: 'prepare' | 'attempt' | null = null;
  /**
   * Set when a network error hit a paused player (user pause or play_blocked): the adapter is gone,
   * the status stays `paused`, and the next user click re-attaches the cached source and plays (PS-2).
   */
  let pausedResume: AttemptCtx | null = null;

  /* ---- timers: the only ones in the state layer ---- */
  let retriesUsed = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let onlineHandler: (() => void) | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;

  /* ---- descriptors, entitlement, dev ---- */
  const descriptors = new Map<ListeningMode, Playable>();
  const prefetching = new Map<ListeningMode, AbortController>();
  let entitlementAbort: AbortController | null = null;
  let entitlementRequest = 0;
  let eventOverride: EventStatus | null = null;
  let entitlementOverride: (typeof ENTITLEMENT_STATUSES)[number] | null = null;
  let fault: DevFault | null = null;

  /* ================================================================ */
  /* Store                                                             */
  /* ================================================================ */

  function dispatch(action: Action): void {
    const next = reduce(state, action);
    if (next === state) return;
    state = next;
    syncWatchdog();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A broken subscriber must not break the others or the coordinator.
      }
    }
  }

  function gateKind(): ReturnType<typeof selectGate>['kind'] {
    return selectGate(state).kind;
  }

  function offers(mode: ListeningMode): boolean {
    return state.event.data?.availableModes.includes(mode) === true;
  }

  /** A timer fired or an event arrived after the root left the document: nothing may keep running. */
  function alive(): boolean {
    if (destroyed) return false;
    if (!deps.root.isConnected) {
      destroy();
      return false;
    }
    return true;
  }

  /* ================================================================ */
  /* Requests                                                          */
  /* ================================================================ */

  /** Every user action starts here: bump requestId and abort the previous action's fetches. */
  function beginAction(): number {
    requestId += 1;
    actionAbort?.abort();
    actionAbort = new AbortController();
    pausedResume = null;
    return requestId;
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (onlineHandler !== null) {
      window.removeEventListener('online', onlineHandler);
      onlineHandler = null;
    }
  }

  function teardownCurrent(): void {
    const cur = current;
    if (cur === null) return;
    current = null;
    for (const off of cur.offs) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    cur.attemptAbort.abort();
    try {
      cur.adapter.destroy();
    } catch {
      // destroy() is idempotent by contract; a throwing adapter must not leave the page half torn down.
    }
    syncWatchdog();
  }

  /** The common part of stop(): invalidate everything an old attempt could still do. */
  function halt(): void {
    requestId += 1;
    actionAbort?.abort();
    actionAbort = null;
    clearRetry();
    teardownCurrent();
    retriesUsed = 0;
    failureOrigin = null;
    lastAttempt = null;
    pausedResume = null;
  }

  /* ================================================================ */
  /* Source descriptors (JSON only, never media)                       */
  /* ================================================================ */

  function toResult(source: PlaybackSource, mode: ListeningMode): ResolveResult {
    if (typeof source !== 'object' || source === null) return { ok: false, reason: 'error' };
    if (source.kind === 'not_ready') return { ok: false, reason: 'not_ready', notReady: source.reason };
    if (source.kind === 'demo' && typeof source.url === 'string' && source.url !== '') {
      return { ok: true, source: { kind: 'demo', url: source.url, mimeType: typeof source.mimeType === 'string' ? source.mimeType : '' } };
    }
    if (source.kind === 'hls') {
      // M2-PLAN C3: the signed playlist of exactly the requested mode; anything else fails closed.
      if (typeof source.url !== 'string' || source.url === '' || source.mode !== mode) return { ok: false, reason: 'error' };
      return { ok: true, source: { kind: 'hls', url: source.url, mode } };
    }
    if (source.kind === 'iframe') {
      // M2-PLAN D2: an https provider player page of exactly the allowed origin (the adapter checks again).
      if (typeof source.url !== 'string' || source.url === '' || typeof source.allowedOrigin !== 'string') return { ok: false, reason: 'error' };
      return { ok: true, source: { kind: 'iframe', url: source.url, allowedOrigin: source.allowedOrigin } };
    }
    return { ok: false, reason: 'not_ready', notReady: 'source_not_configured' };
  }

  /** Hand a fresh descriptor to the view (onSourceResolved); a throwing view must not break the coordinator. */
  function announceSource(source: Playable): void {
    try {
      deps.onSourceResolved?.(source);
    } catch {
      // ignore
    }
  }

  /**
   * The only place that owns the descriptor timeout (PS-1, PS-4). The provider gets an inner signal; a
   * request that has not answered after DESCRIPTOR_TIMEOUT_MS settles as `error` (the caller shows E-NET-03
   * and offers 重試) while the caller's own signal stays un-aborted. An abort of the caller's signal settles
   * as `aborted` at once and clears the timer, so nothing is left running after stop()/destroy().
   */
  function fetchDescriptor(mode: ListeningMode, signal: AbortSignal): Promise<ResolveResult> {
    const event = state.event.data;
    if (event === null) return Promise.resolve({ ok: false, reason: 'not_ready', notReady: 'event_not_found' });
    return new Promise<ResolveResult>((resolve) => {
      if (signal.aborted) {
        resolve({ ok: false, reason: 'aborted' });
        return;
      }
      const inner = new AbortController();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (result: ResolveResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        inner.abort();
        finish({ ok: false, reason: 'aborted' });
      };
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timer = null;
        inner.abort();
        finish({ ok: false, reason: 'error' });
      }, DESCRIPTOR_TIMEOUT_MS);
      deps.playbackProvider.resolve(event.id, mode, inner.signal).then(
        (source) => finish(signal.aborted ? { ok: false, reason: 'aborted' } : toResult(source, mode)),
        (error: unknown) => finish(signal.aborted || isAbort(error) ? { ok: false, reason: 'aborted' } : { ok: false, reason: 'error' }),
      );
    });
  }

  function syncPrepared(): void {
    const mode = state.player.selectedMode;
    dispatch({ type: 'mode/prepared', prepared: mode !== null && descriptors.has(mode) });
  }

  /** Prefetch the descriptor of `mode` into the cache. For the selected mode it also drives preparedMode. */
  function prefetch(mode: ListeningMode): void {
    if (destroyed || descriptors.has(mode) || prefetching.has(mode)) return;
    if (isBlockingGate(gateKind()) || !offers(mode)) return;
    const controller = new AbortController();
    prefetching.set(mode, controller);
    void fetchDescriptor(mode, controller.signal).then((result) => {
      if (prefetching.get(mode) === controller) prefetching.delete(mode);
      if (destroyed || controller.signal.aborted) return;
      const selected = state.player.selectedMode === mode;
      if (result.ok) {
        descriptors.set(mode, result.source);
        announceSource(result.source);
        if (selected) {
          dispatch({ type: 'prepare/clear_not_ready' });
          syncPrepared();
        }
      } else if (result.reason === 'not_ready') {
        if (selected) dispatch({ type: 'prepare/not_ready', reason: result.notReady });
      } else if (result.reason === 'error' && selected && state.player.status === 'selecting') {
        failureOrigin = 'prepare';
        dispatch({ type: 'prepare/failed', error: { code: 'network', mode, publicCode: publicErrorCode('network', 'resolve') } });
      }
    });
  }

  /** Make the selected mode's descriptor available (cache hit: instantly prepared). */
  function ensurePrepared(): void {
    const mode = state.player.selectedMode;
    if (destroyed || mode === null) return;
    if (isBlockingGate(gateKind())) return;
    if (descriptors.has(mode)) {
      syncPrepared();
      return;
    }
    prefetch(mode);
  }

  /* ================================================================ */
  /* Entitlement                                                       */
  /* ================================================================ */

  function abortEntitlement(): void {
    entitlementRequest += 1;
    entitlementAbort?.abort();
    entitlementAbort = null;
  }

  function fetchEntitlement(): void {
    const event = state.event.data;
    if (destroyed || event === null || isBlockingGate(gateKind())) return;
    if (entitlementOverride !== null && event.isDemo) {
      dispatch({ type: 'entitlement/set', status: entitlementOverride });
      return;
    }
    abortEntitlement();
    const controller = new AbortController();
    entitlementAbort = controller;
    const request = entitlementRequest;
    deps.entitlementProvider.get(event.id, controller.signal).then(
      (result) => {
        if (destroyed || controller.signal.aborted || request !== entitlementRequest) return;
        const status = (ENTITLEMENT_STATUSES as readonly string[]).includes(result?.status) ? result.status : 'unavailable';
        dispatch({ type: 'entitlement/set', status: status as (typeof ENTITLEMENT_STATUSES)[number] });
      },
      (error: unknown) => {
        if (destroyed || controller.signal.aborted || request !== entitlementRequest || isAbort(error)) return;
        // Fail closed: an unknown answer never lets playback through.
        dispatch({ type: 'entitlement/set', status: 'unavailable' });
      },
    );
  }

  /* ================================================================ */
  /* Failure classification: ONE place (plan 6.5)                      */
  /* ================================================================ */

  function onlineFix(code: AdapterErrorDetail['code']): AdapterErrorDetail['code'] {
    // navigator.onLine === false at failure -> network (retried; and retried early on `online`).
    return code === 'unknown' && isOffline() ? 'network' : code;
  }

  function failAttempt(cur: Current, rawCode: AdapterErrorDetail['code'], variant: FailureVariant): void {
    if (destroyed || current !== cur || cur.errorHandled) return;
    const code = onlineFix(rawCode);
    // M2-PLAN C3: a signed hls URL may have expired; a cached one is never reused after a network failure.
    if (code === 'network' && cur.ctx.source.kind === 'hls') descriptors.delete(cur.ctx.mode);
    if (code === 'play_blocked') {
      // Not a failure of the attempt: the user can resume it with a click.
      blockedPlay(cur);
      return;
    }
    cur.errorHandled = true;
    if (code === 'network' && state.player.status === 'paused') {
      // The user paused (or play() was blocked): no automatic play() without a gesture (CLAUDE.md, plan 6.3).
      // Drop the broken adapter, stay paused, and re-attach the cached source inside the next click.
      clearRetry();
      teardownCurrent();
      pausedResume = cur.ctx;
      return;
    }
    if (code === 'network' && retriesUsed < MAX_RETRIES) {
      scheduleRetry(cur.ctx);
      return;
    }
    // A source that already reported `playing` but turns out to be silent (adapter guard) never was "good":
    // lastGoodMode and 目前播放 go back to what played before this attempt, as for any failed switch.
    const silent = code === 'unsupported' && cur.hasPlayed;
    terminalFailure(cur.ctx.mode, code, variant, silent ? { restoreGood: cur.prevGood } : undefined);
  }

  function terminalFailure(
    mode: ListeningMode,
    code: PlayerErrorCode,
    variant: FailureVariant,
    restore?: { restoreGood: ListeningMode | null },
  ): void {
    clearRetry();
    teardownCurrent();
    failureOrigin = 'attempt';
    const error: PlayerError = { code, mode, publicCode: publicErrorCode(code, variant) };
    dispatch(restore ? { type: 'attempt/failed', error, restoreGood: restore.restoreGood } : { type: 'attempt/failed', error });
  }

  function blockedPlay(cur: Current): void {
    if (destroyed || current !== cur) return;
    if (state.player.status === 'paused' && state.player.error?.code === 'play_blocked') return;
    cur.stalled = false;
    cur.playingSince = null;
    const error: PlayerError = { code: 'play_blocked', mode: cur.ctx.mode, publicCode: publicErrorCode('play_blocked') };
    dispatch({ type: 'attempt/play_blocked', error });
  }

  /**
   * Bounded, network-only automatic retry: 2 s, 5 s, 10 s, then failed (plan 6.5). An hls attempt asks /playback for
   * a freshly signed URL first (M2-PLAN C3); a demo attempt reuses its descriptor (M1).
   */
  function scheduleRetry(ctx: AttemptCtx): void {
    retriesUsed += 1;
    const attempt = retriesUsed;
    const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 10_000;
    clearRetry();
    teardownCurrent();
    dispatch({ type: 'retry/wait', attempt, max: MAX_RETRIES });
    if (state.player.status !== 'reconnecting' && state.player.status !== 'switching') {
      // The state refused the move (for example the user stopped meanwhile): do not retry.
      return;
    }

    const fire = (): void => {
      clearRetry();
      if (!alive()) return;
      if (ctx.source.kind === 'hls') {
        void refreshThenRun(ctx);
        return;
      }
      void runAttempt(ctx, false);
    };
    retryTimer = setTimeout(fire, delay);
    if (isOffline()) {
      onlineHandler = fire;
      window.addEventListener('online', onlineHandler);
    }
  }

  /* ================================================================ */
  /* Adapter signals                                                   */
  /* ================================================================ */

  function onPlaying(cur: Current): void {
    if (current !== cur) return;
    const t = nowMs();
    cur.hasPlayed = true;
    cur.stalled = false;
    cur.nonFatal = null;
    cur.lastTime = host.media.currentTime;
    cur.lastProgressAt = t;
    cur.playingSince = cur.playingSince ?? t;
    dispatch({ type: 'adapter/playing' });
    if (state.player.status !== 'playing') return;
    failureOrigin = null;
    if (!cur.ctx.remembered) {
      cur.ctx.remembered = true;
      try {
        deps.onModeRemembered?.(cur.ctx.mode);
      } catch {
        // A storage failure must not affect playback.
      }
    }
  }

  function onPaused(cur: Current): void {
    if (current !== cur) return;
    cur.stalled = false;
    cur.playingSince = null;
    dispatch({ type: 'adapter/paused' });
  }

  function onWaiting(cur: Current): void {
    if (current !== cur || state.player.status !== 'playing') return;
    // The 3 s grace period starts at the event; the watchdog turns it into `reconnecting`.
    cur.lastProgressAt = nowMs();
  }

  function onEnded(cur: Current): void {
    if (current !== cur) return;
    if (cur.adapter.kind === 'demo') return; // demo sources loop (plan 6.4)
    cur.playingSince = null;
    dispatch({ type: 'adapter/ended' });
  }

  function onAdapterError(cur: Current, detail: AdapterErrorDetail | undefined): void {
    if (current !== cur) return;
    const d: AdapterErrorDetail = detail ?? { code: 'unknown', fatal: true };
    if (d.fatal === false && d.code === 'network' && cur.ctx.source.kind === 'hls') {
      // M2-PLAN C3: the HLS adapter reports a dead source this way (for example a signed URL that expired and now
      // answers 403). Waiting out the 15 s tolerance would only delay the re-resolve.
      failAttempt(cur, 'network', 'media');
      return;
    }
    if (d.fatal === false) {
      // A library that is still retrying on its own is tolerated for up to 15 s.
      cur.nonFatal = cur.nonFatal ?? { code: d.code, since: nowMs() };
      return;
    }
    failAttempt(cur, d.code, 'media');
  }

  function onLoaded(cur: Current): void {
    if (current !== cur) return;
    // Capabilities are per instance and final once load() resolved (plan 6.10).
    dispatch({ type: 'attempt/capabilities', capabilities: cur.adapter.capabilities });
    if (!cur.adapter.capabilities.reliablePlaybackEvents) {
      // M2-PLAN D2: a provider player frame. "Loaded" is all it can tell us: show the selection, run no watchdog.
      cur.hasPlayed = true;
      dispatch({ type: 'adapter/frame_ready' });
      if (state.player.status === 'playing' && !cur.ctx.remembered) {
        cur.ctx.remembered = true;
        try {
          deps.onModeRemembered?.(cur.ctx.mode);
        } catch {
          // A storage failure must not affect playback.
        }
      }
    }
  }

  function onLoadRejected(cur: Current, error: unknown): void {
    if (current !== cur || cur.attemptAbort.signal.aborted || isAbort(error)) return;
    // The adapter reports the same failure through its 'error' event first; errorHandled dedupes.
    failAttempt(cur, detailOf(error)?.code ?? 'unknown', 'media');
  }

  function onPlayRejected(cur: Current, error: unknown): void {
    if (current !== cur) return;
    const name = errorName(error);
    if (name === 'AbortError') return; // benign: the state follows the action that interrupted play()
    if (name === 'NotAllowedError') {
      blockedPlay(cur);
      return;
    }
    if (name === 'NotSupportedError') {
      const mime = cur.ctx.source.kind === 'demo' ? cur.ctx.source.mimeType : '';
      const mimeKnown = mime === '' || host.media.canPlayType(mime) !== '';
      // HAVE_NOTHING after a non-empty canPlayType means the fetch failed, not the format.
      failAttempt(cur, mimeKnown && host.media.readyState === 0 ? 'network' : 'unsupported', 'media');
      return;
    }
    failAttempt(cur, 'unknown', 'media');
  }

  /* ================================================================ */
  /* Attempts: destroy(old) -> load(new) -> play(), synchronously      */
  /* ================================================================ */

  function takeFault(): DevFault | null {
    const f = fault;
    fault = null;
    return f;
  }

  /**
   * `fromUser`: the caller is a user action (dispatches start/switch and notifies the page registry).
   * Automatic retries and resolved-then-run attempts have already put the state where it belongs.
   */
  function runAttempt(ctx: AttemptCtx, fromUser: boolean): Promise<void> {
    beginAction();
    clearRetry();
    teardownCurrent();
    lastAttempt = { kind: ctx.kind, mode: ctx.mode };
    failureOrigin = null;

    if (fromUser) {
      dispatch(ctx.kind === 'start' ? { type: 'attempt/start', mode: ctx.mode } : { type: 'attempt/switch', mode: ctx.mode });
      if (state.player.status !== 'loading' && state.player.status !== 'switching') return Promise.resolve();
    }
    pageRegistry.notifyLoading(controller);

    let adapter: PlaybackAdapter;
    try {
      adapter = deps.adapterFactory(ctx.source.kind, host, deps.env);
    } catch {
      terminalFailure(ctx.mode, 'unknown', 'media');
      return Promise.resolve();
    }

    const t = nowMs();
    const cur: Current = {
      adapter,
      ctx,
      attemptAbort: new AbortController(),
      offs: [],
      errorHandled: false,
      hasPlayed: false,
      prevGood: state.player.lastGoodMode,
      stalled: false,
      loadStartedAt: t,
      lastTime: host.media.currentTime,
      lastProgressAt: t,
      playingSince: null,
      nonFatal: null,
    };
    const subscribe = (event: AdapterEvent, fn: (detail?: AdapterErrorDetail) => void): void => {
      cur.offs.push(adapter.on(event, fn));
    };
    subscribe('playing', () => onPlaying(cur));
    subscribe('paused', () => onPaused(cur));
    subscribe('waiting', () => onWaiting(cur));
    subscribe('ended', () => onEnded(cur));
    subscribe('error', (detail) => onAdapterError(cur, detail));
    // 'stalled' is a hint only (plan 6.5): the watchdog decides.
    current = cur;
    dispatch({ type: 'attempt/attached', mode: ctx.mode });
    syncWatchdog();

    const injected = takeFault();

    // load(): assigns the source synchronously; the promise only reports readiness.
    if (injected === null || injected === 'play_blocked') {
      let loading: Promise<void>;
      try {
        loading = adapter.load(ctx.source, cur.attemptAbort.signal);
      } catch (error) {
        loading = Promise.reject(error);
      }
      loading.then(
        () => onLoaded(cur),
        (error: unknown) => onLoadRejected(cur, error),
      );
      adapter.setMuted(state.player.muted);
      adapter.setVolume(state.player.volume);
    } else {
      queueMicrotask(() => failAttempt(cur, injected, 'media'));
      return Promise.resolve();
    }

    if (current !== cur || cur.errorHandled) return Promise.resolve(); // load() failed synchronously
    if (injected === 'play_blocked') {
      queueMicrotask(() => blockedPlay(cur));
      return Promise.resolve();
    }

    // play(): still inside the click handler's call stack (no await above).
    let playing: Promise<void>;
    try {
      playing = adapter.play();
    } catch (error) {
      playing = Promise.reject(error);
    }
    return playing.then(
      () => undefined,
      (error: unknown) => onPlayRejected(cur, error),
    );
  }

  /**
   * M2-PLAN C3: ask /playback again for `ctx`'s mode (a signed hls URL can expire mid-show), then attach the new
   * URL. Used by the retry timer and by a resume after a network error. Not a user action: the state is already
   * reconnecting (or resuming), and 目前播放 follows only when the new source plays. A failed request is a failed
   * attempt (bounded like every retry); a not_ready answer (refund, event over) ends playback.
   */
  function refreshThenRun(ctx: AttemptCtx): Promise<void> {
    const id = beginAction();
    const signal = (actionAbort as AbortController).signal;
    descriptors.delete(ctx.mode);
    return fetchDescriptor(ctx.mode, signal).then((result) => {
      if (destroyed || id !== requestId || signal.aborted) return;
      if (result.ok) {
        descriptors.set(ctx.mode, result.source);
        announceSource(result.source);
        void runAttempt({ ...ctx, source: result.source }, false);
        return;
      }
      if (result.reason === 'aborted') return;
      if (result.reason === 'not_ready') {
        const code = notReadyToErrorCode(result.notReady);
        terminalFailure(ctx.mode, code, 'resolve');
        return;
      }
      if (retriesUsed < MAX_RETRIES) {
        scheduleRetry(ctx);
        return;
      }
      terminalFailure(ctx.mode, 'network', 'resolve');
    });
  }

  /** User action with a descriptor that is not cached yet: resolve first (best effort, no gesture guarantee). */
  function runAfterResolve(kind: AttemptKind, mode: ListeningMode): Promise<void> {
    const id = beginAction();
    clearRetry();
    teardownCurrent();
    lastAttempt = { kind, mode };
    failureOrigin = null;
    dispatch(kind === 'start' ? { type: 'attempt/start', mode } : { type: 'attempt/switch', mode });
    if (state.player.status !== 'loading' && state.player.status !== 'switching') return Promise.resolve();
    pageRegistry.notifyLoading(controller);
    const signal = (actionAbort as AbortController).signal;
    return fetchDescriptor(mode, signal).then((result) => {
      if (destroyed || id !== requestId || signal.aborted) return;
      if (result.ok) {
        descriptors.set(mode, result.source);
        announceSource(result.source);
        void runAttempt({ kind, mode, source: result.source, remembered: false }, false);
        return;
      }
      if (result.reason === 'aborted') return;
      if (result.reason === 'not_ready') {
        failureOrigin = 'attempt';
        if (state.player.selectedMode === mode || kind === 'start') {
          dispatch({ type: 'prepare/not_ready', reason: result.notReady });
        }
        dispatch({
          type: 'attempt/failed',
          error: { code: notReadyToErrorCode(result.notReady), mode, publicCode: publicErrorCode(notReadyToErrorCode(result.notReady)) },
        });
        return;
      }
      failureOrigin = 'attempt';
      dispatch({ type: 'attempt/failed', error: { code: 'network', mode, publicCode: publicErrorCode('network', 'resolve') } });
    });
  }

  /* ================================================================ */
  /* Watchdog                                                          */
  /* ================================================================ */

  function syncWatchdog(): void {
    // A provider frame (no reliable playback events) has no media progress to watch (M2-PLAN D2).
    const want = !destroyed && current !== null && current.adapter.capabilities.reliablePlaybackEvents && WATCHED_STATUSES.includes(state.player.status);
    if (want && watchdog === null) {
      watchdog = setInterval(tick, TICK_MS);
    } else if (!want && watchdog !== null) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  /**
   * One interval for everything (plan 6.5): load timeout 20 s; while playing, no currentTime progress
   * for 3 s -> reconnecting and for 15 s -> network error; non-fatal library errors tolerated 15 s;
   * the retry budget resets after 30 s of continuous playback. It never runs while paused.
   * "Progress" only means something once playback started, so before the first `playing` the load
   * timeout is the only clock (otherwise the 15 s rule would always beat the 20 s one).
   */
  function tick(): void {
    if (!alive()) return;
    const cur = current;
    if (cur === null) {
      syncWatchdog();
      return;
    }
    const t = nowMs();
    const time = host.media.currentTime;
    const advanced = time !== cur.lastTime;
    if (advanced) {
      cur.lastTime = time;
      cur.lastProgressAt = t;
    }
    const status = state.player.status;
    const sinceProgress = t - cur.lastProgressAt;

    if (cur.nonFatal !== null && t - cur.nonFatal.since >= NON_FATAL_TOLERANCE_MS) {
      failAttempt(cur, cur.nonFatal.code, 'media');
      return;
    }

    if (cur.hasPlayed) {
      if (status === 'playing') {
        if (cur.playingSince !== null && t - cur.playingSince >= BUDGET_RESET_MS) retriesUsed = 0;
        if (sinceProgress >= STALL_FAIL_MS) {
          failAttempt(cur, 'network', 'stall');
        } else if (sinceProgress >= STALL_GRACE_MS) {
          cur.stalled = true;
          cur.playingSince = null;
          dispatch({ type: 'adapter/stalled' });
        }
        return;
      }
      if (status === 'reconnecting' && cur.stalled) {
        if (advanced) {
          // Sound is back although no `playing` event came (adapters without reliable events).
          cur.stalled = false;
          cur.playingSince = t;
          dispatch({ type: 'adapter/playing' });
        } else if (sinceProgress >= STALL_FAIL_MS) {
          failAttempt(cur, 'network', 'stall');
        }
        return;
      }
    }

    if (status === 'loading' || status === 'switching' || status === 'reconnecting') {
      if (t - cur.loadStartedAt >= LOAD_TIMEOUT_MS) failAttempt(cur, 'network', 'stall');
    }
  }

  /* ================================================================ */
  /* Event changes (plan 6.4)                                          */
  /* ================================================================ */

  function stopInternal(): void {
    halt();
    dispatch({ type: 'player/stopped' });
    ensurePrepared();
    syncWatchdog();
  }

  function syncEvent(data: PublicEvent | null): void {
    const prevStatus = state.event.status;
    const prevGate = gateKind();
    const prevSourceKind = state.event.data?.sourceKind ?? null;
    // The client entitlement mirror must answer for the CURRENT event data, not the mount-time one (F7).
    if (data !== null) (deps.entitlementProvider as EventAwareEntitlementProvider).setEvent?.(data);
    const effective = data !== null ? (eventOverride ?? data.status) : null;
    dispatch({ type: 'event/set', data, status: effective, simulated: data !== null && eventOverride !== null });

    const { selectedMode, status } = state.player;
    if (selectedMode !== null && data !== null && !data.availableModes.includes(selectedMode)) {
      if (status === 'idle' || status === 'selecting' || status === 'failed') dispatch({ type: 'mode/select', mode: null });
    }

    const nextGate = gateKind();
    // A changed sourceKind (for example not_configured -> demo) must re-ask the server even when the status is the same (PS-7).
    const sourceChanged = data !== null && prevSourceKind !== data.sourceKind;
    if (prevStatus === effective && prevGate === nextGate && !sourceChanged) return;

    const intent = hasPlaybackIntent(state.player.status) || state.player.status === 'failed';
    const toFinished = effective === 'ended' || effective === 'cancelled';
    const toWaiting = effective === 'scheduled' || effective === 'doors_open';
    // ended/cancelled/not found, and scheduled/doors_open while sound was wanted: stop, keep selectedMode.
    // live <-> intermission changes nothing about the adapter.
    if (effective === null || toFinished || isBlockingGate(nextGate) || (toWaiting && intent)) {
      stopInternal();
    }

    // The server may answer differently under the new status: ask again.
    dispatch({ type: 'prepare/clear_not_ready' });
    // Clearing the pin can open the gate: decide on the gate as it is NOW, not on the stale one (PS-7).
    if (isBlockingGate(gateKind())) {
      abortEntitlement();
    } else {
      fetchEntitlement();
      ensurePrepared();
    }
  }

  /* ================================================================ */
  /* Controller                                                        */
  /* ================================================================ */

  function stop(): void {
    if (destroyed) return;
    stopInternal();
  }

  function destroy(): void {
    if (destroyed) return;
    halt();
    listeners.clear();
    dispatch({ type: 'player/stopped' });
    destroyed = true;
    for (const c of prefetching.values()) c.abort();
    prefetching.clear();
    abortEntitlement();
    if (watchdog !== null) {
      clearInterval(watchdog);
      watchdog = null;
    }
    unregister();
  }

  const done = Promise.resolve();

  const controller: PlayerController & { dev: DevControls | null } = {
    getState: () => state,

    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    selectMode(mode) {
      if (destroyed) return;
      dispatch({ type: 'mode/select', mode });
      if (state.player.selectedMode === mode) {
        if (state.player.status === 'selecting') failureOrigin = null;
        ensurePrepared();
      }
    },

    start() {
      if (destroyed || !selectCanStart(state)) return done;
      const mode = state.player.selectedMode;
      if (mode === null) return done;
      const source = descriptors.get(mode);
      if (source === undefined) return done;
      retriesUsed = 0;
      return runAttempt({ kind: 'start', mode, source, remembered: false }, true);
    },

    togglePlay() {
      if (destroyed) return done;
      const cur = current;
      const status = state.player.status;
      // A provider player frame has its own controls; ours must not fake a pause it cannot perform (review I2).
      if (cur !== null && !cur.adapter.capabilities.playPause) return done;

      if (status === 'playing' || (status === 'reconnecting' && cur !== null)) {
        if (cur === null) return done;
        beginAction();
        cur.adapter.pause();
        onPaused(cur);
        return done;
      }
      if (status === 'reconnecting') {
        // Waiting for a retry with no adapter: "pause" means give up.
        stopInternal();
        return done;
      }
      if (status === 'paused' && cur !== null) {
        // Resume (also after play_blocked): adapter.play() directly, no new resolve (plan 6.3).
        beginAction();
        cur.errorHandled = false;
        cur.stalled = false;
        const t = nowMs();
        cur.loadStartedAt = t;
        cur.lastProgressAt = t;
        cur.lastTime = host.media.currentTime;
        dispatch({ type: 'attempt/resume' });
        if (state.player.status !== 'loading') return done;
        pageRegistry.notifyLoading(controller);
        const injected = takeFault();
        if (injected === 'play_blocked') {
          queueMicrotask(() => blockedPlay(cur));
          return done;
        }
        if (injected !== null) {
          queueMicrotask(() => failAttempt(cur, injected, 'media'));
          return done;
        }
        let playing: Promise<void>;
        try {
          playing = cur.adapter.play();
        } catch (error) {
          playing = Promise.reject(error);
        }
        return playing.then(
          () => undefined,
          (error: unknown) => onPlayRejected(cur, error),
        );
      }
      if (status === 'paused' && cur === null && pausedResume !== null) {
        // A network error hit the paused player (PS-2): re-attach the cached source inside this click.
        const ctx = pausedResume;
        retriesUsed = 0;
        dispatch({ type: 'attempt/resume' });
        if (state.player.status !== 'loading') return done;
        // An hls URL may have expired while paused: ask for a fresh one (M2-PLAN C3; play() then runs after the
        // request, and a refusal surfaces as play_blocked, one more click).
        if (ctx.source.kind === 'hls') return refreshThenRun(ctx);
        return runAttempt(ctx, false);
      }
      return done; // loading / switching: pause is unavailable (plan 6.4)
    },

    setMuted(muted) {
      if (destroyed) return;
      dispatch({ type: 'audio/muted', muted: muted === true });
      current?.adapter.setMuted(state.player.muted);
    },

    setVolume(volume) {
      if (destroyed) return;
      dispatch({ type: 'audio/volume', volume });
      current?.adapter.setVolume(state.player.volume);
    },

    seekToLive() {
      if (destroyed || current === null || state.capabilities?.seekToLive !== true) return;
      current.adapter.seekToLive();
    },

    prepareSwitch(mode) {
      if (destroyed) return;
      prefetch(mode);
    },

    switchMode(mode) {
      if (destroyed || !offers(mode)) return done;
      const { status, pendingMode, loadedMode, error } = state.player;
      if (status === 'idle' || status === 'selecting') {
        // No adapter and nothing playing (for example mode_unavailable): "switching" is just choosing the other mode.
        failureOrigin = null;
        controller.selectMode(mode);
        return done;
      }
      if (!['playing', 'paused', 'reconnecting', 'failed', 'switching'].includes(status)) return done;
      if (gateKind() !== 'open' || state.entitlement !== 'entitled') return done;
      if (status === 'switching' && pendingMode === mode) return done; // double click
      if ((status === 'playing' || status === 'paused') && loadedMode === mode && error === null) return done;
      retriesUsed = 0;
      const source = descriptors.get(mode);
      if (source !== undefined) return runAttempt({ kind: 'switch', mode, source, remembered: false }, true);
      return runAfterResolve('switch', mode);
    },

    retry() {
      if (destroyed || state.player.status !== 'failed') return done;
      if (failureOrigin === 'prepare') {
        // The descriptor fetch failed: go back to selecting and fetch again.
        beginAction();
        failureOrigin = null;
        const mode = state.player.selectedMode;
        if (mode !== null) controller.selectMode(mode);
        return done;
      }
      // Same rule as start()/switchMode(): a denied or unknown entitlement never lets playback through (D6, PS-6).
      if (gateKind() !== 'open' || state.entitlement !== 'entitled') return done;
      const mode = state.player.error?.mode ?? lastAttempt?.mode ?? state.player.selectedMode;
      if (mode === null || !offers(mode)) return done;
      const kind = lastAttempt?.kind ?? 'start';
      retriesUsed = 0;
      const source = descriptors.get(mode);
      if (source !== undefined) return runAttempt({ kind, mode, source, remembered: false }, true);
      return runAfterResolve(kind, mode);
    },

    retryEntitlement() {
      if (destroyed) return done;
      dispatch({ type: 'entitlement/set', status: 'unknown' });
      fetchEntitlement();
      return done;
    },

    reloadLastGood() {
      const mode = state.player.lastGoodMode;
      if (destroyed || state.player.status !== 'failed' || mode === null || !offers(mode)) return done;
      if (gateKind() !== 'open' || state.entitlement !== 'entitled') return done; // PS-6
      retriesUsed = 0;
      const source = descriptors.get(mode);
      if (source !== undefined) return runAttempt({ kind: 'switch', mode, source, remembered: false }, true);
      return runAfterResolve('switch', mode);
    },

    stop,

    updateEvent(event) {
      if (destroyed) return;
      const known = state.event.data;
      if (known !== null && (known.id !== event.id || known.slug !== event.slug)) return; // another event
      syncEvent(event);
    },

    destroy,

    dev: null,
  };

  const unregister = pageRegistry.register(controller);

  if (boot.devTools) {
    controller.dev = {
      setEventStatus(status) {
        if (destroyed) return;
        eventOverride = status;
        syncEvent(state.event.data);
      },
      setEntitlement(status) {
        if (destroyed) return;
        const event = state.event.data;
        if (event === null || !event.isDemo) return; // simulated entitlement: demo events only
        entitlementOverride = status;
        if (status === null) {
          fetchEntitlement();
          return;
        }
        abortEntitlement();
        dispatch({ type: 'entitlement/set', status });
      },
      injectFault(next) {
        fault = destroyed ? null : next;
      },
    };
  }

  /* ---- mount: entitlement and the preselected mode's descriptor (plan 6.2, 6.3) ---- */
  fetchEntitlement();
  ensurePrepared();

  return controller;
}
