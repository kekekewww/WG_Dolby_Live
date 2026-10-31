import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSource } from '../../../src/types';
import {
  selectAnnouncement,
  selectCanStart,
  selectEntitlementPanel,
  selectErrorActions,
  selectGate,
  selectModeLabel,
  selectStatusMessage,
} from '../../../src/state/model';
import { pageRegistry } from '../../../src/state/page-registry';
import {
  deferred,
  createHarness,
  makeEvent,
  prepare,
  startPlaying,
  type Harness,
  type HarnessOptions,
} from './helpers';

const harnesses: Harness[] = [];

async function make(options: HarnessOptions = {}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

function setOnLine(value: boolean | null): void {
  if (value === null) {
    delete (navigator as unknown as Record<string, unknown>).onLine;
    return;
  }
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

function networkError(h: Harness): void {
  h.last().emit('error', { code: 'network', fatal: true });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const h of harnesses.splice(0)) h.destroy();
  setOnLine(null);
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('mount', () => {
  it('fetches the entitlement once and no media or playback data without a selected mode', async () => {
    const h = await make();
    expect(h.entitlement.calls).toHaveLength(1);
    expect(h.state().entitlement).toBe('entitled');
    expect(h.playback.calls).toHaveLength(0);
    expect(h.adapters).toHaveLength(0);
    expect(h.state().player.status).toBe('idle');
  });

  it('prefetches the descriptor of a preselected mode at creation', async () => {
    const h = await make({ preselect: 'atmos' });
    expect(h.playback.callsFor('atmos')).toHaveLength(1);
    expect(h.state().player.selectedMode).toBe('atmos');
    expect(h.state().player.preparedMode).toBe('atmos');
    expect(selectCanStart(h.state())).toBe(true);
    expect(h.adapters).toHaveLength(0); // never auto-starts
  });

  it('ignores a preselect the event does not offer', async () => {
    const h = await make({ event: makeEvent({ availableModes: ['binaural'] }), preselect: 'atmos' });
    expect(h.state().player.selectedMode).toBeNull();
    expect(h.playback.calls).toHaveLength(0);
  });

  it('makes no request and arms no timer when the deployment is disabled', async () => {
    const h = await make({ boot: { deploymentMode: 'disabled' }, preselect: 'binaural' });
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.entitlement.calls).toHaveLength(0);
    expect(h.playback.calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(selectGate(h.state()).kind).toBe('disabled');
    expect(selectCanStart(h.state())).toBe(false);
    await h.controller.start();
    expect(h.adapters).toHaveLength(0);
  });

  it('treats a not_configured event as gate 4: no entitlement, no descriptor, Start stays off', async () => {
    const h = await make({ event: makeEvent({ sourceKind: 'not_configured' }) });
    h.controller.selectMode('binaural');
    await h.flush();
    expect(selectGate(h.state()).kind).toBe('not_configured');
    expect(h.entitlement.calls).toHaveLength(0);
    expect(h.playback.calls).toHaveLength(0);
    expect(h.state().isDemoMedia).toBe(false);
    await h.controller.start();
    expect(h.adapters).toHaveLength(0);
  });

  it('flags demo media only for demo sources', async () => {
    const h = await make();
    expect(h.state().isDemoMedia).toBe(true);
    expect(h.state().source).toBe('demo');
  });

  it('reports "event not found" when there is no event', async () => {
    const h = await make({ event: null });
    expect(selectGate(h.state()).kind).toBe('not_found');
    expect(h.entitlement.calls).toHaveLength(0);
    h.controller.selectMode('binaural');
    expect(h.state().player.selectedMode).toBeNull();
  });
});

describe('start invariant and single adapter', () => {
  it('runs load() then play() synchronously inside start(), with no await in between', async () => {
    const h = await make();
    await prepare(h);
    const calls = vi.fn();
    h.log.length = 0;
    const started = h.controller.start();
    calls(h.log.filter((l) => !l.startsWith('create')));
    // Nothing was flushed between the start() call and this assertion.
    expect(calls).toHaveBeenCalledWith(['load#0', 'play#0']);
    await started;
    expect(h.adapters).toHaveLength(1);
    expect(h.adapters[0]?.sources[0]).toEqual({ kind: 'demo', url: '/media/binaural.mp3', mimeType: 'audio/mpeg' });
  });

  it('does not fetch anything on start (the descriptor was prefetched)', async () => {
    const h = await make();
    await prepare(h);
    const before = h.playback.calls.length;
    await h.controller.start();
    expect(h.playback.calls).toHaveLength(before);
  });

  it('requires preparedMode === selectedMode', async () => {
    const h = await make();
    const hold = h.playback.hold('binaural');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().player.preparedMode).toBeNull();
    expect(selectCanStart(h.state())).toBe(false);
    await h.controller.start();
    expect(h.adapters).toHaveLength(0);

    hold.resolve({ kind: 'demo', url: '/media/binaural.mp3', mimeType: 'audio/mpeg' });
    await h.flush();
    expect(h.state().player.preparedMode).toBe('binaural');
    await h.controller.start();
    expect(h.adapters).toHaveLength(1);
  });

  it('moves loading -> playing only on the adapter playing event and confirms the mode', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    let s = h.state();
    expect(s.player.status).toBe('loading');
    expect(s.player.loadedMode).toBe('binaural');
    expect(s.player.confirmedPlaying).toBe(false);
    expect(selectModeLabel(s)).toBe('已選擇：Binaural');

    h.last().emit('playing');
    s = h.state();
    expect(s.player.status).toBe('playing');
    expect(s.player.activeMode).toBe('binaural');
    expect(s.player.confirmedPlaying).toBe(true);
    expect(s.player.lastGoodMode).toBe('binaural');
    expect(selectModeLabel(s)).toBe('目前播放：Binaural');
    expect(h.remembered).toEqual(['binaural']);
  });

  it('copies the adapter capabilities only after load() resolved', async () => {
    const load = deferred<void>();
    const h = await make({ scripts: [{ load }] });
    await prepare(h);
    await h.controller.start();
    expect(h.state().capabilities).toBeNull();
    h.last().capabilities = { ...h.last().capabilities, volume: false, seekToLive: true };
    load.resolve();
    await h.flush();
    expect(h.state().capabilities).toMatchObject({ volume: false, seekToLive: true, mute: true });
  });

  it('F06: rapid Start clicks create one adapter', async () => {
    const h = await make();
    await prepare(h);
    const a = h.controller.start();
    const b = h.controller.start();
    const c = h.controller.start();
    await Promise.all([a, b, c]);
    expect(h.adapters).toHaveLength(1);
    expect(h.alive.size).toBe(1);
  });

  it('F06: a stale descriptor for an earlier selection never prepares the current one', async () => {
    const h = await make();
    const holdBinaural = h.playback.hold('binaural');
    const holdAtmos = h.playback.hold('atmos');
    h.controller.selectMode('binaural');
    h.controller.selectMode('atmos');
    holdAtmos.resolve({ kind: 'demo', url: '/media/atmos.mp3', mimeType: 'audio/mpeg' });
    await h.flush();
    expect(h.state().player.preparedMode).toBe('atmos');
    holdBinaural.resolve({ kind: 'demo', url: '/media/binaural.mp3', mimeType: 'audio/mpeg' });
    await h.flush();
    expect(h.state().player.selectedMode).toBe('atmos');
    expect(h.state().player.preparedMode).toBe('atmos');

    await h.controller.start();
    expect(h.last().sources[0]).toMatchObject({ url: '/media/atmos.mp3' });
  });

  it('F06: rapid switches leave exactly one live adapter, loaded with the last choice', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();

    h.log.length = 0;
    void h.controller.switchMode('atmos');
    void h.controller.switchMode('binaural');
    void h.controller.switchMode('atmos');
    await h.flush();

    expect(h.alive.size).toBe(1);
    expect(h.last().sources[0]).toMatchObject({ url: '/media/atmos.mp3' });
    // Every creation saw zero other live adapters: destroy(old) comes before the new adapter exists.
    expect(h.log.filter((l) => l.startsWith('create')).every((l) => l.endsWith('alive=0'))).toBe(true);
    // Superseded adapters are not listened to any more.
    for (const old of h.adapters.slice(0, -1)) expect(old.hasListeners).toBe(false);
    h.last().emit('playing');
    expect(h.state().player.status).toBe('playing');
    expect(h.state().player.activeMode).toBe('atmos');
  });

  it('F06: a stale resolve of an earlier switch is dropped', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    const holdAtmos = h.playback.hold('atmos'); // atmos is not cached: switch has to resolve
    void h.controller.switchMode('atmos');
    await h.flush();
    expect(h.state().player.status).toBe('switching');
    expect(h.alive.size).toBe(0); // the old media stopped first

    void h.controller.switchMode('binaural'); // cached: runs at once and supersedes
    await h.flush();
    expect(h.alive.size).toBe(1);
    const countBefore = h.adapters.length;
    holdAtmos.resolve({ kind: 'demo', url: '/media/atmos.mp3', mimeType: 'audio/mpeg' });
    await h.flush();
    expect(h.adapters).toHaveLength(countBefore);
    expect(h.state().player.pendingMode).toBe('binaural');
  });
});

