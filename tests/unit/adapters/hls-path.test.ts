import { describe, expect, it } from 'vitest';
import { canPlayMode, chooseHlsPath, HLS_MIME } from '../../../src/adapters/hls-path';

const EC3 = 'audio/mp4; codecs="ec-3"';

/** A media element stand-in whose canPlayType answers from a table ('' for anything not listed). */
function media(answers: Record<string, CanPlayTypeResult> = {}): HTMLMediaElement {
  return { canPlayType: (type: string) => answers[type] ?? '' } as unknown as HTMLMediaElement;
}

function mse(supported: (type: string) => boolean) {
  return { isTypeSupported: supported };
}

describe('chooseHlsPath (M2-PLAN C2, refines M1-PLAN 6.9)', () => {
  it.each([
    ['iOS 17.1+ / Safari 17+: native HLS and ManagedMediaSource', media({ [HLS_MIME]: 'maybe' }), { ManagedMediaSource: mse(() => true), MediaSource: mse(() => true) }, 'native'],
    ['iOS before 17.1: native HLS, no MSE at all', media({ [HLS_MIME]: 'maybe' }), {}, 'native'],
    ['Chrome/Edge: answer "maybe" for HLS but only have MediaSource', media({ [HLS_MIME]: 'maybe' }), { MediaSource: mse(() => true) }, 'hlsjs'],
    ['Firefox: no native HLS, MediaSource', media(), { MediaSource: mse(() => true) }, 'hlsjs'],
    ['ManagedMediaSource without native HLS', media(), { ManagedMediaSource: mse(() => true) }, 'hlsjs'],
    ['nothing', media(), {}, 'none'],
  ])('%s → %s', (_name, m, win, expected) => {
    expect(chooseHlsPath(m, win as unknown as Window)).toBe(expected);
  });

  it('a canPlayType that throws counts as no native HLS', () => {
    const throwing = { canPlayType: () => { throw new Error('x'); } } as unknown as HTMLMediaElement;
    expect(chooseHlsPath(throwing, { MediaSource: mse(() => true) } as unknown as Window)).toBe('hlsjs');
  });
});

describe('canPlayMode', () => {
  it('Atmos through hls.js follows (Managed)MediaSource.isTypeSupported for E-AC-3 (Review Focus 4)', () => {
    const asked: string[] = [];
    const no = { MediaSource: mse((t) => (asked.push(t), false)) } as unknown as Window;
    expect(canPlayMode('atmos', 'hlsjs', media(), no)).toBe(false);
    expect(asked).toEqual([EC3]);
    expect(canPlayMode('atmos', 'hlsjs', media(), { MediaSource: mse(() => true) } as unknown as Window)).toBe(true);
    // ManagedMediaSource is asked first when both exist.
    expect(canPlayMode('atmos', 'hlsjs', media(), { ManagedMediaSource: mse(() => true), MediaSource: mse(() => false) } as unknown as Window)).toBe(true);
  });

  it('Atmos on the native path follows canPlayType for E-AC-3', () => {
    expect(canPlayMode('atmos', 'native', media({ [EC3]: 'probably' }), {} as Window)).toBe(true);
    expect(canPlayMode('atmos', 'native', media(), {} as Window)).toBe(false);
  });

  it('is "unknown" only when no API answers (shown as 尚未確認)', () => {
    expect(canPlayMode('atmos', 'hlsjs', media(), { MediaSource: {} } as unknown as Window)).toBe('unknown');
    expect(canPlayMode('atmos', 'native', {} as HTMLMediaElement, {} as Window)).toBe('unknown');
  });

  it('Binaural is never blocked: true on every path that can play HLS, whatever the browser', () => {
    expect(canPlayMode('binaural', 'hlsjs', media(), { MediaSource: mse(() => false) } as unknown as Window)).toBe(true);
    expect(canPlayMode('binaural', 'native', media(), {} as Window)).toBe(true);
    expect(canPlayMode('binaural', 'none', media(), {} as Window)).toBe(false);
    expect(canPlayMode('atmos', 'none', media({ [EC3]: 'probably' }), {} as Window)).toBe(false);
  });
});
