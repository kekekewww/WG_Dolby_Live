import { describe, expect, it } from 'vitest';
import type { AppState, EntitlementStatus, EventStatus, ListeningMode, PlayerError, PublicEvent } from '../../../src/types';
import {
  createInitialState,
  isUrgentAnnouncement,
  normalizeSource,
  orderEvents,
  publicErrorCode,
  selectAnnouncement,
  selectCanStart,
  selectEntitlementPanel,
  selectErrorActions,
  selectGate,
  selectModeLabel,
  selectPrimaryCta,
  selectStatusMessage,
} from '../../../src/state/model';
import { statusCopy } from '../../../src/i18n/copy-status';
import { makeBoot, makeEvent } from './helpers';

function stateOf(
  event: PublicEvent | null,
  patch: {
    player?: Partial<AppState['player']>;
    entitlement?: EntitlementStatus;
    notReady?: AppState['notReady'];
    deploymentMode?: AppState['deploymentMode'];
    status?: EventStatus;
  } = {},
): AppState {
  const base = createInitialState(makeBoot({ deploymentMode: patch.deploymentMode ?? 'demo' }), event, null);
  return {
    ...base,
    event: { ...base.event, status: patch.status ?? base.event.status },
    entitlement: patch.entitlement ?? 'entitled',
    notReady: patch.notReady ?? null,
    player: { ...base.player, ...patch.player },
  };
}

function errorOf(code: PlayerError['code'], mode: ListeningMode | null = 'binaural'): PlayerError {
  return { code, mode, publicCode: publicErrorCode(code) };
}

describe('createInitialState', () => {
  it('starts idle with nothing selected', () => {
    const s = createInitialState(makeBoot(), makeEvent(), null);
    expect(s.player.status).toBe('idle');
    expect(s.player.selectedMode).toBeNull();
    expect(s.entitlement).toBe('unknown');
    expect(s.notReady).toBeNull();
    expect(s.capabilities).toBeNull();
    expect(s.deploymentMode).toBe('demo');
    expect(s.event).toEqual({ data: makeEvent(), status: 'live', simulated: false });
    expect(s.player).toMatchObject({ muted: false, volume: 1, retry: null, error: null, confirmedPlaying: false });
  });

  it('applies a valid preselect only', () => {
    expect(createInitialState(makeBoot(), makeEvent(), 'atmos').player).toMatchObject({ status: 'selecting', selectedMode: 'atmos' });
    expect(createInitialState(makeBoot(), makeEvent({ availableModes: ['binaural'] }), 'atmos').player.selectedMode).toBeNull();
    expect(createInitialState(makeBoot(), null, 'atmos').player.selectedMode).toBeNull();
  });

  it('carries the deployment mode and treats demo and hls (M2-PLAN C3) as configured sources', () => {
    expect(createInitialState(makeBoot({ deploymentMode: 'disabled' }), makeEvent(), null).deploymentMode).toBe('disabled');
    expect(normalizeSource('demo')).toBe('demo');
    expect(normalizeSource('hls')).toBe('hls');
    expect(normalizeSource('iframe')).toBe('not_configured');
    expect(normalizeSource(undefined)).toBe('not_configured');
    const s = createInitialState(makeBoot(), makeEvent({ sourceKind: 'hls' }), null);
    expect(s.source).toBe('hls');
    expect(s.isDemoMedia).toBe(false);
  });
});