describe('entitlement gating', () => {
  it.each(['guest', 'not_entitled'] as const)('%s: panel shown, Start disabled', async (status) => {
    const h = await make({ entitlement: { status }, preselect: 'binaural' });
    expect(h.state().entitlement).toBe(status);
    expect(selectEntitlementPanel(h.state())?.kind).toBe(status);
    expect(selectCanStart(h.state())).toBe(false);
    await h.controller.start();
    expect(h.adapters).toHaveLength(0);
  });

  it('unavailable: panel + retryEntitlement() re-fetches and can recover', async () => {
    const h = await make({ entitlement: { status: 'unavailable', reason: 'x' }, preselect: 'binaural' });
    expect(selectEntitlementPanel(h.state())?.kind).toBe('unavailable');
    expect(selectCanStart(h.state())).toBe(false);

    h.entitlement.answer = { status: 'entitled' };
    void h.controller.retryEntitlement();
    expect(h.state().entitlement).toBe('unknown');
    await h.flush();
    expect(h.entitlement.calls).toHaveLength(2);
    expect(h.state().entitlement).toBe('entitled');
    expect(selectCanStart(h.state())).toBe(true);
  });

  it('unknown while the answer is pending: no panel and Start disabled', async () => {
    const pending = deferred<{ status: 'entitled' }>();
    const g = await make({ preselect: 'binaural' });
    g.entitlement.hold = pending;
    await g.controller.retryEntitlement();
    await g.flush();
    expect(g.state().entitlement).toBe('unknown');
    expect(selectEntitlementPanel(g.state())).toBeNull();
    expect(selectCanStart(g.state())).toBe(false);
    pending.resolve({ status: 'entitled' });
    await g.flush();
    expect(g.state().entitlement).toBe('entitled');
  });

  it('a failing entitlement provider fails closed (unavailable)', async () => {
    const g = await make();
    g.entitlement.failWith = new Error('boom');
    await g.controller.retryEntitlement();
    await g.flush();
    expect(g.state().entitlement).toBe('unavailable');
  });

  it('refetches the entitlement when the event status changes', async () => {
    const h = await make({ event: makeEvent({ status: 'doors_open' }) });
    expect(h.entitlement.calls).toHaveLength(1);
    h.controller.updateEvent(makeEvent({ status: 'live' }));
    await h.flush();
    expect(h.entitlement.calls).toHaveLength(2);
    // ... but not for an unchanged status (a poll that found nothing new).
    h.controller.updateEvent(makeEvent({ status: 'live', title: 'renamed' }));
    await h.flush();
    expect(h.entitlement.calls).toHaveLength(2);
  });

  it('the server denying a prefetched mode flips the entitlement closed (never fails open)', async () => {
    const h = await make();
    h.playback.notReady('binaural', 'not_entitled');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().notReady).toBe('not_entitled');
    expect(h.state().entitlement).toBe('not_entitled');
    expect(selectCanStart(h.state())).toBe(false);
  });
});

