/**
 * Ticket holders' stream link for VLC or Safari (decision 2026-11-01, DECISION-2026-11-01-atmos-only.md): shown only to
 * an entitled viewer of a live HLS event whose browser cannot play the Atmos stream, or after playback failed. The link
 * is fetched from /playback on a click, a fresh one per click, never at page load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExternalLinkPanel } from '../../../src/components/external-link';
import type { AppState, ListeningMode, PlaybackSource } from '../../../src/types';
import { attach, makeEvent, makeState } from './helpers';

const URL_1 = 'https://stream.example.test/live/atmos/playlist.m3u8?token=one';
const URL_2 = 'https://stream.example.test/live/atmos/playlist.m3u8?token=two';
const HLS_EVENT = makeEvent({ isDemo: false, sourceKind: 'hls', availableModes: ['atmos'] });

function entitledLive(player: Partial<AppState['player']> = {}) {
  return makeState({ entitlement: 'entitled', source: 'hls', player: { status: 'selecting', selectedMode: 'atmos', ...player } }, HLS_EVENT);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createExternalLinkPanel', () => {
  it('stays hidden for a guest, a viewer without a ticket, a demo event, and a browser that can play the stream', () => {
    const resolve = vi.fn();
    const panel = createExternalLinkPanel({ event: HLS_EVENT, resolve, atmosPlayable: false });
    attach(panel.el);
    panel.update(makeState({ entitlement: 'guest', source: 'hls' }, HLS_EVENT));
    expect(panel.el.hidden).toBe(true);
    panel.update(makeState({ entitlement: 'not_entitled', source: 'hls' }, HLS_EVENT));
    expect(panel.el.hidden).toBe(true);
    panel.update(makeState({ entitlement: 'entitled', source: 'demo' }));
    expect(panel.el.hidden).toBe(true);

    const playable = createExternalLinkPanel({ event: HLS_EVENT, resolve, atmosPlayable: true });
    playable.update(entitledLive());
    expect(playable.el.hidden).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('shows the VLC and Safari steps to an entitled viewer whose browser cannot play Atmos, without a link until asked', () => {
    const resolve = vi.fn();
    const panel = createExternalLinkPanel({ event: HLS_EVENT, resolve, atmosPlayable: false });
    attach(panel.el);
    panel.update(entitledLive());
    expect(panel.el.hidden).toBe(false);
    expect(panel.el.textContent).toContain('VLC');
    expect(panel.el.textContent).toContain('Safari');
    expect(panel.el.querySelector('input')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('also shows after playback failed on a browser that should play it', () => {
    const panel = createExternalLinkPanel({ event: HLS_EVENT, resolve: vi.fn(), atmosPlayable: true });
    panel.update(entitledLive({ status: 'failed' }));
    expect(panel.el.hidden).toBe(false);
  });

  it('a click fetches a fresh link each time and shows it with a copy button', async () => {
    const resolve = vi
      .fn<(id: number, mode: ListeningMode) => Promise<PlaybackSource>>()
      .mockResolvedValueOnce({ kind: 'hls', url: URL_1, mode: 'atmos' })
      .mockResolvedValueOnce({ kind: 'hls', url: URL_2, mode: 'atmos' });
    const panel = createExternalLinkPanel({ event: HLS_EVENT, resolve, atmosPlayable: false });
    attach(panel.el);
    panel.update(entitledLive());
    const button = panel.el.querySelector<HTMLButtonElement>('button.wg-live__external-get')!;
    button.click();
    await flush();
    expect(resolve).toHaveBeenLastCalledWith(HLS_EVENT.id, 'atmos');
    expect(panel.el.querySelector<HTMLInputElement>('input')!.value).toBe(URL_1);
    expect(panel.el.querySelector('button.wg-live__external-copy')).not.toBeNull();
    button.click();
    await flush();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(panel.el.querySelector<HTMLInputElement>('input')!.value).toBe(URL_2);
  });

  it('shows a plain message and no link when the server hands out none', async () => {
    const resolve = vi.fn().mockResolvedValue({ kind: 'not_ready', reason: 'source_not_configured' });
    const panel = createExternalLinkPanel({ event: HLS_EVENT, resolve, atmosPlayable: false });
    attach(panel.el);
    panel.update(entitledLive());
    panel.el.querySelector<HTMLButtonElement>('button.wg-live__external-get')!.click();
    await flush();
    expect(panel.el.querySelector('input')).toBeNull();
    expect(panel.el.textContent).toContain('暫時無法取得播放連結');
  });
});
