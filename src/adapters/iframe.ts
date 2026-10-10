import type { PlaybackAdapter } from '../types';
import { createInertAdapter } from './inert';

/**
 * iframe adapter: an inert stub in M1 (plan 6.9, spec 9.3).
 *
 * The server never emits an `iframe` source in M1 and the coordinator treats one as
 * `not_configured`, so this adapter is never loaded. It does nothing, renders no frame and
 * never reports `unsupported`.
 *
 * M2 contract (recorded now, not implemented):
 * - Only HTTPS player URLs approved by an admin. The client asserts `protocol === 'https:'` and
 *   `new URL(url).origin === allowedOrigin` before creating the frame inside `host.frameSlot`.
 * - The frame gets a `title`. Record the `allow`/`sandbox` values per vendor once tested;
 *   never apply an untested generic string.
 * - Messages: accept only when `event.origin === allowedOrigin`, `event.source === frame.contentWindow`
 *   and the schema is valid. Send with `postMessage(message, allowedOrigin)`, never `'*'`.
 * - Without a vendor message protocol, no overlay controls: capabilities stay false because the
 *   outer UI cannot control the frame. The frame `load` event proves nothing about playability.
 */
export function createIframeAdapter(): PlaybackAdapter {
  return createInertAdapter('iframe');
}