describe('server not_ready and unsupported sources', () => {
  it('mode_unavailable disables Start for that mode and offers switch_mode; another mode clears it', async () => {
    const h = await make();
    h.playback.notReady('atmos', 'mode_unavailable');
    h.controller.selectMode('atmos');
    await h.flush();
    expect(h.state().notReady).toBe('mode_unavailable');
    expect(selectCanStart(h.state())).toBe(false);
    expect(selectErrorActions(h.state())).toEqual(['switch_mode']);
    expect(selectStatusMessage(h.state()).title).toBe('目前環境無法播放這個音訊版本');

    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().notReady).toBeNull();
    expect(selectCanStart(h.state())).toBe(true);
  });

  it('a source kind this build does not know is treated as not configured', async () => {
    const h = await make();
    h.playback.answers.set('binaural', { kind: 'dash', url: 'https://player.example/a.mpd' } as unknown as PlaybackSource);
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().notReady).toBe('source_not_configured');
    expect(h.state().source).toBe('not_configured');
    expect(selectGate(h.state()).kind).toBe('not_configured');
    await h.controller.start();
    expect(h.adapters).toHaveLength(0);
  });

  it('a prefetch network failure shows failed with a retry that fetches again', async () => {
    const h = await make();
    h.playback.failWith = new Error('offline');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().player.status).toBe('failed');
    expect(h.state().player.error).toMatchObject({ code: 'network', publicCode: 'E-NET-03' });
    expect(selectErrorActions(h.state())).toEqual(['retry']);

    h.playback.failWith = null;
    await h.controller.retry();
    await h.flush();
    expect(h.state().player.status).toBe('selecting');
    expect(h.state().player.preparedMode).toBe('binaural');
    expect(h.adapters).toHaveLength(0); // retry of a prefetch never starts playback
  });
});

describe('errors and bounded retries', () => {
  it('retries a network error after 2 s, 5 s and 10 s, then fails; a manual retry works again', async () => {
    const h = await make();
    await startPlaying(h);

    networkError(h);
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry).toEqual({ attempt: 1, max: 3 });
    expect(h.alive.size).toBe(0); // the failed adapter is gone while we wait
    await h.advance(1_999);
    expect(h.adapters).toHaveLength(1);
    await h.advance(1);
    expect(h.adapters).toHaveLength(2);
    expect(h.state().player.status).toBe('reconnecting');

    networkError(h);
    expect(h.state().player.retry).toEqual({ attempt: 2, max: 3 });
    await h.advance(4_999);
    expect(h.adapters).toHaveLength(2);
    await h.advance(1);
    expect(h.adapters).toHaveLength(3);

    networkError(h);
    expect(h.state().player.retry).toEqual({ attempt: 3, max: 3 });
    await h.advance(9_999);
    expect(h.adapters).toHaveLength(3);
    await h.advance(1);
    expect(h.adapters).toHaveLength(4);

    networkError(h);
    const s = h.state();
    expect(s.player.status).toBe('failed');
    expect(s.player.error).toEqual({ code: 'network', mode: 'binaural', publicCode: 'E-NET-01' });
    expect(s.player.retry).toBeNull();
    expect(vi.getTimerCount()).toBe(0); // no parallel timers left behind
    expect(selectErrorActions(s)).toEqual(['retry']);

    await h.advance(60_000);
    expect(h.adapters).toHaveLength(4); // nothing retries on its own any more

    await h.controller.retry();
    expect(h.adapters).toHaveLength(5);
    h.last().emit('playing');
    expect(h.state().player.status).toBe('playing');
  });

  it('remembers the mode once, even when the first attempts needed retries', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    networkError(h);
    await h.advance(2_000);
    networkError(h);
    await h.advance(5_000);
    expect(h.remembered).toEqual([]);
    h.last().emit('playing');
    expect(h.remembered).toEqual(['binaural']);
    h.last().emit('paused');
    h.last().emit('playing');
    expect(h.remembered).toEqual(['binaural']);
  });

  it('does not retry decode or unsupported errors', async () => {
    const h = await make();
    await startPlaying(h);
    h.last().emit('error', { code: 'decode', fatal: true });
    expect(h.state().player.status).toBe('failed');
    expect(h.state().player.error?.code).toBe('decode');
    expect(vi.getTimerCount()).toBe(0);

    const g = await make();
    await startPlaying(g);
    g.last().emit('error', { code: 'unsupported', fatal: true });
    expect(g.state().player.error).toMatchObject({ code: 'unsupported', publicCode: 'E-SRC-01' });
    expect(selectErrorActions(g.state())).toEqual(['switch_mode']);
  });

  it('does not retry an unknown error', async () => {
    const h = await make();
    await startPlaying(h);
    h.last().emit('error', { code: 'unknown', fatal: true });
    expect(h.state().player.error?.code).toBe('unknown');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts a media error event and the load() rejection of the same attempt once', async () => {
    const load = deferred<void>();
    const h = await make({ scripts: [{ load }] });
    await prepare(h);
    await h.controller.start();
    networkError(h);
    load.reject(Object.assign(new Error('x'), { detail: { code: 'network', fatal: true } }));
    await h.flush();
    expect(h.state().player.retry).toEqual({ attempt: 1, max: 3 });
    expect(vi.getTimerCount()).toBe(1); // one retry timer
  });

  it('classifies a play() NotSupportedError at HAVE_NOTHING as network, and as unsupported without codec support', async () => {
    const h = await make({ scripts: [{ play: 'unsupported' }] });
    await prepare(h);
    await h.controller.start();
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry?.attempt).toBe(1);

    const g = await make({ scripts: [{ play: 'unsupported' }] });
    g.host.media.canPlayType = () => '';
    await prepare(g);
    await g.controller.start();
    expect(g.state().player.status).toBe('failed');
    expect(g.state().player.error?.code).toBe('unsupported');
  });

  it('AbortError from play() is benign: no error, no retry, the state follows the interrupting action', async () => {
    const h = await make({ scripts: [{ play: 'abort' }] });
    await prepare(h);
    await h.controller.start();
    await h.flush();
    expect(h.state().player.status).toBe('loading');
    expect(h.state().player.error).toBeNull();
    expect(h.state().player.retry).toBeNull();
    h.last().emit('playing');
    expect(h.state().player.status).toBe('playing');
  });

  it('an aborted load() (superseded) is benign too', async () => {
    const h = await make({ scripts: [{ load: new DOMException('aborted', 'AbortError') }] });
    await prepare(h);
    await h.controller.start();
    await h.flush();
    expect(h.state().player.error).toBeNull();
    expect(h.state().player.status).toBe('loading');
  });

  it('an unknown error while offline is a network error (retried), and `online` retries early', async () => {
    setOnLine(false);
    const h = await make();
    await startPlaying(h);
    h.last().emit('error', { code: 'unknown', fatal: true });
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry?.attempt).toBe(1);
    expect(h.adapters).toHaveLength(1);

    setOnLine(true);
    window.dispatchEvent(new Event('online'));
    expect(h.adapters).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0 + 1); // only the watchdog of the new attempt
    await h.advance(10_000);
    expect(h.adapters).toHaveLength(2); // the 2 s timer did not fire a second attempt
  });

  it('tolerates fatal:false library errors for 15 s, then treats them as the network error they are', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    h.last().emit('error', { code: 'network', fatal: false });
    await h.advance(14_500);
    expect(h.state().player.status).toBe('loading');
    await h.advance(1_000);
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry?.attempt).toBe(1);
  });
});

