import { describe, expect, it } from 'vitest';
import type { AppState, PlayerCapabilities, PlayerError, PlayerStatus } from '../../../src/types';
import { createInitialState, publicErrorCode } from '../../../src/state/model';
import { reduce } from '../../../src/state/reducer';
import type { Action } from '../../../src/state/reducer';
import { PLAYER_TRANSITIONS, canTransition, hasPlaybackIntent } from '../../../src/state/transitions';
import { makeBoot, makeEvent } from './helpers';

const STATUSES: PlayerStatus[] = ['idle', 'selecting', 'loading', 'playing', 'paused', 'switching', 'reconnecting', 'failed'];

function base(patch: Partial<AppState['player']> = {}): AppState {
  const s = createInitialState(makeBoot(), makeEvent(), null);
  return { ...s, player: { ...s.player, ...patch } };
}

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reduce, state);
}

const err = (code: PlayerError['code'], mode: PlayerError['mode'] = 'binaural'): PlayerError => ({
  code,
  mode,
  publicCode: publicErrorCode(code),
});

describe('transition table', () => {
  it('has an entry for every status and only references real statuses', () => {
    expect(Object.keys(PLAYER_TRANSITIONS).sort()).toEqual([...STATUSES].sort());
    for (const targets of Object.values(PLAYER_TRANSITIONS)) {
      for (const to of targets) expect(STATUSES).toContain(to);
    }
  });

  it('pins the paths plan 6.4 relies on', () => {
    const allowed: Array<[PlayerStatus, PlayerStatus]> = [
      ['idle', 'selecting'],
      ['selecting', 'loading'],
      ['loading', 'playing'],
      ['loading', 'paused'], // play_blocked
      ['loading', 'reconnecting'],
      ['playing', 'paused'],
      ['playing', 'reconnecting'],
      ['playing', 'switching'],
      ['paused', 'loading'], // resume
      ['paused', 'switching'],
      ['switching', 'playing'],
      ['switching', 'failed'],
      ['reconnecting', 'playing'],
      ['reconnecting', 'failed'],
      ['failed', 'loading'],
      ['failed', 'switching'],
      ['failed', 'selecting'],
    ];
    for (const [from, to] of allowed) expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
  });

  it('refuses impossible jumps', () => {
    const refused: Array<[PlayerStatus, PlayerStatus]> = [
      ['idle', 'playing'],
      ['idle', 'loading'],
      ['selecting', 'playing'],
      ['selecting', 'paused'],
      ['selecting', 'switching'],
      ['switching', 'loading'],
      ['failed', 'playing'],
      ['failed', 'paused'],
      ['playing', 'loading'],
    ];
    for (const [from, to] of refused) expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
  });

  it('every status can fall back to selecting or idle (stop)', () => {
    for (const status of STATUSES.filter((s) => s !== 'idle' && s !== 'selecting')) {
      expect(canTransition(status, 'selecting')).toBe(true);
      expect(canTransition(status, 'idle')).toBe(true);
    }
  });

  it('a status may stay where it is', () => {
    for (const status of STATUSES) expect(canTransition(status, status)).toBe(true);
  });

  it('playback intent excludes idle, selecting and failed', () => {
    expect(STATUSES.filter(hasPlaybackIntent)).toEqual(['loading', 'playing', 'paused', 'switching', 'reconnecting']);
  });
});

