/**
 * M2-PLAN D2: a provider player (iframe) source. The frame cannot confirm playback, so the state shows
 * 「已選擇：…（由串流服務播放器播放）」, never 「目前播放」, and no watchdog or retry runs on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlayerKeydown, primaryAction } from '../../../src/components/player-controls';
import { parsePlaybackSource } from '../../../src/adapters/providers';
import { selectGate, selectModeLabel } from '../../../src/state/model';
import type { PlaybackSource } from '../../../src/types';
import { createHarness, makeEvent, prepare, type Harness } from './helpers';

const ORIGIN = 'https://player.example.test';
const FRAME_CAPS = { playPause: false, mute: false, volume: false, seekToLive: false, fullscreen: false, remotePlayback: false, reliablePlaybackEvents: false };
const harnesses: Harness[] = [];

async function make(): Promise<Harness> {
  const h = await createHarness({ event: makeEvent({ isDemo: false, sourceKind: 'iframe', title: '秋季音樂會' }) });
  harnesses.push(h);
  h.playback.answers.set('binaural', { kind: 'iframe', url: `${ORIGIN}/embed?b`, allowedOrigin: ORIGIN });
  h.playback.answers.set('atmos', { kind: 'iframe', url: `${ORIGIN}/embed?a`, allowedOrigin: ORIGIN });
  return h;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const h of harnesses.splice(0)) h.destroy();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('iframe sources (M2-PLAN D2)', () => {
  it('the REST parser accepts an https player page whose origin is allowedOrigin, and nothing else', () => {
    const good = { kind: 'iframe', url: `${ORIGIN}/embed?t=1`, allowedOrigin: ORIGIN };
    expect(parsePlaybackSource(good)).toEqual(good);
    const no: PlaybackSource = { kind: 'not_ready', reason: 'source_not_configured' };
    expect(parsePlaybackSource({ ...good, allowedOrigin: 'https://other.example.test' })).toEqual(no);
    expect(parsePlaybackSource({ ...good, url: 'http://player.example.test/embed', allowedOrigin: 'http://player.example.test' })).toEqual(no);
    expect(parsePlaybackSource({ kind: 'iframe', url: `${ORIGIN}/embed` })).toEqual(no);
  });

  it('a loaded frame shows 已選擇 (by the provider player), never 目前播放, and no play/pause button', async () => {
    const h = await make();
    expect(selectGate(h.state()).kind).toBe('open');
    await prepare(h);
    h.scripts.push({});
    const started = h.controller.start();
    h.last().capabilities = { ...FRAME_CAPS };
    await started;
    await h.flush();
    const s = h.state();
    expect(s.player.status).toBe('playing');
    expect(s.player.confirmedPlaying).toBe(false);
    expect(s.player.activeMode).toBe('binaural');
    expect(selectModeLabel(s)).toBe('已選擇：Binaural（由串流服務播放器播放）');
    expect(primaryAction(s).kind).toBe('hidden');
    expect(h.remembered).toEqual(['binaural']);
  });

  it('no watchdog runs on a frame: 60 s without media progress changes nothing', async () => {
    const h = await make();
    await prepare(h);
    const started = h.controller.start();
    h.last().capabilities = { ...FRAME_CAPS };
    await started;
    await h.flush();
    await h.advance(60_000);
    expect(h.state().player.status).toBe('playing');
    expect(h.adapters).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('review I2: pause/resume (button, K or Space) does nothing on a frame; the state never fakes a pause', async () => {
    const h = await make();
    await prepare(h);
    const started = h.controller.start();
    h.last().capabilities = { ...FRAME_CAPS };
    await started;
    await h.flush();
    await h.controller.togglePlay();
    expect(h.state().player.status).toBe('playing');
    const key = new KeyboardEvent('keydown', { key: 'k', cancelable: true });
    expect(handlePlayerKeydown(key, h.controller)).toBe(false);
    expect(key.defaultPrevented).toBe(false);
    expect(h.state().player.status).toBe('playing');
    expect(h.last().pauseCalls).toBe(0);
  });

  it('switching modes replaces the frame and the label follows the selection', async () => {
    const h = await make();
    await prepare(h);
    const started = h.controller.start();
    h.last().capabilities = { ...FRAME_CAPS };
    await started;
    await h.flush();
    h.controller.prepareSwitch('atmos'); // the switch dialog prefetches the other mode
    await h.flush();
    const switched = h.controller.switchMode('atmos');
    h.last().capabilities = { ...FRAME_CAPS };
    await switched;
    await h.flush();
    expect(h.adapters).toHaveLength(2);
    expect(h.alive.size).toBe(1);
    expect(h.last().sources[0]).toMatchObject({ kind: 'iframe', url: `${ORIGIN}/embed?a` });
    expect(selectModeLabel(h.state())).toBe('已選擇：Dolby Atmos 音軌（由串流服務播放器播放）');
  });
});