describe('play_blocked', () => {
  it('pauses with play_blocked, keeps the adapter, arms no timers and never retries', async () => {
    const h = await make({ scripts: [{ play: 'blocked' }] });
    await prepare(h);
    await h.controller.start();
    await h.flush();
    const s = h.state();
    expect(s.player.status).toBe('paused');
    expect(s.player.error).toEqual({ code: 'play_blocked', mode: 'binaural', publicCode: 'E-PLY-01' });
    expect(selectStatusMessage(s).title).toBe('請點擊開始聆聽');
    expect(selectAnnouncement(s)).toBe('請點擊開始聆聽');
    expect(h.alive.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await h.advance(60_000);
    expect(h.adapters).toHaveLength(1);
  });

  it('resume calls adapter.play() directly: no new descriptor, no new adapter', async () => {
    const h = await make({ scripts: [{ play: 'blocked' }] });
    await prepare(h);
    await h.controller.start();
    await h.flush();
    const callsBefore = h.playback.calls.length;
    const adapter = h.last();
    // The next play() works (the user gesture unlocked the element).
    (adapter as unknown as { script: { play: string } }).script = { play: 'resolve' };

    await h.controller.togglePlay();
    expect(adapter.playCalls).toBe(2);
    expect(h.playback.calls).toHaveLength(callsBefore);
    expect(h.adapters).toHaveLength(1);
    expect(h.state().player.status).toBe('loading');
    adapter.emit('playing');
    expect(h.state().player.status).toBe('playing');
    expect(h.state().player.error).toBeNull();
  });

  it('a second block keeps the player on the play_blocked pause', async () => {
    const h = await make({ scripts: [{ play: 'blocked' }] });
    await prepare(h);
    await h.controller.start();
    await h.flush();
    await h.controller.togglePlay();
    await h.flush();
    expect(h.state().player.status).toBe('paused');
    expect(h.state().player.error?.code).toBe('play_blocked');
    expect(h.last().playCalls).toBe(2);
  });
});

describe('watchdog', () => {
  it('goes reconnecting after 3 s without progress, recovers on progress, and fails the network after 15 s', async () => {
    const h = await make();
    await startPlaying(h);
    expect(vi.getTimerCount()).toBe(1); // the one watchdog interval

    h.setTime(10);
    await h.advance(2_000); // time keeps moving: no stall
    h.setTime(11);
    await h.advance(2_000);
    expect(h.state().player.status).toBe('playing');

    await h.advance(3_000); // frozen
    expect(h.state().player.status).toBe('reconnecting');
    expect(selectAnnouncement(h.state())).toBe('連線暫時中斷，正在重新連線');

    // Sound comes back by itself.
    h.setTime(12);
    await h.advance(500);
    expect(h.state().player.status).toBe('playing');

    // Frozen for good: 3 s -> reconnecting, 15 s since the last progress -> network error -> retry 1.
    await h.advance(3_000);
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry).toBeNull();
    await h.advance(12_500);
    expect(h.state().player.retry).toEqual({ attempt: 1, max: 3 });
    expect(h.alive.size).toBe(0);
  });

  it('the 15 s stall error consumes one retry and ends in failed with E-NET-02 after the budget', async () => {
    const h = await make();
    await startPlaying(h);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await h.advance(15_000);
      expect(h.state().player.retry).toEqual({ attempt, max: 3 });
      await h.advance(attempt === 1 ? 2_000 : attempt === 2 ? 5_000 : 10_000);
      h.last().emit('playing');
      expect(h.state().player.status).toBe('playing');
    }
    await h.advance(15_000);
    expect(h.state().player.status).toBe('failed');
    expect(h.state().player.error?.publicCode).toBe('E-NET-02');
  });

  it('times out a load after 20 s (network error, one retry consumed)', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    await h.advance(19_500);
    expect(h.state().player.status).toBe('loading');
    await h.advance(500);
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry?.attempt).toBe(1);
  });

  it('is never armed while paused', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    expect(vi.getTimerCount()).toBe(1);
    await h.controller.togglePlay();
    expect(adapter.pauseCalls).toBe(1);
    expect(h.state().player.status).toBe('paused');
    expect(vi.getTimerCount()).toBe(0);
    await h.advance(60_000);
    expect(h.state().player.status).toBe('paused'); // a frozen clock while paused is not a stall
  });

  it('resets the retry budget only after 30 s of continuous playback', async () => {
    const h = await make();
    await startPlaying(h);
    networkError(h);
    await h.advance(2_000);
    networkError(h);
    await h.advance(5_000);
    expect(h.state().player.retry?.attempt).toBe(2);
    h.last().emit('playing');

    for (let i = 1; i <= 28; i += 1) {
      h.setTime(i);
      await h.advance(1_000);
    }
    networkError(h);
    // 28 s of playback is not enough: this is attempt 3.
    expect(h.state().player.retry?.attempt).toBe(3);
    await h.advance(10_000);
    h.last().emit('playing');
    for (let i = 100; i <= 135; i += 1) {
      h.setTime(i);
      await h.advance(1_000);
    }
    networkError(h);
    expect(h.state().player.retry?.attempt).toBe(1);
  });

  it('uses no timers when the player is idle', async () => {
    const h = await make();
    await prepare(h);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pause, resume, mute and external events', () => {
  it('pauses and resumes the same adapter', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    await h.controller.togglePlay();
    expect(h.state().player.status).toBe('paused');
    expect(h.state().player.confirmedPlaying).toBe(true);
    await h.controller.togglePlay();
    expect(adapter.playCalls).toBe(2);
    expect(h.state().player.status).toBe('loading');
    adapter.emit('playing');
    expect(h.state().player.status).toBe('playing');
    expect(h.adapters).toHaveLength(1);
  });

  it('pause is unavailable while loading and while switching', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    await h.controller.togglePlay();
    expect(h.last().pauseCalls).toBe(0);
    expect(h.state().player.status).toBe('loading');

    h.last().emit('playing');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    expect(h.state().player.status).toBe('switching');
    await h.controller.togglePlay();
    expect(h.last().pauseCalls).toBe(0);
    expect(h.state().player.status).toBe('switching');
  });

  it('an external pause (lock screen, headset) pauses the state; it is ignored while loading', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    h.last().emit('paused');
    expect(h.state().player.status).toBe('loading');
    h.last().emit('playing');
    h.last().emit('paused');
    expect(h.state().player.status).toBe('paused');
    h.last().emit('playing'); // resumed outside the player
    expect(h.state().player.status).toBe('playing');
  });

  it('demo sources loop: an ended event changes nothing', async () => {
    const h = await make();
    await startPlaying(h);
    h.last().emit('ended');
    expect(h.state().player.status).toBe('playing');
    expect(h.state().player.confirmedPlaying).toBe(true);
  });

  it('keeps mute and volume in state and applies them to every new adapter', async () => {
    const h = await make();
    const first = await startPlaying(h);
    h.controller.setMuted(true);
    h.controller.setVolume(0.4);
    expect(first.mutedCalls.at(-1)).toBe(true);
    expect(first.volumeCalls.at(-1)).toBe(0.4);
    expect(h.state().player).toMatchObject({ muted: true, volume: 0.4 });

    h.controller.prepareSwitch('atmos');
    await h.flush();
    await h.controller.switchMode('atmos');
    expect(h.last().mutedCalls).toContain(true);
    expect(h.last().volumeCalls).toContain(0.4);
    h.controller.setVolume(7);
    expect(h.state().player.volume).toBe(1);
  });

  it('seekToLive only reaches the adapter when the capability exists', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    h.controller.seekToLive();
    expect(adapter.seekCalls).toBe(0);
  });
});

