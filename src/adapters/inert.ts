import type { PlaybackAdapter, PlayerCapabilities } from '../types';

const NO_CAPABILITIES: PlayerCapabilities = Object.freeze({
  playPause: false,
  mute: false,
  volume: false,
  seekToLive: false,
  fullscreen: false,
  remotePlayback: false,
  reliablePlaybackEvents: false,
});

/**
 * An adapter that does nothing (plan 6.9). It backs the M1 `hls` and `iframe` stubs.
 *
 * - It takes no host: it never touches `host.media` (the element is shared with the one real adapter).
 * - It never emits an event, so it can never report `unsupported` for a case it does not know.
 * - Every capability is false, so no control renders for it.
 * - load() and play() resolve; destroy() is an idempotent no-op.
 *
 * The coordinator never loads these in M1 (a server `hls`/`iframe` source is treated as
 * `not_configured`); they exist so the factory can answer every `PlaybackAdapter['kind']`.
 */
export function createInertAdapter(kind: PlaybackAdapter['kind']): PlaybackAdapter {
  return {
    kind,
    get capabilities(): PlayerCapabilities {
      return { ...NO_CAPABILITIES };
    },
    load(): Promise<void> {
      return Promise.resolve();
    },
    play(): Promise<void> {
      return Promise.resolve();
    },
    pause(): void {},
    setMuted(): void {},
    setVolume(): void {},
    seekToLive(): void {},
    destroy(): void {},
    on(): () => void {
      return () => undefined;
    },
  };
}
