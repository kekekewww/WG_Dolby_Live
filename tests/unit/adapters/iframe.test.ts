import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIframeAdapter } from '../../../src/adapters/iframe';
import { AdapterLoadError } from '../../../src/adapters/native-media';
import type { AdapterErrorDetail, MediaHost, PlaybackAdapter } from '../../../src/types';

const ORIGIN = 'https://player.example.test';
const BIN = { kind: 'iframe', url: `${ORIGIN}/embed?track=binaural&token=a`, allowedOrigin: ORIGIN } as const;
const ATMOS = { kind: 'iframe', url: `${ORIGIN}/embed?track=atmos&token=b`, allowedOrigin: ORIGIN } as const;

let host: MediaHost;
let controller: AbortController;

beforeEach(() => {
  document.body.replaceChildren();
  const media = document.createElement('video');
  const frameSlot = document.createElement('div');
  frameSlot.hidden = true;
  document.body.append(media, frameSlot);
  host = { media, frameSlot };
  controller = new AbortController();
});

afterEach(() => vi.useRealTimers());

const make = (): PlaybackAdapter => createIframeAdapter(host, { volumeSettable: true, frameTitle: '秋季音樂會・串流服務播放器' });
const frames = (): HTMLIFrameElement[] => [...document.querySelectorAll('iframe')];

function errors(a: PlaybackAdapter): AdapterErrorDetail[] {
  const seen: AdapterErrorDetail[] = [];
  a.on('error', (d) => seen.push(d as AdapterErrorDetail));
  return seen;
}

describe('iframe adapter (M2-PLAN D2)', () => {
  it('claims no capability: our own controls never drive the provider player', () => {
    expect(Object.values(make().capabilities).every((v) => v === false)).toBe(true);
    expect(make().kind).toBe('iframe');
  });

  it.each([
    ['plain http', { ...BIN, url: 'http://player.example.test/embed', allowedOrigin: 'http://player.example.test' }],
    ['origin mismatch', { ...BIN, allowedOrigin: 'https://other.example.test' }],
    ['javascript url', { ...BIN, url: 'javascript:alert(1)' }],
  ])('refuses %s and creates no frame', async (_name, source) => {
    const a = make();
    const seen = errors(a);
    await expect(a.load(source, controller.signal)).rejects.toBeInstanceOf(AdapterLoadError);
    expect(frames()).toHaveLength(0);
    expect(seen).toEqual([{ code: 'unsupported', fatal: true }]);
  });

  it('creates one titled frame in the slot, hides the media element, and resolves on the frame load event', async () => {
    const a = make();
    const loaded = a.load(BIN, controller.signal);
    const [frame] = frames();
    expect(frames()).toHaveLength(1);
    expect(frame?.parentElement).toBe(host.frameSlot);
    expect(frame?.getAttribute('src')).toBe(BIN.url);
    expect(frame?.title).toBe('秋季音樂會・串流服務播放器');
    expect(frame?.hasAttribute('allow')).toBe(false);
    expect(host.frameSlot.hidden).toBe(false);
    expect(host.media.hidden).toBe(true);
    frame?.dispatchEvent(new Event('load'));
    await expect(loaded).resolves.toBeUndefined();
    await expect(a.play()).resolves.toBeUndefined();
  });

  it('rejects after 20 s without a load event (a network failure the coordinator may retry)', async () => {
    vi.useFakeTimers();
    const a = make();
    const seen = errors(a);
    const loaded = a.load(BIN, controller.signal);
    vi.advanceTimersByTime(20_000);
    await expect(loaded).rejects.toBeInstanceOf(AdapterLoadError);
    expect(seen).toEqual([{ code: 'network', fatal: true }]);
  });

  it('Binaural → Atmos → Binaural keeps exactly one frame; destroy removes it, shows the media again, safe twice', () => {
    for (const source of [BIN, ATMOS, BIN]) {
      const a = make();
      void a.load(source, controller.signal);
      expect(frames()).toHaveLength(1);
      expect(frames()[0]?.getAttribute('src')).toBe(source.url);
      a.destroy();
      a.destroy();
      expect(frames()).toHaveLength(0);
    }
    expect(host.frameSlot.hidden).toBe(true);
    expect(host.media.hidden).toBe(false);
  });

  it('a second load() on the same adapter replaces the frame', () => {
    const a = make();
    void a.load(BIN, controller.signal);
    const first = frames()[0];
    void a.load(ATMOS, controller.signal);
    expect(frames()).toHaveLength(1);
    expect(frames()[0]).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    a.destroy();
  });
});