describe('stop()', () => {
  it('resets playback, keeps the selection, clears timers and aborts action fetches', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    h.controller.stop();
    const s = h.state();
    expect(adapter.destroyed).toBe(true);
    expect(s.player).toMatchObject({
      status: 'selecting',
      selectedMode: 'binaural',
      activeMode: null,
      loadedMode: null,
      confirmedPlaying: false,
      retry: null,
      error: null,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(selectCanStart(s)).toBe(true); // can start again right away (descriptor cached)
  });

  it('goes to idle when nothing is selected', async () => {
    const h = await make();
    h.controller.stop();
    expect(h.state().player.status).toBe('idle');
  });

  it('during a retry wait: no further load happens', async () => {
    const h = await make();
    await startPlaying(h);
    networkError(h);
    expect(vi.getTimerCount()).toBe(1);
    h.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
    await h.advance(60_000);
    expect(h.adapters).toHaveLength(1);
    expect(h.state().player.status).toBe('selecting');
  });

  it('removes the `online` listener it added for a retry', async () => {
    setOnLine(false);
    const h = await make();
    await startPlaying(h);
    h.last().emit('error', { code: 'unknown', fatal: true });
    h.controller.stop();
    setOnLine(true);
    window.dispatchEvent(new Event('online'));
    expect(h.adapters).toHaveLength(1);
  });

  it('drops the result of an in-flight resolve started before it', async () => {
    const h = await make();
    await startPlaying(h);
    const hold = h.playback.hold('atmos');
    void h.controller.switchMode('atmos');
    await h.flush();
    h.controller.stop();
    hold.resolve({ kind: 'demo', url: '/media/atmos.mp3', mimeType: 'audio/mpeg' });
    await h.flush();
    expect(h.adapters).toHaveLength(1);
    expect(h.state().player.status).toBe('selecting');
  });

  it('is what pagehide uses: calling it on an idle or stopped controller is harmless', async () => {
    const h = await make();
    h.controller.stop();
    h.controller.stop();
    expect(h.state().player.status).toBe('idle');
  });
});

describe('switching modes', () => {
  it('prepareSwitch prefetches the other mode without touching the state', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    const before = h.state();
    h.controller.prepareSwitch('atmos');
    await h.flush();
    expect(h.playback.callsFor('atmos')).toHaveLength(1);
    expect(h.state()).toBe(before);
    h.controller.prepareSwitch('atmos'); // cached: no second request
    await h.flush();
    expect(h.playback.callsFor('atmos')).toHaveLength(1);
  });

  it('success: 目前播放 changes only after the new source plays', async () => {
    const h = await make();
    const first = await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();

    const p = h.controller.switchMode('atmos');
    // Same call stack: old adapter destroyed, new one loaded and playing was called.
    expect(first.destroyed).toBe(true);
    expect(h.last().playCalls).toBe(1);
    let s = h.state();
    expect(s.player.status).toBe('switching');
    expect(s.player.pendingMode).toBe('atmos');
    expect(s.player.confirmedPlaying).toBe(false);
    expect(s.player.activeMode).toBe('binaural');
    expect(selectModeLabel(s)).toBe('已選擇：Dolby Atmos 音軌');
    await p;

    h.last().emit('playing');
    s = h.state();
    expect(s.player).toMatchObject({
      status: 'playing',
      activeMode: 'atmos',
      selectedMode: 'atmos',
      lastGoodMode: 'atmos',
      pendingMode: null,
      confirmedPlaying: true,
    });
    expect(selectModeLabel(s)).toBe('目前播放：Dolby Atmos 音軌');
    expect(h.remembered).toEqual(['binaural', 'atmos']);
    expect(h.alive.size).toBe(1);
  });

  it('switching to the mode that already plays, or to one the event does not offer, does nothing', async () => {
    const h = await make({ event: makeEvent({ availableModes: ['binaural'] }) });
    await startPlaying(h, 'binaural');
    await h.controller.switchMode('binaural');
    await h.controller.switchMode('atmos');
    expect(h.adapters).toHaveLength(1);
    expect(h.state().player.status).toBe('playing');
  });

  it('a duplicate click during switching is ignored', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    void h.controller.switchMode('atmos');
    expect(h.adapters).toHaveLength(2);
  });

  it('failure keeps lastGoodMode, offers reload and (for Atmos) the Binaural fallback; the track never changes silently', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    h.last().emit('error', { code: 'decode', fatal: true });

    const s = h.state();
    expect(s.player.status).toBe('failed');
    expect(s.player.error).toMatchObject({ code: 'decode', mode: 'atmos' });
    expect(s.player.lastGoodMode).toBe('binaural');
    expect(s.player.activeMode).toBe('binaural');
    expect(s.player.selectedMode).toBe('binaural');
    expect(s.player.confirmedPlaying).toBe(false);
    expect(selectErrorActions(s)).toEqual(['retry', 'reload_last_good', 'fallback_binaural']);
    expect(selectAnnouncement(s)).toBe('切換失敗，仍保留原模式：Binaural');
    expect(h.alive.size).toBe(0);
  });

  it('reloadLastGood() plays the previous mode again', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    h.last().emit('error', { code: 'decode', fatal: true });

    await h.controller.reloadLastGood();
    expect(h.last().sources[0]).toMatchObject({ url: '/media/binaural.mp3' });
    expect(h.state().player.status).toBe('switching');
    h.last().emit('playing');
    expect(h.state().player).toMatchObject({ status: 'playing', activeMode: 'binaural', selectedMode: 'binaural', error: null });
  });

  it('a failed switch is retried as a switch (manual retry of the last attempted mode)', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    h.last().emit('error', { code: 'decode', fatal: true });
    await h.controller.retry();
    expect(h.last().sources[0]).toMatchObject({ url: '/media/atmos.mp3' });
    expect(h.state().player.pendingMode).toBe('atmos');
  });

  it('network failure of an Atmos switch is retried, then fails; the Binaural fallback works', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    networkError(h);
    expect(h.state().player.status).toBe('switching'); // still a switch while it is retried
    expect(h.state().player.retry?.attempt).toBe(1);
    await h.advance(2_000);
    networkError(h);
    await h.advance(5_000);
    networkError(h);
    await h.advance(10_000);
    networkError(h);
    expect(h.state().player.status).toBe('failed');
    expect(selectErrorActions(h.state())).toContain('fallback_binaural');

    await h.controller.switchMode('binaural');
    h.last().emit('playing');
    expect(h.state().player).toMatchObject({ status: 'playing', activeMode: 'binaural' });
  });

  it('an Atmos failure on the first start offers the Binaural fallback', async () => {
    const h = await make();
    await prepare(h, 'atmos');
    await h.controller.start();
    h.last().emit('error', { code: 'decode', fatal: true });
    expect(h.state().player.status).toBe('failed');
    expect(selectErrorActions(h.state())).toEqual(['retry', 'fallback_binaural']);

    await h.controller.switchMode('binaural');
    h.last().emit('playing');
    expect(h.state().player).toMatchObject({ status: 'playing', activeMode: 'binaural', selectedMode: 'binaural' });
  });

  it('switching to an uncached mode resolves first, then loads', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    expect(h.playback.callsFor('atmos')).toHaveLength(0);
    await h.controller.switchMode('atmos');
    expect(h.state().player.status).toBe('switching');
    await h.flush();
    expect(h.playback.callsFor('atmos')).toHaveLength(1);
    expect(h.last().sources[0]).toMatchObject({ url: '/media/atmos.mp3' });
  });

  it('a server denial while resolving for a switch fails the switch with the matching code', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.playback.notReady('atmos', 'mode_unavailable');
    await h.controller.switchMode('atmos');
    await h.flush();
    expect(h.state().player.status).toBe('failed');
    expect(h.state().player.error).toMatchObject({ code: 'unsupported', mode: 'atmos' });
    expect(h.state().player.lastGoodMode).toBe('binaural');
  });
});

