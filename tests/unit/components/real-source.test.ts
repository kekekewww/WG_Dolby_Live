/**
 * M2-PLAN C3: what a viewer of a real (hls) event sees. No demo labels, honest unsupported copy, and controls only
 * for what the adapter can do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventCard } from '../../../src/components/event-card';
import { createModeSelector } from '../../../src/components/mode-selector';
import { createPlayerControls } from '../../../src/components/player-controls';
import { createStatusPanel } from '../../../src/components/status-panel';
import { DEMO_MEDIA_NOTICE } from '../../../src/i18n/copy';
import { createInitialState } from '../../../src/state/model';
import type { AppState, PublicEvent } from '../../../src/types';
import { FULL_CAPS, LINKS, attach, createFakeController, makeBoot, makeEvent } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

const REAL: PublicEvent = makeEvent({
  isDemo: false,
  sourceKind: 'hls',
  title: '秋季音樂會',
  performers: ['弦樂四重奏'],
  description: '錄音室現場演出。',
  programme: ['第一首', '第二首'],
  status: 'live',
  poster: null,
  posterUrl: null,
});

function realState(player: Partial<AppState['player']>, capabilities = FULL_CAPS): AppState {
  const base = createInitialState(makeBoot({ events: [REAL], deploymentMode: 'live' }), REAL, null);
  return { ...base, entitlement: 'entitled', capabilities, player: { ...base.player, ...player } };
}

const playing = (caps = FULL_CAPS): AppState =>
  realState(
    { status: 'playing', selectedMode: 'binaural', preparedMode: 'binaural', loadedMode: 'binaural', activeMode: 'binaural', confirmedPlaying: true, lastGoodMode: 'binaural' },
    caps,
  );

function panelFor(state: AppState): HTMLElement {
  const panel = createStatusPanel({ controller: createFakeController(state), headingTag: 'h3', links: LINKS, event: REAL, onSwitchMode: vi.fn(), onViewEvent: vi.fn() });
  attach(panel.el);
  panel.update(state);
  return panel.el;
}

const shown = (root: HTMLElement): string =>
  Array.from(root.querySelectorAll<HTMLElement>('*'))
    .filter((el) => !el.hidden && !el.closest('[hidden]') && el.children.length === 0)
    .map((el) => el.textContent ?? '')
    .join(' | ');

describe('real (hls) sources in the UI (M2-PLAN C3)', () => {
  it('the state of a real event is hls and never demo media', () => {
    const s = playing();
    expect(s.source).toBe('hls');
    expect(s.isDemoMedia).toBe(false);
  });

  it('never shows the demo audio notice while a real source plays', () => {
    expect(shown(panelFor(playing()))).not.toContain(DEMO_MEDIA_NOTICE);
  });

  it('the event card of a real event has no 介面示範 badge or demo note', () => {
    const card = createEventCard({ event: REAL, boot: makeBoot({ events: [REAL] }), featured: false, headingTag: 'h3', nowMs: Date.parse(REAL.startsAt), signal: new AbortController().signal });
    attach(card.el);
    const text = card.el.textContent ?? '';
    expect(text).not.toContain('介面示範');
    expect(text).not.toContain('操作示範');
  });

  it('Atmos unsupported here: 目前環境無法播放這個音訊版本, and the Binaural choice stays enabled', () => {
    const failed = realState({ status: 'failed', selectedMode: 'atmos', error: { code: 'unsupported', mode: 'atmos', publicCode: 'E-SRC-01' } });
    expect(shown(panelFor(failed))).toContain('目前環境無法播放這個音訊版本');
    const selector = createModeSelector({ onSelect: vi.fn(), headingTag: 'h3' } as never);
    attach(selector.el);
    selector.update({ selected: 'atmos', available: REAL.availableModes });
    expect(selector.inputs.binaural.disabled).toBe(false);
  });

  it('返回直播 appears only when the adapter reports a live edge', () => {
    for (const [seekToLive, expected] of [
      [false, 0],
      [true, 1],
    ] as const) {
      const state = playing({ ...FULL_CAPS, seekToLive });
      const controls = createPlayerControls({ controller: createFakeController(state), media: document.createElement('video') } as never);
      attach(controls.el);
      controls.update(state);
      const live = Array.from(controls.el.querySelectorAll<HTMLElement>('button')).filter((b) => !b.hidden && !b.closest('[hidden]') && b.textContent === '返回直播');
      expect(live).toHaveLength(expected);
      controls.destroy();
      document.body.replaceChildren();
    }
  });
});
