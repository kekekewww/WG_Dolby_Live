import { safeUrl } from '../dom';
import type {
  AdapterEnv,
  AdapterErrorDetail,
  AdapterEvent,
  MediaHost,
  PlaybackAdapter,
  PlaybackSource,
  PlayerCapabilities,
} from '../types';
import { canPlayMode, chooseHlsPath } from './hls-path';
import { AdapterLoadError, canFullscreen, claimMedia, createNativeMediaAdapter, ownsMedia, releaseMedia } from './native-media';

/**
 * HLS adapter (M2-PLAN C2; spec 9.2, M1-PLAN 6.9).
 *
 * - The path is chosen once, by feature detection (hls-path.ts), never by browser name:
 *   native HLS on the shared element (Safari 17+/iOS) through the native-media adapter, else the plugin's own
 *   pinned hls.js (window.WGLiveHls, from wg-live-hls.js). A window.Hls from the theme or another plugin is never used.
 * - An Atmos track this browser cannot decode is refused before any request (Review Focus 4).
 * - The element stays the shared `host.media`; at most one Hls instance exists per adapter, and a new load()
 *   destroys the previous instance before making the next.
 * - load() attaches synchronously when the library is already loaded (the player preloads it when an hls source
 *   is chosen), so play() can run inside the click. Otherwise play() waits for the attach.
 * - Errors: a fatal network error (including a 403 from an expired token) is { network, fatal: false }: the
 *   source must be resolved again (the coordinator does that). A fatal media error is recovered once, then
 *   { decode, fatal: true }. Codec errors are { unsupported, fatal: true }. Non-fatal library errors are ignored;
 *   the coordinator's watchdog tolerates the library retrying.
 * - destroy(): own listeners first, then hls.destroy(), then removeAttribute('src') and load(). Idempotent.
 */

type LoadableSource = Exclude<PlaybackSource, { kind: 'not_ready' }>;
type Listener = (detail?: AdapterErrorDetail) => void;

export interface HlsErrorData {
  type?: unknown;
  details?: unknown;
  fatal?: unknown;
}

/** The part of hls.js this adapter uses (types only: the library itself is never bundled into the core). */
export interface HlsInstance {
  on(event: string, listener: (event: string, data: never) => void): void;
  off(event: string, listener: (event: string, data: never) => void): void;
  attachMedia(media: HTMLMediaElement): void;
  loadSource(url: string): void;
  recoverMediaError(): void;
  destroy(): void;
  readonly liveSyncPosition: number | null;
}