describe('event status changes (updateEvent)', () => {
  it.each(['ended', 'cancelled'] as const)('-> %s while playing stops playback and shows the gate', async (status) => {
    const h = await make();
    const adapter = await startPlaying(h);
    const entitlementCalls = h.entitlement.calls.length;
    h.controller.updateEvent(makeEvent({ status }));
    await h.flush();
    expect(adapter.destroyed).toBe(true);
    expect(h.state().player.status).toBe('selecting');
    expect(h.state().player.selectedMode).toBe('binaural');
    expect(selectGate(h.state()).kind).toBe(status);
    expect(selectCanStart(h.state())).toBe(false);
    expect(h.entitlement.calls).toHaveLength(entitlementCalls); // gates 0-4: no entitlement request
    expect(selectAnnouncement(h.state())).toBe(status === 'ended' ? '活動狀態更新：已結束' : '活動狀態更新：已取消');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('-> scheduled while playing stops, disables Start and keeps the selection', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    h.controller.updateEvent(makeEvent({ status: 'scheduled' }));
    expect(adapter.destroyed).toBe(true);
    expect(h.state().player.selectedMode).toBe('binaural');
    expect(selectGate(h.state()).kind).toBe('scheduled');
    expect(selectCanStart(h.state())).toBe(false);
  });

  it('-> doors_open while loading stops the load', async () => {
    const h = await make();
    await prepare(h);
    await h.controller.start();
    expect(h.state().player.status).toBe('loading');
    h.controller.updateEvent(makeEvent({ status: 'doors_open' }));
    expect(h.state().player.status).toBe('selecting');
    expect(h.alive.size).toBe(0);
  });

  it('-> doors_open while only selecting keeps the selection and starts nothing', async () => {
    const h = await make();
    await prepare(h);
    h.controller.updateEvent(makeEvent({ status: 'doors_open' }));
    expect(h.state().player.status).toBe('selecting');
    expect(selectCanStart(h.state())).toBe(false);
    expect(h.adapters).toHaveLength(0);
  });

  it('live <-> intermission changes nothing about the adapter', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    h.controller.updateEvent(makeEvent({ status: 'intermission' }));
    expect(adapter.destroyed).toBe(false);
    expect(adapter.destroyCount).toBe(0);
    expect(h.state().player.status).toBe('playing');
    expect(selectGate(h.state())).toEqual({ kind: 'open', intermission: true });
    expect(selectStatusMessage(h.state()).detail).toBe('演出中場休息');
    h.controller.updateEvent(makeEvent({ status: 'live' }));
    expect(adapter.destroyCount).toBe(0);
    expect(h.state().player.status).toBe('playing');
    expect(h.adapters).toHaveLength(1);
  });

  it('doors_open -> live enables Start without starting anything', async () => {
    const h = await make({ event: makeEvent({ status: 'doors_open' }), preselect: 'atmos' });
    expect(h.state().player.preparedMode).toBe('atmos');
    expect(selectCanStart(h.state())).toBe(false);

    h.controller.updateEvent(makeEvent({ status: 'live' }));
    await h.flush();
    expect(selectCanStart(h.state())).toBe(true);
    expect(h.adapters).toHaveLength(0);
    expect(selectAnnouncement(h.state())).toBe('活動狀態更新：演出中');
  });

  it('re-asks the server after a status change that turned a denial into a possible start', async () => {
    const h = await make({ event: makeEvent({ status: 'scheduled', isDemo: false }) });
    h.playback.notReady('binaural', 'event_not_playable');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().notReady).toBe('event_not_playable');

    h.playback.answers.delete('binaural');
    h.controller.updateEvent(makeEvent({ status: 'live', isDemo: false }));
    await h.flush();
    expect(h.state().notReady).toBeNull();
    expect(h.state().player.preparedMode).toBe('binaural');
    expect(selectCanStart(h.state())).toBe(true);
  });

  it('ignores a snapshot of another event', async () => {
    const h = await make();
    h.controller.updateEvent(makeEvent({ id: 999, slug: 'other', status: 'ended' }));
    expect(h.state().event.status).toBe('live');
  });

  it('drops the selection when the event no longer offers that mode (not while playing)', async () => {
    const h = await make();
    await prepare(h, 'atmos');
    h.controller.updateEvent(makeEvent({ availableModes: ['binaural'] }));
    expect(h.state().player.selectedMode).toBeNull();
    expect(h.state().player.status).toBe('idle');
  });
});

