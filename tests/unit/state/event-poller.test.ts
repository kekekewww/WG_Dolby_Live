import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventProvider, PublicEvent } from '../../../src/types';
import { DETACHED_EVENT, POLL_INTERVAL_MS, POLL_MAX_BACKOFF_MS, POLL_TIMEOUT_MS, startEventPoller } from '../../../src/state/event-poller';
import type { EventPoller } from '../../../src/state/event-poller';
import { deferred, makeEvent } from './helpers';

let hidden = false;
let root: HTMLElement;
const pollers: EventPoller[] = [];

function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

interface Rig {
  poller: EventPoller;
  get: ReturnType<typeof vi.fn>;
  events: PublicEvent[];
  gone: ReturnType<typeof vi.fn>;
}

function rig(get: (slug: string, signal?: AbortSignal) => Promise<PublicEvent | null>): Rig {
  const getFn = vi.fn(get);
  const events: PublicEvent[] = [];
  const gone = vi.fn();
  const provider: EventProvider = { list: () => Promise.resolve([]), get: getFn };
  const poller = startEventPoller({ provider, slug: 'demo-live', root, onEvent: (e) => events.push(e), onGone: gone });
  pollers.push(poller);
  return { poller, get: getFn, events, gone };
}

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  for (const p of pollers.splice(0)) p.stop();
  root.remove();
  delete (document as unknown as Record<string, unknown>).hidden;
  vi.useRealTimers();
});

describe('event poller', () => {
  it('polls every 60 s with one timer chain and reports the event', async () => {
    const r = rig(() => Promise.resolve(makeEvent()));
    expect(r.get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(r.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.get).toHaveBeenCalledTimes(1);
    expect(r.get.mock.calls[0]?.[0]).toBe('demo-live');
    expect(r.events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('backs off after failures up to 5 min, and returns to 60 s after a success', async () => {
    let fail = true;
    const r = rig(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve(makeEvent())));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // fails -> next in 120 s
    expect(r.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(r.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // fails -> next in 240 s
    expect(r.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(240_000); // fails -> next in 300 s (cap)
    expect(r.get).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_MAX_BACKOFF_MS - 1);
    expect(r.get).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.get).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(POLL_MAX_BACKOFF_MS); // still capped
    expect(r.get).toHaveBeenCalledTimes(5);

    fail = false;
    await vi.advanceTimersByTimeAsync(POLL_MAX_BACKOFF_MS); // succeeds -> back to 60 s
    expect(r.get).toHaveBeenCalledTimes(6);
    expect(r.events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.get).toHaveBeenCalledTimes(7);
  });

  it('pauses while the document is hidden and refreshes at once when it becomes visible', async () => {
    const r = rig(() => Promise.resolve(makeEvent()));
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(r.get).not.toHaveBeenCalled();

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not poll when a timer fires while hidden, and resumes on visible', async () => {
    const r = rig(() => Promise.resolve(makeEvent()));
    hidden = true; // hidden without a visibilitychange event
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.get).not.toHaveBeenCalled();
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.get).toHaveBeenCalledTimes(1);
  });

  it('refreshes on a bfcache pageshow only', async () => {
    const r = rig(() => Promise.resolve(makeEvent()));
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.get).not.toHaveBeenCalled();
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.get).toHaveBeenCalledTimes(1);
  });

  it('refreshNow() polls immediately and never overlaps a request in flight', async () => {
    const pending = deferred<PublicEvent | null>();
    const r = rig(() => pending.promise);
    r.poller.refreshNow();
    r.poller.refreshNow();
    expect(r.get).toHaveBeenCalledTimes(1);
    pending.resolve(makeEvent());
    await vi.advanceTimersByTimeAsync(0);
    expect(r.events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('destroys itself when its root left the document', async () => {
    const r = rig(() => Promise.resolve(makeEvent()));
    root.remove();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    r.poller.refreshNow();
    expect(r.get).not.toHaveBeenCalled();
  });

  it('stops for good on stop(): aborts the request in flight and removes its listeners', async () => {
    let signal: AbortSignal | undefined;
    const r = rig((_slug, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    r.poller.refreshNow();
    expect(signal?.aborted).toBe(false);
    r.poller.stop();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(r.get).toHaveBeenCalledTimes(1);
    r.poller.stop(); // idempotent
  });

  it('reports a vanished event once and keeps polling in case it comes back', async () => {
    let answer: PublicEvent | null = null;
    const r = rig(() => Promise.resolve(answer));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.gone).toHaveBeenCalledTimes(1);
    answer = makeEvent();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.events).toHaveLength(1);
  });

  it('treats an abort rejection as no news (no backoff, no report)', async () => {
    const r = rig(() => Promise.reject(new DOMException('x', 'AbortError')));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.events).toHaveLength(0);
    expect(r.gone).not.toHaveBeenCalled();
  });
  it('PS-5: a request that never answers times out, backs off and polling continues', async () => {
    let hang = true;
    const r = rig((_slug, signal) => {
      if (!hang) return Promise.resolve(makeEvent({ title: 'recovered' }));
      void signal; // a provider that ignores the abort signal must not hang the chain either
      return new Promise<PublicEvent | null>(() => undefined);
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(r.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1); // only the guard
    await vi.advanceTimersByTimeAsync(1);
    // The hung request failed: next poll after the doubled delay (120 s), and refreshNow works again.
    expect(vi.getTimerCount()).toBe(1);
    hang = false;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 - 1);
    expect(r.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.get).toHaveBeenCalledTimes(2);
    expect(r.events.map((e) => e.title)).toEqual(['recovered']);
  });

  it('PS-5: refreshNow (visibilitychange) is not blocked forever by a hung request', async () => {
    let hang = true;
    const r = rig(() => (hang ? new Promise<PublicEvent | null>(() => undefined) : Promise.resolve(makeEvent())));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    r.poller.refreshNow(); // still in flight: ignored
    expect(r.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    hang = false;
    r.poller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.get).toHaveBeenCalledTimes(2);
    expect(r.events).toHaveLength(1);
  });

  it('PS-5: stop() clears the timeout guard of an in-flight request', async () => {
    const r = rig(() => new Promise<PublicEvent | null>(() => undefined));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(vi.getTimerCount()).toBe(1);
    r.poller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('PS-8: a detached root stops the poller and announces it on document, once', async () => {
    const seen = vi.fn();
    document.addEventListener(DETACHED_EVENT, seen);
    try {
      const r = rig(() => Promise.resolve(makeEvent()));
      root.remove();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(r.get).not.toHaveBeenCalled();
      expect(seen).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener(DETACHED_EVENT, seen);
    }
  });
});