export interface HlsCtor {
  new (config: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  readonly Events?: { ERROR?: string; LEVEL_LOADED?: string };
  readonly ErrorTypes?: { NETWORK_ERROR?: string; MEDIA_ERROR?: string };
}

export interface HlsDeps {
  /** Window used for feature detection (tests pass a stand-in). */
  win?: Window;
  /** The library if it is loaded already (default: window.WGLiveHls). */
  loadedHls?: () => HlsCtor | null;
  /** Load the library (default: inject env.hlsScriptUrl once). */
  loadHls?: () => Promise<HlsCtor>;
}

const UNSUPPORTED_DETAILS = new Set(['manifestIncompatibleCodecsError', 'bufferAddCodecError', 'bufferIncompatibleCodecsError']);
const HLS_CONFIG = { lowLatencyMode: false, enableWorker: true } as const;

/* ------------------------------------------------------------------ */
/* Loading wg-live-hls.js (once per page)                              */
/* ------------------------------------------------------------------ */

let scriptPromise: Promise<HlsCtor> | null = null;

function isCtor(value: unknown): value is HlsCtor {
  return typeof value === 'function' && typeof (value as { isSupported?: unknown }).isSupported === 'function';
}

/** window.WGLiveHls when our own file has run, else null. Never window.Hls. */
export function loadedHlsCtor(): HlsCtor | null {
  const value = (window as unknown as { WGLiveHls?: unknown }).WGLiveHls;
  return isCtor(value) ? value : null;
}

/** Inject wg-live-hls.js once; a failed load is forgotten so a later retry injects it again. */
export function loadHlsScript(url: string | null | undefined): Promise<HlsCtor> {
  const ready = loadedHlsCtor();
  if (ready) return Promise.resolve(ready);
  if (scriptPromise) return scriptPromise;
  if (!url || safeUrl(url) === null) return Promise.reject(new Error('No script URL for the HLS library.'));
  const script = document.createElement('script');
  const promise = new Promise<HlsCtor>((resolve, reject) => {
    script.addEventListener(
      'load',
      () => {
        const ctor = loadedHlsCtor();
        if (ctor) resolve(ctor);
        else reject(new Error('wg-live-hls did not define WGLiveHls.'));
      },
      { once: true },
    );
    script.addEventListener('error', () => reject(new Error('wg-live-hls failed to load.')), { once: true });
  });
  scriptPromise = promise;
  promise.catch(() => {
    if (scriptPromise === promise) scriptPromise = null;
    script.remove();
  });
  script.src = url;
  script.async = true;
  script.dataset.wgLive = 'hls';
  document.head.append(script);
  return promise;
}

/** Start fetching the library before the click (no-op when loaded or without a URL). */
export function preloadHls(url: string | null | undefined): void {
  if (!url || loadedHlsCtor()) return;
  loadHlsScript(url).catch(() => undefined);
}

/** Preload hls.js only where this element will use it (the hls.js path; never on native HLS). */
export function prepareHlsLibrary(media: HTMLMediaElement, env: AdapterEnv, win: Window = window): void {
  if (chooseHlsPath(media, win) === 'hlsjs') preloadHls(env.hlsScriptUrl);
}

export function __resetHlsLoaderForTests(): void {
  scriptPromise = null;
}

/** Dev only: the number of live Hls instances on the page (M2-PLAN C4 asserts it never exceeds one). */
function countInstance(delta: 1 | -1): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __wgLiveHlsCount?: number };
  w.__wgLiveHlsCount = (w.__wgLiveHlsCount ?? 0) + delta;
}

