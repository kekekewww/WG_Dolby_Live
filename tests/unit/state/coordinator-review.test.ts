/**
 * Regression tests for the review findings PS-1 ... PS-7, spec F7 and the selector side of UI-03
 * (docs/implementation/reports/review-playback-state.md). Each test names the finding it pins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntitlementPlaceholder } from '../../../src/adapters/entitlement-placeholder';
import { DESCRIPTOR_TIMEOUT_MS } from '../../../src/state/coordinator';
import { selectCanStart, selectErrorActions, selectGate, selectSwitchTarget } from '../../../src/state/model';
import { createHarness, makeEvent, prepare, startPlaying, type Harness, type HarnessOptions } from './helpers';

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const h of harnesses.splice(0)) h.destroy();
  setOnLine(null);
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('PS-1: an uncached switch/retry/reload has a way out', () => {
  it('a switch whose descriptor never answers fails with E-NET-03 and offers retry instead of staying on switching', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.playback.hold('atmos'); // /playback stalls
    const p = h.controller.switchMode('atmos');
    expect(h.state().player.status).toBe('switching');
    expect(h.alive.size).toBe(0); // the old audio is already torn down

    await h.advance(DESCRIPTOR_TIMEOUT_MS - 1);
    expect(h.state().player.status).toBe('switching');
    await h.advance(1);
    await p;
    const s = h.state();
    expect(s.player.status).toBe('failed');
    expect(s.player.error).toEqual({ code: 'network', mode: 'atmos', publicCode: 'E-NET-03' });
    expect(selectErrorActions(s)).toEqual(['retry', 'reload_last_good', 'fallback_binaural']);
    expect(h.playback.callsFor('atmos')[0]?.signal?.aborted).toBe(true); // the stalled request was cancelled
    expect(vi.getTimerCount()).toBe(0);

    // The manual retry asks again and plays.
    const retried = h.controller.retry();
    await h.flush();
    await retried;
    expect(h.playback.callsFor('atmos')).toHaveLength(2);
    h.last().emit('playing');
    expect(h.state().player).toMatchObject({ status: 'playing', activeMode: 'atmos' });
  });

  it('an answer that arrives in time clears the timer', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    const hold = h.playback.hold('atmos');
    const p = h.controller.switchMode('atmos');
    await h.advance(DESCRIPTOR_TIMEOUT_MS - 1);
    hold.resolve({ kind: 'demo', url: '/media/atmos.mp3', mimeType: 'audio/mpeg' });
    await h.flush();
    await p;
    expect(h.adapters).toHaveLength(2);
    expect(h.state().player.status).toBe('switching');
    await h.advance(60_000);
    expect(h.state().player.status).toBe('switching'); // no late timeout failure
  });

  it('stop() and destroy() leave no timer behind while a descriptor is pending', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.playback.hold('atmos');
    void h.controller.switchMode('atmos');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
    await h.advance(DESCRIPTOR_TIMEOUT_MS * 2);
    expect(h.state().player.status).toBe('selecting'); // the stale timeout did not fail the stopped player

    const g = await make();
    await startPlaying(g, 'binaural');
    g.playback.hold('atmos');
    void g.controller.switchMode('atmos');
    g.controller.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PS-4: a prefetch that never settles is not final', () => {
  it('times out into 重試 for the selected mode, and the retry asks again', async () => {
    const h = await make();
    h.playback.hold('binaural');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.playback.callsFor('binaural')).toHaveLength(1);
    expect(selectCanStart(h.state())).toBe(false);

    h.controller.selectMode('binaural'); // re-click while pending: deduped
    await h.advance(DESCRIPTOR_TIMEOUT_MS);
    const s = h.state();
    expect(s.player.status).toBe('failed');
    expect(s.player.error).toMatchObject({ code: 'network', mode: 'binaural', publicCode: 'E-NET-03' });
    expect(selectErrorActions(s)).toContain('retry');

    await h.controller.retry();
    await h.flush();
    expect(h.playback.callsFor('binaural')).toHaveLength(2);
    expect(h.state().player.status).toBe('selecting');
    expect(selectCanStart(h.state())).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a stalled prefetch of the other mode can be issued again afterwards', async () => {
    const h = await make();
    await startPlaying(h, 'binaural');
    h.playback.hold('atmos');
    h.controller.prepareSwitch('atmos');
    h.controller.prepareSwitch('atmos');
    expect(h.playback.callsFor('atmos')).toHaveLength(1);
    await h.advance(DESCRIPTOR_TIMEOUT_MS);
    h.controller.prepareSwitch('atmos');
    await h.flush();
    expect(h.playback.callsFor('atmos')).toHaveLength(2);
    expect(h.state().player.error).toBeNull(); // a background prefetch never fails or disturbs playback
    expect(h.alive.size).toBe(1);
  });
});

describe('PS-2: no automatic play() while the user has paused', () => {
  it('a network error while paused creates no adapter and never plays, online or not', async () => {
    const h = await make();
    const first = await startPlaying(h);
    await h.controller.togglePlay();
    expect(h.state().player.status).toBe('paused');

    setOnLine(false);
    first.emit('error', { code: 'network', fatal: true });
    window.dispatchEvent(new Event('online'));
    await h.advance(60_000);

    expect(h.adapters).toHaveLength(1);
    expect(first.playCalls).toBe(1);
    expect(h.state().player.status).toBe('paused');
    expect(h.state().player.retry).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the next click re-attaches the cached source and plays inside the click (no new descriptor request)', async () => {
    const h = await make();
    const first = await startPlaying(h);
    await h.controller.togglePlay();
    first.emit('error', { code: 'network', fatal: true });
    await h.advance(10_000);
    const requests = h.playback.calls.length;

    const p = h.controller.togglePlay();
    // Synchronous part of the click: a new adapter was created, loaded and play() was called.
    expect(h.adapters).toHaveLength(2);
    expect(h.last().playCalls).toBe(1);
    expect(h.state().player.status).toBe('loading');
    await p;
    h.last().emit('playing');
    expect(h.state().player).toMatchObject({ status: 'playing', activeMode: 'binaural' });
    expect(h.playback.calls).toHaveLength(requests);
  });

  it('after play_blocked a network error does not retry on its own either', async () => {
    const h = await make({ scripts: [{ play: 'blocked' }] });
    await prepare(h);
    await h.controller.start();
    await h.flush();
    expect(h.state().player.status).toBe('paused');
    expect(h.state().player.error?.code).toBe('play_blocked');

    h.last().emit('error', { code: 'network', fatal: true });
    await h.advance(60_000);
    expect(h.adapters).toHaveLength(1);
    expect(h.last().playCalls).toBe(1);
    expect(h.state().player.status).toBe('paused');
    expect(h.state().player.error?.code).toBe('play_blocked');

    await h.controller.togglePlay();
    expect(h.adapters).toHaveLength(2); // only the user's click plays
    expect(h.last().playCalls).toBe(1);
  });

  it('a network error while playing still retries automatically (unchanged)', async () => {
    const h = await make();
    const first = await startPlaying(h);
    first.emit('error', { code: 'network', fatal: true });
    expect(h.state().player.status).toBe('reconnecting');
    await h.advance(2_000);
    expect(h.adapters).toHaveLength(2);
  });

  it('stop() forgets the pending re-attach', async () => {
    const h = await make();
    const first = await startPlaying(h);
    await h.controller.togglePlay();
    first.emit('error', { code: 'network', fatal: true });
    h.controller.stop();
    await h.controller.togglePlay();
    expect(h.adapters).toHaveLength(1);
  });
});

describe('PS-3 / UI-03: the switch_mode action', () => {
  it('mode_unavailable in selecting: the action targets the other mode and switchMode() selects it', async () => {
    const h = await make();
    h.playback.notReady('atmos', 'mode_unavailable');
    h.controller.selectMode('atmos');
    await h.flush();
    let s = h.state();
    expect(s.player.status).toBe('selecting');
    expect(s.notReady).toBe('mode_unavailable');
    expect(selectErrorActions(s)).toEqual(['switch_mode']);
    expect(selectSwitchTarget(s)).toBe('binaural');

    await h.controller.switchMode('binaural');
    await h.flush();
    s = h.state();
    expect(s.player).toMatchObject({ status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' });
    expect(s.notReady).toBeNull();
    expect(h.adapters).toHaveLength(0); // selecting the other mode starts nothing
    expect(selectCanStart(s)).toBe(true);
  });

  it('is not offered when the other mode does not exist, and has no target', async () => {
    const h = await make({ event: makeEvent({ availableModes: ['atmos'] }) });
    h.playback.notReady('atmos', 'mode_unavailable');
    h.controller.selectMode('atmos');
    await h.flush();
    expect(h.state().notReady).toBe('mode_unavailable');
    expect(selectErrorActions(h.state())).toEqual([]);
    expect(selectSwitchTarget(h.state())).toBeNull();
  });

  it('a failed switch to Binaural targets Atmos (the last good mode), listed once as reload_last_good', async () => {
    const h = await make();
    await startPlaying(h, 'atmos');
    h.controller.prepareSwitch('binaural');
    await h.flush();
    void h.controller.switchMode('binaural');
    h.last().emit('error', { code: 'unsupported', fatal: true });
    const s = h.state();
    expect(s.player).toMatchObject({ status: 'failed', activeMode: 'atmos', lastGoodMode: 'atmos' });
    expect(s.player.error?.mode).toBe('binaural');
    expect(selectSwitchTarget(s)).toBe('atmos');
    expect(selectErrorActions(s)).toEqual(['reload_last_good']);
  });

  it('a first Binaural start that is unsupported offers switch_mode to Atmos', async () => {
    const h = await make();
    await prepare(h, 'binaural');
    void h.controller.start();
    h.last().emit('error', { code: 'unsupported', fatal: true });
    const s = h.state();
    expect(s.player.status).toBe('failed');
    expect(selectSwitchTarget(s)).toBe('atmos');
    expect(selectErrorActions(s)).toEqual(['switch_mode']);
  });

  it('an unsupported first Atmos start keeps the Binaural fallback and has no duplicate switch_mode', async () => {
    const h = await make();
    await prepare(h, 'atmos');
    void h.controller.start();
    h.last().emit('error', { code: 'unsupported', fatal: true });
    expect(selectErrorActions(h.state())).toEqual(['fallback_binaural']);
  });
});

describe('PS-6: retry and reload respect the gate and the entitlement', () => {
  async function failedWithGuest(h: Harness): Promise<void> {
    await startPlaying(h, 'binaural');
    h.last().emit('error', { code: 'decode', fatal: true });
    expect(h.state().player.status).toBe('failed');
    h.controller.dev?.setEntitlement('guest');
    expect(h.state().entitlement).toBe('guest');
  }

  it('retry() does nothing while the entitlement is not entitled, and the selector offers no retry', async () => {
    const h = await make({ boot: { devTools: true } });
    await failedWithGuest(h);
    expect(selectErrorActions(h.state())).not.toContain('retry');
    const adapters = h.adapters.length;
    await h.controller.retry();
    await h.flush();
    expect(h.adapters).toHaveLength(adapters);
    expect(h.state().player.status).toBe('failed');
  });

  it('retry() works again once the entitlement is back', async () => {
    const h = await make({ boot: { devTools: true } });
    await failedWithGuest(h);
    h.controller.dev?.setEntitlement(null);
    await h.flush();
    expect(h.state().entitlement).toBe('entitled');
    expect(selectErrorActions(h.state())).toContain('retry');
    await h.controller.retry();
    expect(h.state().player.status).toBe('loading');
  });

  it('reloadLastGood() is refused for a denied entitlement and while the gate is closed', async () => {
    const h = await make({ boot: { devTools: true } });
    await startPlaying(h, 'binaural');
    h.controller.prepareSwitch('atmos');
    await h.flush();
    void h.controller.switchMode('atmos');
    h.last().emit('error', { code: 'decode', fatal: true });
    expect(h.state().player.status).toBe('failed');
    expect(selectErrorActions(h.state())).toContain('reload_last_good');

    h.controller.dev?.setEntitlement('not_entitled');
    expect(selectErrorActions(h.state())).not.toContain('reload_last_good');
    const adapters = h.adapters.length;
    await h.controller.reloadLastGood();
    expect(h.adapters).toHaveLength(adapters);
    expect(h.state().player.status).toBe('failed');
  });

  it('a prepare failure can still be retried without an entitlement (it starts no playback)', async () => {
    const h = await make();
    h.playback.failWith = new Error('down');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().player.status).toBe('failed');
    h.playback.failWith = null;
    await h.controller.retry();
    await h.flush();
    expect(h.state().player.status).toBe('selecting');
    expect(selectCanStart(h.state())).toBe(true);
  });
});

describe('PS-7: the source_not_configured pin and the re-prefetch', () => {
  it('a status change that clears the pin re-asks and prepares the mode (stale gate no longer used)', async () => {
    const h = await make();
    h.playback.notReady('binaural', 'source_not_configured');
    h.controller.selectMode('binaural');
    await h.flush();
    expect(selectGate(h.state()).kind).toBe('not_configured');
    expect(h.playback.callsFor('binaural')).toHaveLength(1);

    h.playback.answers.delete('binaural'); // the admin fixed the source
    h.controller.updateEvent(makeEvent({ status: 'intermission' }));
    await h.flush();
    const s = h.state();
    expect(s.notReady).toBeNull();
    expect(selectGate(s).kind).toBe('open');
    expect(h.playback.callsFor('binaural')).toHaveLength(2);
    expect(s.player.preparedMode).toBe('binaural');
    expect(selectCanStart(s)).toBe(true);
    expect(h.entitlement.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a poll that reports a different sourceKind re-asks even when the status is unchanged', async () => {
    const h = await make();
    h.playback.notReady('binaural', 'source_not_configured');
    h.controller.selectMode('binaural');
    await h.flush();
    h.controller.updateEvent(makeEvent({ sourceKind: 'not_configured' })); // same status, still unconfigured
    await h.flush();
    expect(selectGate(h.state()).kind).toBe('not_configured');

    h.playback.answers.delete('binaural');
    h.controller.updateEvent(makeEvent({ sourceKind: 'demo' })); // same status, source now configured
    await h.flush();
    expect(selectGate(h.state()).kind).toBe('open');
    expect(selectCanStart(h.state())).toBe(true);
  });

  it('a same-status poll with the same sourceKind keeps the pin and sends no request', async () => {
    const h = await make();
    h.playback.notReady('binaural', 'source_not_configured');
    h.controller.selectMode('binaural');
    await h.flush();
    const calls = h.playback.calls.length;
    h.controller.updateEvent(makeEvent({ title: 'fresh title' }));
    await h.flush();
    expect(h.playback.calls).toHaveLength(calls);
    expect(selectGate(h.state()).kind).toBe('not_configured');
  });
});

describe('F7: the client entitlement mirror follows polled event data', () => {
  it('not_configured -> demo opens the gate and the mirror answers entitled', async () => {
    const mountTime = makeEvent({ sourceKind: 'not_configured' });
    const placeholder = createEntitlementPlaceholder([mountTime]);
    const h = await make({ event: mountTime, entitlementProvider: placeholder });
    expect(selectGate(h.state()).kind).toBe('not_configured');
    expect(h.state().entitlement).toBe('unknown');

    h.controller.updateEvent(makeEvent({ sourceKind: 'demo' }));
    await h.flush();
    expect(selectGate(h.state()).kind).toBe('open');
    expect(h.state().entitlement).toBe('entitled');

    h.controller.selectMode('binaural');
    await h.flush();
    expect(selectCanStart(h.state())).toBe(true);
  });

  it('a real (non-demo) event stays unavailable however the polled data looks', async () => {
    const real = makeEvent({ isDemo: false, sourceKind: 'not_configured' });
    const h = await make({ event: real, entitlementProvider: createEntitlementPlaceholder([real]) });
    h.controller.updateEvent(makeEvent({ isDemo: false, sourceKind: 'demo' }));
    await h.flush();
    expect(h.state().entitlement).toBe('unavailable');
  });
});