describe('selectGate (plan 6.2 order 0-7)', () => {
  const cases: Array<[string, AppState, string, boolean]> = [
    ['0 disabled wins over everything', stateOf(makeEvent({ status: 'cancelled' }), { deploymentMode: 'disabled' }), 'disabled', false],
    ['1 no event', stateOf(null), 'not_found', false],
    ['2 cancelled', stateOf(makeEvent({ status: 'cancelled' })), 'cancelled', false],
    ['2 cancelled beats an unconfigured source', stateOf(makeEvent({ status: 'cancelled', sourceKind: 'not_configured' })), 'cancelled', false],
    ['3 ended', stateOf(makeEvent({ status: 'ended' })), 'ended', false],
    ['4 not configured', stateOf(makeEvent({ sourceKind: 'not_configured' })), 'not_configured', false],
    ['4 beats scheduled', stateOf(makeEvent({ status: 'scheduled', sourceKind: 'not_configured' })), 'not_configured', false],
    ['4 server iframe is not configured until M2-PLAN D2', stateOf(makeEvent({ sourceKind: 'iframe' })), 'not_configured', false],
    ['4 server hls is a configured source (M2-PLAN C3)', stateOf(makeEvent({ sourceKind: 'hls' })), 'open', false],
    ['5 scheduled', stateOf(makeEvent({ status: 'scheduled' })), 'scheduled', false],
    ['6 doors open', stateOf(makeEvent({ status: 'doors_open' })), 'doors_open', false],
    ['7 live', stateOf(makeEvent({ status: 'live' })), 'open', false],
    ['7 intermission', stateOf(makeEvent({ status: 'intermission' })), 'open', true],
  ];
  it.each(cases)('%s', (_name, state, kind, intermission) => {
    expect(selectGate(state)).toEqual({ kind, intermission });
  });

  it('uses the simulated status the state carries', () => {
    expect(selectGate(stateOf(makeEvent({ status: 'live' }), { status: 'ended' })).kind).toBe('ended');
  });
});

describe('selectCanStart (plan 6.2: gate 7 + entitled + prepared)', () => {
  const ready = { player: { status: 'selecting' as const, selectedMode: 'binaural' as const, preparedMode: 'binaural' as const } };

  it('is true only when all conditions hold', () => {
    expect(selectCanStart(stateOf(makeEvent(), ready))).toBe(true);
    expect(selectCanStart(stateOf(makeEvent({ status: 'intermission' }), ready))).toBe(true);
  });

  it.each([
    ['doors_open', stateOf(makeEvent({ status: 'doors_open' }), ready)],
    ['scheduled', stateOf(makeEvent({ status: 'scheduled' }), ready)],
    ['ended', stateOf(makeEvent({ status: 'ended' }), ready)],
    ['cancelled', stateOf(makeEvent({ status: 'cancelled' }), ready)],
    ['not configured', stateOf(makeEvent({ sourceKind: 'not_configured' }), ready)],
    ['disabled', stateOf(makeEvent(), { ...ready, deploymentMode: 'disabled' })],
    ['guest', stateOf(makeEvent(), { ...ready, entitlement: 'guest' })],
    ['not_entitled', stateOf(makeEvent(), { ...ready, entitlement: 'not_entitled' })],
    ['unavailable', stateOf(makeEvent(), { ...ready, entitlement: 'unavailable' })],
    ['unknown', stateOf(makeEvent(), { ...ready, entitlement: 'unknown' })],
    ['no selection', stateOf(makeEvent(), { player: { status: 'idle' } })],
    ['not prepared', stateOf(makeEvent(), { player: { ...ready.player, preparedMode: null } })],
    ['prepared another mode', stateOf(makeEvent(), { player: { ...ready.player, preparedMode: 'atmos' } })],
    ['server not_ready', stateOf(makeEvent(), { ...ready, notReady: 'mode_unavailable' })],
    ['already loading', stateOf(makeEvent(), { player: { ...ready.player, status: 'loading' } })],
    ['playing', stateOf(makeEvent(), { player: { ...ready.player, status: 'playing' } })],
    ['failed', stateOf(makeEvent(), { player: { ...ready.player, status: 'failed' } })],
  ])('is false: %s', (_name, state) => {
    expect(selectCanStart(state)).toBe(false);
  });
});

