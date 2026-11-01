import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHlsLoaderForTests, createHlsAdapter, prepareHlsLibrary, type HlsCtor } from '../../../src/adapters/hls';
import { AdapterLoadError } from '../../../src/adapters/native-media';
import type { AdapterErrorDetail, AdapterEnv, MediaHost, PlaybackAdapter } from '../../../src/types';

const BIN = { kind: 'hls', url: 'https://stream.example.test/live/binaural/index.m3u8?t=1', mode: 'binaural' } as const;
const ATMOS = { kind: 'hls', url: 'https://stream.example.test/live/atmos/index.m3u8?t=1', mode: 'atmos' } as const;
const SCRIPT = 'https://sounds.example.test/wp-content/plugins/wg-live/assets/dist/wg-live-hls.js?ver=0123456789ab';

type Listener = (event: string, data: Record<string, unknown>) => void;

/** Records what the adapter does with the library; the statics mirror hls.js's names and values. */
class FakeHls {
  static instances: FakeHls[] = [];
  static log: string[] = [];
  static Events = { ERROR: 'hlsError', LEVEL_LOADED: 'hlsLevelLoaded', MANIFEST_PARSED: 'hlsManifestParsed' };
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError', OTHER_ERROR: 'otherError' };
  static ErrorDetails = {
    MANIFEST_INCOMPATIBLE_CODECS_ERROR: 'manifestIncompatibleCodecsError',
    BUFFER_ADD_CODEC_ERROR: 'bufferAddCodecError',
    BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError',
    FRAG_LOAD_ERROR: 'fragLoadError',
    BUFFER_STALLED_ERROR: 'bufferStalledError',
  };
  static isSupported(): boolean {
    return true;
  }
  readonly id: number;
  media: HTMLMediaElement | null = null;
  source: string | null = null;
  destroyed = false;
  recovered = 0;
  liveSyncPosition: number | null = 120;
  private listeners = new Map<string, Set<Listener>>();
  constructor(readonly config: Record<string, unknown>) {
    this.id = FakeHls.instances.length + 1;
    FakeHls.instances.push(this);
    FakeHls.log.push(`new ${this.id}`);
  }
  on(event: string, fn: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(fn);
  }
  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }
  attachMedia(media: HTMLMediaElement): void {
    this.media = media;
    media.setAttribute('src', `blob:mse-${this.id}`);
  }
  loadSource(url: string): void {
    this.source = url;
  }
  recoverMediaError(): void {
    this.recovered += 1;
  }
  destroy(): void {
    this.destroyed = true;
    FakeHls.log.push(`destroy ${this.id}`);
  }
  emit(event: string, data: Record<string, unknown>): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(event, data);
  }
  get listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

const Ctor = FakeHls as unknown as HlsCtor;
const CHROME_LIKE = { MediaSource: { isTypeSupported: (t: string) => !t.includes('ec-3') } } as unknown as Window;
const EDGE_LIKE = { MediaSource: { isTypeSupported: () => true } } as unknown as Window;

let host: MediaHost;
let media: HTMLVideoElement;
let controller: AbortController;
const env: AdapterEnv = { volumeSettable: true, hlsScriptUrl: SCRIPT };

function errors(adapter: PlaybackAdapter): AdapterErrorDetail[] {
  const seen: AdapterErrorDetail[] = [];
  adapter.on('error', (d) => seen.push(d as AdapterErrorDetail));
  return seen;
}

/** An adapter whose library is already loaded (the usual case: the player preloads it before the click). */
function loaded(win: Window = CHROME_LIKE): PlaybackAdapter {
  return createHlsAdapter(host, env, { win, loadedHls: () => Ctor, loadHls: () => Promise.resolve(Ctor) });
}

const last = (): FakeHls => FakeHls.instances[FakeHls.instances.length - 1] as FakeHls;

beforeEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  __resetHlsLoaderForTests();
  FakeHls.instances = [];
  FakeHls.log = [];
  media = document.createElement('video');
  media.preload = 'none';
  document.body.append(media);
  host = { media, frameSlot: document.createElement('div') };
  controller = new AbortController();
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.spyOn(media, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(media, 'pause').mockImplementation(() => undefined);
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).WGLiveHls;
  delete (window as unknown as Record<string, unknown>).Hls;
});

