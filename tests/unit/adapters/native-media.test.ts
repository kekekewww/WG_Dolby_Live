import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAdapter } from '../../../src/adapters/demo';
import { AdapterLoadError, classifyMediaFailure, createNativeMediaAdapter } from '../../../src/adapters/native-media';
import type { AdapterErrorDetail, AdapterEvent, MediaHost, PlaybackAdapter } from '../../../src/types';

const DEMO = { kind: 'demo', url: 'https://cdn.example.test/demo-tone-1.mp3', mimeType: 'audio/mpeg' } as const;

function makeHost(tag: 'audio' | 'video' = 'audio'): MediaHost {
  const media = document.createElement(tag);
  media.preload = 'none';
  document.body.append(media);
  return { media, frameSlot: document.createElement('div') };
}

/** Define an own property on the element to stand in for read-only DOM state jsdom does not drive. */
function setProp(media: HTMLMediaElement, name: string, value: unknown): void {
  Object.defineProperty(media, name, { value, configurable: true, writable: true });
}

function ranges(...spans: Array<[number, number]>): TimeRanges {
  return {
    length: spans.length,
    start: (i: number) => spans[i]?.[0] ?? 0,
    end: (i: number) => spans[i]?.[1] ?? 0,
  } as TimeRanges;
}

function collect(adapter: PlaybackAdapter, ...events: AdapterEvent[]): Array<[AdapterEvent, AdapterErrorDetail | undefined]> {
  const seen: Array<[AdapterEvent, AdapterErrorDetail | undefined]> = [];
  for (const event of events) adapter.on(event, (detail) => seen.push([event, detail]));
  return seen;
}

let host: MediaHost;
let media: HTMLMediaElement;
let controller: AbortController;

beforeEach(() => {
  document.body.replaceChildren();
  host = makeHost();
  media = host.media;
  controller = new AbortController();
  vi.spyOn(media, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(media, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(media, 'pause').mockImplementation(() => undefined);
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('load()', () => {
  it('assigns src synchronously, without <source> children, and does not start playback', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    expect(media.getAttribute('src')).toBe(DEMO.url);
    expect(media.querySelector('source')).toBeNull();
    expect(media.play).not.toHaveBeenCalled();
    expect(media.preload).toBe('auto');
    adapter.destroy();
  });

  it('never creates or replaces the element', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    adapter.destroy();
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(document.querySelector('audio')).toBe(media);
  });

  it('resolves on loadedmetadata', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const loaded = adapter.load(DEMO, controller.signal);
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(loaded).resolves.toBeUndefined();
    adapter.destroy();
  });

  it('resolves on canplay when loadedmetadata never came', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const loaded = adapter.load(DEMO, controller.signal);
    media.dispatchEvent(new Event('canplay'));
    await expect(loaded).resolves.toBeUndefined();
    adapter.destroy();
  });

  it('rejects with AbortError when the signal aborts, and emits no error', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const errors = collect(adapter, 'error');
    const loaded = adapter.load(DEMO, controller.signal);
    controller.abort();
    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
    expect(errors).toEqual([]);
    adapter.destroy();
  });

  it('rejects immediately and leaves the element alone when the signal is already aborted', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    controller.abort();
    await expect(adapter.load(DEMO, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(media.hasAttribute('src')).toBe(false);
    adapter.destroy();
  });

  it('a second load() supersedes the first and settles it with AbortError', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const first = adapter.load(DEMO, controller.signal);
    const second = adapter.load({ ...DEMO, url: 'https://cdn.example.test/demo-tone-2.mp3' }, controller.signal);
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(second).resolves.toBeUndefined();
    expect(media.getAttribute('src')).toBe('https://cdn.example.test/demo-tone-2.mp3');
    adapter.destroy();
  });

  it('rejects a non-http(s) or unparseable url as unknown and never assigns it', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const errors = collect(adapter, 'error');
    const loaded = adapter.load({ kind: 'demo', url: 'javascript:alert(1)', mimeType: 'audio/mpeg' }, controller.signal);
    await expect(loaded).rejects.toBeInstanceOf(AdapterLoadError);
    expect(media.hasAttribute('src')).toBe(false);
    expect(errors).toEqual([['error', { code: 'unknown', fatal: true }]]);
    adapter.destroy();
  });

  it('does not accept hls/iframe sources (their adapters are separate)', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const loaded = adapter.load({ kind: 'hls', url: 'https://cdn.example.test/live.m3u8', mode: 'atmos' }, controller.signal);
    await expect(loaded).rejects.toMatchObject({ detail: { code: 'unknown' } });
    expect(media.hasAttribute('src')).toBe(false);
    adapter.destroy();
  });
});

