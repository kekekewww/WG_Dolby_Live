import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlayerControls,
  handlePlayerKeydown,
  isFullscreenActive,
  toggleFullscreen,
  primaryAction,
  startReason,
} from '../../../src/components/player-controls';
import { createPlayerShell } from '../../../src/components/player-shell';
import type { AppState, PlayerController, PlayerStatus } from '../../../src/types';
import {
  FULL_CAPS,
  attach,
  createFakeController,
  makeEvent,
  makeState,
  playingState,
  readyState,
} from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

function statusState(status: PlayerStatus, extra: Parameters<typeof makeState>[0] = {}): AppState {
  return makeState({ entitlement: 'entitled', ...extra, player: { status, selectedMode: 'binaural', preparedMode: 'binaural', ...extra.player } });
}

describe('primaryAction', () => {
  it('starts from idle/selecting and enables only through selectCanStart', () => {
    expect(primaryAction(makeState())).toMatchObject({ kind: 'start', label: '開始聆聽', disabled: true });
    expect(primaryAction(readyState())).toMatchObject({ kind: 'start', label: '開始聆聽', disabled: false });
  });

  it('is busy and disabled while loading or switching (pause is unavailable)', () => {
    expect(primaryAction(statusState('loading'))).toMatchObject({ kind: 'busy', disabled: true, label: '正在連接音訊' });
    expect(primaryAction(statusState('switching'))).toMatchObject({ kind: 'busy', disabled: true });
  });

  it('pauses while playing or reconnecting and resumes when paused', () => {
    expect(primaryAction(statusState('playing'))).toMatchObject({ kind: 'toggle', label: '暫停', disabled: false });
    expect(primaryAction(statusState('reconnecting'))).toMatchObject({ kind: 'toggle', label: '暫停' });
    expect(primaryAction(statusState('paused'))).toMatchObject({ kind: 'toggle', label: '繼續播放' });
  });

  it('offers「開始聆聽」again after play_blocked, but through togglePlay (no new resolve)', () => {
    const blocked = statusState('paused', {
      player: { error: { code: 'play_blocked', mode: 'binaural', publicCode: 'E-PLY-01' } },
    });
    expect(primaryAction(blocked)).toMatchObject({ kind: 'toggle', label: '開始聆聽', disabled: false });
  });

  it('hides the big button after a failure (recovery lives in the status panel)', () => {
    expect(primaryAction(statusState('failed')).kind).toBe('hidden');
  });
});

describe('startReason', () => {
  it('UI-07: an event with no listening mode says so instead of asking for a choice', () => {
    const state = makeState({ entitlement: 'entitled' }, makeEvent({ availableModes: [] }));
    expect(startReason(state)).toBe('聆聽模式即將公布');
  });


  it('is null when Start is enabled or not shown', () => {
    expect(startReason(readyState())).toBeNull();
    expect(startReason(statusState('playing'))).toBeNull();
  });

  it('asks for a mode first', () => {
    expect(startReason(makeState())).toBe('請先選擇聆聽模式');
  });

  it('explains a scheduled, doors-open and unconfigured event', () => {
    const base = { entitlement: 'entitled' as const, player: { selectedMode: 'binaural' as const, preparedMode: 'binaural' as const, status: 'selecting' as const } };
    expect(startReason(makeState({ ...base, event: { status: 'scheduled' } }))).toContain('演出開始前');
    expect(startReason(makeState({ ...base, event: { status: 'doors_open' } }))).toContain('開放後即可開始');
    expect(startReason(makeState({ ...base, source: 'not_configured' }))).toBe('播放來源尚未開放');
  });

  it('names the entitlement state that blocks Start', () => {
    const player = { selectedMode: 'binaural' as const, status: 'selecting' as const };
    expect(startReason(makeState({ entitlement: 'unknown', player }))).toBe('正在確認觀看資格');
    expect(startReason(makeState({ entitlement: 'guest', player }))).toBe('請先登入');
    expect(startReason(makeState({ entitlement: 'not_entitled', player }))).toBe('尚未取得觀看資格');
    expect(startReason(makeState({ entitlement: 'unavailable', player }))).toBe('暫時無法確認觀看資格');
  });

  it('says the source is being checked while the descriptor is not prepared', () => {
    const state = makeState({ entitlement: 'entitled', player: { selectedMode: 'atmos', preparedMode: null, status: 'selecting' } });
    expect(startReason(state)).toBe('正在確認播放來源');
  });
});

