import type { AdapterEnv } from '../types';

/** What main.ts hands to every view (plan 3.2, 6.10). */
export interface ViewContext {
  /** The .wg-live[data-wg-live-view] element that owns this view. */
  root: HTMLElement;
  /**
   * Write to the root's .wg-live__sr-status live region. Messages are coalesced within 750 ms
   * (the latest wins) and identical consecutive messages are dropped. `immediate` writes at once
   * (play_blocked, failures).
   */
  announce(message: string, opts?: { immediate?: boolean }): void;
  /** Environment facts probed once at boot (volume support). */
  env: AdapterEnv;
}

export interface ViewInstance {
  /** Remove listeners, timers and DOM owned by the view. Idempotent. */
  destroy(): void;
  /** pagehide: stop playback and release media (players). */
  stop?(): void;
  /** pageshow (bfcache restore): refresh live data immediately (pollers). */
  refresh?(): void;
}
