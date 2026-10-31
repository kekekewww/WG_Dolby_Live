import type { ListeningMode } from '../types';

/**
 * Pure feature detection for HLS playback (M2-PLAN C2; refines M1-PLAN 6.9). Never looks at the browser name.
 */

export type HlsPath = 'native' | 'hlsjs' | 'none';

export const HLS_MIME = 'application/vnd.apple.mpegurl';
/** E-AC-3 (Dolby Digital Plus, the Atmos carrier) in fMP4. */
export const EC3_TYPE = 'audio/mp4; codecs="ec-3"';

interface MseLike {
  isTypeSupported?: unknown;
}

function canPlay(media: HTMLMediaElement, type: string): string | null {
  if (typeof media.canPlayType !== 'function') return null;
  try {
    return media.canPlayType(type);
  } catch {
    return '';
  }
}

function sources(win: Window): MseLike[] {
  const w = win as unknown as Record<string, MseLike | undefined>;
  return [w.ManagedMediaSource, w.MediaSource].filter((s): s is MseLike => s !== undefined && s !== null);
}

/**
 * native when the element plays HLS itself AND (ManagedMediaSource exists OR there is no MediaSource at all):
 * Safari 17+/iOS 17.1+, and older iOS that has native HLS but no MSE. hlsjs when a (Managed)MediaSource exists.
 * Chrome and Edge answer "maybe" for HLS but have no ManagedMediaSource, so they take hls.js (probe 2026-10-30).
 */
export function chooseHlsPath(media: HTMLMediaElement, win: Window): HlsPath {
  const native = (canPlay(media, HLS_MIME) ?? '') !== '';
  const hasMms = 'ManagedMediaSource' in win;
  const hasMse = 'MediaSource' in win;
  if (native && (hasMms || !hasMse)) return 'native';
  if (hasMse || hasMms) return 'hlsjs';
  return 'none';
}

/**
 * Can this mode play on this path? Binaural (AAC stereo) plays wherever HLS plays. Atmos needs E-AC-3: the element's
 * own answer on the native path, (Managed)MediaSource.isTypeSupported on the hls.js path. 'unknown' only when no API
 * answers; the UI shows 尚未確認 and the attempt goes ahead.
 */
export function canPlayMode(mode: ListeningMode, path: HlsPath, media: HTMLMediaElement, win: Window): boolean | 'unknown' {
  if (path === 'none') return false;
  if (mode === 'binaural') return true;
  if (path === 'native') {
    const answer = canPlay(media, EC3_TYPE);
    return answer === null ? 'unknown' : answer !== '';
  }
  for (const source of sources(win)) {
    if (typeof source.isTypeSupported !== 'function') continue;
    try {
      return (source.isTypeSupported as (type: string) => boolean).call(source, EC3_TYPE) === true;
    } catch {
      return false;
    }
  }
  return 'unknown';
}