describe('player controls component', () => {
  function build(state: AppState, mediaKind: 'audio' | 'video' = 'audio') {
    const controller = createFakeController(state);
    const shell = createPlayerShell(mediaKind);
    const controls = createPlayerControls({ controller, mediaKind, fullscreenRoot: shell.theater, media: shell.host.media });
    shell.controlsSlot.append(controls.el);
    attach(shell.el);
    controls.update(state);
    return { controller, controls, shell };
  }

  it('disables Start with a visible reason and never calls start()', () => {
    const { controller, controls } = build(makeState({ entitlement: 'guest', player: { selectedMode: 'binaural', status: 'selecting' } }));
    const button = controls.primary;
    expect(button.textContent).toBe('開始聆聽');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reason = controls.el.querySelector<HTMLElement>('.wg-live__start-reason');
    expect(reason?.hidden).toBe(false);
    expect(reason?.textContent).toBe('請先登入');
    expect(button.getAttribute('aria-describedby')).toBe(reason?.id);
    button.click();
    expect(controller.calls.start).not.toHaveBeenCalled();
  });

  it('calls controller.start() synchronously from the click when Start is enabled', () => {
    const { controller, controls } = build(readyState());
    expect(controls.primary.hasAttribute('aria-disabled')).toBe(false);
    expect(controls.el.querySelector<HTMLElement>('.wg-live__start-reason')?.hidden).toBe(true);
    controls.primary.click();
    // No await between the click and start(): the call has already happened.
    expect(controller.calls.start).toHaveBeenCalledTimes(1);
  });

  it('turns into pause / resume with togglePlay, keeping the same button node', () => {
    const { controller, controls } = build(readyState());
    const node = controls.primary;
    controller.set(playingState());
    controls.update(controller.getState());
    expect(controls.primary).toBe(node);
    expect(node.textContent).toBe('暫停');
    node.click();
    expect(controller.calls.togglePlay).toHaveBeenCalledTimes(1);
    expect(controller.calls.start).not.toHaveBeenCalled();
  });

  it('ignores clicks while loading or switching', () => {
    const { controller, controls } = build(statusState('loading'));
    controls.primary.click();
    controller.set(statusState('switching'));
    controls.update(controller.getState());
    controls.primary.click();
    expect(controller.calls.togglePlay).not.toHaveBeenCalled();
    expect(controller.calls.start).not.toHaveBeenCalled();
    expect(controls.primary.getAttribute('aria-disabled')).toBe('true');
  });

  it('hides the big button after a failure', () => {
    const { controls } = build(statusState('failed'));
    expect(controls.primary.hidden).toBe(true);
  });

  describe('capability driven controls', () => {
    const ctl = (el: HTMLElement) => ({
      mute: el.querySelector<HTMLElement>('.wg-live__mute'),
      volume: el.querySelector<HTMLElement>('.wg-live__volume'),
      live: el.querySelector<HTMLElement>('.wg-live__live'),
      fullscreen: el.querySelector<HTMLElement>('.wg-live__fullscreen'),
      transport: el.querySelector<HTMLElement>('.wg-live__transport'),
    });

    it('renders no secondary control before playback starts or without capabilities', () => {
      const { controls } = build(readyState('binaural', { capabilities: FULL_CAPS }));
      const c = ctl(controls.el);
      expect(c.transport?.hidden).toBe(true);
      const noCaps = build(statusState('playing', { capabilities: null }));
      expect(ctl(noCaps.controls.el).transport?.hidden).toBe(true);
    });

    it('shows mute and volume only when the adapter supports them', () => {
      const { controls } = build(playingState('binaural', { capabilities: FULL_CAPS }));
      const c = ctl(controls.el);
      expect(c.mute?.hidden).toBe(false);
      expect(c.volume?.hidden).toBe(false);
      expect(c.live?.hidden).toBe(true);
      expect(c.fullscreen?.hidden).toBe(true);
    });

    it('keeps mute but hides the volume slider where volume cannot be set (iOS)', () => {
      const { controls } = build(playingState('binaural', { capabilities: { ...FULL_CAPS, volume: false } }));
      const c = ctl(controls.el);
      expect(c.mute?.hidden).toBe(false);
      expect(c.volume?.hidden).toBe(true);
    });

    it('hides everything the adapter cannot do', () => {
      const none = { ...FULL_CAPS, mute: false, volume: false };
      const { controls } = build(playingState('binaural', { capabilities: none }));
      const c = ctl(controls.el);
      expect(c.mute?.hidden).toBe(true);
      expect(c.volume?.hidden).toBe(true);
      expect(c.transport?.hidden).toBe(true);
    });

    it('shows 返回直播 only with seekToLive and calls the controller', () => {
      const { controller, controls } = build(playingState('binaural', { capabilities: { ...FULL_CAPS, seekToLive: true } }));
      const live = ctl(controls.el).live;
      expect(live?.hidden).toBe(false);
      expect(live?.textContent).toBe('返回直播');
      live?.click();
      expect(controller.calls.seekToLive).toHaveBeenCalledTimes(1);
    });

    it('shows fullscreen only for video, and only when supported', () => {
      const caps = { ...FULL_CAPS, fullscreen: true };
      const video = build(playingState('binaural', { capabilities: caps }), 'video');
      expect(ctl(video.controls.el).fullscreen?.hidden).toBe(false);
      document.body.replaceChildren();
      const audio = build(playingState('binaural', { capabilities: caps }), 'audio');
      expect(ctl(audio.controls.el).fullscreen?.hidden).toBe(true);
      document.body.replaceChildren();
      const unsupported = build(playingState('binaural', { capabilities: FULL_CAPS }), 'video');
      expect(ctl(unsupported.controls.el).fullscreen?.hidden).toBe(true);
    });

    it('mutes through the controller and reflects the state in aria-pressed', () => {
      const { controller, controls } = build(playingState('binaural', { capabilities: FULL_CAPS }));
      const mute = ctl(controls.el).mute as HTMLButtonElement;
      expect(mute.getAttribute('aria-pressed')).toBe('false');
      mute.click();
      expect(controller.calls.setMuted).toHaveBeenCalledWith(true);
      controller.set(playingState('binaural', { capabilities: FULL_CAPS, player: { muted: true } }));
      controls.update(controller.getState());
      expect(mute.getAttribute('aria-pressed')).toBe('true');
    });

    it('sends the slider position to the controller as a 0..1 volume', () => {
      const { controller, controls } = build(playingState('binaural', { capabilities: FULL_CAPS }));
      const input = controls.el.querySelector<HTMLInputElement>('.wg-live__volume-input') as HTMLInputElement;
      expect(input.getAttribute('aria-valuetext')).toBe('100%');
      input.value = '30';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(controller.calls.setVolume).toHaveBeenCalledWith(0.3);
      expect(input.getAttribute('aria-valuetext')).toBe('30%');
    });

    it('labels the slider', () => {
      const { controls } = build(playingState('binaural', { capabilities: FULL_CAPS }));
      const input = controls.el.querySelector<HTMLInputElement>('.wg-live__volume-input') as HTMLInputElement;
      expect(controls.el.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('音量');
    });
  });
});

describe('keyboard shortcuts (plan 6.10)', () => {
  function setup(state: AppState = playingState()) {
    const controller = createFakeController(state);
    const group = document.createElement('div');
    const button = document.createElement('button');
    const link = document.createElement('a');
    link.href = '/x';
    const text = document.createElement('input');
    text.type = 'text';
    const range = document.createElement('input');
    range.type = 'range';
    const radio = document.createElement('input');
    radio.type = 'radio';
    const select = document.createElement('select');
    const area = document.createElement('textarea');
    const roleButton = document.createElement('span');
    roleButton.setAttribute('role', 'button');
    const plain = document.createElement('div');
    plain.tabIndex = 0;
    group.append(button, link, text, range, radio, select, area, roleButton, plain);
    attach(group);
    const press = (target: Element, init: KeyboardEventInit & { key: string }): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      handlePlayerKeydown(event, controller as PlayerController);
      return event;
    };
    return { controller, press, button, link, text, range, radio, select, area, roleButton, plain };
  }

  it('toggles playback on Space and K from a plain focus target, and prevents the default', () => {
    const t = setup();
    const space = t.press(t.plain, { key: ' ' });
    expect(space.defaultPrevented).toBe(true);
    const k = t.press(t.plain, { key: 'k' });
    expect(k.defaultPrevented).toBe(true);
    expect(t.controller.calls.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('works while paused and reconnecting', () => {
    for (const status of ['paused', 'reconnecting'] as const) {
      const t = setup(playingState('binaural', { player: { status } }));
      t.press(t.plain, { key: ' ' });
      expect(t.controller.calls.togglePlay).toHaveBeenCalledTimes(1);
    }
  });

  it('never starts playback and never toggles while loading, switching or before start', () => {
    for (const state of [readyState(), statusState('loading'), statusState('switching'), statusState('failed')]) {
      const t = setup(state);
      const event = t.press(t.plain, { key: ' ' });
      expect(event.defaultPrevented).toBe(false);
      expect(t.controller.calls.togglePlay).not.toHaveBeenCalled();
      expect(t.controller.calls.start).not.toHaveBeenCalled();
    }
  });

  it('ignores Space on buttons, links, role=button, radios and sliders (Space already means "press")', () => {
    const t = setup();
    for (const el of [t.button, t.link, t.roleButton, t.radio, t.range]) {
      const event = t.press(el, { key: ' ' });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(t.controller.calls.togglePlay).not.toHaveBeenCalled();
  });

  it('still lets K work on a focused button', () => {
    const t = setup();
    t.press(t.button, { key: 'k' });
    expect(t.controller.calls.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('ignores both keys in editable targets', () => {
    const t = setup();
    for (const el of [t.text, t.select, t.area]) {
      expect(t.press(el, { key: ' ' }).defaultPrevented).toBe(false);
      expect(t.press(el, { key: 'k' }).defaultPrevented).toBe(false);
    }
    expect(t.controller.calls.togglePlay).not.toHaveBeenCalled();
  });

  it('ignores any modifier, key repeat and IME composition', () => {
    const t = setup();
    for (const init of [
      { key: 'k', ctrlKey: true },
      { key: 'k', metaKey: true },
      { key: 'k', altKey: true },
      { key: ' ', shiftKey: true },
      { key: 'k', repeat: true },
      { key: 'k', isComposing: true },
    ]) {
      expect(t.press(t.plain, init).defaultPrevented).toBe(false);
    }
    expect(t.controller.calls.togglePlay).not.toHaveBeenCalled();
  });

  it('ignores events another handler already prevented', () => {
    const t = setup();
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    event.preventDefault();
    t.plain.dispatchEvent(event);
    expect(handlePlayerKeydown(event, t.controller)).toBe(false);
    expect(t.controller.calls.togglePlay).not.toHaveBeenCalled();
  });

  it('does not prevent the default for unrelated keys', () => {
    const t = setup();
    for (const key of ['Enter', 'ArrowLeft', 'm', 'Tab']) {
      expect(t.press(t.plain, { key }).defaultPrevented).toBe(false);
    }
    expect(t.controller.calls.togglePlay).not.toHaveBeenCalled();
  });
});

describe('event data stays out of the controls', () => {
  it('uses no time display and no visualizer element', () => {
    const state = playingState();
    const controller = createFakeController(state);
    const shell = createPlayerShell('audio');
    const controls = createPlayerControls({ controller, mediaKind: 'audio', fullscreenRoot: shell.theater, media: shell.host.media });
    controls.update(state);
    expect(controls.el.querySelector('canvas, svg, progress, meter, time')).toBeNull();
    expect(makeEvent().mediaKind).toBe('video'); // video is the default; the audio shell above is the audio-only case
  });
});

describe('fullscreen (spec 5.3: the stage AND the control bar go fullscreen)', () => {
  type Doc = Document & Record<string, unknown>;
  const doc = document as Doc;

  function mount() {
    const shell = createPlayerShell('video');
    const controller = createFakeController(playingState('binaural', { capabilities: { ...FULL_CAPS, fullscreen: true } }));
    const controls = createPlayerControls({ controller, mediaKind: 'video', fullscreenRoot: shell.theater, media: shell.host.media });
    shell.controlsSlot.append(controls.el);
    attach(shell.el);
    controls.update(controller.getState());
    const button = controls.el.querySelector<HTMLButtonElement>('.wg-live__fullscreen') as HTMLButtonElement;
    return { shell, controls, button, controller };
  }

  function setFullscreenElement(el: Element | null, key: 'fullscreenElement' | 'webkitFullscreenElement' = 'fullscreenElement') {
    Object.defineProperty(document, key, { configurable: true, get: () => el });
  }

  afterEach(() => {
    for (const key of ['fullscreenElement', 'webkitFullscreenElement', 'exitFullscreen', 'webkitExitFullscreen']) {
      delete (doc as Record<string, unknown>)[key];
    }
    vi.restoreAllMocks();
  });

  it('wraps the stage and the controls slot in ONE element that is the fullscreen target', () => {
    const { shell } = mount();
    expect(shell.theater.className).toBe('wg-live__theater');
    expect(shell.theater.contains(shell.stage)).toBe(true);
    expect(shell.theater.contains(shell.controlsSlot)).toBe(true);
    expect(shell.theater.contains(shell.host.media)).toBe(true);
    expect(shell.theater.contains(shell.controlsSlot.querySelector('.wg-live__play'))).toBe(true);
  });

  it('requests fullscreen on the wrapper (not the bare stage) when the standard API exists', () => {
    const { shell, button } = mount();
    const request = vi.fn(() => Promise.resolve());
    shell.theater.requestFullscreen = request;
    shell.stage.requestFullscreen = vi.fn(() => Promise.resolve());
    button.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(shell.stage.requestFullscreen).not.toHaveBeenCalled();
  });

  it('falls back to webkitRequestFullscreen on the wrapper', () => {
    const { shell } = mount();
    const webkit = vi.fn();
    (shell.theater as unknown as { webkitRequestFullscreen: () => void }).webkitRequestFullscreen = webkit;
    toggleFullscreen(shell.theater, shell.host.media);
    expect(webkit).toHaveBeenCalledTimes(1);
  });

  it('uses webkitEnterFullscreen on the <video> when element fullscreen is unavailable (iPhone)', () => {
    const { shell } = mount();
    const enter = vi.fn();
    (shell.host.media as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen = enter;
    toggleFullscreen(shell.theater, shell.host.media);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('does nothing (and does not throw) when no fullscreen API exists, or the request is refused', async () => {
    const { shell } = mount();
    expect(() => toggleFullscreen(shell.theater, shell.host.media)).not.toThrow();
    shell.theater.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
    expect(() => toggleFullscreen(shell.theater, shell.host.media)).not.toThrow();
    await Promise.resolve();
  });

  it('exits when something is already fullscreen (standard and webkit-prefixed)', () => {
    const { shell } = mount();
    const exit = vi.fn(() => Promise.resolve());
    doc.exitFullscreen = exit;
    setFullscreenElement(shell.theater);
    const request = vi.fn(() => Promise.resolve());
    shell.theater.requestFullscreen = request;
    toggleFullscreen(shell.theater, shell.host.media);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();

    Reflect.deleteProperty(doc, 'exitFullscreen');
    setFullscreenElement(null);
    setFullscreenElement(shell.theater, 'webkitFullscreenElement');
    const webkitExit = vi.fn();
    doc.webkitExitFullscreen = webkitExit;
    toggleFullscreen(shell.theater, shell.host.media);
    expect(webkitExit).toHaveBeenCalledTimes(1);
  });

  it('flips the button label with fullscreenchange, so Esc leaves it consistent', () => {
    const { shell, button, controls } = mount();
    expect(button.textContent).toBe('全螢幕');
    setFullscreenElement(shell.theater);
    expect(isFullscreenActive(shell.theater)).toBe(true);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(button.textContent).toBe('結束全螢幕');
    expect(button.dataset.fullscreen).toBe('true');
    setFullscreenElement(null); // Esc
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(button.textContent).toBe('全螢幕');
    expect(button.dataset.fullscreen).toBe('false');
    controls.destroy();
    setFullscreenElement(shell.theater);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(button.textContent).toBe('全螢幕'); // listener removed on destroy
  });

  it('keeps the same <video> element throughout', () => {
    const { shell } = mount();
    const media = shell.host.media;
    setFullscreenElement(shell.theater);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(shell.stage.querySelector('video')).toBe(media);
  });

  it('the stage is focusable (not tabbable) so a click on the picture keeps focus inside the player group', () => {
    const { shell, controller } = mount();
    expect(shell.stage.getAttribute('tabindex')).toBe('-1');
    shell.el.addEventListener('keydown', (e) => handlePlayerKeydown(e, controller));
    shell.stage.focus();
    expect(document.activeElement).toBe(shell.stage);
    shell.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true }));
    expect(controller.calls.togglePlay).toHaveBeenCalledTimes(1);
  });
});
