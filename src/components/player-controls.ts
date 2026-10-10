/**
 * Transport controls (spec 5.3, plan 6.3 / 6.10).
 *
 * One primary button changes role with the player status (開始聆聽 / 暫停 / 繼續播放), so keyboard
 * focus survives the whole Start -> loading -> Pause sequence. It uses aria-disabled plus a click
 * guard instead of `disabled`, which keeps it focusable and lets the visible reason text describe it.
 * Mute, volume, 返回直播 and fullscreen are rendered only when the adapter's capabilities allow
 * them (never faked), and fullscreen only for video.
 *
 * Start invariant (plan 6.3): the click handler calls controller.start() synchronously, with
 * nothing awaited before it.
 */
import { h, uid } from '../dom';
import { playerCopy } from '../i18n/copy-player';
import { notReadyCopy, statusCopy } from '../i18n/copy';
import { selectCanStart, selectGate } from '../state/model';
import type { AppState, PlayerController } from '../types';

/* ------------------------------------------------------------------ */
/* Pure view logic (exported for tests)                                */
/* ------------------------------------------------------------------ */

export type PrimaryKind = 'start' | 'toggle' | 'busy' | 'hidden';

export interface PrimaryAction {
  kind: PrimaryKind;
  label: string;
  /** Rendered as aria-disabled="true" and ignored by the click handler. */
  disabled: boolean;
}

/** What the big button does for this state. */
export function primaryAction(state: AppState): PrimaryAction {
  const { status, error } = state.player;
  switch (status) {
    case 'idle':
    case 'selecting':
      return { kind: 'start', label: statusCopy.action.start, disabled: !selectCanStart(state) };
    case 'loading':
      return { kind: 'busy', label: playerCopy.controls.connecting, disabled: true };
    case 'switching':
      return { kind: 'busy', label: playerCopy.controls.switching, disabled: true };
    case 'playing':
    case 'reconnecting':
      return { kind: 'toggle', label: statusCopy.action.pause, disabled: false };
    case 'paused':
      // After a blocked play() the next click calls adapter.play() directly (plan 6.3).
      return {
        kind: 'toggle',
        label: error?.code === 'play_blocked' ? statusCopy.action.start : statusCopy.action.resume,
        disabled: false,
      };
    case 'failed':
      // Recovery lives in the status panel (retry / reload / fallback / switch) and, for a mode that
      // never played, in the selector: picking a mode moves the status back to `selecting`.
      return { kind: 'hidden', label: statusCopy.action.start, disabled: true };
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Visible reason why「開始聆聽」is disabled; null when it is enabled or not shown. */
export function startReason(state: AppState): string | null {
  const action = primaryAction(state);
  if (action.kind !== 'start' || !action.disabled) return null;
  const { selectedMode, preparedMode } = state.player;
  if (selectedMode === null) return playerCopy.startReason.noMode;

  switch (selectGate(state).kind) {
    case 'scheduled':
      return playerCopy.startReason.notOpenScheduled;
    case 'doors_open':
      return playerCopy.startReason.notOpenDoors;
    case 'not_configured':
      return playerCopy.startReason.noSource;
    case 'open':
      break;
    default:
      return null; // terminal gates hide the controls entirely
  }

  switch (state.entitlement) {
    case 'unknown':
      return statusCopy.entitlement.checking;
    case 'guest':
      return statusCopy.entitlement.guest.message;
    case 'not_entitled':
      return statusCopy.entitlement.notEntitled.message;
    case 'unavailable':
      return statusCopy.entitlement.unavailable.message;
    case 'entitled':
      break;
  }
  if (preparedMode !== selectedMode && state.notReady !== null) return notReadyCopy(state.notReady);
  return statusCopy.player.checkingSource;
}

const EDITABLE_INPUT_EXCLUDED = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
const ACTIVATABLE_INPUT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

function isEditableTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !EDITABLE_INPUT_EXCLUDED.has(target.type);
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}

function isActivatableTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement && ACTIVATABLE_INPUT.has(target.type)) return true;
  return target.closest('button, a[href], summary, [role="button"], [role="switch"], [role="slider"]') !== null;
}

/**
 * Space / K toggle playback (plan 6.10). Returns true when the shortcut was handled; only then
 * is preventDefault() called. Ignored: defaultPrevented, repeat, IME composition, any modifier,
 * editable targets, and (for Space) activatable controls, where Space already means "press".
 * The shortcut pauses/resumes a loaded stream; it never starts playback or resolves a source.
 */
export function handlePlayerKeydown(event: KeyboardEvent, controller: PlayerController): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const isSpace = event.key === ' ' || event.key === 'Spacebar';
  const isK = event.key === 'k';
  if (!isSpace && !isK) return false;

  const target = event.target instanceof Element ? event.target : null;
  if (isEditableTarget(target)) return false;
  if (isSpace && isActivatableTarget(target)) return false;

  const { status } = controller.getState().player;
  if (status !== 'playing' && status !== 'paused' && status !== 'reconnecting') return false;

  event.preventDefault();
  controller.togglePlay().catch(() => undefined);
  return true;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface PlayerControlsOptions {
  controller: PlayerController;
  mediaKind: 'audio' | 'video';
  /** Element that goes fullscreen (the stage). */
  stage: HTMLElement;
  media: HTMLMediaElement;
}