describe('HLS adapter: hls.js path', () => {
  it('attaches the shared element and loads the URL synchronously, without starting playback', () => {
    const adapter = loaded();
    void adapter.load(BIN, controller.signal);
    expect(adapter.kind).toBe('hls');
    expect(FakeHls.instances).toHaveLength(1);
    expect(last().media).toBe(media);
    expect(last().source).toBe(BIN.url);
    expect(last().config).toMatchObject({ lowLatencyMode: false, enableWorker: true });
    expect(media.play).not.toHaveBeenCalled();
    expect(document.querySelectorAll('video')).toHaveLength(1);
    adapter.destroy();
  });

  it('refuses Atmos before any request when the browser cannot decode E-AC-3 (Review Focus 4)', async () => {
    const loadHls = vi.fn(() => Promise.resolve(Ctor));
    const adapter = createHlsAdapter(host, env, { win: CHROME_LIKE, loadedHls: () => Ctor, loadHls });
    const seen = errors(adapter);
    const result = adapter.load(ATMOS, controller.signal);
    await expect(result).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    expect(FakeHls.instances).toHaveLength(0);
    expect(loadHls).not.toHaveBeenCalled();
    expect(media.getAttribute('src')).toBeNull();
  });

  it('Atmos goes ahead where E-AC-3 is supported', () => {
    const adapter = loaded(EDGE_LIKE);
    void adapter.load(ATMOS, controller.signal);
    expect(last().source).toBe(ATMOS.url);
    adapter.destroy();
  });

  it('two load() calls never leave two instances: the first is destroyed before the second is made', () => {
    const adapter = loaded();
    void adapter.load(BIN, controller.signal);
    void adapter.load({ ...BIN, url: `${BIN.url}&again` }, controller.signal);
    expect(FakeHls.log).toEqual(['new 1', 'destroy 1', 'new 2']);
    expect(FakeHls.instances.filter((h) => !h.destroyed)).toHaveLength(1);
    adapter.destroy();
  });

  it('destroy(): own listeners first, then hls.destroy(), src removed, load(); safe twice; nothing after it', () => {
    const adapter = loaded();
    const seen = errors(adapter);
    const playing = vi.fn();
    adapter.on('playing', playing);
    void adapter.load(BIN, controller.signal);
    const hls = last();
    adapter.destroy();
    adapter.destroy();
    expect(hls.destroyed).toBe(true);
    expect(hls.listenerCount).toBe(0);
    expect(media.getAttribute('src')).toBeNull();
    expect(media.load).toHaveBeenCalledTimes(1);
    media.dispatchEvent(new Event('playing'));
    hls.emit('hlsError', { type: 'networkError', details: 'fragLoadError', fatal: true });
    expect(playing).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('resolves load() when the element has metadata', async () => {
    const adapter = loaded();
    const result = adapter.load(BIN, controller.signal);
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBeUndefined();
    adapter.destroy();
  });

  it('a fatal network error (an expired token answering 403) is reported as network, not fatal (Review Focus 5)', () => {
    const adapter = loaded();
    const seen = errors(adapter);
    void adapter.load(BIN, controller.signal);
    last().emit('hlsError', { type: 'networkError', details: 'fragLoadError', fatal: true, response: { code: 403 } });
    expect(seen).toEqual([{ code: 'network', fatal: false }]);
    adapter.destroy();
  });

  it('a fatal media error is recovered once, then reported as decode', () => {
    const adapter = loaded();
    const seen = errors(adapter);
    void adapter.load(BIN, controller.signal);
    last().emit('hlsError', { type: 'mediaError', details: 'bufferStalledError', fatal: true });
    expect(last().recovered).toBe(1);
    expect(seen).toEqual([]);
    last().emit('hlsError', { type: 'mediaError', details: 'bufferStalledError', fatal: true });
    expect(last().recovered).toBe(1);
    expect(seen).toEqual([{ code: 'decode', fatal: true }]);
    adapter.destroy();
  });

  it.each(['manifestIncompatibleCodecsError', 'bufferAddCodecError', 'bufferIncompatibleCodecsError'])('%s is unsupported (fatal), whatever hls.js says', (details) => {
    const adapter = loaded();
    const seen = errors(adapter);
    void adapter.load(BIN, controller.signal);
    last().emit('hlsError', { type: 'mediaError', details, fatal: details === 'manifestIncompatibleCodecsError' });
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    adapter.destroy();
  });

  it('ignores non-fatal errors (the coordinator tolerates the library retrying)', () => {
    const adapter = loaded();
    const seen = errors(adapter);
    void adapter.load(BIN, controller.signal);
    last().emit('hlsError', { type: 'networkError', details: 'fragLoadError', fatal: false });
    expect(seen).toEqual([]);
    adapter.destroy();
  });

  it('seekToLive is offered only for a live playlist and goes to the live sync position', () => {
    const adapter = loaded();
    void adapter.load(BIN, controller.signal);
    expect(adapter.capabilities.seekToLive).toBe(false);
    last().emit('hlsLevelLoaded', { details: { live: true } });
    expect(adapter.capabilities.seekToLive).toBe(true);
    adapter.seekToLive();
    expect(media.currentTime).toBe(120);
    expect(adapter.capabilities).toMatchObject({ playPause: true, mute: true, volume: true, remotePlayback: false, reliablePlaybackEvents: true });
    adapter.destroy();
  });
});

describe('HLS adapter: loading the library', () => {
  it('injects the plugin\'s own script once, uses only window.WGLiveHls, and ignores another plugin\'s window.Hls', async () => {
    const theirs = vi.fn();
    (window as unknown as Record<string, unknown>).Hls = theirs;
    const a = createHlsAdapter(host, env, { win: CHROME_LIKE });
    const b = createHlsAdapter(host, env, { win: CHROME_LIKE });
    void a.load(BIN, controller.signal);
    a.destroy();
    void b.load(BIN, controller.signal);
    const scripts = [...document.querySelectorAll('script')].filter((s) => s.src === SCRIPT);
    expect(scripts).toHaveLength(1);
    expect(FakeHls.instances).toHaveLength(0);

    (window as unknown as Record<string, unknown>).WGLiveHls = FakeHls;
    scripts[0]?.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(FakeHls.instances).toHaveLength(1));
    expect(last().media).toBe(media);
    expect(theirs).not.toHaveBeenCalled();
    b.destroy();
  });

  it('prepareHlsLibrary preloads the script only on the hls.js path (M2-PLAN C3)', () => {
    vi.mocked(media.canPlayType).mockImplementation((t) => (t === 'application/vnd.apple.mpegurl' ? 'maybe' : ''));
    prepareHlsLibrary(media, env, { ManagedMediaSource: {}, MediaSource: {} } as unknown as Window);
    expect(document.querySelectorAll('script')).toHaveLength(0);
    prepareHlsLibrary(media, env, CHROME_LIKE);
    prepareHlsLibrary(media, env, CHROME_LIKE);
    expect([...document.querySelectorAll('script')].map((s) => s.src)).toEqual([SCRIPT]);
  });

  it('play() before the library is ready waits for the attach and then plays', async () => {
    let release: (c: HlsCtor) => void = () => undefined;
    const adapter = createHlsAdapter(host, env, { win: CHROME_LIKE, loadedHls: () => null, loadHls: () => new Promise((r) => (release = r)) });
    void adapter.load(BIN, controller.signal);
    const played = adapter.play();
    expect(media.play).not.toHaveBeenCalled();
    release(Ctor);
    await played;
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(last().source).toBe(BIN.url);
    adapter.destroy();
  });

  it('a script that fails to load is a network failure the coordinator may retry', async () => {
    const adapter = createHlsAdapter(host, env, { win: CHROME_LIKE, loadedHls: () => null, loadHls: () => Promise.reject(new Error('blocked')) });
    const seen = errors(adapter);
    await expect(adapter.load(BIN, controller.signal)).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'network', fatal: true }]);
  });

  it('without a script URL nothing is injected and the source is unsupported', async () => {
    const adapter = createHlsAdapter(host, { volumeSettable: true, hlsScriptUrl: null }, { win: CHROME_LIKE });
    const seen = errors(adapter);
    await expect(adapter.load(BIN, controller.signal)).rejects.toBeInstanceOf(AdapterLoadError);
    expect(document.querySelectorAll('script')).toHaveLength(0);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
  });
});

