import type { PlaybackAdapter } from '../types';
import { createInertAdapter } from './inert';

/**
 * HLS adapter: an inert stub in M1 (plan 6.9, spec 9.2).
 *
 * The server never emits an `hls` source in M1 and the coordinator treats one as
 * `not_configured`, so this adapter is never loaded. It does nothing and never reports
 * `unsupported`.
 *
 * M2 contract (recorded now, not implemented):
 * - Use native HLS only when `media.canPlayType('application/vnd.apple.mpegurl')` is non-empty
 *   AND `'ManagedMediaSource' in window`. Pick the path by feature detection, never by browser name.
 * - Otherwise use the plugin's own pinned hls.js, loaded lazily and gated by `Hls.isSupported()`.
 *   Never use a `window.Hls` that another plugin or the theme may have defined.
 * - The element stays the shared `host.media`; destroy() removes its listeners first, then
 *   `hls.destroy()`, `removeAttribute('src')` and `load()`.
 * - `fatal: false` library errors are tolerated by the coordinator for up to 15 s.
 * - Support for the library is not proof of Atmos output: capabilities stay honest.
 */
export function createHlsAdapter(): PlaybackAdapter {
  return createInertAdapter('hls');
}
