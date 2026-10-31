import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntitlementPlaceholder } from '../../../src/adapters/entitlement-placeholder';
import { createAdapterFactory } from '../../../src/adapters/factory';
import { createIframeAdapter } from '../../../src/adapters/iframe';
import { demoEvents } from '../../../src/fixtures/demo-events';
import type { MediaHost, PlaybackAdapter, PublicEvent } from '../../../src/types';

function makeHost(): MediaHost {
  const media = document.createElement('audio');
  media.preload = 'none';
  document.body.append(media);
  return { media, frameSlot: document.createElement('div') };
}

describe('createAdapterFactory', () => {
  let host: MediaHost;
  beforeEach(() => {
    document.body.replaceChildren();
    host = makeHost();
  });

  it('returns a demo adapter for kind demo', () => {
    const adapter = createAdapterFactory()('demo', host, { volumeSettable: true });
    expect(adapter.kind).toBe('demo');
    expect(adapter.capabilities.playPause).toBe(true);
    adapter.destroy();
  });

  it('returns the HLS adapter for kind hls (M2-PLAN C2)', () => {
    const adapter = createAdapterFactory()('hls', host, { volumeSettable: true, hlsScriptUrl: null });
    expect(adapter.kind).toBe('hls');
    expect(adapter.capabilities.playPause).toBe(true);
    adapter.destroy();
  });

  it.each(['iframe'] as const)('returns an inert %s stub that never touches the shared element', async (kind) => {
    const media = host.media;
    const spies = [vi.spyOn(media, 'play'), vi.spyOn(media, 'pause'), vi.spyOn(media, 'load'), vi.spyOn(media, 'removeAttribute')];
    const addListener = vi.spyOn(media, 'addEventListener');
    media.setAttribute('src', 'https://cdn.example.test/other.mp3'); // owned by someone else
    spies[3]!.mockClear();

    const adapter: PlaybackAdapter = createAdapterFactory()(kind, host, { volumeSettable: true });
    expect(adapter.kind).toBe(kind);
    const seen: unknown[] = [];
    for (const event of ['playing', 'paused', 'waiting', 'stalled', 'ended', 'error'] as const) {
      adapter.on(event, (d) => seen.push([event, d]))();
      adapter.on(event, (d) => seen.push([event, d]));
    }

    await expect(adapter.load({ kind: 'demo', url: 'https://x.test/a.mp3', mimeType: 'audio/mpeg' }, new AbortController().signal)).resolves.toBeUndefined();
    await expect(adapter.play()).resolves.toBeUndefined();
    adapter.pause();
    adapter.setMuted(true);
    adapter.setVolume(0.5);
    adapter.seekToLive();
    adapter.destroy();
    adapter.destroy();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(media.getAttribute('src')).toBe('https://cdn.example.test/other.mp3');
    expect(seen).toEqual([]); // never reports anything, in particular never 'unsupported'
  });

  it('stubs expose no capabilities, so no control renders', () => {
    for (const adapter of [createIframeAdapter()]) {
      expect(Object.values(adapter.capabilities).every((v) => v === false)).toBe(true);
    }
  });

  it('an unknown runtime kind still yields an inert adapter instead of throwing', () => {
    const adapter = createAdapterFactory()('mystery' as never, host, { volumeSettable: true });
    expect(() => adapter.destroy()).not.toThrow();
    expect(Object.values(adapter.capabilities).every((v) => v === false)).toBe(true);
  });

  it('every call returns a new adapter', () => {
    const factory = createAdapterFactory();
    const a = factory('demo', host, { volumeSettable: true });
    const b = factory('demo', host, { volumeSettable: true });
    expect(a).not.toBe(b);
    a.destroy();
    b.destroy();
  });
});

describe('createEntitlementPlaceholder (plan D6)', () => {
  const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
  const [live, scheduled] = demoEvents(NOW) as [PublicEvent, PublicEvent, ...PublicEvent[]];
  const real: PublicEvent = { ...live, id: 5001, slug: 'real-concert', isDemo: false, sourceKind: 'not_configured' };
  const demoNoSource: PublicEvent = { ...live, id: 5002, slug: 'demo-no-source', isDemo: true, sourceKind: 'not_configured' };
  const all = [live, scheduled, real, demoNoSource];

  it('a demo event with the demo source is entitled', async () => {
    await expect(createEntitlementPlaceholder(all).get(live.id)).resolves.toEqual({ status: 'entitled' });
  });

  it('a real event is unavailable/not_implemented, never entitled', async () => {
    await expect(createEntitlementPlaceholder(all).get(real.id)).resolves.toEqual({ status: 'unavailable', reason: 'not_implemented' });
  });

  it('a demo event without a demo source is unavailable', async () => {
    await expect(createEntitlementPlaceholder(all).get(demoNoSource.id)).resolves.toEqual({ status: 'unavailable', reason: 'not_implemented' });
  });

  it('an unknown event is unavailable and never fails open', async () => {
    await expect(createEntitlementPlaceholder(all).get(424242)).resolves.toMatchObject({ status: 'unavailable' });
    await expect(createEntitlementPlaceholder([]).get(live.id)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it.each(['guest', 'not_entitled', 'entitled', 'unavailable'] as const)('setOverride(%s) changes the display for demo events', async (status) => {
    const provider = createEntitlementPlaceholder(all);
    provider.setOverride(status);
    await expect(provider.get(live.id)).resolves.toMatchObject({ status });
  });

  it('setOverride(null) restores the default', async () => {
    const provider = createEntitlementPlaceholder(all);
    provider.setOverride('guest');
    provider.setOverride(null);
    await expect(provider.get(live.id)).resolves.toEqual({ status: 'entitled' });
  });

  it('the override never grants access to a non-demo event', async () => {
    const provider = createEntitlementPlaceholder(all);
    provider.setOverride('entitled');
    await expect(provider.get(real.id)).resolves.toEqual({ status: 'unavailable', reason: 'not_implemented' });
    await expect(provider.get(424242)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('a garbage override value never lets playback through', async () => {
    const provider = createEntitlementPlaceholder(all);
    provider.setOverride('unknown' as never);
    await expect(provider.get(live.id)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('rejects with AbortError when aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(createEntitlementPlaceholder(all).get(live.id, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('F7: setEvent makes the mirror answer for the CURRENT event data, not the mount-time one', async () => {
    const provider = createEntitlementPlaceholder(all);
    await expect(provider.get(demoNoSource.id)).resolves.toMatchObject({ status: 'unavailable' });
    provider.setEvent({ ...demoNoSource, sourceKind: 'demo' }); // the admin fixed the source; a poll delivered it
    await expect(provider.get(demoNoSource.id)).resolves.toEqual({ status: 'entitled' });
    provider.setEvent({ ...demoNoSource, sourceKind: 'not_configured' });
    await expect(provider.get(demoNoSource.id)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('F7: setEvent never grants a real (non-demo) event and learns events it did not know', async () => {
    const provider = createEntitlementPlaceholder([]);
    await expect(provider.get(real.id)).resolves.toMatchObject({ status: 'unavailable', reason: 'event_not_found' });
    provider.setEvent({ ...real, sourceKind: 'demo' });
    await expect(provider.get(real.id)).resolves.toEqual({ status: 'unavailable', reason: 'not_implemented' });
    provider.setEvent(live);
    await expect(provider.get(live.id)).resolves.toEqual({ status: 'entitled' });
  });

  it('makes no network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = createEntitlementPlaceholder(all);
    provider.setOverride('guest');
    await provider.get(live.id);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