describe('reduce: selection', () => {
  it('select moves idle -> selecting and resets the prepared mode', () => {
    const s = reduce(base({ preparedMode: 'atmos' }), { type: 'mode/select', mode: 'binaural' });
    expect(s.player).toMatchObject({ status: 'selecting', selectedMode: 'binaural', preparedMode: null });
  });

  it('re-selecting the same mode keeps the prepared mode and returns the same object', () => {
    const s = base({ status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' });
    expect(reduce(s, { type: 'mode/select', mode: 'binaural' })).toBe(s);
  });

  it('refuses a mode the event does not offer, and any change while playback is active', () => {
    const s = base();
    const only = { ...s, event: { ...s.event, data: makeEvent({ availableModes: ['binaural'] }) } };
    expect(reduce(only, { type: 'mode/select', mode: 'atmos' })).toBe(only);
    for (const status of ['loading', 'playing', 'paused', 'switching', 'reconnecting'] as const) {
      const active = base({ status, selectedMode: 'binaural' });
      expect(reduce(active, { type: 'mode/select', mode: 'atmos' })).toBe(active);
    }
  });

  it('selecting from failed clears the error and goes back to selecting', () => {
    const s = base({ status: 'failed', selectedMode: 'atmos', error: err('network', 'atmos') });
    expect(reduce(s, { type: 'mode/select', mode: 'binaural' }).player).toMatchObject({ status: 'selecting', error: null, selectedMode: 'binaural' });
  });

  it('prepared follows the selection', () => {
    const s = base({ status: 'selecting', selectedMode: 'atmos' });
    expect(reduce(s, { type: 'mode/prepared', prepared: true }).player.preparedMode).toBe('atmos');
    expect(reduce(reduce(s, { type: 'mode/prepared', prepared: true }), { type: 'mode/prepared', prepared: false }).player.preparedMode).toBeNull();
  });
});

describe('reduce: playback facts', () => {
  const selecting = base({ status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' });

  it('start -> attached -> playing confirms the loaded mode', () => {
    const s = run(selecting, { type: 'attempt/start', mode: 'binaural' }, { type: 'attempt/attached', mode: 'binaural' });
    expect(s.player).toMatchObject({ status: 'loading', loadedMode: 'binaural', confirmedPlaying: false, activeMode: null });
    const playing = reduce(s, { type: 'adapter/playing' });
    expect(playing.player).toMatchObject({
      status: 'playing',
      activeMode: 'binaural',
      lastGoodMode: 'binaural',
      confirmedPlaying: true,
      selectedMode: 'binaural',
      preparedMode: 'binaural',
    });
  });

  it('a late playing signal is dropped when nothing is loaded or the status does not allow it', () => {
    expect(reduce(selecting, { type: 'adapter/playing' })).toBe(selecting);
    const failed = base({ status: 'failed', loadedMode: 'binaural' });
    expect(reduce(failed, { type: 'adapter/playing' })).toBe(failed);
  });

  it('a switch keeps the old activeMode but is not confirmed until playing', () => {
    const playing = base({ status: 'playing', selectedMode: 'binaural', activeMode: 'binaural', loadedMode: 'binaural', lastGoodMode: 'binaural', confirmedPlaying: true });
    const s = run(playing, { type: 'attempt/switch', mode: 'atmos' }, { type: 'attempt/attached', mode: 'atmos' });
    expect(s.player).toMatchObject({ status: 'switching', pendingMode: 'atmos', activeMode: 'binaural', confirmedPlaying: false, loadedMode: 'atmos' });
    const done = reduce(s, { type: 'adapter/playing' });
    expect(done.player).toMatchObject({ status: 'playing', activeMode: 'atmos', selectedMode: 'atmos', pendingMode: null, lastGoodMode: 'atmos' });
  });

  it('a failed switch keeps lastGoodMode and the old selection', () => {
    const playing = base({ status: 'playing', selectedMode: 'binaural', activeMode: 'binaural', loadedMode: 'binaural', lastGoodMode: 'binaural', confirmedPlaying: true });
    const s = run(playing, { type: 'attempt/switch', mode: 'atmos' }, { type: 'attempt/failed', error: err('decode', 'atmos') });
    expect(s.player).toMatchObject({
      status: 'failed',
      pendingMode: null,
      loadedMode: null,
      lastGoodMode: 'binaural',
      selectedMode: 'binaural',
      confirmedPlaying: false,
    });
    expect(s.capabilities).toBeNull();
  });

  it('retry/wait keeps a switch a switch and turns a plain load into reconnecting', () => {
    const sw = run(base({ status: 'playing', selectedMode: 'binaural', loadedMode: 'binaural' }), { type: 'attempt/switch', mode: 'atmos' }, { type: 'retry/wait', attempt: 1, max: 3 });
    expect(sw.player).toMatchObject({ status: 'switching', retry: { attempt: 1, max: 3 } });
    const loading = run(selecting, { type: 'attempt/start', mode: 'binaural' }, { type: 'retry/wait', attempt: 2, max: 3 });
    expect(loading.player).toMatchObject({ status: 'reconnecting', retry: { attempt: 2, max: 3 }, loadedMode: null });
  });

  it('playing clears the retry state', () => {
    const s = run(
      selecting,
      { type: 'attempt/start', mode: 'binaural' },
      { type: 'retry/wait', attempt: 1, max: 3 },
      { type: 'attempt/attached', mode: 'binaural' },
      { type: 'adapter/playing' },
    );
    expect(s.player).toMatchObject({ status: 'playing', retry: null });
  });

  it('paused is ignored while loading or switching, accepted while playing', () => {
    const loading = run(selecting, { type: 'attempt/start', mode: 'binaural' });
    expect(reduce(loading, { type: 'adapter/paused' })).toBe(loading);
    const playing = run(loading, { type: 'attempt/attached', mode: 'binaural' }, { type: 'adapter/playing' });
    expect(reduce(playing, { type: 'adapter/paused' }).player.status).toBe('paused');
  });

  it('play_blocked pauses with the error and no retry', () => {
    const s = run(selecting, { type: 'attempt/start', mode: 'binaural' }, { type: 'attempt/attached', mode: 'binaural' }, { type: 'attempt/play_blocked', error: err('play_blocked') });
    expect(s.player).toMatchObject({ status: 'paused', error: { code: 'play_blocked' }, confirmedPlaying: false, retry: null });
    const resumed = reduce(s, { type: 'attempt/resume' });
    expect(resumed.player).toMatchObject({ status: 'loading', error: null });
  });

  it('a stall only affects a playing player', () => {
    expect(reduce(selecting, { type: 'adapter/stalled' })).toBe(selecting);
    const playing = run(selecting, { type: 'attempt/start', mode: 'binaural' }, { type: 'attempt/attached', mode: 'binaural' }, { type: 'adapter/playing' });
    expect(reduce(playing, { type: 'adapter/stalled' }).player.status).toBe('reconnecting');
  });

  it('ended (non-looping source) pauses and drops the confirmation', () => {
    const playing = run(selecting, { type: 'attempt/start', mode: 'binaural' }, { type: 'attempt/attached', mode: 'binaural' }, { type: 'adapter/playing' });
    expect(reduce(playing, { type: 'adapter/ended' }).player).toMatchObject({ status: 'paused', confirmedPlaying: false });
  });

  it('stopped keeps the selection and clears everything else', () => {
    const playing = base({
      status: 'playing',
      selectedMode: 'atmos',
      preparedMode: 'atmos',
      loadedMode: 'atmos',
      activeMode: 'atmos',
      lastGoodMode: 'atmos',
      confirmedPlaying: true,
      error: err('network'),
      retry: { attempt: 1, max: 3 },
    });
    const s = reduce({ ...playing, capabilities: { playPause: true, mute: true, volume: true, seekToLive: false, fullscreen: false, remotePlayback: false, reliablePlaybackEvents: true } }, { type: 'player/stopped' });
    expect(s.player).toMatchObject({
      status: 'selecting',
      selectedMode: 'atmos',
      preparedMode: 'atmos',
      loadedMode: null,
      activeMode: null,
      lastGoodMode: null,
      confirmedPlaying: false,
      error: null,
      retry: null,
    });
    expect(s.capabilities).toBeNull();
    expect(reduce(base(), { type: 'player/stopped' }).player.status).toBe('idle');
  });

  it('stopped on an already stopped state is the same object (no spurious notification)', () => {
    const s = base({ status: 'selecting', selectedMode: 'atmos' });
    expect(reduce(s, { type: 'player/stopped' })).toBe(s);
  });
});

describe('reduce: server answers and entitlement', () => {
  it('not_ready clears the prepared mode; not_entitled flips the entitlement closed', () => {
    const s = { ...base({ status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' }), entitlement: 'entitled' as const };
    const r = reduce(s, { type: 'prepare/not_ready', reason: 'not_entitled' });
    expect(r).toMatchObject({ notReady: 'not_entitled', entitlement: 'not_entitled' });
    expect(r.player.preparedMode).toBeNull();
    expect(reduce({ ...s, entitlement: 'guest' }, { type: 'prepare/not_ready', reason: 'not_entitled' }).entitlement).toBe('guest');
    expect(reduce(s, { type: 'prepare/not_ready', reason: 'entitlement_unavailable' }).entitlement).toBe('unavailable');
  });

  it('source_not_configured moves the source to not_configured until cleared', () => {
    const s = base({ status: 'selecting', selectedMode: 'binaural' });
    const r = reduce(s, { type: 'prepare/not_ready', reason: 'source_not_configured' });
    expect(r).toMatchObject({ source: 'not_configured', isDemoMedia: false });
    // A poll with the same event must not undo the server's answer.
    expect(reduce(r, { type: 'event/set', data: makeEvent(), status: 'live', simulated: false }).source).toBe('not_configured');
    const cleared = reduce(r, { type: 'prepare/clear_not_ready' });
    expect(cleared).toMatchObject({ notReady: null, source: 'demo', isDemoMedia: true });
  });

  it('entitlement/set returns the same object when nothing changes', () => {
    const s = reduce(base(), { type: 'entitlement/set', status: 'guest' });
    expect(reduce(s, { type: 'entitlement/set', status: 'guest' })).toBe(s);
  });

  it('event/set replaces the slice and re-derives source and demo flag', () => {
    const r = reduce(base(), { type: 'event/set', data: makeEvent({ sourceKind: 'not_configured' }), status: 'ended', simulated: true });
    expect(r.event).toMatchObject({ status: 'ended', simulated: true });
    expect(r).toMatchObject({ source: 'not_configured', isDemoMedia: false });
  });

  it('prefetch failure moves selecting to failed with the error', () => {
    const s = base({ status: 'selecting', selectedMode: 'binaural' });
    expect(reduce(s, { type: 'prepare/failed', error: err('network') }).player).toMatchObject({ status: 'failed', error: { code: 'network' } });
  });
});

describe('reduce: audio and capabilities', () => {
  it('clamps the volume, ignores NaN, and returns the same object for no-ops', () => {
    const s = base();
    expect(reduce(s, { type: 'audio/volume', volume: 5 }).player.volume).toBe(1);
    expect(reduce(s, { type: 'audio/volume', volume: -1 }).player.volume).toBe(0);
    expect(reduce(s, { type: 'audio/volume', volume: Number.NaN })).toBe(s);
    expect(reduce(s, { type: 'audio/muted', muted: false })).toBe(s);
    expect(reduce(s, { type: 'audio/muted', muted: true }).player.muted).toBe(true);
  });

  it('copies the capabilities and returns the same object for equal ones', () => {
    const caps: PlayerCapabilities = { playPause: true, mute: true, volume: false, seekToLive: false, fullscreen: false, remotePlayback: false, reliablePlaybackEvents: true };
    const s = reduce(base(), { type: 'attempt/capabilities', capabilities: caps });
    expect(s.capabilities).toEqual(caps);
    expect(s.capabilities).not.toBe(caps);
    expect(reduce(s, { type: 'attempt/capabilities', capabilities: { ...caps } })).toBe(s);
  });
});
