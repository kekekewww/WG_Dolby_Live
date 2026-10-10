/**
 * Player status transition table (M1-PLAN 6.4).
 *
 * The reducer asks `canTransition()` before it changes `player.status`, so an impossible jump
 * (for example a late `playing` signal while the player is `selecting`) is dropped instead of
 * producing an inconsistent state. The table is exported so tests can pin it.
 */
import type { PlayerStatus } from '../types';

/** `from -> to` pairs the reducer accepts. A status may always "transition" to itself. */
export const PLAYER_TRANSITIONS: Readonly<Record<PlayerStatus, readonly PlayerStatus[]>> = {
  // A mode was picked.
  idle: ['selecting'],
  // Start, the dev-panel/prefetch failure, the selection was cleared.
  selecting: ['idle', 'loading', 'failed'],
  // First load: playing, play_blocked (paused), a stall or network retry, failure, stop().
  loading: ['playing', 'paused', 'reconnecting', 'failed', 'selecting', 'idle'],
  // Pause, stall, switch, mid-stream failure, stop().
  playing: ['paused', 'reconnecting', 'switching', 'failed', 'selecting', 'idle'],
  // Resume (loading), a resume that works outside the player (playing), switch, stop().
  paused: ['playing', 'loading', 'reconnecting', 'switching', 'failed', 'selecting', 'idle'],
  // Switch finished (playing), play_blocked after a switch (paused), failed switch, stop().
  switching: ['playing', 'paused', 'failed', 'selecting', 'idle'],
  // Connection back (playing), pause, user switch while reconnecting, give up, stop().
  reconnecting: ['playing', 'paused', 'switching', 'failed', 'selecting', 'idle'],
  // Manual retry (loading), switch/reload (switching), another mode picked or stop() (selecting/idle).
  failed: ['loading', 'switching', 'selecting', 'idle'],
};

export function canTransition(from: PlayerStatus, to: PlayerStatus): boolean {
  return from === to || PLAYER_TRANSITIONS[from].includes(to);
}

/** Statuses in which playback is intended (the user asked for sound and no terminal state was reached). */
export const PLAYBACK_INTENT_STATUSES: readonly PlayerStatus[] = [
  'loading',
  'playing',
  'paused',
  'switching',
  'reconnecting',
];

/** Statuses the watchdog observes. It is never armed while `paused` (plan 6.5). */
export const WATCHED_STATUSES: readonly PlayerStatus[] = ['loading', 'playing', 'switching', 'reconnecting'];

/** Statuses in which the mode selector may change the selection. */
export const SELECTABLE_STATUSES: readonly PlayerStatus[] = ['idle', 'selecting', 'failed'];

export function hasPlaybackIntent(status: PlayerStatus): boolean {
  return PLAYBACK_INTENT_STATUSES.includes(status);
}