describe('HLS adapter: native path', () => {
  it('plays the URL on the element itself (no hls.js) when the element has native HLS and ManagedMediaSource', () => {
    vi.mocked(media.canPlayType).mockImplementation((t) => (t === 'application/vnd.apple.mpegurl' ? 'maybe' : ''));
    const loadHls = vi.fn(() => Promise.resolve(Ctor));
    const win = { ManagedMediaSource: { isTypeSupported: () => true }, MediaSource: { isTypeSupported: () => true } } as unknown as Window;
    const adapter = createHlsAdapter(host, env, { win, loadedHls: () => Ctor, loadHls });
    void adapter.load(BIN, controller.signal);
    expect(adapter.kind).toBe('hls');
    expect(media.getAttribute('src')).toBe(BIN.url);
    expect(FakeHls.instances).toHaveLength(0);
    expect(loadHls).not.toHaveBeenCalled();
    expect(media.play).not.toHaveBeenCalled();
    adapter.destroy();
    expect(media.getAttribute('src')).toBeNull();
  });

  it('native Atmos without E-AC-3 support is refused before the element loads anything', async () => {
    vi.mocked(media.canPlayType).mockImplementation((t) => (t === 'application/vnd.apple.mpegurl' ? 'maybe' : ''));
    const adapter = createHlsAdapter(host, env, { win: {} as Window, loadedHls: () => Ctor });
    const seen = errors(adapter);
    await expect(adapter.load(ATMOS, controller.signal)).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    expect(media.getAttribute('src')).toBeNull();
  });
});