export interface PlayerControls {
  el: HTMLElement;
  primary: HTMLButtonElement;
  update(state: AppState): void;
  destroy(): void;
}

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FullscreenStage = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function toggleFullscreen(stage: HTMLElement, media: HTMLMediaElement): void {
  const doc = document as FullscreenDoc;
  try {
    const current = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (current) {
      if (typeof doc.exitFullscreen === 'function') void doc.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (typeof stage.requestFullscreen === 'function') {
      void stage.requestFullscreen().catch(() => undefined);
    } else if (typeof (stage as FullscreenStage).webkitRequestFullscreen === 'function') {
      (stage as FullscreenStage).webkitRequestFullscreen?.();
    } else if (media instanceof HTMLVideoElement) {
      // iPhone Safari can only fullscreen the <video> element itself.
      (media as FullscreenVideo).webkitEnterFullscreen?.();
    }
  } catch {
    // Fullscreen can be refused (iframe policy, no user activation); nothing to recover.
  }
}

export function createPlayerControls(options: PlayerControlsOptions): PlayerControls {
  const { controller, mediaKind, stage, media } = options;
  const reasonId = uid('wg-live-start-reason');
  const disposers: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(type, handler);
    disposers.push(() => target.removeEventListener(type, handler));
  };

  const primary = h('button', {
    className: 'wg-live__btn wg-live__btn--primary wg-live__play',
    type: 'button',
    attrs: { 'aria-describedby': reasonId, 'aria-keyshortcuts': playerCopy.controls.keyShortcuts },
    text: statusCopy.action.start,
  });
  const reason = h('p', { className: 'wg-live__start-reason wg-live__small wg-live__muted', id: reasonId, hidden: true });

  const mute = h('button', {
    className: 'wg-live__btn wg-live__btn--secondary wg-live__mute',
    type: 'button',
    attrs: { 'aria-pressed': 'false' },
    text: playerCopy.controls.mute,
    hidden: true,
  });
  const volumeId = uid('wg-live-volume');
  const volumeInput = h('input', {
    className: 'wg-live__volume-input',
    id: volumeId,
    type: 'range',
    min: 0,
    max: 100,
    step: 5,
    value: 100,
    attrs: { 'aria-valuetext': '100%' },
  });
  const volume = h(
    'div',
    { className: 'wg-live__volume', hidden: true },
    h('label', { className: 'wg-live__volume-label', attrs: { for: volumeId }, text: playerCopy.controls.volume }),
    volumeInput,
  );
  const live = h('button', {
    className: 'wg-live__btn wg-live__btn--secondary wg-live__live',
    type: 'button',
    text: playerCopy.controls.seekToLive,
    hidden: true,
  });
  const fullscreen = h('button', {
    className: 'wg-live__btn wg-live__btn--secondary wg-live__fullscreen',
    type: 'button',
    text: playerCopy.controls.fullscreen,
    hidden: true,
  });

  const secondary = h(
    'div',
    { className: 'wg-live__transport', attrs: { role: 'group', 'aria-label': playerCopy.controls.groupLabel }, hidden: true },
    mute,
    volume,
    live,
    fullscreen,
  );
  const el = h('div', { className: 'wg-live__controls-main' }, primary, reason, secondary);

  /* ---- events ---- */
  listen(primary, 'click', () => {
    if (primary.getAttribute('aria-disabled') === 'true') return;
    const state = controller.getState();
    const action = primaryAction(state);
    if (action.disabled) return;
    if (action.kind === 'start') {
      if (!selectCanStart(state)) return;
      // Synchronous on purpose: destroy -> load -> play inside this click (plan 6.3).
      controller.start().catch(() => undefined);
    } else if (action.kind === 'toggle') {
      controller.togglePlay().catch(() => undefined);
    }
  });
  listen(mute, 'click', () => {
    controller.setMuted(!controller.getState().player.muted);
  });
  listen(volumeInput, 'input', () => {
    const value = Number(volumeInput.value);
    if (!Number.isFinite(value)) return;
    volumeInput.setAttribute('aria-valuetext', `${Math.round(value)}%`);
    controller.setVolume(Math.min(1, Math.max(0, value / 100)));
  });
  listen(live, 'click', () => controller.seekToLive());
  listen(fullscreen, 'click', () => toggleFullscreen(stage, media));

  function setText(node: HTMLElement, text: string): void {
    if (node.textContent !== text) node.textContent = text;
  }

  function update(state: AppState): void {
    const action = primaryAction(state);
    primary.hidden = action.kind === 'hidden';
    primary.dataset.action = action.kind;
    setText(primary, action.label);
    if (action.disabled) primary.setAttribute('aria-disabled', 'true');
    else primary.removeAttribute('aria-disabled');

    const why = startReason(state);
    reason.hidden = why === null;
    setText(reason, why ?? '');

    const { status } = state.player;
    const caps = state.capabilities;
    const engaged = status !== 'idle' && status !== 'selecting';
    const showMute = engaged && caps !== null && caps.mute;
    const showVolume = engaged && caps !== null && caps.volume;
    const showLive = engaged && caps !== null && caps.seekToLive;
    const showFullscreen = engaged && caps !== null && caps.fullscreen && mediaKind === 'video';

    mute.hidden = !showMute;
    volume.hidden = !showVolume;
    live.hidden = !showLive;
    fullscreen.hidden = !showFullscreen;
    secondary.hidden = !(showMute || showVolume || showLive || showFullscreen);

    const muted = state.player.muted;
    mute.setAttribute('aria-pressed', muted ? 'true' : 'false');

    const percent = Math.round(Math.min(1, Math.max(0, state.player.volume)) * 100);
    if (Number(volumeInput.value) !== percent && document.activeElement !== volumeInput) {
      volumeInput.value = String(percent);
      volumeInput.setAttribute('aria-valuetext', `${percent}%`);
    }
  }

  return {
    el,
    primary,
    update,
    destroy(): void {
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}
