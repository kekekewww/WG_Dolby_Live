/**
 * Initial application state and the selectors every view reads (M1-PLAN 6.1, 6.2, 6.7, 6.10).
 *
 * Three axes stay separate (CLAUDE.md): the event status (`state.event.status`), the player
 * status (`state.player.status`) and the entitlement (`state.entitlement`). The gate below only
 * looks at the event/deployment/source; entitlement is its own panel and its own Start condition.
 * Selectors are pure functions of AppState, so they are the single place where the "which message
 * wins" decisions live.
 */
import type {
  AppState,
  BootConfig,
  EventStatus,
  ListeningMode,
  NotReadyReason,
  PlayerError,
  PlayerErrorCode,
  PublicEvent,
  SourceKind,
} from '../types';
import { errorCopy, failedCopy, notReadyCopy } from '../i18n/copy';
import { statusCopy } from '../i18n/copy-status';
import { playerHref } from '../util/url';
import { formatEventDateTime } from '../util/time';

/* ------------------------------------------------------------------ */
/* Gate                                                                */
/* ------------------------------------------------------------------ */

export type GateKind =
  | 'disabled'
  | 'not_found'
  | 'cancelled'
  | 'ended'
  | 'not_configured'
  | 'scheduled'
  | 'doors_open'
  | 'open';

export interface Gate {
  kind: GateKind;
  /** True while the event status is `intermission` (the gate itself is `open`). */
  intermission: boolean;
}

/** Gates 0-4 (plan 6.2): below these the entitlement is not fetched and no source is prefetched. */
const BLOCKING_GATES: readonly GateKind[] = ['disabled', 'not_found', 'cancelled', 'ended', 'not_configured'];

export function isBlockingGate(kind: GateKind): boolean {
  return BLOCKING_GATES.includes(kind);
}

/**
 * The source kinds this build can play: 'demo' (M1) and 'hls' (M2-PLAN C3). An `iframe` value is treated as not
 * configured until its adapter exists (M2-PLAN D2); anything unknown is not configured.
 */
export function normalizeSource(kind: SourceKind | null | undefined): SourceKind {
  return kind === 'demo' || kind === 'hls' ? kind : 'not_configured';
}