describe('demo adapter', () => {
  it('has kind demo and sets media.loop while it owns the element', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    expect(adapter.kind).toBe('demo');
    expect(media.loop).toBe(false);
    void adapter.load(DEMO, controller.signal);
    expect(media.loop).toBe(true);
    adapter.destroy();
    expect(media.loop).toBe(false);
  });

  it('a plain native adapter does not loop', () => {
    const adapter = createNativeMediaAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    expect(media.loop).toBe(false);
    adapter.destroy();
  });
});

describe('error classification (plan 6.5)', () => {
  function loadWithErrors(): { adapter: PlaybackAdapter; errors: ReturnType<typeof collect>; loaded: Promise<void> } {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const errors = collect(adapter, 'error');
    const loaded = adapter.load(DEMO, controller.signal);
    return { adapter, errors, loaded };
  }

  function mediaError(code: number, readyState = 0): void {
    setProp(media, 'error', { code });
    setProp(media, 'readyState', readyState);
    media.dispatchEvent(new Event('error'));
  }

  it('canPlayType() === "" before load -> unsupported, no src, play() rejects', async () => {
    vi.spyOn(media, 'canPlayType').mockReturnValue('');
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const errors = collect(adapter, 'error');
    await expect(adapter.load(DEMO, controller.signal)).rejects.toMatchObject({ detail: { code: 'unsupported', fatal: true } });
    expect(errors).toEqual([['error', { code: 'unsupported', fatal: true }]]);
    expect(media.hasAttribute('src')).toBe(false);
    await expect(adapter.play()).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(media.play).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    adapter.destroy();
  });

  it('navigator.onLine === false -> network', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { adapter, errors, loaded } = loadWithErrors();
    mediaError(4, 0);
    await expect(loaded).rejects.toMatchObject({ detail: { code: 'network' } });
    expect(errors).toEqual([['error', { code: 'network', fatal: true }]]);
    adapter.destroy();
  });

  it('MediaError 2 -> network', async () => {
    const { adapter, errors, loaded } = loadWithErrors();
    mediaError(2);
    await expect(loaded).rejects.toBeInstanceOf(AdapterLoadError);
    expect(errors).toEqual([['error', { code: 'network', fatal: true }]]);
    adapter.destroy();
  });

  it('MediaError 3 -> decode', async () => {
    const { adapter, errors, loaded } = loadWithErrors();
    mediaError(3, 1);
    await expect(loaded).rejects.toBeInstanceOf(AdapterLoadError);
    expect(errors).toEqual([['error', { code: 'decode', fatal: true }]]);
    adapter.destroy();
  });

  it('MediaError 4 with HAVE_NOTHING after a non-empty canPlayType -> network (fetch failed)', async () => {
    const { adapter, errors, loaded } = loadWithErrors();
    mediaError(4, 0);
    await expect(loaded).rejects.toBeInstanceOf(AdapterLoadError);
    expect(errors).toEqual([['error', { code: 'network', fatal: true }]]);
    adapter.destroy();
  });

  it('MediaError 4 after metadata -> unsupported', async () => {
    const { adapter, errors } = loadWithErrors();
    media.dispatchEvent(new Event('loadedmetadata'));
    mediaError(4, 1);
    expect(errors).toEqual([['error', { code: 'unsupported', fatal: true }]]);
    adapter.destroy();
  });

  it('an unknown or missing MediaError -> unknown', () => {
    const { adapter, errors } = loadWithErrors();
    setProp(media, 'error', null);
    media.dispatchEvent(new Event('error'));
    expect(errors).toEqual([['error', { code: 'unknown', fatal: true }]]);
    adapter.destroy();
  });

  it('play() NotSupportedError with HAVE_NOTHING -> network, reported once with the media error', async () => {
    const { adapter, errors } = loadWithErrors();
    setProp(media, 'readyState', 0);
    vi.spyOn(media, 'play').mockRejectedValue(new DOMException('no', 'NotSupportedError'));
    await expect(adapter.play()).rejects.toMatchObject({ name: 'NotSupportedError' });
    await Promise.resolve();
    setProp(media, 'error', { code: 4 });
    media.dispatchEvent(new Event('error'));
    expect(errors).toEqual([['error', { code: 'network', fatal: true }]]);
    adapter.destroy();
  });

  it('play() NotSupportedError after metadata -> unsupported', async () => {
    const { adapter, errors } = loadWithErrors();
    setProp(media, 'readyState', 2);
    vi.spyOn(media, 'play').mockRejectedValue(new DOMException('no', 'NotSupportedError'));
    await expect(adapter.play()).rejects.toMatchObject({ name: 'NotSupportedError' });
    await Promise.resolve();
    expect(errors).toEqual([['error', { code: 'unsupported', fatal: true }]]);
    adapter.destroy();
  });

  it('play() NotAllowedError and AbortError reject unchanged and emit no error event', async () => {
    const { adapter, errors } = loadWithErrors();
    const blocked = new DOMException('blocked', 'NotAllowedError');
    vi.spyOn(media, 'play').mockRejectedValueOnce(blocked);
    await expect(adapter.play()).rejects.toBe(blocked);
    const aborted = new DOMException('interrupted', 'AbortError');
    vi.spyOn(media, 'play').mockRejectedValueOnce(aborted);
    await expect(adapter.play()).rejects.toBe(aborted);
    await Promise.resolve();
    expect(errors).toEqual([]);
    adapter.destroy();
  });

  it('an error after the load resolved still emits (mid-playback failure) but only once', async () => {
    const { adapter, errors, loaded } = loadWithErrors();
    media.dispatchEvent(new Event('loadedmetadata'));
    await loaded;
    mediaError(2, 4);
    mediaError(2, 4);
    expect(errors).toEqual([['error', { code: 'network', fatal: true }]]);
    adapter.destroy();
  });

  it('a new load() re-arms error reporting', () => {
    const { adapter, errors } = loadWithErrors();
    mediaError(2);
    void adapter.load(DEMO, controller.signal);
    mediaError(3, 1);
    expect(errors.map(([, d]) => d?.code)).toEqual(['network', 'decode']);
    adapter.destroy();
  });

  it('classifyMediaFailure orders unsupported before offline before MediaError codes', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(classifyMediaFailure({ readyState: 0 }, 3, false).code).toBe('unsupported');
    expect(classifyMediaFailure({ readyState: 1 }, 3, true).code).toBe('network');
  });
});