describe('one player per page', () => {
  it('stops the other controller when this one starts loading', async () => {
    const a = await make();
    const b = await make();
    expect(pageRegistry.size()).toBeGreaterThanOrEqual(2);
    const adapterA = await startPlaying(a);
    expect(a.state().player.status).toBe('playing');

    await prepare(b);
    await b.controller.start();
    expect(adapterA.destroyed).toBe(true);
    expect(a.state().player.status).toBe('selecting');
    expect(b.state().player.status).toBe('loading');
  });

  it('unregisters on destroy', async () => {
    const before = pageRegistry.size();
    const a = await make();
    expect(pageRegistry.size()).toBe(before + 1);
    a.destroy();
    harnesses.splice(harnesses.indexOf(a), 1);
    expect(pageRegistry.size()).toBe(before);
  });
});

describe('dev controls', () => {
  it('are null unless boot.devTools is true', async () => {
    const h = await make();
    expect(h.controller.dev).toBeNull();
    const g = await make({ boot: { devTools: true } });
    expect(g.controller.dev).not.toBeNull();
  });

  it('setEventStatus simulates a status, applies the stop rules, and null restores the real one', async () => {
    const h = await make({ boot: { devTools: true } });
    const adapter = await startPlaying(h);
    h.controller.dev?.setEventStatus('ended');
    expect(adapter.destroyed).toBe(true);
    expect(h.state().event).toMatchObject({ status: 'ended', simulated: true });
    expect(selectGate(h.state()).kind).toBe('ended');

    h.controller.dev?.setEventStatus(null);
    await h.flush();
    expect(h.state().event).toMatchObject({ status: 'live', simulated: false });
    expect(selectCanStart(h.state())).toBe(true);
  });

  it('an override survives a poll that reports the real status', async () => {
    const h = await make({ boot: { devTools: true } });
    h.controller.dev?.setEventStatus('doors_open');
    h.controller.updateEvent(makeEvent({ status: 'live', title: 'fresh' }));
    expect(h.state().event.status).toBe('doors_open');
    expect(h.state().event.data?.title).toBe('fresh');
  });

  it('setEntitlement changes the display only: no request, null re-fetches the real answer', async () => {
    const h = await make({ boot: { devTools: true }, preselect: 'binaural' });
    const calls = h.entitlement.calls.length;
    h.controller.dev?.setEntitlement('guest');
    expect(h.state().entitlement).toBe('guest');
    expect(selectCanStart(h.state())).toBe(false);
    expect(h.entitlement.calls).toHaveLength(calls);

    h.controller.dev?.setEntitlement(null);
    await h.flush();
    expect(h.state().entitlement).toBe('entitled');
    expect(h.entitlement.calls).toHaveLength(calls + 1);
  });

  it('setEntitlement is ignored for events that are not demos', async () => {
    const h = await make({ boot: { devTools: true }, event: makeEvent({ isDemo: false }) });
    h.controller.dev?.setEntitlement('guest');
    expect(h.state().entitlement).toBe('entitled');
  });

  it('injectFault(network) fails only the next attempt: it retries and then works', async () => {
    const h = await make({ boot: { devTools: true } });
    await prepare(h);
    h.controller.dev?.injectFault('network');
    await h.controller.start();
    await h.flush();
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry?.attempt).toBe(1);
    await h.advance(2_000);
    expect(h.adapters).toHaveLength(2);
    expect(h.last().sources).toHaveLength(1); // the fault was consumed: this load is real
    h.last().emit('playing');
    expect(h.state().player.status).toBe('playing');
  });

  it('injectFault(decode / unsupported) fail without retry', async () => {
    const h = await make({ boot: { devTools: true } });
    await prepare(h);
    h.controller.dev?.injectFault('decode');
    await h.controller.start();
    await h.flush();
    expect(h.state().player.error?.code).toBe('decode');

    const g = await make({ boot: { devTools: true } });
    await prepare(g);
    g.controller.dev?.injectFault('unsupported');
    await g.controller.start();
    await g.flush();
    expect(g.state().player.error?.code).toBe('unsupported');
  });

  it('injectFault(play_blocked) pauses with play_blocked and resume then works', async () => {
    const h = await make({ boot: { devTools: true } });
    await prepare(h);
    h.controller.dev?.injectFault('play_blocked');
    await h.controller.start();
    await h.flush();
    expect(h.state().player.status).toBe('paused');
    expect(h.state().player.error?.code).toBe('play_blocked');
    await h.controller.togglePlay();
    h.last().emit('playing');
    expect(h.state().player.status).toBe('playing');
  });

  it('injectFault(null) clears a pending fault', async () => {
    const h = await make({ boot: { devTools: true } });
    await prepare(h);
    h.controller.dev?.injectFault('decode');
    h.controller.dev?.injectFault(null);
    await h.controller.start();
    expect(h.state().player.status).toBe('loading');
  });
});

