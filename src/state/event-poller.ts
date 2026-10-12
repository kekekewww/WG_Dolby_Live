/**
 * Event status poller (M1-PLAN 3.2, 6.4). One timer chain, no setInterval:
 * - 60 s between polls, doubling after each failure up to 5 min, back to 60 s after a success;
 * - nothing runs while the document is hidden; it refreshes at once when the page becomes
 *   visible again and on a bfcache `pageshow`;
 * - it destroys itself when its root element is no longer in the document.
 * The poller only reports; the player controller decides what a status change means.
 */
import type { EventProvider, PublicEvent } from '../types';

export const POLL_INTERVAL_MS = 60_000;
export const POLL_MAX_BACKOFF_MS = 300_000;
/** A poll that has not answered by now counts as a failure (backoff), so one hung request cannot end polling (PS-5). */
export const POLL_TIMEOUT_MS = 15_000;
/**
 * Fired on `document` when the poller finds its root detached. main.ts listens and destroys the
 * mounted instance, so a paused/failed player that no timer watches is still released (PS-8).
 */
export const DETACHED_EVENT = 'wg-live:detached';

export interface EventPollerOptions {
  provider: EventProvider;
  slug: string;
  root: HTMLElement;
  onEvent(event: PublicEvent): void;
  /** The event no longer exists or is no longer public (the provider answered null). */
  onGone?(): void;
}

export interface EventPoller {
  stop(): void;
  /** Poll now (visibilitychange, pageshow, or a caller that wants fresh data). */
  refreshNow(): void;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export function startEventPoller(opts: EventPollerOptions): EventPoller {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let guard: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let inFlight = false;
  let delay = POLL_INTERVAL_MS;
  let gone = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    if (guard !== null) {
      clearTimeout(guard);
      guard = null;
    }
    controller?.abort();
    controller = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
  };

  /** True (and stops) when the root left the document. */
  const orphaned = (): boolean => {
    if (opts.root.isConnected) return false;
    stop();
    try {
      document.dispatchEvent(new CustomEvent(DETACHED_EVENT));
    } catch {
      // Releasing the player is best effort; the next mountAll() sweep still catches it.
    }
    return true;
  };

  const schedule = (): void => {
    clearTimer();
    // Hidden documents do not poll; visibilitychange restarts the chain.
    if (stopped || document.hidden) return;
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delay);
  };

  async function poll(): Promise<void> {
    if (stopped || orphaned()) return;
    if (document.hidden) return;
    if (inFlight) return;
    inFlight = true;
    clearTimer();
    const mine = new AbortController();
    controller = mine;
    let timedOut = false;
    // Race the request against the timeout: a provider that ignores the abort signal must not hang the chain either.
    const timeout = new Promise<never>((_, reject) => {
      guard = setTimeout(() => {
        guard = null;
        timedOut = true;
        mine.abort();
        reject(new Error('poll timeout'));
      }, POLL_TIMEOUT_MS);
    });
    try {
      const event = await Promise.race([opts.provider.get(opts.slug, mine.signal), timeout]);
      if (stopped || mine.signal.aborted) return;
      delay = POLL_INTERVAL_MS;
      if (event === null) {
        if (!gone) {
          gone = true;
          opts.onGone?.();
        }
      } else {
        gone = false;
        opts.onEvent(event);
      }
    } catch (error) {
      if (stopped) return;
      if (!timedOut && (mine.signal.aborted || isAbortError(error))) return;
      delay = Math.min(delay * 2, POLL_MAX_BACKOFF_MS);
    } finally {
      if (guard !== null) {
        clearTimeout(guard);
        guard = null;
      }
      inFlight = false;
      if (controller === mine) controller = null;
      if (!stopped && !orphaned()) schedule();
    }
  }

  function refreshNow(): void {
    if (stopped || orphaned()) return;
    if (inFlight) return;
    clearTimer();
    void poll();
  }

  function onVisibility(): void {
    if (stopped) return;
    if (document.hidden) {
      clearTimer();
      return;
    }
    refreshNow();
  }

  function onPageShow(event: Event): void {
    if ((event as PageTransitionEvent).persisted) refreshNow();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  schedule();

  return { stop, refreshNow };
}