/** Plan 6.2 gating order 0-7. */
export function selectGate(s: AppState): Gate {
  const none = { intermission: false };
  if (s.deploymentMode === 'disabled') return { kind: 'disabled', ...none };
  if (s.event.data === null || s.event.status === null) return { kind: 'not_found', ...none };
  switch (s.event.status) {
    case 'cancelled':
      return { kind: 'cancelled', ...none };
    case 'ended':
      return { kind: 'ended', ...none };
    default:
      break;
  }
  if (s.source === 'not_configured') return { kind: 'not_configured', ...none };
  switch (s.event.status) {
    case 'scheduled':
      return { kind: 'scheduled', ...none };
    case 'doors_open':
      return { kind: 'doors_open', ...none };
    case 'live':
      return { kind: 'open', intermission: false };
    case 'intermission':
      return { kind: 'open', intermission: true };
    default: {
      const unreachable: never = s.event.status;
      return unreachable;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Initial state                                                       */
/* ------------------------------------------------------------------ */

/**
 * `preselect` is the validated `?wg_mode=` / remembered mode. It is applied only when the event
 * offers that mode (the caller validates too; this is the second line of defence).
 */
export function createInitialState(
  boot: BootConfig,
  event: PublicEvent | null,
  preselect: ListeningMode | null,
): AppState {
  const selectedMode = event !== null && preselect !== null && event.availableModes.includes(preselect) ? preselect : null;
  const source = normalizeSource(event?.sourceKind);
  return {
    event: {
      data: event,
      status: event?.status ?? null,
      simulated: false,
    },
    player: {
      status: selectedMode !== null ? 'selecting' : 'idle',
      selectedMode,
      preparedMode: null,
      loadedMode: null,
      activeMode: null,
      confirmedPlaying: false,
      pendingMode: null,
      lastGoodMode: null,
      error: null,
      retry: null,
      muted: false,
      volume: 1,
    },
    entitlement: 'unknown',
    notReady: null,
    source,
    capabilities: null,
    isDemoMedia: source === 'demo',
    deploymentMode: boot.deploymentMode,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function modeName(mode: ListeningMode): string {
  return statusCopy.modeName[mode];
}

/**
 * Generic public error codes (plan 6.5): short, never a URL or stack.
 * `variant` separates the places a network failure can come from.
 */
export function publicErrorCode(code: PlayerErrorCode, variant: 'media' | 'stall' | 'resolve' = 'media'): string {
  switch (code) {
    case 'network':
      return variant === 'stall' ? 'E-NET-02' : variant === 'resolve' ? 'E-NET-03' : 'E-NET-01';
    case 'decode':
      return 'E-DEC-01';
    case 'unsupported':
      return 'E-SRC-01';
    case 'not_configured':
      return 'E-CFG-01';
    case 'not_entitled':
      return 'E-ENT-01';
    case 'entitlement_unavailable':
      return 'E-ENT-02';
    case 'play_blocked':
      return 'E-PLY-01';
    case 'unknown':
      return 'E-UNK-01';
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}

function otherMode(mode: ListeningMode): ListeningMode {
  return mode === 'binaural' ? 'atmos' : 'binaural';
}

function offers(s: AppState, mode: ListeningMode): boolean {
  return s.event.data?.availableModes.includes(mode) === true;
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/**
 * Start is enabled only when all three hold (plan 6.2): gate 7 reached, entitlement `entitled`,
 * and the source descriptor for the selected mode has resolved. Server `not_ready` and a fresh
 * selection both leave `preparedMode` null, so they disable Start without extra checks.
 */
export function selectCanStart(s: AppState): boolean {
  return (
    selectGate(s).kind === 'open' &&
    s.entitlement === 'entitled' &&
    s.player.status === 'selecting' &&
    s.player.selectedMode !== null &&
    s.player.preparedMode === s.player.selectedMode &&
    s.notReady === null
  );
}

export type StatusTone = 'neutral' | 'info' | 'warning' | 'error';

export interface StatusMessage {
  title: string;
  detail: string | null;
  tone: StatusTone;
}

function gateMessage(s: AppState, gate: Gate): StatusMessage | null {
  const g = statusCopy.gate;
  switch (gate.kind) {
    case 'disabled':
      return { title: g.disabled.title, detail: g.disabled.detail, tone: 'neutral' };
    case 'not_found':
      return { title: g.eventNotFound.title, detail: g.eventNotFound.detail, tone: 'warning' };
    case 'cancelled':
      return { title: g.cancelled.title, detail: g.cancelled.detail, tone: 'warning' };
    case 'ended':
      return { title: g.ended.title, detail: g.ended.detail, tone: 'neutral' };
    case 'not_configured':
      return { title: g.sourceNotConfigured.title, detail: g.sourceNotConfigured.detail, tone: 'info' };
    case 'scheduled': {
      const event = s.event.data;
      const when = event ? formatEventDateTime(event.startsAt, event.displayTimezone) : null;
      return {
        title: g.scheduled.title,
        detail: when && when.machine !== '' ? statusCopy.startsAt(when.full) : statusCopy.time.tbd,
        tone: 'info',
      };
    }
    case 'doors_open':
      return { title: g.doorsOpen.title, detail: g.doorsOpen.detail, tone: 'info' };
    case 'open':
      return null;
    default: {
      const unreachable: never = gate.kind;
      return unreachable;
    }
  }
}

/** Plan 6.7: the UI for a server `not_ready` reason (entitlement reasons use the panel, but still say so here). */
function notReadyMessage(s: AppState, reason: NotReadyReason): StatusMessage {
  const g = statusCopy.gate;
  switch (reason) {
    case 'disabled':
      return { title: notReadyCopy(reason), detail: g.disabled.detail, tone: 'neutral' };
    case 'source_not_configured':
      return { title: notReadyCopy(reason), detail: g.sourceNotConfigured.detail, tone: 'info' };
    case 'event_not_found':
      return { title: notReadyCopy(reason), detail: g.eventNotFound.detail, tone: 'warning' };
    case 'mode_unavailable':
      return { title: notReadyCopy(reason), detail: null, tone: 'warning' };
    case 'event_not_playable': {
      // "The event-status copy": the server disagrees with the client status, so say what the status means.
      const status = s.event.status;
      if (status === 'scheduled') return { title: g.scheduled.title, detail: null, tone: 'info' };
      return { title: g.doorsOpen.title, detail: g.doorsOpen.detail, tone: 'info' };
    }
    case 'not_entitled':
      return { title: statusCopy.entitlement.notEntitled.message, detail: null, tone: 'warning' };
    case 'entitlement_unavailable':
      return { title: statusCopy.entitlement.unavailable.message, detail: null, tone: 'warning' };
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

function errorDetail(error: PlayerError): string {
  return `${statusCopy.errorCodeLabel}：${error.publicCode}`;
}

/** What the player status line says. Gate messages win over everything the player does (plan 6.2). */
export function selectStatusMessage(s: AppState): StatusMessage {
  const gate = selectGate(s);
  const fromGate = gateMessage(s, gate);
  if (fromGate !== null) return fromGate;

  const p = statusCopy.player;
  const { player } = s;
  const intermissionNote = gate.intermission ? statusCopy.gate.intermission.title : null;

  if (s.notReady !== null && (player.status === 'idle' || player.status === 'selecting')) {
    return notReadyMessage(s, s.notReady);
  }

  switch (player.status) {
    case 'idle':
    case 'selecting': {
      let hint: string | null;
      // No mode on offer (plan 4.2): do not tell the user to choose one.
      if (s.event.data !== null && s.event.data.availableModes.length === 0) hint = p.modesPending;
      else if (player.status === 'idle') hint = p.idle;
      else if (s.entitlement === 'entitled') hint = player.preparedMode === player.selectedMode ? p.selecting : p.checkingSource;
      else hint = s.entitlement === 'unknown' ? statusCopy.entitlement.checking : null;
      if (gate.intermission) return { title: statusCopy.gate.intermission.title, detail: hint, tone: 'info' };
      return { title: hint ?? statusCopy.gate.live.title, detail: null, tone: 'neutral' };
    }
    case 'loading':
      return { title: p.loading, detail: intermissionNote, tone: 'info' };
    case 'playing':
      return { title: p.playing, detail: intermissionNote, tone: 'neutral' };
    case 'paused':
      if (player.error?.code === 'play_blocked') {
        return { title: p.playBlocked, detail: null, tone: 'warning' };
      }
      return { title: p.paused, detail: intermissionNote, tone: 'neutral' };
    case 'switching':
      return { title: p.switching, detail: intermissionNote, tone: 'info' };
    case 'reconnecting':
      return { title: p.reconnecting, detail: null, tone: 'warning' };
    case 'failed': {
      const error = player.error;
      if (error === null) return { title: p.failed, detail: null, tone: 'error' };
      const base = failedCopy(error.code);
      const failedSwitch = player.lastGoodMode !== null && error.mode !== null && error.mode !== player.lastGoodMode;
      if (failedSwitch && player.lastGoodMode !== null) {
        return {
          title: base,
          detail: `${statusCopy.announce.switchFailed(modeName(player.lastGoodMode))}（${errorDetail(error)}）`,
          tone: 'error',
        };
      }
      return { title: base, detail: errorDetail(error), tone: 'error' };
    }
    default: {
      const unreachable: never = player.status;
      return unreachable;
    }
  }
}

/** 已選擇：… before the adapter confirmed playing, 目前播放：… after (plan 6.10). */
export function selectModeLabel(s: AppState): string | null {
  const { player } = s;
  if (player.confirmedPlaying && player.activeMode !== null) {
    return statusCopy.currentMode(modeName(player.activeMode));
  }
  const mode = player.status === 'switching' && player.pendingMode !== null ? player.pendingMode : player.selectedMode;
  return mode !== null ? statusCopy.selectedMode(modeName(mode)) : null;
}

export interface EntitlementPanel {
  kind: 'guest' | 'not_entitled' | 'unavailable';
  message: string;
}

/** The panel next to the status message (plan 6.2). Nothing for `unknown` and `entitled`. */
export function selectEntitlementPanel(s: AppState): EntitlementPanel | null {
  if (isBlockingGate(selectGate(s).kind)) return null;
  switch (s.entitlement) {
    case 'guest':
      return { kind: 'guest', message: statusCopy.entitlement.guest.message };
    case 'not_entitled':
      return { kind: 'not_entitled', message: statusCopy.entitlement.notEntitled.message };
    case 'unavailable':
      return { kind: 'unavailable', message: statusCopy.entitlement.unavailable.message };
    case 'unknown':
    case 'entitled':
      return null;
    default: {
      const unreachable: never = s.entitlement;
      return unreachable;
    }
  }
}

export type ErrorAction =
  | 'retry'
  | 'reload_last_good'
  | 'fallback_binaural'
  | 'switch_mode'
  | 'view_event'
  | 'back_to_events';

/**
 * The mode the 切換模式 (switch_mode) action moves to, or null when there is none. It is always the
 * OTHER mode than the one that is failing (the selected mode while nothing has started, the failed
 * attempt's mode otherwise), and only when that mode is offered by the event. After a failed
 * Atmos -> Binaural switch the target is therefore Atmos, never the mode that just failed.
 */
export function selectSwitchTarget(s: AppState): ListeningMode | null {
  const { player } = s;
  const failing = player.status === 'failed' ? (player.error?.mode ?? player.selectedMode) : player.selectedMode;
  if (failing === null) return null;
  const target = otherMode(failing);
  return offers(s, target) ? target : null;
}

/**
 * Recovery actions for the current state, in display order (plan 6.6, 6.7). A failed switch offers
 * reloading the old mode, and a failed Atmos load offers the Binaural fallback; the track is never
 * changed silently.
 */
export function selectErrorActions(s: AppState): ErrorAction[] {
  const out: ErrorAction[] = [];
  const add = (a: ErrorAction): void => {
    if (!out.includes(a)) out.push(a);
  };

  const gate = selectGate(s);
  switch (gate.kind) {
    case 'not_found':
    case 'ended':
      return ['back_to_events'];
    case 'not_configured':
      return ['view_event'];
    case 'disabled':
    case 'cancelled':
    case 'scheduled':
    case 'doors_open':
      return [];
    case 'open':
      break;
  }

  if (s.notReady !== null && s.player.status !== 'failed') {
    switch (s.notReady) {
      case 'source_not_configured':
        return ['view_event'];
      case 'event_not_found':
        return ['back_to_events'];
      case 'mode_unavailable':
        return selectSwitchTarget(s) !== null ? ['switch_mode'] : [];
      case 'disabled':
      case 'event_not_playable':
      case 'not_entitled':
      case 'entitlement_unavailable':
        return [];
      default: {
        const unreachable: never = s.notReady;
        return unreachable;
      }
    }
  }

  const { player } = s;
  if (player.status !== 'failed' || player.error === null) return out;
  const error = player.error;

  // Resuming playback needs the same conditions as Start (plan 6.2, D6): a denied or unknown entitlement
  // offers no retry/reload/switch that would start sound.
  const entitled = s.entitlement === 'entitled';
  switch (error.code) {
    case 'network':
    case 'unknown':
    case 'decode':
      if (entitled) add('retry');
      break;
    case 'not_configured':
      add('view_event');
      break;
    case 'unsupported':
    case 'not_entitled':
    case 'entitlement_unavailable':
    case 'play_blocked':
      break;
    default: {
      const unreachable: never = error.code;
      return unreachable;
    }
  }
  if (entitled && player.lastGoodMode !== null && error.mode !== player.lastGoodMode && offers(s, player.lastGoodMode)) {
    add('reload_last_good');
  }
  if (error.mode === 'atmos' && offers(s, 'binaural')) add('fallback_binaural');
  // "This environment cannot play this version" (plan 6.7) offers the other mode when it exists.
  // For Atmos the Binaural fallback above already is that offer. When the target is the last good mode,
  // reload_last_good already is that offer (the same click), so it is not listed twice.
  if (entitled && error.code === 'unsupported' && error.mode === 'binaural') {
    const target = selectSwitchTarget(s);
    if (target !== null && !(out.includes('reload_last_good') && target === player.lastGoodMode)) add('switch_mode');
  }
  return out;
}

/**
 * The live-region text for the current state, or null when nothing should be announced
 * (plan 6.10). The view announces only when the value is new. Never the countdown, the retry
 * counter or a time display.
 */
export function selectAnnouncement(s: AppState): string | null {
  const a = statusCopy.announce;
  const gate = selectGate(s);
  const status = s.event.status;

  if (gate.kind === 'ended' || gate.kind === 'cancelled' || gate.kind === 'scheduled' || gate.kind === 'doors_open') {
    return status !== null ? a.eventStatus(status) : null;
  }
  if (gate.kind !== 'open') return null;

  const { player } = s;
  switch (player.status) {
    case 'idle':
    case 'selecting':
      // Waiting for the show: a status change (doors_open -> live) is the news.
      return status !== null ? a.eventStatus(status) : null;
    case 'loading':
      return a.loading;
    case 'switching':
      return statusCopy.player.switching;
    case 'reconnecting':
      return a.reconnecting;
    case 'playing':
      return player.confirmedPlaying && player.activeMode !== null ? a.playing(modeName(player.activeMode)) : a.loading;
    case 'paused':
      return player.error?.code === 'play_blocked' ? a.playBlocked : a.paused;
    case 'failed': {
      const error = player.error;
      if (error === null) return a.failed(statusCopy.player.failed);
      if (player.lastGoodMode !== null && error.mode !== null && error.mode !== player.lastGoodMode) {
        return a.switchFailed(modeName(player.lastGoodMode));
      }
      // A network failure after the retries: the title already says what to do, no prefix needed.
      return error.code === 'network' ? statusCopy.player.failed : a.failed(errorCopy(error.code));
    }
    default: {
      const unreachable: never = player.status;
      return unreachable;
    }
  }
}

/** play_blocked and failures are announced at once instead of being coalesced (plan 6.10). */
export function isUrgentAnnouncement(s: AppState): boolean {
  const { player } = s;
  return player.status === 'failed' || (player.status === 'paused' && player.error?.code === 'play_blocked');
}

export interface PrimaryCta {
  label: string;
  kind: 'link' | 'details';
  href: string | null;
}

/** Plan 6.1 table: the first matching row wins. */
export function selectPrimaryCta(event: PublicEvent, boot: BootConfig): PrimaryCta {
  const c = statusCopy.cta;
  const details = (label: string): PrimaryCta => ({ label, kind: 'details', href: null });
  const link = (label: string, fallback: string): PrimaryCta => {
    const href = playerHref(boot.links.player, event.slug);
    // Without a player page there is nothing to open: fall back to the details row instead of a dead link.
    return href !== null ? { label, kind: 'link', href } : details(fallback);
  };

  if (event.status === 'cancelled' || event.status === 'ended') return details(c.viewDetails);
  if (event.isDemo && event.sourceKind === 'demo') return link(c.demo, c.viewDetails);
  switch (event.status) {
    case 'doors_open':
    case 'live':
    case 'intermission':
      return link(c.enter, c.viewDetails);
    case 'scheduled':
      return details(c.viewEvent);
    default: {
      const unreachable: never = event.status;
      return unreachable;
    }
  }
}

function startMs(event: PublicEvent): number {
  const t = Date.parse(event.startsAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

const FINISHED: readonly EventStatus[] = ['ended', 'cancelled'];

/**
 * Featured event and the rest (plan 6.1). The featured event is `featuredSlug` when it names an
 * event in the list, else the earliest event that is neither ended nor cancelled. Other events:
 * upcoming ascending, then ended and cancelled descending. `_nowMs` is accepted for the contract
 * signature; ordering uses the event status, not the clock, so a stale clock cannot reshuffle cards.
 */
export function orderEvents(
  events: PublicEvent[],
  featuredSlug: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the shared contract signature
  _nowMs: number,
): { featured: PublicEvent | null; others: PublicEvent[] } {
  const upcoming = events.filter((e) => !FINISHED.includes(e.status)).sort((a, b) => startMs(a) - startMs(b));
  const finished = events.filter((e) => FINISHED.includes(e.status)).sort((a, b) => startMs(b) - startMs(a));
  const ordered = [...upcoming, ...finished];

  const named = featuredSlug !== null ? ordered.find((e) => e.slug === featuredSlug) : undefined;
  const featured = named ?? upcoming[0] ?? null;
  return { featured, others: ordered.filter((e) => e !== featured) };
}