describe('destroy and lifecycle', () => {
  it('releases the adapter, clears every timer and aborts in-flight fetches', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    const entitlementHold = deferred<{ status: 'entitled' }>();
    h.entitlement.hold = entitlementHold;
    await h.controller.retryEntitlement();
    const signal = h.entitlement.calls.at(-1)?.signal;
    expect(signal?.aborted).toBe(false);

    h.controller.destroy();
    expect(adapter.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(signal?.aborted).toBe(true);
    await h.controller.start();
    h.controller.selectMode('atmos');
    expect(h.adapters).toHaveLength(1);
    h.controller.destroy(); // idempotent
  });

  it('destroys itself on the next tick when its root left the document', async () => {
    const h = await make();
    const adapter = await startPlaying(h);
    h.root.remove();
    await h.advance(500);
    expect(adapter.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry when its root left the document during the wait', async () => {
    const h = await make();
    await startPlaying(h);
    networkError(h);
    h.root.remove();
    await h.advance(2_000);
    expect(h.adapters).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('notifies subscribers on change only, and survives a throwing subscriber', async () => {
    const h = await make();
    const seen: string[] = [];
    h.controller.subscribe(() => {
      throw new Error('bad subscriber');
    });
    const off = h.controller.subscribe((s) => seen.push(s.player.status));
    h.controller.selectMode('binaural');
    expect(seen).toEqual(['selecting']);
    h.controller.selectMode('binaural'); // no change
    expect(seen).toEqual(['selecting']);
    off();
    h.controller.selectMode('atmos');
    expect(seen).toEqual(['selecting']);
  });

  it('selectMode is a no-op while playback is active (use switchMode)', async () => {
    const h = await make();
    await startPlaying(h);
    h.controller.selectMode('atmos');
    expect(h.state().player.selectedMode).toBe('binaural');
  });
});