describe('play() and element events', () => {
  it('play() returns the element promise unchanged', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    const elementPromise = Promise.resolve();
    vi.spyOn(media, 'play').mockReturnValue(elementPromise);
    expect(adapter.play()).toBe(elementPromise);
    adapter.destroy();
  });

  it('play() tolerates engines that return undefined', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    vi.spyOn(media, 'play').mockReturnValue(undefined as unknown as Promise<void>);
    await expect(adapter.play()).resolves.toBeUndefined();
    adapter.destroy();
  });

  it('play() before any load rejects NotSupportedError without touching the element', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    await expect(adapter.play()).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(media.play).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it('maps element events to adapter events', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const seen = collect(adapter, 'playing', 'paused', 'waiting', 'stalled', 'ended');
    void adapter.load(DEMO, controller.signal);
    for (const type of ['playing', 'pause', 'waiting', 'stalled', 'ended']) media.dispatchEvent(new Event(type));
    expect(seen.map(([name]) => name)).toEqual(['playing', 'paused', 'waiting', 'stalled', 'ended']);
    adapter.destroy();
  });

  it('ignores a stale queued pause event while the element is playing again', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const seen = collect(adapter, 'paused');
    void adapter.load(DEMO, controller.signal);
    setProp(media, 'paused', false);
    media.dispatchEvent(new Event('pause'));
    expect(seen).toEqual([]);
    setProp(media, 'paused', true);
    media.dispatchEvent(new Event('pause'));
    expect(seen).toHaveLength(1);
    adapter.destroy();
  });

  it('on() returns an unsubscribe function and a throwing listener does not break the others', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const second = vi.fn();
    adapter.on('playing', () => {
      throw new Error('listener bug');
    });
    const off = adapter.on('playing', second);
    void adapter.load(DEMO, controller.signal);
    media.dispatchEvent(new Event('playing'));
    expect(second).toHaveBeenCalledTimes(1);
    off();
    media.dispatchEvent(new Event('playing'));
    expect(second).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it('pause(), setMuted(), setVolume() act on the element', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    adapter.pause();
    expect(media.pause).toHaveBeenCalledTimes(1);
    adapter.setMuted(true);
    expect(media.muted).toBe(true);
    adapter.setMuted(false);
    expect(media.muted).toBe(false);
    adapter.setVolume(0.4);
    expect(media.volume).toBeCloseTo(0.4);
    adapter.setVolume(7);
    expect(media.volume).toBe(1);
    adapter.setVolume(-1);
    expect(media.volume).toBe(0);
    adapter.destroy();
  });

  it('setVolume() is a no-op where the environment cannot set volume (iOS)', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: false });
    void adapter.load(DEMO, controller.signal);
    media.volume = 0.8;
    adapter.setVolume(0.1);
    expect(media.volume).toBe(0.8);
    adapter.setMuted(true);
    expect(media.muted).toBe(true);
    adapter.destroy();
  });
});

