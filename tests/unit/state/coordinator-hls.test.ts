/**
 * M2-PLAN C3: the coordinator with real (hls) sources. A signed URL can expire mid-show: every retry of an hls
 * source asks /playback again, at most MAX_RETRIES times, and 目前播放 does not change until the new source plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectGate } from '../../../src/state/model';
import type { ListeningMode, PlaybackSource } from '../../../src/types';
import { createHarness, makeEvent, startPlaying, type Harness, type HarnessOptions } from './helpers';

const harnesses: Harness[] = [];
let token = 0;

function hls(mode: ListeningMode): PlaybackSource {
  token += 1;
  return { kind: 'hls', url: `https://stream.example.test/${mode}/index.m3u8?token=${token}`, mode };
}

async function make(options: HarnessOptions = {}): Promise<Harness> {
  const h = await createHarness({ event: makeEvent({ isDemo: false, sourceKind: 'hls', title: '秋季音樂會' }), ...options });
  harnesses.push(h);
  h.playback.answers.set('binaural', hls('binaural'));
  h.playback.answers.set('atmos', hls('atmos'));
  return h;
}

/** hls.js gave up on the network: what the HLS adapter reports for an expired signed URL. */
function tokenExpired(h: Harness): void {
  h.last().emit('error', { code: 'network', fatal: false });
}

beforeEach(() => {
  vi.useFakeTimers();
  token = 0;
});

afterEach(() => {
  for (const h of harnesses.splice(0)) h.destroy();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('hls sources (M2-PLAN C3)', () => {
  it('an hls source opens the gate and loads through the factory', async () => {
    const h = await make();
    expect(h.state().source).toBe('hls');
    expect(selectGate(h.state()).kind).not.toBe('not_configured');
    const answer = h.playback.answers.get('binaural');
    await startPlaying(h);
    expect(h.last().sources).toEqual([answer]);
    expect(h.state().player.status).toBe('playing');
  });

  it('is never demo media', async () => {
    const h = await make();
    await startPlaying(h);
    expect(h.state().isDemoMedia).toBe(false);
  });

  it('an hls answer for another mode is refused (fail closed)', async () => {
    const h = await make();
    h.playback.answers.set('binaural', hls('atmos'));
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.state().player.preparedMode).toBeNull();
    expect(h.state().player.error?.code).toBe('network');
  });

  it('asks the view to prepare the library as soon as an hls descriptor arrives (before the click)', async () => {
    const h = await make();
    h.controller.selectMode('binaural');
    await h.flush();
    expect(h.resolved).toEqual(['hls']);
  });

  it('an expired token re-resolves at once and then once per retry; the attempts stop at the limit (Review Focus 5)', async () => {
    const h = await make();
    await startPlaying(h);
    expect(h.playback.callsFor('binaural')).toHaveLength(1);

    tokenExpired(h);
    // No 15 s grace for a dead source: reconnecting now, the descriptor is fetched again when the retry fires.
    expect(h.state().player.status).toBe('reconnecting');
    expect(h.state().player.retry).toEqual({ attempt: 1, max: 3 });
    expect(h.state().player.lastGoodMode).toBe('binaural');
    await h.advance(1_999);
    expect(h.playback.callsFor('binaural')).toHaveLength(1);
    const fresh = h.playback.answers.get('binaural');
    await h.advance(1);
    expect(h.playback.callsFor('binaural')).toHaveLength(2);
    expect(h.adapters).toHaveLength(2);
    expect(h.last().sources).toEqual([fresh]);
    expect(h.state().player.lastGoodMode).toBe('binaural');

    h.playback.answers.set('binaural', hls('binaural'));
    tokenExpired(h);
    await h.advance(5_000);
    expect(h.playback.callsFor('binaural')).toHaveLength(3);
    h.playback.answers.set('binaural', hls('binaural'));
    tokenExpired(h);
    await h.advance(10_000);
    expect(h.playback.callsFor('binaural')).toHaveLength(4);

    tokenExpired(h);
    expect(h.state().player.status).toBe('failed');
    expect(h.state().player.error).toEqual({ code: 'network', mode: 'binaural', publicCode: 'E-NET-01' });
    expect(vi.getTimerCount()).toBe(0);
    await h.advance(60_000);
    expect(h.playback.callsFor('binaural')).toHaveLength(4);
  });

  it('the new signed URL plays and the player is back to playing', async () => {
    const h = await make();
    await startPlaying(h);
    tokenExpired(h);
    await h.advance(2_000);
    h.last().emit('playing');
    expect(h.state().player.status).toBe('playing');
    expect(h.state().player.activeMode).toBe('binaural');
  });

  it('a manual 重試 after the failure resolves again: a cached signed URL is never reused after a network failure', async () => {
    const h = await make();
    await startPlaying(h);
    for (const wait of [2_000, 5_000, 10_000]) {
      tokenExpired(h);
      await h.advance(wait);
    }
    tokenExpired(h);
    expect(h.state().player.status).toBe('failed');
    const before = h.playback.callsFor('binaural').length;
    const fresh = hls('binaural');
    h.playback.answers.set('binaural', fresh);
    await h.controller.retry();
    await h.flush();
    expect(h.playback.callsFor('binaural')).toHaveLength(before + 1);
    expect(h.last().sources).toEqual([fresh]);
  });

  it('a refund mid-show: the re-resolve answers not_entitled and playback stops (Review Focus 3)', async () => {
    const h = await make();
    await startPlaying(h);
    h.playback.notReady('binaural', 'not_entitled');
    tokenExpired(h);
    await h.advance(2_000);
    expect(h.state().player.status).toBe('failed');
    expect(h.state().player.error?.code).toBe('not_entitled');
    expect(h.alive.size).toBe(0);
  });

  it('a failed re-resolve counts as a retry and is bounded too', async () => {
    const h = await make();
    await startPlaying(h);
    h.playback.failWith = new Error('offline');
    tokenExpired(h);
    await h.advance(2_000);
    await h.advance(5_000);
    await h.advance(10_000);
    expect(h.state().player.status).toBe('failed');
    expect(h.playback.callsFor('binaural')).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('demo sources keep M1 behaviour: a network retry reuses the cached descriptor', async () => {
    const h = await createHarness();
    harnesses.push(h);
    await startPlaying(h);
    h.last().emit('error', { code: 'network', fatal: true });
    await h.advance(2_000);
    expect(h.playback.callsFor('binaural')).toHaveLength(1);
    expect(h.adapters).toHaveLength(2);
  });
});
