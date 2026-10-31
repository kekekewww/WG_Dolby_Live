/**
 * Pure reducer for AppState (M1-PLAN 6.4). No timers, no I/O, no adapter: the coordinator decides
 * what happens and dispatches the facts here. Every status change goes through the transition table
 * in transitions.ts, so an impossible jump is dropped and the previous state object is returned
 * (reference equality tells the store nothing changed).
 */
import type {
  AppState,
  EntitlementStatus,
  EventStatus,
  ListeningMode,
  NotReadyReason,
  PlayerCapabilities,
  PlayerError,
  PublicEvent,
} from '../types';
import { normalizeSource } from './model';
import { SELECTABLE_STATUSES, canTransition } from './transitions';

export type Action =
  /** Replace the event slice. `status` is the effective status (a dev override wins over the data). */
  | { type: 'event/set'; data: PublicEvent | null; status: EventStatus | null; simulated: boolean }
  | { type: 'entitlement/set'; status: EntitlementStatus }
  /** `null` clears the selection. */
  | { type: 'mode/select'; mode: ListeningMode | null }
  /** The coordinator tells whether the selected mode's descriptor is cached. */
  | { type: 'mode/prepared'; prepared: boolean }
  | { type: 'prepare/not_ready'; reason: NotReadyReason }
  | { type: 'prepare/clear_not_ready' }
  | { type: 'prepare/failed'; error: PlayerError }
  /** start() and the manual retry of a start. */
  | { type: 'attempt/start'; mode: ListeningMode }
  /** switchMode(), reloadLastGood() and the Binaural fallback. */
  | { type: 'attempt/switch'; mode: ListeningMode }
  /** The source of `mode` is now attached to the adapter. */
  | { type: 'attempt/attached'; mode: ListeningMode }
  /** Resume after pause / play_blocked. */
  | { type: 'attempt/resume' }
  | { type: 'attempt/capabilities'; capabilities: PlayerCapabilities }
  | { type: 'adapter/playing' }
  /** M2-PLAN D2: a provider player frame loaded. It cannot confirm playback, so confirmedPlaying stays false. */
  | { type: 'adapter/frame_ready' }
  | { type: 'adapter/paused' }
  | { type: 'adapter/ended' }
  /** The watchdog saw no progress for the grace period while playing. */
  | { type: 'adapter/stalled' }
  | { type: 'retry/wait'; attempt: number; max: number }
  /** `restoreGood` (present only for a source that played but was silent): the mode that really played before. */
  | { type: 'attempt/failed'; error: PlayerError; restoreGood?: ListeningMode | null }
  | { type: 'attempt/play_blocked'; error: PlayerError }
  | { type: 'player/stopped' }
  | { type: 'audio/muted'; muted: boolean }
  | { type: 'audio/volume'; volume: number };

type Player = AppState['player'];

/** Apply a player patch; returns the same state object when nothing in the patch differs. */
function withPlayer(state: AppState, patch: Partial<Player>): AppState {
  const keys = Object.keys(patch) as Array<keyof Player>;
  if (keys.every((key) => Object.is(state.player[key], patch[key]))) return state;
  return { ...state, player: { ...state.player, ...patch } };
}

/** Change the status only when the transition table allows it. */
function moveTo(state: AppState, to: Player['status'], patch: Partial<Player> = {}): AppState {
  if (!canTransition(state.player.status, to)) return state;
  return withPlayer(state, { ...patch, status: to });
}

function sameCapabilities(a: PlayerCapabilities | null, b: PlayerCapabilities): boolean {
  return (
    a !== null &&
    a.playPause === b.playPause &&
    a.mute === b.mute &&
    a.volume === b.volume &&
    a.seekToLive === b.seekToLive &&
    a.fullscreen === b.fullscreen &&
    a.remotePlayback === b.remotePlayback &&
    a.reliablePlaybackEvents === b.reliablePlaybackEvents
  );
}