describe('capabilities (per instance, plan 6.10)', () => {
  it('audio file: playPause, mute, no live/fullscreen/remote; volume follows the environment', () => {
    const withVolume = createDemoAdapter(host, { volumeSettable: true });
    expect(withVolume.capabilities).toEqual({
      playPause: true,
      mute: true,
      volume: true,
      seekToLive: false,
      fullscreen: false,
      remotePlayback: false,
      reliablePlaybackEvents: true,
    });
    const withoutVolume = createDemoAdapter(host, { volumeSettable: false });
    expect(withoutVolume.capabilities.volume).toBe(false);
    expect(withoutVolume.capabilities.mute).toBe(true);
  });

  it('seekToLive only when the duration is Infinity and something is seekable after loadedmetadata', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const loaded = adapter.load(DEMO, controller.signal);
    setProp(media, 'duration', Infinity);
    setProp(media, 'seekable', ranges([0, 120]));
    expect(adapter.capabilities.seekToLive).toBe(false); // not final before loadedmetadata
    media.dispatchEvent(new Event('loadedmetadata'));
    await loaded;
    expect(adapter.capabilities.seekToLive).toBe(true);

    setProp(media, 'currentTime', 0);
    adapter.seekToLive();
    expect(media.currentTime).toBe(120);
    adapter.destroy();
  });

  it('no seekToLive for a finite duration or an empty seekable range', async () => {
    for (const [duration, seekable] of [
      [30, ranges([0, 30])],
      [Infinity, ranges()],
    ] as const) {
      const adapter = createDemoAdapter(host, { volumeSettable: true });
      const loaded = adapter.load(DEMO, new AbortController().signal);
      setProp(media, 'duration', duration);
      setProp(media, 'seekable', seekable);
      media.dispatchEvent(new Event('loadedmetadata'));
      await loaded;
      expect(adapter.capabilities.seekToLive).toBe(false);
      setProp(media, 'currentTime', 5);
      adapter.seekToLive();
      expect(media.currentTime).toBe(5);
      adapter.destroy();
    }
  });

  it('fullscreen only for <video> with a fullscreen API', () => {
    const videoHost = makeHost('video');
    const video = videoHost.media;
    expect(createNativeMediaAdapter(videoHost, { volumeSettable: true }).capabilities.fullscreen).toBe(false);

    setProp(video, 'requestFullscreen', () => Promise.resolve());
    expect(createNativeMediaAdapter(videoHost, { volumeSettable: true }).capabilities.fullscreen).toBe(true);

    const iosHost = makeHost('video');
    setProp(iosHost.media, 'webkitEnterFullscreen', () => undefined);
    expect(createNativeMediaAdapter(iosHost, { volumeSettable: false }).capabilities.fullscreen).toBe(true);

    // <audio> never gets a fullscreen control, even with the API present.
    setProp(media, 'requestFullscreen', () => Promise.resolve());
    expect(createNativeMediaAdapter(host, { volumeSettable: true }).capabilities.fullscreen).toBe(false);
  });

  it('never claims remote playback in M1', () => {
    expect(createDemoAdapter(host, { volumeSettable: true }).capabilities.remotePlayback).toBe(false);
  });

  it('returns a fresh object each time (callers cannot mutate adapter state)', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const caps = adapter.capabilities;
    (caps as { playPause: boolean }).playPause = false;
    expect(adapter.capabilities.playPause).toBe(true);
  });
});

