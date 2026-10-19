import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModeLabel, createStatusPanel, createUnavailablePanel } from '../../../src/components/status-panel';
import { DEMO_MEDIA_NOTICE } from '../../../src/i18n/copy';
import type { AppState, PlayerError } from '../../../src/types';
import { LINKS, attach, createFakeController, makeEvent, makeState, playingState, readyState } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

function build(state: AppState, headingTag: 'h2' | 'h3' = 'h3') {
  const controller = createFakeController(state);
  const onSwitchMode = vi.fn<(trigger: HTMLElement) => void>();
  const onViewEvent = vi.fn<() => void>();
  const panel = createStatusPanel({
    controller,
    headingTag,
    links: LINKS,
    event: makeEvent(),
    onSwitchMode,
    onViewEvent,
  });
  attach(panel.el);
  panel.update(state);
  return { controller, panel, onSwitchMode, onViewEvent };
}

const visible = (root: HTMLElement, selector: string): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.hidden && !el.closest('[hidden]'));

function actionLabels(root: HTMLElement): string[] {
  return visible(root, '.wg-live__status-actions button, .wg-live__status-actions a').map((el) => el.textContent ?? '');
}

const failed = (error: PlayerError, extra: Parameters<typeof makeState>[0] = {}): AppState =>
  makeState({
    entitlement: 'entitled',
    ...extra,
    player: { status: 'failed', selectedMode: error.mode, error, ...extra.player },
  });