describe('0.5.1: an http stream on an https page (mixed content)', () => {
  const HTTP_ATMOS = { kind: 'hls', url: 'http://198.51.100.7:1935/live/atmos/playlist.m3u8', mode: 'atmos' } as const;
  const EC3 = { isTypeSupported: () => true };

  it('hls.js path: refused as unsupported before hls.js loads or any request is made', async () => {
    const loadHls = vi.fn(() => Promise.resolve(Ctor));
    const win = { MediaSource: EC3, location: { protocol: 'https:' } } as unknown as Window;
    const adapter = createHlsAdapter(host, env, { win, loadedHls: () => Ctor, loadHls });
    const seen = errors(adapter);
    await expect(adapter.load(HTTP_ATMOS, controller.signal)).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    expect(FakeHls.instances).toHaveLength(0);
    expect(loadHls).not.toHaveBeenCalled();
  });

  it('native path (Safari): refused before the element gets the URL', async () => {
    vi.mocked(media.canPlayType).mockImplementation((t) => (t === 'application/vnd.apple.mpegurl' ? 'maybe' : 'probably'));
    const win = { ManagedMediaSource: EC3, MediaSource: EC3, location: { protocol: 'https:' } } as unknown as Window;
    const adapter = createHlsAdapter(host, env, { win, loadedHls: () => Ctor });
    const seen = errors(adapter);
    await expect(adapter.load(HTTP_ATMOS, controller.signal)).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    expect(media.getAttribute('src')).toBeNull();
  });

  it('the same http stream on an http page is loaded as usual', () => {
    const win = { MediaSource: EC3, location: { protocol: 'http:' } } as unknown as Window;
    const adapter = createHlsAdapter(host, env, { win, loadedHls: () => Ctor, loadHls: () => Promise.resolve(Ctor) });
    void adapter.load(HTTP_ATMOS, controller.signal);
    expect(FakeHls.instances).toHaveLength(1);
    adapter.destroy();
  });
});