describe('destroy()', () => {
  it('removes its listeners BEFORE pause, removeAttribute(src) and load', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    const remove = vi.spyOn(media, 'removeEventListener');
    const removeAttr = vi.spyOn(media, 'removeAttribute');
    adapter.destroy();

    const lastRemove = Math.max(...remove.mock.invocationCallOrder);
    const firstReset = Math.min(
      ...vi.mocked(media.pause).mock.invocationCallOrder,
      ...removeAttr.mock.invocationCallOrder,
      ...vi.mocked(media.load).mock.invocationCallOrder,
    );
    expect(remove).toHaveBeenCalled();
    expect(lastRemove).toBeLessThan(firstReset);

    const pauseAt = vi.mocked(media.pause).mock.invocationCallOrder[0] ?? 0;
    const attrAt = removeAttr.mock.invocationCallOrder[0] ?? 0;
    const loadAt = vi.mocked(media.load).mock.invocationCallOrder[0] ?? 0;
    expect(pauseAt).toBeLessThan(attrAt);
    expect(attrAt).toBeLessThan(loadAt);
    expect(removeAttr).toHaveBeenCalledWith('src');
    expect(media.hasAttribute('src')).toBe(false);
    expect(media.preload).toBe('none');
  });

  it('events fired by the reset itself reach nobody', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const seen = collect(adapter, 'paused', 'error', 'playing');
    void adapter.load(DEMO, controller.signal);
    vi.mocked(media.pause).mockImplementation(() => {
      media.dispatchEvent(new Event('pause'));
    });
    vi.mocked(media.load).mockImplementation(() => {
      media.dispatchEvent(new Event('emptied'));
      media.dispatchEvent(new Event('error'));
    });
    adapter.destroy();
    expect(seen).toEqual([]);
  });

  it('is idempotent', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    void adapter.load(DEMO, controller.signal);
    adapter.destroy();
    adapter.destroy();
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(media.load).toHaveBeenCalledTimes(1);
  });

  it('rejects a pending load with AbortError and silences later events and calls', async () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const seen = collect(adapter, 'playing', 'error');
    const loaded = adapter.load(DEMO, controller.signal);
    adapter.destroy();
    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });

    media.dispatchEvent(new Event('playing'));
    media.dispatchEvent(new Event('error'));
    expect(seen).toEqual([]);
    await expect(adapter.play()).rejects.toMatchObject({ name: 'AbortError' });
    await expect(adapter.load(DEMO, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(media.hasAttribute('src')).toBe(false);
    expect(adapter.on('playing', () => undefined)()).toBeUndefined();
  });

  it('removes the abort listener from the signal (no leak across sources)', () => {
    const adapter = createDemoAdapter(host, { volumeSettable: true });
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    void adapter.load(DEMO, controller.signal);
    adapter.destroy();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('a superseded adapter cannot reset the element the next adapter is using', () => {
    const old = createDemoAdapter(host, { volumeSettable: true });
    void old.load(DEMO, controller.signal);
    const next = createDemoAdapter(host, { volumeSettable: true });
    const nextUrl = 'https://cdn.example.test/demo-tone-2.mp3';
    void next.load({ ...DEMO, url: nextUrl }, controller.signal);

    old.destroy(); // late destroy of the old adapter
    expect(media.getAttribute('src')).toBe(nextUrl);
    expect(media.pause).not.toHaveBeenCalled();
    expect(media.load).not.toHaveBeenCalled();

    // and its operations no longer reach the element
    old.pause();
    old.setMuted(true);
    expect(media.pause).not.toHaveBeenCalled();
    expect(media.muted).toBe(false);

    next.destroy();
    expect(media.hasAttribute('src')).toBe(false);
  });

  it('destroy(old) then load(new) in one tick leaves the new source in place', () => {
    const old = createDemoAdapter(host, { volumeSettable: true });
    void old.load(DEMO, controller.signal);
    old.destroy();
    const next = createDemoAdapter(host, { volumeSettable: true });
    const nextUrl = 'https://cdn.example.test/demo-tone-2.mp3';
    void next.load({ ...DEMO, url: nextUrl }, controller.signal);
    expect(media.getAttribute('src')).toBe(nextUrl);
    next.destroy();
  });
});
