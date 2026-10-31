import { h, safeUrl } from '../dom';
import type { AdapterEnv, AdapterErrorDetail, AdapterEvent, MediaHost, PlaybackAdapter, PlaybackSource, PlayerCapabilities } from '../types';
import { AdapterLoadError } from './native-media';

/**
 * Provider player adapter (M2-PLAN D2; spec 9.3, M1-PLAN 6.9).
 *
 * - Only an https player page whose origin equals the server's `allowedOrigin`; anything else is refused before a
 *   frame exists.
 * - ONE <iframe title="…"> in `host.frameSlot`; the shared media element is hidden meanwhile and shown again on
 *   destroy(). No `allow` or `sandbox` string until a vendor's values are tested and recorded (never generic).
 * - Every capability is false: without a vendor control API our UI cannot drive the frame, so it renders none of
 *   its own controls and never claims 「目前播放」. The frame `load` event means "loaded", never "playing".
 * - load() rejects after 20 s without a load event. destroy() blanks and removes the frame; idempotent.
 * - No postMessage bridge yet (M2-PLAN D3 waits for the vendor's documentation).
 */

type LoadableSource = Exclude<PlaybackSource, { kind: 'not_ready' }>;
type Listener = (detail?: AdapterErrorDetail) => void;

export const FRAME_LOAD_TIMEOUT_MS = 20_000;

const NO_CAPABILITIES: PlayerCapabilities = Object.freeze({
  playPause: false,
  mute: false,
  volume: false,
  seekToLive: false,
  fullscreen: false,
  remotePlayback: false,
  reliablePlaybackEvents: false,
});

function abortError(message = 'The operation was aborted.'): DOMException {
  return new DOMException(message, 'AbortError');
}

/** The frame's https URL when it belongs to `allowedOrigin`, else null. */
function approvedUrl(source: LoadableSource): string | null {
  if (source.kind !== 'iframe') return null;
  const safe = safeUrl(source.url);
  if (safe === null) return null;
  try {
    const url = new URL(safe);
    return url.protocol === 'https:' && url.origin === source.allowedOrigin ? url.href : null;
  } catch {
    return null;
  }
}

export function createIframeAdapter(host: MediaHost, env: AdapterEnv): PlaybackAdapter {
  const subscribers = new Map<AdapterEvent, Set<Listener>>();
  let destroyed = false;
  let frame: HTMLIFrameElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { resolve: () => void; reject: (e: unknown) => void; cleanup: () => void } | null = null;

  const emit = (event: AdapterEvent, detail?: AdapterErrorDetail): void => {
    if (destroyed) return;
    for (const fn of [...(subscribers.get(event) ?? [])]) {
      try {
        fn(detail);
      } catch {
        // ignore
      }
    }
  };

  const settle = (action: 'resolve' | 'reject', error?: unknown): void => {
    const p = pending;
    if (!p) return;
    pending = null;
    p.cleanup();
    if (action === 'resolve') p.resolve();
    else p.reject(error);
  };

  const fail = (detail: AdapterErrorDetail): void => {
    emit('error', detail);
    settle('reject', new AdapterLoadError(detail));
  };

  const removeFrame = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const f = frame;
    frame = null;
    if (!f) return;
    try {
      f.src = 'about:blank'; // stop the provider's audio before the node goes
    } catch {
      // ignore
    }
    f.remove();
  };

  return {
    kind: 'iframe',

    get capabilities(): PlayerCapabilities {
      return { ...NO_CAPABILITIES };
    },

    load(source: LoadableSource, signal: AbortSignal): Promise<void> {
      if (destroyed) return Promise.reject(abortError('The adapter was destroyed.'));
      if (signal.aborted) return Promise.reject(abortError());
      settle('reject', abortError('Superseded by a newer load.'));
      removeFrame();

      const promise = new Promise<void>((resolve, reject) => {
        const onAbort = (): void => settle('reject', abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        pending = { resolve, reject, cleanup: () => signal.removeEventListener('abort', onAbort) };
      });
      promise.catch(() => undefined);

      const url = approvedUrl(source);
      if (url === null) {
        fail({ code: 'unsupported', fatal: true });
        return promise;
      }

      const f = h('iframe', { className: 'wg-live__provider-frame' }) as HTMLIFrameElement;
      f.title = env.frameTitle && env.frameTitle !== '' ? env.frameTitle : '串流服務播放器';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.addEventListener('load', () => {
        if (frame !== f) return;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        settle('resolve'); // loaded, not playing
      });
      f.src = url;
      frame = f;
      host.media.hidden = true;
      host.frameSlot.hidden = false;
      host.frameSlot.append(f);
      timer = setTimeout(() => {
        timer = null;
        if (frame === f) fail({ code: 'network', fatal: true });
      }, FRAME_LOAD_TIMEOUT_MS);
      return promise;
    },

    // The provider player has its own controls; ours are not rendered (all capabilities false).
    play(): Promise<void> {
      return destroyed ? Promise.reject(abortError('The adapter was destroyed.')) : Promise.resolve();
    },
    pause(): void {},
    setMuted(): void {},
    setVolume(): void {},
    seekToLive(): void {},

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      subscribers.clear();
      settle('reject', abortError('The adapter was destroyed.'));
      removeFrame();
      if (host.frameSlot.querySelector('iframe') === null) {
        host.frameSlot.hidden = true;
        host.media.hidden = false;
      }
    },

    on(event: AdapterEvent, listener: Listener): () => void {
      if (destroyed) return () => undefined;
      let set = subscribers.get(event);
      if (!set) {
        set = new Set();
        subscribers.set(event, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}