describe('status heading', () => {
  it('is a visible heading with tabindex=-1 (the focus fallback) at the requested level', () => {
    const { panel } = build(readyState());
    expect(panel.heading.tagName).toBe('H3');
    expect(panel.heading.getAttribute('tabindex')).toBe('-1');
    expect(panel.heading.textContent).toBe('按下「開始聆聽」即可播放');
    expect(panel.heading.hidden).toBe(false);
    expect(build(readyState(), 'h2').panel.heading.tagName).toBe('H2');
  });

  it('updates the heading text in place', () => {
    const state = readyState();
    const { controller, panel } = build(state);
    const heading = panel.heading;
    controller.set(playingState());
    panel.update(controller.getState());
    expect(panel.heading).toBe(heading);
    expect(heading.textContent).toBe('播放中');
  });

  it('is not a live region (announcements go through the root status region only)', () => {
    const { panel } = build(readyState());
    expect(panel.el.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });
});

describe('gate messages (plan 6.2)', () => {
  it('scheduled: 演出尚未開始 with the start time and the help link', () => {
    const { panel } = build(makeState({ event: { status: 'scheduled' } }));
    expect(panel.heading.textContent).toBe('演出尚未開始');
    expect(panel.el.querySelector('.wg-live__status-detail')?.textContent).toContain('開始時間：');
    expect(actionLabels(panel.el)).toEqual(['聆聽說明']);
  });

  it('cancelled: 本場活動已取消 with a contact link', () => {
    const { panel } = build(makeState({ event: { status: 'cancelled' } }));
    expect(panel.heading.textContent).toBe('本場活動已取消');
    expect(actionLabels(panel.el)).toEqual(['聯絡我們']);
  });

  it('ended: 本場演出已結束 with a link back to the events and never a replay button', () => {
    const { panel } = build(makeState({ event: { status: 'ended' } }));
    expect(panel.heading.textContent).toBe('本場演出已結束');
    expect(actionLabels(panel.el)).toEqual(['返回活動列表']);
    expect(panel.el.textContent).not.toContain('回放');
  });

  it('source not configured: 播放來源尚未開放 with 查看活動資訊', () => {
    const { panel, onViewEvent } = build(makeState({ source: 'not_configured', isDemoMedia: false }));
    expect(panel.heading.textContent).toBe('播放來源尚未開放');
    expect(actionLabels(panel.el)).toEqual(['查看活動資訊']);
    visible(panel.el, '.wg-live__status-actions button')[0]?.click();
    expect(onViewEvent).toHaveBeenCalledTimes(1);
  });

  it('doors open: 即將開放聆聽', () => {
    const { panel } = build(makeState({ event: { status: 'doors_open' } }));
    expect(panel.heading.textContent).toBe('即將開放聆聽');
  });

  it('intermission adds 演出中場休息 and keeps the connection', () => {
    const { panel } = build(playingState('binaural', { event: { status: 'intermission' } }));
    expect(panel.el.textContent).toContain('演出中場休息');
  });

  it('puts the tone on the panel', () => {
    expect(build(makeState({ event: { status: 'cancelled' } })).panel.el.dataset.tone).toBe('warning');
    expect(build(playingState()).panel.el.dataset.tone).toBe('neutral');
  });
});

describe('demo media notice', () => {
  it('is shown whenever demo media is in use, in both modes', () => {
    for (const mode of ['binaural', 'atmos'] as const) {
      const { panel } = build(playingState(mode));
      const notice = panel.el.querySelector<HTMLElement>('.wg-live__demo-notice');
      expect(notice?.hidden).toBe(false);
      expect(notice?.textContent).toBe(DEMO_MEDIA_NOTICE);
    }
  });

  it('is shown before playback starts as soon as the source is demo', () => {
    const { panel } = build(readyState());
    expect(panel.el.querySelector<HTMLElement>('.wg-live__demo-notice')?.hidden).toBe(false);
  });

  it('is hidden when no demo media is involved', () => {
    const { panel } = build(makeState({ source: 'not_configured', isDemoMedia: false }));
    expect(panel.el.querySelector<HTMLElement>('.wg-live__demo-notice')?.hidden).toBe(true);
  });
});

describe('mode label', () => {
  it('says 已選擇 before playback is confirmed and 目前播放 only after', () => {
    const label = createModeLabel();
    attach(label.el);
    const text = () => label.el.querySelector<HTMLElement>('.wg-live__mode-label') as HTMLElement;

    label.update(makeState());
    expect(text().hidden).toBe(true);

    label.update(readyState('atmos'));
    expect(text().hidden).toBe(false);
    expect(text().textContent).toBe('已選擇：Dolby Atmos 音軌');

    // loaded but not yet confirmed playing: still 已選擇
    label.update(playingState('atmos', { player: { status: 'loading', confirmedPlaying: false, activeMode: null } }));
    expect(text().textContent).toBe('已選擇：Dolby Atmos 音軌');

    label.update(playingState('binaural'));
    expect(text().textContent).toBe('目前播放：Binaural');
  });

  it('never labels a mode that is only being switched to as 目前播放', () => {
    const label = createModeLabel();
    attach(label.el);
    label.update(
      playingState('binaural', {
        player: { status: 'switching', pendingMode: 'atmos', confirmedPlaying: false, activeMode: 'binaural' },
      }),
    );
    expect(label.el.querySelector('.wg-live__mode-label')?.textContent).toBe('已選擇：Dolby Atmos 音軌');
  });

  it('adds the note that the label does not confirm device output', () => {
    const label = createModeLabel();
    label.update(readyState());
    // The note is a separate node (the view puts it in the status block), never inside the label element.
    expect(label.el.querySelector('.wg-live__mode-note')).toBeNull();
    expect(label.note.classList.contains('wg-live__mode-note')).toBe(true);
    expect(label.note.hidden).toBe(false);
    expect(label.note.textContent).toContain('模式標示只代表');
    expect(label.el.textContent).not.toMatch(/已認證|7\.1\.4|Dolby 認證/);
  });
});

describe('error recovery actions (plan 6.5 - 6.7)', () => {
  const networkError: PlayerError = { code: 'network', mode: 'binaural', publicCode: 'E-NET-01' };

  it('offers retry for a network failure and calls controller.retry()', () => {
    const { controller, panel } = build(failed(networkError));
    expect(panel.heading.textContent).toBe('無法播放，請重試');
    expect(actionLabels(panel.el)).toEqual(['重試']);
    visible(panel.el, '.wg-live__status-actions button')[0]?.click();
    expect(controller.calls.retry).toHaveBeenCalledTimes(1);
  });

  it('shows the generic public error code as small print, never a URL or stack', () => {
    const { panel } = build(failed(networkError));
    const code = panel.el.querySelector<HTMLElement>('.wg-live__error-code');
    expect(code?.hidden).toBe(false);
    expect(code?.textContent).toBe('錯誤代碼：E-NET-01');
    expect(code?.className).toContain('wg-live__small');
  });

  it('hides the error code and actions when nothing failed', () => {
    const { panel } = build(playingState());
    expect(panel.el.querySelector<HTMLElement>('.wg-live__error-code')?.hidden).toBe(true);
    expect(visible(panel.el, '.wg-live__status-actions button, .wg-live__status-actions a')).toHaveLength(0);
    expect(panel.el.querySelector<HTMLElement>('.wg-live__status-actions')?.hidden).toBe(true);
  });

  it('one yellow primary: only the first recovery action after a failure, never while Start is shown', () => {
    const atmosFailure: PlayerError = { code: 'network', mode: 'atmos', publicCode: 'E-NET-01' };
    const { panel } = build(failed(atmosFailure, { player: { lastGoodMode: 'binaural' } }));
    const primary = visible(panel.el, '.wg-live__status-actions .wg-live__btn--primary');
    expect(primary.map((b) => b.textContent)).toEqual(['重試']);

    const idle = build(makeState({ entitlement: 'entitled', notReady: 'mode_unavailable', player: { status: 'idle', selectedMode: 'atmos' } }));
    expect(idle.panel.el.querySelector('.wg-live__btn--primary')).toBeNull();
  });

  it('after a failed switch to Atmos: reload the old mode and fall back to Binaural; the track is never changed silently', () => {
    const atmosFailure: PlayerError = { code: 'network', mode: 'atmos', publicCode: 'E-NET-01' };
    const state = failed(atmosFailure, { player: { lastGoodMode: 'binaural' } });
    const { controller, panel } = build(state);
    expect(actionLabels(panel.el)).toEqual(['重試', '重新載入Binaural', '改用耳機 Binaural']);
    expect(panel.el.textContent).toContain('仍保留原模式');

    const buttons = visible(panel.el, '.wg-live__status-actions button');
    buttons.find((b) => b.textContent === '重新載入Binaural')?.click();
    expect(controller.calls.reloadLastGood).toHaveBeenCalledTimes(1);
    buttons.find((b) => b.textContent === '改用耳機 Binaural')?.click();
    expect(controller.calls.switchMode).toHaveBeenCalledWith('binaural');
    expect(controller.calls.switchMode).toHaveBeenCalledTimes(1);
  });

  it('prefetches the Binaural descriptor when the fallback appears, so the click can start synchronously', async () => {
    const atmosFailure: PlayerError = { code: 'unsupported', mode: 'atmos', publicCode: 'E-SRC-01' };
    const { controller } = build(failed(atmosFailure));
    await Promise.resolve();
    expect(controller.calls.prepareSwitch).toHaveBeenCalledWith('binaural');
    expect(controller.calls.prepareSwitch).toHaveBeenCalledTimes(1);
  });

  it('does not prefetch again on every re-render of the same error', async () => {
    const atmosFailure: PlayerError = { code: 'unsupported', mode: 'atmos', publicCode: 'E-SRC-01' };
    const state = failed(atmosFailure);
    const { controller, panel } = build(state);
    panel.update(state);
    panel.update(state);
    await Promise.resolve();
    expect(controller.calls.prepareSwitch).toHaveBeenCalledTimes(1);
  });

  it('offers 切換模式 (through the view) when Binaural is unsupported but Atmos exists', () => {
    const unsupported: PlayerError = { code: 'unsupported', mode: 'binaural', publicCode: 'E-SRC-01' };
    const { panel, onSwitchMode } = build(failed(unsupported));
    expect(panel.heading.textContent).toBe('目前環境無法播放這個音訊版本');
    expect(actionLabels(panel.el)).toEqual(['切換模式', '聆聽說明']);
    const button = visible(panel.el, '.wg-live__status-actions button')[0] as HTMLElement;
    button.click();
    expect(onSwitchMode).toHaveBeenCalledWith(button);
  });

  it('offers the help link (spec 6 查看說明) with every unsupported failure, and only then', () => {
    const atmos: PlayerError = { code: 'unsupported', mode: 'atmos', publicCode: 'E-SRC-01' };
    const { panel } = build(failed(atmos));
    const links = visible(panel.el, '.wg-live__status-actions a');
    expect(links.map((a) => a.textContent)).toEqual(['聆聽說明']);
    expect((links[0] as HTMLAnchorElement).getAttribute('href')).toBe(LINKS.help);
    // The mode switch for an Atmos failure is the Binaural fallback (spec 5.4).
    expect(actionLabels(panel.el)).toContain('改用耳機 Binaural');

    const network: PlayerError = { code: 'network', mode: 'atmos', publicCode: 'E-NET-01' };
    expect(visible(build(failed(network)).panel.el, '.wg-live__status-actions a')).toEqual([]);
  });

  it('a failed switch to an unsupported Atmos keeps 重新載入 of the last good mode next to the help link', () => {
    const atmos: PlayerError = { code: 'unsupported', mode: 'atmos', publicCode: 'E-SRC-01' };
    const { panel } = build(failed(atmos, { player: { lastGoodMode: 'binaural' } }));
    expect(actionLabels(panel.el)).toEqual(['重新載入Binaural', '改用耳機 Binaural', '聆聽說明']);
  });

  it('ignores a click on 切換模式 while it is aria-disabled (click guard, never `disabled`)', () => {
    const unsupported: PlayerError = { code: 'unsupported', mode: 'binaural', publicCode: 'E-SRC-01' };
    const { panel, onSwitchMode } = build(failed(unsupported));
    const button = visible(panel.el, '.wg-live__status-actions button')[0] as HTMLButtonElement;
    button.setAttribute('aria-disabled', 'true');
    button.click();
    expect(onSwitchMode).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it('falls back to a retry button when a failed state would otherwise leave no action', () => {
    const odd: PlayerError = { code: 'play_blocked', mode: 'binaural', publicCode: 'E-PLY-01' };
    const { panel } = build(failed(odd));
    expect(actionLabels(panel.el)).toEqual(['重試']);
  });

  it('PS-6: the retry fallback needs an entitled viewer; a denied or unknown entitlement gets no retry', () => {
    const odd: PlayerError = { code: 'play_blocked', mode: 'binaural', publicCode: 'E-PLY-01' };
    for (const entitlement of ['guest', 'not_entitled', 'unavailable', 'unknown'] as const) {
      const { panel } = build(failed(odd, { entitlement }));
      expect(actionLabels(panel.el), entitlement).toEqual([]);
      expect(panel.el.querySelector<HTMLElement>('.wg-live__status-actions')?.hidden, entitlement).toBe(true);
    }
    const { panel } = build(failed(networkError, { entitlement: 'guest' }));
    expect(actionLabels(panel.el)).toEqual([]);
  });

  it('UI-07: with no listening mode on offer the heading does not ask for a choice', () => {
    const none = makeEvent({ availableModes: [] });
    const { panel } = build(makeState({ entitlement: 'entitled', player: { status: 'idle' } }, none));
    expect(panel.heading.textContent).toBe('聆聽模式即將公布');
    expect(panel.heading.textContent).not.toContain('請先選擇');
  });

  it('keeps the same button nodes across updates', () => {
    const { panel } = build(failed(networkError));
    const before = Array.from(panel.el.querySelectorAll('button'));
    panel.update(playingState());
    panel.update(failed(networkError));
    expect(Array.from(panel.el.querySelectorAll('button'))).toEqual(before);
  });

  it('stops reacting after destroy()', () => {
    const { controller, panel } = build(failed(networkError));
    const retry = visible(panel.el, '.wg-live__status-actions button')[0] as HTMLElement;
    panel.destroy();
    retry.click();
    expect(controller.calls.retry).not.toHaveBeenCalled();
  });
});

describe('createUnavailablePanel (no controller)', () => {
  it('disabled mode: 線上音樂會尚未開放 with home and contact links', () => {
    const { el, heading } = createUnavailablePanel('disabled', LINKS, 'h2');
    attach(el);
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('線上音樂會尚未開放');
    expect(Array.from(el.querySelectorAll('a')).map((a) => a.textContent)).toEqual(['回首頁', '聯絡我們']);
    expect(Array.from(el.querySelectorAll('a')).every((a) => !a.hidden)).toBe(true);
  });

  it('not found: 找不到這場活動 with a link back to the list', () => {
    const { el, heading } = createUnavailablePanel('not_found', LINKS, 'h2');
    expect(heading.textContent).toBe('找不到這場活動');
    expect(el.querySelector('a')?.textContent).toBe('返回活動列表');
    expect(el.querySelector('a')?.getAttribute('href')).toBe(LINKS.events);
  });

  it('omits links that are not configured', () => {
    const { el } = createUnavailablePanel('disabled', { ...LINKS, contact: null }, 'h2');
    expect(Array.from(el.querySelectorAll('a')).map((a) => a.textContent)).toEqual(['回首頁']);
  });

  it('drops unsafe link targets', () => {
    const { el } = createUnavailablePanel('not_found', { ...LINKS, events: 'javascript:alert(1)', help: null }, 'h2');
    expect(el.querySelector('a')).toBeNull();
  });
});
