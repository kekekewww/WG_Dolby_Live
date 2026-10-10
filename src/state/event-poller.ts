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
    controller?.abort();
    controller = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
  };

  /** True (and stops) when the root left the document. */
  const orphaned = (): boolean => {
    if (opts.root.isConnected) return false;
    stop();
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
    try {
      const event = await opts.provider.get(opts.slug, mine.signal);
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
      if (stopped || mine.signal.aborted || isAbortError(error)) return;
      delay = Math.min(delay * 2, POLL_MAX_BACKOFF_MS);
    } finally {
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