export function reduce(state: AppState, action: Action): AppState {
  const p = state.player;
  switch (action.type) {
    case 'event/set': {
      // A server "source not configured" answer sticks until the notReady is cleared.
      const source = state.notReady === 'source_not_configured' ? 'not_configured' : normalizeSource(action.data?.sourceKind);
      return {
        ...state,
        event: { data: action.data, status: action.status, simulated: action.simulated },
        source,
        isDemoMedia: source === 'demo',
      };
    }

    case 'entitlement/set':
      return state.entitlement === action.status ? state : { ...state, entitlement: action.status };

    case 'mode/select': {
      if (action.mode === null) {
        if (!SELECTABLE_STATUSES.includes(p.status)) return state;
        return { ...withPlayer(state, { selectedMode: null, preparedMode: null, error: null, status: 'idle' }), notReady: null };
      }
      if (!SELECTABLE_STATUSES.includes(p.status)) return state;
      if (state.event.data === null || !state.event.data.availableModes.includes(action.mode)) return state;
      if (p.selectedMode === action.mode && p.status === 'selecting') return state;
      const same = p.selectedMode === action.mode;
      return {
        ...withPlayer(state, {
          selectedMode: action.mode,
          preparedMode: same ? p.preparedMode : null,
          error: null,
          status: 'selecting',
        }),
        notReady: same ? state.notReady : null,
      };
    }

    case 'mode/prepared': {
      const preparedMode = action.prepared ? p.selectedMode : null;
      return p.preparedMode === preparedMode ? state : withPlayer(state, { preparedMode });
    }

    case 'prepare/not_ready': {
      let entitlement = state.entitlement;
      // The server is the authority: a denial it reports can never leave Start enabled.
      if (action.reason === 'not_entitled' && entitlement !== 'guest') entitlement = 'not_entitled';
      if (action.reason === 'entitlement_unavailable') entitlement = 'unavailable';
      const unconfigured = action.reason === 'source_not_configured';
      return {
        ...withPlayer(state, { preparedMode: null }),
        notReady: action.reason,
        entitlement,
        source: unconfigured ? 'not_configured' : state.source,
        isDemoMedia: unconfigured ? false : state.isDemoMedia,
      };
    }

    case 'prepare/clear_not_ready': {
      if (state.notReady === null) return state;
      const source = normalizeSource(state.event.data?.sourceKind);
      return { ...state, notReady: null, source, isDemoMedia: source === 'demo' };
    }

    case 'prepare/failed':
      return moveTo(state, 'failed', { error: action.error, preparedMode: null });

    case 'attempt/start':
      return moveTo(state, 'loading', {
        pendingMode: null,
        loadedMode: null,
        confirmedPlaying: false,
        error: null,
        retry: null,
      });

    case 'attempt/switch': {
      const next = moveTo(state, 'switching', {
        pendingMode: action.mode,
        loadedMode: null,
        confirmedPlaying: false,
        error: null,
        retry: null,
      });
      return next === state ? state : { ...next, capabilities: null };
    }

    case 'attempt/attached':
      return p.loadedMode === action.mode ? state : withPlayer(state, { loadedMode: action.mode });

    case 'attempt/resume':
      return moveTo(state, 'loading', { error: null });

    case 'attempt/capabilities':
      return sameCapabilities(state.capabilities, action.capabilities)
        ? state
        : { ...state, capabilities: { ...action.capabilities } };

    case 'adapter/playing': {
      if (p.loadedMode === null) return state;
      const next = moveTo(state, 'playing', {
        activeMode: p.loadedMode,
        selectedMode: p.loadedMode,
        preparedMode: p.loadedMode,
        lastGoodMode: p.loadedMode,
        confirmedPlaying: true,
        pendingMode: null,
        error: null,
        retry: null,
      });
      return next;
    }

    case 'adapter/frame_ready': {
      if (p.loadedMode === null) return state;
      return moveTo(state, 'playing', {
        activeMode: p.loadedMode,
        selectedMode: p.loadedMode,
        preparedMode: p.loadedMode,
        lastGoodMode: p.loadedMode,
        confirmedPlaying: false,
        pendingMode: null,
        error: null,
        retry: null,
      });
    }

    case 'adapter/paused':
      // Ignored while loading or switching (a queued pause of the superseded source), plan 6.4.
      if (p.status !== 'playing' && p.status !== 'reconnecting' && p.status !== 'paused') return state;
      return p.status === 'paused' ? state : moveTo(state, 'paused', { retry: null });

    case 'adapter/ended':
      if (p.status !== 'playing' && p.status !== 'reconnecting') return state;
      return moveTo(state, 'paused', { confirmedPlaying: false, retry: null });

    case 'adapter/stalled':
      return p.status === 'playing' ? moveTo(state, 'reconnecting') : state;

    case 'retry/wait': {
      // A switch stays a switch while it is being retried; everything else is a reconnect.
      const to: Player['status'] = p.pendingMode !== null ? 'switching' : 'reconnecting';
      return moveTo(state, to, {
        retry: { attempt: action.attempt, max: action.max },
        loadedMode: null,
        confirmedPlaying: false,
      });
    }

    case 'attempt/failed': {
      const next = moveTo(state, 'failed', {
        error: action.error,
        retry: null,
        pendingMode: null,
        loadedMode: null,
        confirmedPlaying: false,
        ...(action.restoreGood !== undefined ? { lastGoodMode: action.restoreGood, activeMode: action.restoreGood } : {}),
      });
      return next === state ? state : { ...next, capabilities: null };
    }

    case 'attempt/play_blocked':
      return moveTo(state, 'paused', {
        error: action.error,
        selectedMode: p.loadedMode ?? p.selectedMode,
        pendingMode: null,
        confirmedPlaying: false,
        retry: null,
      });

    case 'player/stopped': {
      const status: Player['status'] = p.selectedMode !== null ? 'selecting' : 'idle';
      const next = withPlayer(state, {
        status,
        loadedMode: null,
        activeMode: null,
        confirmedPlaying: false,
        pendingMode: null,
        lastGoodMode: null,
        error: null,
        retry: null,
      });
      return next.capabilities === null ? next : { ...next, capabilities: null };
    }

    case 'audio/muted':
      return p.muted === action.muted ? state : withPlayer(state, { muted: action.muted });

    case 'audio/volume': {
      const volume = Number.isFinite(action.volume) ? Math.min(1, Math.max(0, action.volume)) : p.volume;
      return p.volume === volume ? state : withPlayer(state, { volume });
    }

    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