describe('0.5.1: picture and sound from two links (video muted + Dolby Atmos sound)', () => {
  const DUAL = { kind: 'hls', url: 'https://s.example.test/atmos.m3u8', mode: 'atmos', videoUrl: 'https://s.example.test/video.m3u8' } as const;
  const onMedia = (el: Element | null): FakeHls | undefined => [...FakeHls.instances].reverse().find((h) => h.media === el && !h.destroyed);
  const soundEl = (): HTMLAudioElement | null => document.querySelector<HTMLAudioElement>('audio.wg-live__sound');

  beforeEach(() => {
    // jsdom has no media pipeline: the hidden <audio> the adapter creates needs these too.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  it('loads the picture link into the stage <video> (muted) and the Atmos link into its own hidden <audio>', () => {
    const adapter = loaded(EDGE_LIKE);
    void adapter.load(DUAL, controller.signal);
    expect(FakeHls.instances).toHaveLength(2);
    expect(onMedia(media)?.source).toBe(DUAL.videoUrl);
    const sound = soundEl();
    expect(sound).not.toBeNull();
    expect(sound?.hidden).toBe(true);
    expect(onMedia(sound)?.source).toBe(DUAL.url);
    expect(media.muted).toBe(true);
    expect(media.play).not.toHaveBeenCalled();
    adapter.destroy();
    expect(soundEl()).toBeNull();
    expect(FakeHls.instances.every((h) => h.destroyed)).toBe(true);
  });

  it('one click plays both, pause pauses both; mute and volume act on the sound, the picture stays muted', () => {
    const adapter = loaded(EDGE_LIKE);
    void adapter.load(DUAL, controller.signal);
    const sound = soundEl() as HTMLAudioElement;
    // The stage <video> has its own spies (outer beforeEach); the adapter's <audio> uses the prototype ones.
    const playSpy = vi.mocked(HTMLMediaElement.prototype.play);
    playSpy.mockClear();
    void adapter.play();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(playSpy.mock.contexts as unknown as HTMLMediaElement[]).toContain(sound);
    const pauseSpy = vi.mocked(HTMLMediaElement.prototype.pause);
    pauseSpy.mockClear();
    adapter.pause();
    expect(media.pause).toHaveBeenCalled();
    expect(pauseSpy.mock.contexts as unknown as HTMLMediaElement[]).toContain(sound);
    adapter.setMuted(true);
    expect(sound.muted).toBe(true);
    adapter.setMuted(false);
    expect(sound.muted).toBe(false);
    expect(media.muted).toBe(true);
    adapter.setVolume(0.4);
    expect(sound.volume).toBeCloseTo(0.4);
    adapter.destroy();
  });

  it('a failing picture never reaches the player; a failing sound does', () => {
    const adapter = loaded(EDGE_LIKE);
    const seen = errors(adapter);
    void adapter.load(DUAL, controller.signal);
    onMedia(media)?.emit('hlsError', { type: 'mediaError', details: 'manifestIncompatibleCodecsError', fatal: true });
    expect(seen).toEqual([]);
    onMedia(soundEl())?.emit('hlsError', { type: 'mediaError', details: 'manifestIncompatibleCodecsError', fatal: true });
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    adapter.destroy();
  });

  it('without E-AC-3 the sound is refused before any request (the link panel takes over)', async () => {
    const adapter = loaded(CHROME_LIKE);
    const seen = errors(adapter);
    const load = adapter.load(DUAL, controller.signal);
    await expect(load).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
    expect(onMedia(soundEl())).toBeUndefined();
    adapter.destroy();
  });

  it('a source without videoUrl plays the one link on the stage, as before (no extra element)', () => {
    const adapter = loaded(EDGE_LIKE);
    void adapter.load(ATMOS, controller.signal);
    expect(FakeHls.instances).toHaveLength(1);
    expect(onMedia(media)?.source).toBe(ATMOS.url);
    expect(soundEl()).toBeNull();
    adapter.destroy();
  });

  it('a later one-link load drops the separate sound and unmutes the stage', () => {
    const adapter = loaded(EDGE_LIKE);
    void adapter.load(DUAL, controller.signal);
    void adapter.load(ATMOS, controller.signal);
    expect(soundEl()).toBeNull();
    expect(media.muted).toBe(false);
    expect(onMedia(media)?.source).toBe(ATMOS.url);
    adapter.destroy();
  });
});