function abortError(message = 'The operation was aborted.'): DOMException {
  return new DOMException(message, 'AbortError');
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

/**
 * 0.5.1 (user decision 2026-11-02: the live stream is plain http): an http stream on an https page is mixed content,
 * which browsers block or upgrade to https, so it never plays in the page. Refuse it before any request; the ticket
 * holder's personal link (VLC / Safari) is the way to listen.
 */
export function isMixedContent(url: string, win: Window): boolean {
  try {
    return win.location?.protocol === 'https:' && new URL(url).protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * 0.5.2 (user decision 2026-11-02: the sound must play the same way as opening the link). A browser that plays HLS
 * itself (Safari on Mac, iPhone, iPad) cannot load an http stream inside the https page, yet plays the very same link
 * when it opens it. Then Start opens the link in the browser's own player instead of refusing it. Feature detection
 * only; the hls.js browsers (no E-AC-3) keep the VLC link panel.
 */
export function opensInBrowserPlayer(source: PlaybackSource, media: HTMLMediaElement, win: Window): boolean {
  if (source.kind !== 'hls' || !isMixedContent(source.url, win)) return false;
  return chooseHlsPath(media, win) === 'native' && canPlayMode(source.mode, 'native', media, win) !== false;
}

export function createHlsAdapter(host: MediaHost, env: AdapterEnv, deps: HlsDeps = {}): PlaybackAdapter {
  const primary = createSingleHlsAdapter(host, env, deps);
  // 0.5.1: only a video stage can show a separate picture link; an audio stage always plays the one link.
  return host.media.tagName === 'VIDEO' ? createPictureAndSoundAdapter(primary, host, env, deps) : primary;
}

const ADAPTER_EVENTS: readonly AdapterEvent[] = ['playing', 'paused', 'waiting', 'stalled', 'ended', 'error'];

/**
 * 0.5.1 (user decision 2026-11-02): a video event may take its picture from a separate HLS link. Then the stage
 * <video> plays the picture link muted and a hidden <audio> owned by this adapter plays the Dolby Atmos link; one
 * click starts both and pause stops both. The sound drives the player: its events, errors, mute and volume. A picture
 * failure is swallowed and the sound goes on (the stage then has no picture). Two live streams: picture and sound can
 * be a second or two apart. Without a videoUrl the stage plays the one link exactly as before.
 */
function createPictureAndSoundAdapter(picture: PlaybackAdapter, host: MediaHost, env: AdapterEnv, deps: HlsDeps): PlaybackAdapter {
  const listeners = new Map<AdapterEvent, Set<(detail?: AdapterErrorDetail) => void>>();
  const emit = (event: AdapterEvent, detail?: AdapterErrorDetail): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(detail);
  };
  const forward = (adapter: PlaybackAdapter): (() => void) => {
    const offs = ADAPTER_EVENTS.map((event) => adapter.on(event, (detail) => emit(event, detail)));
    return () => offs.forEach((off) => off());
  };

  let unforward = forward(picture);
  let sound: { el: HTMLAudioElement; adapter: PlaybackAdapter } | null = null;
  let destroyed = false;

  const dropSound = (): void => {
    if (!sound) return;
    sound.adapter.destroy();
    sound.el.remove();
    sound = null;
  };

  return {
    kind: 'hls',
    get capabilities() {
      // The sound's controls; fullscreen belongs to the picture.
      return sound ? { ...sound.adapter.capabilities, fullscreen: picture.capabilities.fullscreen } : picture.capabilities;
    },

    load(source, signal) {
      if (destroyed) return picture.load(source, signal);
      if (source.kind !== 'hls' || !source.videoUrl) {
        if (sound) {
          unforward();
          dropSound();
          unforward = forward(picture);
          host.media.muted = false;
        }
        return picture.load(source, signal);
      }
      if (!sound) {
        const el = document.createElement('audio');
        el.preload = 'none';
        el.hidden = true;
        el.className = 'wg-live__sound';
        host.media.insertAdjacentElement('afterend', el);
        unforward();
        sound = { el, adapter: createSingleHlsAdapter({ media: el, frameSlot: host.frameSlot }, env, deps) };
        unforward = forward(sound.adapter);
      }
      host.media.muted = true;
      // The sound first: a refused sound (no E-AC-3, mixed content) fails before the picture is fetched.
      const heard = sound.adapter.load({ kind: 'hls', url: source.url, mode: source.mode }, signal);
      // The picture link carries no Dolby Atmos requirement ('binaural' skips the E-AC-3 check); its failure is not
      // the player's (no listener sees it) and never stops the sound.
      picture.load({ kind: 'hls', url: source.videoUrl, mode: 'binaural' }, signal).catch(() => undefined);
      return heard;
    },

    play() {
      if (!sound) return picture.play();
      // Both inside the same click (the sound is the one that counts; a muted picture may start on its own).
      picture.play().catch(() => undefined);
      return sound.adapter.play();
    },

    pause() {
      picture.pause();
      sound?.adapter.pause();
    },

    setMuted(muted) {
      if (!sound) {
        picture.setMuted(muted);
        return;
      }
      sound.adapter.setMuted(muted);
      picture.setMuted(true);
    },

    setVolume(volume) {
      (sound?.adapter ?? picture).setVolume(volume);
    },

    seekToLive() {
      picture.seekToLive();
      sound?.adapter.seekToLive();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      unforward();
      listeners.clear();
      picture.destroy();
      dropSound();
    },

    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => {
        listeners.get(event)?.delete(listener);
      };
    },
  };
}

function createSingleHlsAdapter(host: MediaHost, env: AdapterEnv, deps: HlsDeps): PlaybackAdapter {
  const win = deps.win ?? window;
  const path = chooseHlsPath(host.media, win);
  if (path === 'native') {
    return createNativeMediaAdapter(host, env, {
      kind: 'hls',
      loop: false,
      refuse: (source) =>
        source.kind === 'hls' && (isMixedContent(source.url, win) || canPlayMode(source.mode, 'native', host.media, win) === false)
          ? { code: 'unsupported', fatal: true }
          : null,
    });
  }
  return createHlsJsAdapter(host, env, win, deps);
}

interface Pending {
  resolve: () => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

function createHlsJsAdapter(host: MediaHost, env: AdapterEnv, win: Window, deps: HlsDeps): PlaybackAdapter {
  const media = host.media;
  const loadedHls = deps.loadedHls ?? loadedHlsCtor;
  const loadHls = deps.loadHls ?? (() => loadHlsScript(env.hlsScriptUrl));
  const canLoad = deps.loadHls !== undefined || Boolean(env.hlsScriptUrl);
  const token = {};

  const subscribers = new Map<AdapterEvent, Set<{ fn: Listener }>>();
  let destroyed = false;
  let failed = false;
  let recovered = false;
  let live = false;
  let seq = 0;
  let pending: Pending | null = null;
  let hls: HlsInstance | null = null;
  let hlsOff: (() => void) | null = null;
  /** Resolves when this load's Hls instance is attached; play() before that waits on it. */
  let attached: Promise<boolean> | null = null;
  let detachElement: (() => void) | null = null;

  const emit = (event: AdapterEvent, detail?: AdapterErrorDetail): void => {
    if (destroyed) return;
    for (const entry of [...(subscribers.get(event) ?? [])]) {
      try {
        entry.fn(detail);
      } catch {
        // A listener must not break the others.
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

  /** Report a failure once per load(): one `error` event, and reject a still-pending load(). */
  const fail = (detail: AdapterErrorDetail): void => {
    if (destroyed || failed) return;
    failed = true;
    emit('error', detail);
    settle('reject', new AdapterLoadError(detail));
  };

  const isActive = (): boolean => !destroyed && ownsMedia(media, token);

  const onReady = (): void => {
    if (!destroyed) settle('resolve');
  };
  const handlers: Array<[string, () => void]> = [
    ['playing', () => emit('playing')],
    [
      'pause',
      () => {
        if (media.paused) emit('paused');
      },
    ],
    ['waiting', () => emit('waiting')],
    ['stalled', () => emit('stalled')],
    ['ended', () => emit('ended')],
    ['loadedmetadata', onReady],
    ['canplay', onReady],
  ];
  const attachElement = (): void => {
    if (detachElement) return;
    for (const [type, fn] of handlers) media.addEventListener(type, fn);
    detachElement = () => {
      for (const [type, fn] of handlers) media.removeEventListener(type, fn);
      detachElement = null;
    };
  };

  /** Remove our library listeners, then destroy the instance. */
  const teardownHls = (): void => {
    if (hlsOff) hlsOff();
    hlsOff = null;
    const h = hls;
    hls = null;
    if (!h) return;
    try {
      h.destroy();
    } catch {
      // ignore
    }
    countInstance(-1);
  };

  const start = (ctor: HlsCtor, url: string): void => {
    const names = { error: ctor.Events?.ERROR ?? 'hlsError', level: ctor.Events?.LEVEL_LOADED ?? 'hlsLevelLoaded' };
    const types = { network: ctor.ErrorTypes?.NETWORK_ERROR ?? 'networkError', media: ctor.ErrorTypes?.MEDIA_ERROR ?? 'mediaError' };
    const instance = new ctor({ ...HLS_CONFIG });
    countInstance(1);
    hls = instance;

    const onError = (_event: string, data: HlsErrorData): void => {
      if (destroyed || hls !== instance) return;
      if (UNSUPPORTED_DETAILS.has(String(data?.details ?? ''))) {
        fail({ code: 'unsupported', fatal: true });
        return;
      }
      if (data?.fatal !== true) return;
      if (data.type === types.network) {
        fail({ code: 'network', fatal: false });
        return;
      }
      if (data.type === types.media && !recovered) {
        recovered = true;
        try {
          instance.recoverMediaError();
        } catch {
          fail({ code: 'decode', fatal: true });
        }
        return;
      }
      fail({ code: data.type === types.media ? 'decode' : 'unknown', fatal: true });
    };
    const onLevel = (_event: string, data: { details?: { live?: unknown } }): void => {
      if (hls === instance) live = data?.details?.live === true;
    };
    instance.on(names.error, onError as (event: string, data: never) => void);
    instance.on(names.level, onLevel as (event: string, data: never) => void);
    hlsOff = () => {
      instance.off(names.error, onError as (event: string, data: never) => void);
      instance.off(names.level, onLevel as (event: string, data: never) => void);
    };

    media.preload = 'auto';
    instance.attachMedia(media);
    instance.loadSource(url);
  };

  const playNow = (): Promise<void> => {
    let result: Promise<void> | undefined;
    try {
      result = media.play();
    } catch (error) {
      return Promise.reject(error);
    }
    return result ?? Promise.resolve();
  };

  const adapter: PlaybackAdapter = {
    kind: 'hls',

    get capabilities(): PlayerCapabilities {
      return {
        playPause: true,
        mute: true,
        volume: env.volumeSettable,
        // Only a live playlist has a live edge to go back to.
        seekToLive: live,
        fullscreen: canFullscreen(media),
        remotePlayback: false,
        reliablePlaybackEvents: true,
      };
    },

    load(source: LoadableSource, signal: AbortSignal): Promise<void> {
      if (destroyed) return Promise.reject(abortError('The adapter was destroyed.'));
      if (signal.aborted) return Promise.reject(abortError());

      settle('reject', abortError('Superseded by a newer load.'));
      failed = false;
      recovered = false;
      live = false;
      seq += 1;
      const mine = seq;
      // One instance at most: the previous one goes before anything else happens.
      teardownHls();
      attached = null;

      const promise = new Promise<void>((resolve, reject) => {
        const onAbort = (): void => settle('reject', abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        pending = { resolve, reject, cleanup: () => signal.removeEventListener('abort', onAbort) };
      });
      promise.catch(() => undefined);

      const href = source.kind === 'hls' ? safeUrl(source.url) : null;
      let protocolOk = false;
      if (href !== null) {
        try {
          const protocol = new URL(href).protocol;
          protocolOk = protocol === 'https:' || protocol === 'http:';
        } catch {
          protocolOk = false;
        }
      }
      if (source.kind !== 'hls' || href === null || !protocolOk) {
        fail({ code: 'unknown', fatal: true });
        return promise;
      }
      // Before any request: an http stream on an https page (mixed content), a track this browser cannot decode, or
      // no MSE at all.
      if (isMixedContent(href, win) || canPlayMode(source.mode, chooseHlsPath(media, win), media, win) === false) {
        fail({ code: 'unsupported', fatal: true });
        return promise;
      }

      const ready = loadedHls();
      if (!ready && !canLoad) {
        fail({ code: 'unsupported', fatal: true });
        return promise;
      }
      claimMedia(media, token);
      attachElement();
      if (ready) {
        start(ready, href);
        attached = Promise.resolve(true);
        return promise;
      }
      attached = loadHls().then(
        (ctor) => {
          if (destroyed || mine !== seq || signal.aborted) return false;
          start(ctor, href);
          return true;
        },
        () => {
          if (!destroyed && mine === seq) fail({ code: 'network', fatal: true });
          return false;
        },
      );
      return promise;
    },

    play(): Promise<void> {
      if (destroyed) return Promise.reject(abortError('The adapter was destroyed.'));
      const wait = attached;
      if (!wait || !isActive()) return Promise.reject(new DOMException('No playable source is loaded.', 'NotSupportedError'));
      if (hls) return playNow();
      // The library is still loading: play once it is attached (outside the click; a refusal surfaces as
      // NotAllowedError and the coordinator asks for one more click).
      return wait.then((ok) => (ok && !destroyed && isActive() ? playNow() : Promise.reject(abortError())));
    },

    pause(): void {
      if (isActive()) media.pause();
    },

    setMuted(muted: boolean): void {
      if (isActive()) media.muted = muted === true;
    },

    setVolume(volume: number): void {
      if (!isActive() || !env.volumeSettable || !Number.isFinite(volume)) return;
      media.volume = Math.min(1, Math.max(0, volume));
    },

    seekToLive(): void {
      if (!isActive() || !live || !hls) return;
      const position = hls.liveSyncPosition;
      if (typeof position !== 'number' || !Number.isFinite(position)) return;
      try {
        media.currentTime = position;
      } catch {
        // ignore
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // Own listeners first, so nothing of the reset below reaches anybody.
      if (detachElement) detachElement();
      subscribers.clear();
      settle('reject', abortError('The adapter was destroyed.'));
      teardownHls();
      attached = null;
      if (!releaseMedia(media, token)) return;
      try {
        media.pause();
      } catch {
        // ignore
      }
      media.removeAttribute('src');
      media.preload = 'none';
      try {
        media.load(); // no further network activity
      } catch {
        // ignore
      }
    },

    on(event: AdapterEvent, listener: Listener): () => void {
      if (destroyed) return () => undefined;
      let set = subscribers.get(event);
      if (!set) {
        set = new Set();
        subscribers.set(event, set);
      }
      const entry = { fn: listener };
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
  };

  return adapter;
}