describe('selectStatusMessage', () => {
  it('gate messages, in plan 6.2 wording', () => {
    expect(selectStatusMessage(stateOf(makeEvent(), { deploymentMode: 'disabled' })).title).toBe('線上音樂會尚未開放');
    expect(selectStatusMessage(stateOf(null)).title).toBe('找不到這場活動');
    expect(selectStatusMessage(stateOf(makeEvent({ status: 'cancelled' }))).title).toBe('本場活動已取消');
    expect(selectStatusMessage(stateOf(makeEvent({ status: 'ended' }))).title).toBe('本場演出已結束');
    expect(selectStatusMessage(stateOf(makeEvent({ sourceKind: 'not_configured' }))).title).toBe('播放來源尚未開放');
    expect(selectStatusMessage(stateOf(makeEvent({ status: 'doors_open' }))).title).toBe('即將開放聆聽');
  });

  it('scheduled shows the start time in the event zone', () => {
    const m = selectStatusMessage(stateOf(makeEvent({ status: 'scheduled', startsAt: '2026-10-24T11:30:00Z' })));
    expect(m.title).toBe('演出尚未開始');
    expect(m.detail).toBe('開始時間：2026年10月24日（六）19:30 台北時間');
    expect(m.tone).toBe('info');
  });

  it('scheduled with an unreadable time says the time is pending', () => {
    const m = selectStatusMessage(stateOf(makeEvent({ status: 'scheduled', startsAt: 'garbage' })));
    expect(m.detail).toBe(statusCopy.time.tbd);
  });

  it('the gate beats the player status and the entitlement (entitlement is a separate panel)', () => {
    const s = stateOf(makeEvent({ status: 'ended' }), { entitlement: 'guest', player: { status: 'playing' } });
    expect(selectStatusMessage(s).title).toBe('本場演出已結束');
  });

  it('open: follows the player status', () => {
    const open = (status: AppState['player']['status'], extra: Partial<AppState['player']> = {}) =>
      selectStatusMessage(stateOf(makeEvent(), { player: { status, ...extra } }));
    expect(open('idle').title).toBe('請先選擇聆聽模式');
    expect(open('selecting', { selectedMode: 'binaural', preparedMode: 'binaural' }).title).toBe('按下「開始聆聽」即可播放');
    expect(open('selecting', { selectedMode: 'binaural', preparedMode: null }).title).toBe('正在確認播放來源');
    expect(open('loading').title).toBe('正在連接音訊');
    expect(open('playing').title).toBe('播放中');
    expect(open('paused').title).toBe('已暫停');
    expect(open('switching').title).toBe('正在切換聆聽模式');
    expect(open('reconnecting')).toMatchObject({ title: '連線暫時中斷，正在重新連線', tone: 'warning' });
  });

  it('open: play_blocked reads 請點擊開始聆聽', () => {
    const s = stateOf(makeEvent(), { player: { status: 'paused', error: errorOf('play_blocked') } });
    expect(selectStatusMessage(s)).toMatchObject({ title: '請點擊開始聆聽', tone: 'warning' });
  });

  it('open: failed shows the generic message and the public code, never a URL', () => {
    const s = stateOf(makeEvent(), { player: { status: 'failed', error: errorOf('network') } });
    const m = selectStatusMessage(s);
    expect(m.tone).toBe('error');
    expect(m.title).toBe('無法播放，請重試'); // nothing is retrying any more, so it must not say 正在重新連線
    expect(m.detail).toBe('錯誤代碼：E-NET-01');
    expect(`${m.title}${m.detail}`).not.toMatch(/https?:|\.mp3|\/media\//);
  });

  it('open: a failed switch also says the old mode is kept', () => {
    const s = stateOf(makeEvent(), {
      player: { status: 'failed', error: errorOf('decode', 'atmos'), lastGoodMode: 'binaural' },
    });
    expect(selectStatusMessage(s).detail).toBe('切換失敗，仍保留原模式：Binaural（錯誤代碼：E-DEC-01）');
  });

  it('intermission adds 演出中場休息', () => {
    const idle = selectStatusMessage(stateOf(makeEvent({ status: 'intermission' }), { player: { status: 'idle' } }));
    expect(idle.title).toBe('演出中場休息');
    expect(idle.detail).toBe('請先選擇聆聽模式');
    const playing = selectStatusMessage(stateOf(makeEvent({ status: 'intermission' }), { player: { status: 'playing' } }));
    expect(playing).toMatchObject({ title: '播放中', detail: '演出中場休息' });
  });

  it('a server not_ready reason wins over the player hint (plan 6.7)', () => {
    const msg = (reason: AppState['notReady']) =>
      selectStatusMessage(stateOf(makeEvent(), { notReady: reason, player: { status: 'selecting', selectedMode: 'atmos' } }));
    expect(msg('mode_unavailable').title).toBe('目前環境無法播放這個音訊版本');
    expect(msg('source_not_configured').title).toBe('播放來源尚未開放');
    expect(msg('event_not_found').title).toBe('找不到這場活動');
    expect(msg('disabled').title).toBe('線上音樂會尚未開放');
    expect(msg('not_entitled').title).toBe('尚未取得觀看資格');
    expect(msg('entitlement_unavailable').title).toBe('暫時無法確認觀看資格');
    expect(msg('event_not_playable').title).toBe('即將開放聆聽');
  });

  it('entitlement that is not entitled leaves a neutral live title instead of an invitation to press Start', () => {
    const s = stateOf(makeEvent(), { entitlement: 'guest', player: { status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' } });
    expect(selectStatusMessage(s).title).toBe('演出進行中');
  });
});

describe('selectModeLabel', () => {
  it('is null without a selection', () => {
    expect(selectModeLabel(stateOf(makeEvent()))).toBeNull();
  });
  it('is 已選擇 before playback is confirmed and 目前播放 after', () => {
    expect(selectModeLabel(stateOf(makeEvent(), { player: { selectedMode: 'atmos' } }))).toBe('已選擇：Dolby Atmos 音軌');
    expect(selectModeLabel(stateOf(makeEvent(), { player: { selectedMode: 'binaural', activeMode: 'binaural', confirmedPlaying: true } }))).toBe(
      '目前播放：Binaural',
    );
  });
  it('does not claim 目前播放 for an unconfirmed (loading) mode', () => {
    expect(
      selectModeLabel(stateOf(makeEvent(), { player: { status: 'loading', selectedMode: 'atmos', loadedMode: 'atmos', confirmedPlaying: false } })),
    ).toBe('已選擇：Dolby Atmos 音軌');
  });
  it('shows the pending mode while switching', () => {
    expect(
      selectModeLabel(stateOf(makeEvent(), { player: { status: 'switching', selectedMode: 'binaural', pendingMode: 'atmos', activeMode: 'binaural' } })),
    ).toBe('已選擇：Dolby Atmos 音軌');
  });
});

describe('selectEntitlementPanel', () => {
  it.each([
    ['guest', '請先登入'],
    ['not_entitled', '尚未取得觀看資格'],
    ['unavailable', '暫時無法確認觀看資格'],
  ] as const)('%s', (status, message) => {
    expect(selectEntitlementPanel(stateOf(makeEvent(), { entitlement: status }))).toEqual({ kind: status, message });
  });
  it('is empty for unknown and entitled', () => {
    expect(selectEntitlementPanel(stateOf(makeEvent(), { entitlement: 'unknown' }))).toBeNull();
    expect(selectEntitlementPanel(stateOf(makeEvent(), { entitlement: 'entitled' }))).toBeNull();
  });
  it('is shown next to scheduled and doors_open but not behind gates 0-4', () => {
    expect(selectEntitlementPanel(stateOf(makeEvent({ status: 'scheduled' }), { entitlement: 'guest' }))?.kind).toBe('guest');
    expect(selectEntitlementPanel(stateOf(makeEvent({ status: 'doors_open' }), { entitlement: 'guest' }))?.kind).toBe('guest');
    expect(selectEntitlementPanel(stateOf(makeEvent({ status: 'ended' }), { entitlement: 'guest' }))).toBeNull();
    expect(selectEntitlementPanel(stateOf(makeEvent(), { entitlement: 'guest', deploymentMode: 'disabled' }))).toBeNull();
    expect(selectEntitlementPanel(stateOf(makeEvent({ sourceKind: 'not_configured' }), { entitlement: 'guest' }))).toBeNull();
  });
});

describe('selectErrorActions', () => {
  const failed = (error: PlayerError, extra: Partial<AppState['player']> = {}, event = makeEvent()) =>
    selectErrorActions(stateOf(event, { player: { status: 'failed', ...extra, error } }));

  it('network: retry', () => {
    expect(failed(errorOf('network'))).toEqual(['retry']);
  });
  it('decode: retry', () => {
    expect(failed(errorOf('decode'))).toEqual(['retry']);
  });
  it('unsupported: switch the mode (Binaural -> Atmos); for Atmos the Binaural fallback is the offer', () => {
    expect(failed(errorOf('unsupported', 'binaural'))).toEqual(['switch_mode']);
    expect(failed(errorOf('unsupported', 'atmos'))).toEqual(['fallback_binaural']);
    expect(failed(errorOf('unsupported', 'binaural'), {}, makeEvent({ availableModes: ['binaural'] }))).toEqual([]);
  });
  it('a failed Atmos load offers the Binaural fallback', () => {
    expect(failed(errorOf('network', 'atmos'))).toEqual(['retry', 'fallback_binaural']);
  });
  it('a failed switch offers reloading the old mode', () => {
    expect(failed(errorOf('decode', 'atmos'), { lastGoodMode: 'binaural' })).toEqual(['retry', 'reload_last_good', 'fallback_binaural']);
    expect(failed(errorOf('network', 'binaural'), { lastGoodMode: 'binaural' })).toEqual(['retry']);
  });
  it('does not offer the fallback when the event has no Binaural', () => {
    expect(failed(errorOf('decode', 'atmos'), {}, makeEvent({ availableModes: ['atmos'] }))).toEqual(['retry']);
  });
  it('is empty when nothing failed', () => {
    expect(selectErrorActions(stateOf(makeEvent(), { player: { status: 'playing' } }))).toEqual([]);
    expect(selectErrorActions(stateOf(makeEvent(), { player: { status: 'paused', error: errorOf('play_blocked') } }))).toEqual([]);
  });
  it('gate and not_ready links (plan 6.2, 6.7)', () => {
    expect(selectErrorActions(stateOf(null))).toEqual(['back_to_events']);
    expect(selectErrorActions(stateOf(makeEvent({ status: 'ended' })))).toEqual(['back_to_events']);
    expect(selectErrorActions(stateOf(makeEvent({ sourceKind: 'not_configured' })))).toEqual(['view_event']);
    expect(selectErrorActions(stateOf(makeEvent({ status: 'cancelled' })))).toEqual([]);
    const nr = (reason: AppState['notReady']) =>
      selectErrorActions(stateOf(makeEvent(), { notReady: reason, player: { status: 'selecting', selectedMode: 'atmos' } }));
    expect(nr('mode_unavailable')).toEqual(['switch_mode']);
    expect(nr('source_not_configured')).toEqual(['view_event']);
    expect(nr('event_not_found')).toEqual(['back_to_events']);
    expect(nr('not_entitled')).toEqual([]);
    expect(nr('entitlement_unavailable')).toEqual([]);
    expect(nr('disabled')).toEqual([]);
    expect(nr('event_not_playable')).toEqual([]);
  });
});

describe('selectAnnouncement (plan 6.10)', () => {
  const player = (status: AppState['player']['status'], extra: Partial<AppState['player']> = {}) =>
    selectAnnouncement(stateOf(makeEvent(), { player: { status, ...extra } }));

  it('announces the player moments with the copy strings', () => {
    expect(player('loading')).toBe('正在連接音訊');
    expect(player('playing', { activeMode: 'atmos', confirmedPlaying: true })).toBe('目前播放：Dolby Atmos 音軌');
    expect(player('paused')).toBe('已暫停');
    expect(player('reconnecting')).toBe('連線暫時中斷，正在重新連線');
    expect(player('switching')).toBe('正在切換聆聽模式');
    expect(player('paused', { error: errorOf('play_blocked') })).toBe('請點擊開始聆聽');
    expect(player('failed', { error: errorOf('network') })).toBe('無法播放，請重試'); // retries used up: not "reconnecting"
    expect(player('failed', { error: errorOf('decode') })).toBe('播放失敗：目前環境無法播放這個音訊版本');
    expect(player('failed', { error: errorOf('decode', 'atmos'), lastGoodMode: 'binaural' })).toBe('切換失敗，仍保留原模式：Binaural');
  });

  it('announces event-status changes while waiting', () => {
    expect(selectAnnouncement(stateOf(makeEvent({ status: 'doors_open' })))).toBe('活動狀態更新：即將開放');
    expect(selectAnnouncement(stateOf(makeEvent({ status: 'ended' })))).toBe('活動狀態更新：已結束');
    expect(selectAnnouncement(stateOf(makeEvent({ status: 'live' })))).toBe('活動狀態更新：演出中');
  });

  it('has nothing to say for gates that never change by themselves', () => {
    expect(selectAnnouncement(stateOf(makeEvent(), { deploymentMode: 'disabled' }))).toBeNull();
    expect(selectAnnouncement(stateOf(null))).toBeNull();
    expect(selectAnnouncement(stateOf(makeEvent({ sourceKind: 'not_configured' })))).toBeNull();
  });

  it('never contains the countdown, the retry counter or a time', () => {
    const texts = [
      selectAnnouncement(stateOf(makeEvent({ status: 'scheduled' }))),
      player('reconnecting', { retry: { attempt: 2, max: 3 } }),
      player('failed', { error: errorOf('network') }),
    ];
    for (const text of texts) expect(text).not.toMatch(/\d/);
  });

  it('flags only play_blocked and failures as urgent', () => {
    expect(isUrgentAnnouncement(stateOf(makeEvent(), { player: { status: 'failed' } }))).toBe(true);
    expect(isUrgentAnnouncement(stateOf(makeEvent(), { player: { status: 'paused', error: errorOf('play_blocked') } }))).toBe(true);
    expect(isUrgentAnnouncement(stateOf(makeEvent(), { player: { status: 'paused' } }))).toBe(false);
    expect(isUrgentAnnouncement(stateOf(makeEvent(), { player: { status: 'reconnecting' } }))).toBe(false);
  });
});

describe('selectPrimaryCta (plan 6.1 table, first match wins)', () => {
  const boot = makeBoot();
  const cta = (patch: Partial<PublicEvent>) => selectPrimaryCta(makeEvent(patch), boot);

  it('cancelled and ended: details, never a player link or a replay button', () => {
    expect(cta({ status: 'cancelled' })).toEqual({ label: '查看活動資訊', kind: 'details', href: null });
    expect(cta({ status: 'ended', replayAvailable: true })).toEqual({ label: '查看活動資訊', kind: 'details', href: null });
  });
  it('a demo event with a demo source: 體驗播放介面 -> player', () => {
    expect(cta({ status: 'live' })).toEqual({ label: '體驗播放介面', kind: 'link', href: '/live/listen/?wg_event=demo-live' });
    expect(cta({ status: 'scheduled' })).toMatchObject({ label: '體驗播放介面', kind: 'link' });
  });
  it('doors_open / live / intermission of a regular event: 進入聆聽', () => {
    for (const status of ['doors_open', 'live', 'intermission'] as const) {
      expect(cta({ status, isDemo: false })).toEqual({ label: '進入聆聽', kind: 'link', href: '/live/listen/?wg_event=demo-live' });
    }
  });
  it('a demo event without a configured source falls through to the status rows', () => {
    expect(cta({ status: 'live', sourceKind: 'not_configured' })).toMatchObject({ label: '進入聆聽' });
  });
  it('scheduled: 查看活動 expands details', () => {
    expect(cta({ status: 'scheduled', isDemo: false })).toEqual({ label: '查看活動', kind: 'details', href: null });
  });
  it('falls back to details when the site has no player page', () => {
    const noPlayer = makeBoot({ links: { ...boot.links, player: null } });
    expect(selectPrimaryCta(makeEvent({ status: 'live' }), noPlayer)).toEqual({ label: '查看活動資訊', kind: 'details', href: null });
  });
});

describe('orderEvents (plan 6.1)', () => {
  const ev = (slug: string, status: EventStatus, startsAt: string) => makeEvent({ id: slug.length * 7 + slug.charCodeAt(0), slug, status, startsAt });
  const now = Date.parse('2026-10-24T00:00:00Z');

  it('featured = the named event; others: upcoming ascending, then ended/cancelled descending', () => {
    const events = [
      ev('old-ended', 'ended', '2026-01-01T10:00:00Z'),
      ev('later', 'scheduled', '2026-12-01T10:00:00Z'),
      ev('newer-ended', 'ended', '2026-09-01T10:00:00Z'),
      ev('soon', 'doors_open', '2026-10-25T10:00:00Z'),
      ev('gone', 'cancelled', '2026-06-01T10:00:00Z'),
    ];
    const r = orderEvents(events, 'later', now);
    expect(r.featured?.slug).toBe('later');
    expect(r.others.map((e) => e.slug)).toEqual(['soon', 'newer-ended', 'gone', 'old-ended']);
  });

  it('without a (valid) featured slug: the earliest event that is neither ended nor cancelled', () => {
    const events = [ev('b', 'scheduled', '2026-12-01T10:00:00Z'), ev('ended', 'ended', '2026-01-01T10:00:00Z'), ev('a', 'live', '2026-10-23T10:00:00Z')];
    expect(orderEvents(events, null, now).featured?.slug).toBe('a');
    expect(orderEvents(events, 'does-not-exist', now).featured?.slug).toBe('a');
    expect(orderEvents(events, null, now).others.map((e) => e.slug)).toEqual(['b', 'ended']);
  });

  it('only finished events: no featured event, nothing is invented', () => {
    const r = orderEvents([ev('x', 'ended', '2026-01-01T10:00:00Z'), ev('y', 'cancelled', '2026-02-01T10:00:00Z')], null, now);
    expect(r.featured).toBeNull();
    expect(r.others.map((e) => e.slug)).toEqual(['y', 'x']);
  });

  it('a single event has no others; no events gives nothing', () => {
    const one = ev('only', 'scheduled', '2026-12-01T10:00:00Z');
    expect(orderEvents([one], null, now)).toEqual({ featured: one, others: [] });
    expect(orderEvents([], null, now)).toEqual({ featured: null, others: [] });
  });

  it('does not mutate its input and puts unreadable start times last', () => {
    const events = [ev('bad', 'scheduled', 'nope'), ev('ok', 'scheduled', '2026-12-01T10:00:00Z')];
    const copy = [...events];
    const r = orderEvents(events, null, now);
    expect(events).toEqual(copy);
    expect(r.featured?.slug).toBe('ok');
    expect(r.others.map((e) => e.slug)).toEqual(['bad']);
  });
});

describe('publicErrorCode', () => {
  it('is short, generic and distinguishes where a network failure came from', () => {
    expect(publicErrorCode('network')).toBe('E-NET-01');
    expect(publicErrorCode('network', 'stall')).toBe('E-NET-02');
    expect(publicErrorCode('network', 'resolve')).toBe('E-NET-03');
    for (const code of ['decode', 'unsupported', 'not_configured', 'not_entitled', 'entitlement_unavailable', 'play_blocked', 'unknown'] as const) {
      expect(publicErrorCode(code)).toMatch(/^E-[A-Z]{3}-\d{2}$/);
    }
  });
});
