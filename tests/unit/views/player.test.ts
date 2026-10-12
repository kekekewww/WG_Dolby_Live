import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoEvents } from '../../../src/fixtures/demo-events';
import { pageRegistry } from '../../../src/state/page-registry';
import type { EventPollerOptions } from '../../../src/state/event-poller';
import type { AppState, BootConfig, DevControls, PlayerError, PublicEvent } from '../../../src/types';
import { mountPlayerView } from '../../../src/views/player';
import type { ViewContext, ViewInstance } from '../../../src/views/types';
import {
  FULL_CAPS,
  LINKS,
  attach,
  createFakeController,
  fakeDev,
  makeBoot,
  makeEvent,
  makeState,
  playingState,
  readyState,
} from '../components/helpers';
import type { FakeController } from '../components/helpers';
import { createPlayerController } from '../../../src/state/coordinator';
import type { CoordinatorDeps } from '../../../src/state/coordinator';
import { startEventPoller } from '../../../src/state/event-poller';

vi.mock('../../../src/state/coordinator', () => ({ createPlayerController: vi.fn() }));
vi.mock('../../../src/state/event-poller', () => ({ startEventPoller: vi.fn() }));

const mounted: ViewInstance[] = [];
const createMock = vi.mocked(createPlayerController);
const pollerMock = vi.mocked(startEventPoller);
const pollerStop = vi.fn<() => void>();
const pollerRefresh = vi.fn<() => void>();
let pollerOptions: EventPollerOptions | null = null;

interface Mounted {
  root: HTMLElement;
  mount: HTMLElement;
  controller: FakeController;
  instance: ViewInstance;
  announce: ReturnType<typeof vi.fn<ViewContext['announce']>>;
  boot: BootConfig;
}

function mountView(
  options: {
    boot?: Partial<BootConfig>;
    state?: AppState;
    dev?: DevControls | null;
    search?: string;
    event?: PublicEvent;
  } = {},
): Mounted {
  const events = options.event ? [options.event] : demoEvents(Date.parse('2026-10-24T12:00:00Z'));
  const boot = makeBoot({ events, ...options.boot });
  window.history.replaceState(null, '', options.search ?? '/live/listen/?wg_event=demo-live-binaural-atmos');
  const root = document.createElement('div');
  root.className = 'wg-live wg-live--player';
  root.id = 'wg-live-1';
  const mount = document.createElement('div');
  mount.className = 'wg-live__mount';
  root.append(mount);
  attach(root);
  let state = options.state ?? readyState();
  if (options.event) {
    // The coordinator seeds the state from the event it is given; mirror that in the fake.
    state = { ...state, event: { ...state.event, data: options.event, status: options.event.status } };
  }
  const controller = createFakeController(state, options.dev ?? null);
  createMock.mockReturnValue(controller);
  const announce = vi.fn<ViewContext['announce']>();
  const instance = mountPlayerView(mount, boot, { root, announce, env: { volumeSettable: true } });
  mounted.push(instance);
  return { root, mount, controller, instance, announce, boot };
}

const q = <T extends HTMLElement = HTMLElement>(m: Mounted, selector: string): T => {
  const el = m.mount.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};
const maybe = (m: Mounted, selector: string): HTMLElement | null => m.mount.querySelector<HTMLElement>(selector);
const text = (el: Element | null): string => el?.textContent ?? '';

beforeEach(() => {
  createMock.mockReset();
  pollerMock.mockReset();
  pollerStop.mockReset();
  pollerRefresh.mockReset();
  pollerOptions = null;
  pollerMock.mockImplementation((opts) => {
    pollerOptions = opts;
    return { stop: pollerStop, refreshNow: pollerRefresh };
  });
  window.localStorage.clear();
});

afterEach(() => {
  for (const instance of mounted.splice(0)) instance.destroy();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

/* ------------------------------------------------------------------ */

describe('states without a controller', () => {
  it('disabled mode: message + home and contact links, no controller, no poller, no media', () => {
    const m = mountView({ boot: { deploymentMode: 'disabled', events: [], fixedEventSlug: null } });
    expect(createMock).not.toHaveBeenCalled();
    expect(pollerMock).not.toHaveBeenCalled();
    expect(text(m.mount)).toContain('線上音樂會尚未開放');
    const links = Array.from(m.mount.querySelectorAll('a')).map((a) => a.textContent);
    expect(links).toEqual(['回首頁', '聯絡我們']);
    expect(m.mount.querySelector('audio, video, fieldset, dialog')).toBeNull();
  });

  it('disabled mode wins even when a slug and events are present', () => {
    mountView({ boot: { deploymentMode: 'disabled' } });
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown slug', '/live/listen/?wg_event=no-such-event'],
    ['no slug', '/live/listen/'],
    ['an invalid slug', '/live/listen/?wg_event=%E4%B8%AD%E6%96%87'],
    ['an uppercase slug', '/live/listen/?wg_event=Demo-Live'],
    ['a repeated parameter', '/live/listen/?wg_event=demo-live-binaural-atmos&wg_event=demo-ended'],
  ])('event not found (%s): 找不到這場活動 + link back, no controller', (_name, search) => {
    const m = mountView({ search });
    expect(createMock).not.toHaveBeenCalled();
    expect(pollerMock).not.toHaveBeenCalled();
    expect(text(q(m, '.wg-live__status-title'))).toBe('找不到這場活動');
    expect(m.mount.querySelector('a')?.getAttribute('href')).toBe(LINKS.events);
    expect(m.mount.querySelector('audio, video')).toBeNull();
  });

  it('uses the view heading level for the lone message', () => {
    const m = mountView({ search: '/live/listen/', boot: { heading: 'h1' } });
    expect(q(m, '.wg-live__status-title').tagName).toBe('H1');
  });

  it('destroy() removes the message', () => {
    const m = mountView({ search: '/live/listen/' });
    m.instance.destroy();
    expect(m.mount.childElementCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('event resolution and controller dependencies', () => {
  function deps(): CoordinatorDeps {
    const call = createMock.mock.calls[0];
    if (!call) throw new Error('controller was not created');
    return call[0];
  }

  it('resolves the event from ?wg_event=', () => {
    mountView();
    expect(deps().event?.slug).toBe('demo-live-binaural-atmos');
  });

  it('the shortcode event attribute (fixedEventSlug) wins over ?wg_event=', () => {
    mountView({ boot: { fixedEventSlug: 'demo-scheduled' } });
    expect(deps().event?.slug).toBe('demo-scheduled');
  });

  it('builds the dependencies from the boot config and the context', () => {
    const m = mountView();
    const d = deps();
    expect(d.boot).toBe(m.boot);
    expect(d.root).toBe(m.root);
    expect(d.env).toEqual({ volumeSettable: true });
    expect(d.host.media).toBeInstanceOf(HTMLAudioElement);
    expect(m.mount.querySelector('.wg-live__stage')?.contains(d.host.media)).toBe(true);
    expect(typeof d.adapterFactory).toBe('function');
    expect(typeof d.playbackProvider.resolve).toBe('function');
    expect(typeof d.entitlementProvider.get).toBe('function');
    expect(typeof d.eventProvider.get).toBe('function');
  });

  it('preselects a valid ?wg_mode=', () => {
    mountView({ search: '/live/listen/?wg_event=demo-live-binaural-atmos&wg_mode=atmos' });
    expect(deps().preselect).toBe('atmos');
  });

  it('ignores an unknown ?wg_mode= and a mode the event does not offer', () => {
    mountView({ search: '/live/listen/?wg_event=demo-live-binaural-atmos&wg_mode=surround' });
    expect(deps().preselect).toBeNull();
    createMock.mockClear();
    mountView({ search: '/live/listen/?wg_event=demo-ended&wg_mode=atmos' });
    expect(deps().preselect).toBeNull();
  });

  it('falls back to the remembered mode, but only when the event offers it', () => {
    window.localStorage.setItem('wg-live:mode', 'atmos');
    mountView();
    expect(deps().preselect).toBe('atmos');
    createMock.mockClear();
    mountView({ search: '/live/listen/?wg_event=demo-ended' }); // binaural only
    expect(deps().preselect).toBeNull();
  });

  it('a valid ?wg_mode= beats the remembered mode', () => {
    window.localStorage.setItem('wg-live:mode', 'atmos');
    mountView({ search: '/live/listen/?wg_event=demo-live-binaural-atmos&wg_mode=binaural' });
    expect(deps().preselect).toBe('binaural');
  });

  it('remembers the mode through onModeRemembered (only the mode is stored)', () => {
    mountView();
    deps().onModeRemembered?.('atmos');
    expect(window.localStorage.getItem('wg-live:mode')).toBe('atmos');
    expect(window.localStorage.length).toBe(1);
  });

  it('creates a <video> host for video events', () => {
    mountView({ event: makeEvent({ mediaKind: 'video', slug: 'demo-live-binaural-atmos' }) });
    expect(deps().host.media).toBeInstanceOf(HTMLVideoElement);
  });

  it('registers the controller on the page registry and unregisters it on destroy', () => {
    const before = pageRegistry.size();
    const m = mountView();
    expect(pageRegistry.size()).toBe(before + 1);
    m.instance.destroy();
    expect(pageRegistry.size()).toBe(before);
  });

  it('starts one event poller that feeds controller.updateEvent', () => {
    const m = mountView();
    expect(pollerMock).toHaveBeenCalledTimes(1);
    expect(pollerOptions?.slug).toBe('demo-live-binaural-atmos');
    expect(pollerOptions?.root).toBe(m.root);
    const next = makeEvent({ status: 'ended' });
    pollerOptions?.onEvent(next);
    expect(m.controller.calls.updateEvent).toHaveBeenCalledWith(next);
  });
});

/* ------------------------------------------------------------------ */

describe('layout and content', () => {
  it('follows the spec 5.3 mobile order: title + status, stage, controls, mode + switch, info, help', () => {
    const m = mountView({ state: playingState() });
    const view = q(m, '.wg-live__player-view');
    const order = Array.from(view.children).map((c) => c.className.split(' ')[0]);
    // The title area lives inside the player group (HYBRID): from 768px CSS `order` puts the stage first.
    expect(order).toEqual(['wg-live__player', 'wg-live__aside', 'wg-live__dialog']);
    expect(Array.from(q(m, '.wg-live__aside').children).map((c) => c.className.split(' ')[0])).toEqual([
      'wg-live__info',
      'wg-live__help-link',
    ]);

    const head = q(m, '.wg-live__player-head');
    expect(Array.from(head.children).map((c) => c.className.split(' ')[0])).toEqual([
      'wg-live__meta-row',
      'wg-live__player-title',
      'wg-live__player-meta',
      'wg-live__status',
      'wg-live__entitlement',
    ]);
    // The mode-label note moved into the status block (the bar stays one row).
    expect(q(m, '.wg-live__status .wg-live__mode-note')).toBeTruthy();
    expect(maybe(m, '.wg-live__modebar .wg-live__mode-note')).toBeNull();

    const player = q(m, '.wg-live__player');
    expect(player.getAttribute('role')).toBe('group');
    expect(player.getAttribute('aria-label')).toBeTruthy();
    expect(Array.from(player.children).map((c) => c.className.split(' ')[0])).toEqual([
      'wg-live__player-head',
      'wg-live__stage',
      'wg-live__controls',
    ]);
    const slot = q(m, '.wg-live__controls');
    expect(Array.from(slot.children).map((c) => c.className.split(' ')[0])).toEqual([
      'wg-live__mode-selector',
      'wg-live__controls-main',
      'wg-live__modebar',
    ]);
  });

  it('puts the event title in the view heading; the 介面示範 badge sits in the meta row but stays in the heading name', () => {
    const m = mountView();
    const title = q(m, '.wg-live__player-title');
    expect(title.tagName).toBe('H2');
    expect(title.textContent).toContain('【介面示範】錄音室現場音樂會 Live');
    expect(title.querySelector('.wg-live__badge--demo')).toBeNull();
    const badge = q(m, '.wg-live__meta-row .wg-live__badge--demo');
    expect(badge.textContent).toBe('介面示範');
    const names = (title.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(names).toEqual(['【介面示範】錄音室現場音樂會 Live', '介面示範']);
  });

  it('renders performers and date as two meta items (no " · " text node) and the programme as an ordered list', () => {
    const m = mountView();
    const items = Array.from(m.mount.querySelectorAll('.wg-live__player-meta-item'));
    expect(items).toHaveLength(2);
    expect(q(m, '.wg-live__player-meta').textContent).not.toContain('·');
    expect(q(m, '.wg-live__programme-list').tagName).toBe('OL');
    expect(q(m, '.wg-live__info-body > .wg-live__info-main .wg-live__info-text')).toBeTruthy();
  });

  it('has no demo badge for a non-demo event', () => {
    const m = mountView({ event: makeEvent({ isDemo: false, slug: 'demo-live-binaural-atmos' }) });
    expect(maybe(m, '.wg-live__badge--demo')).toBeNull();
  });

  it('uses h1 / h2 / h3 when the shortcode promotes the heading', () => {
    const m = mountView({ boot: { heading: 'h1' } });
    expect(q(m, '.wg-live__player-title').tagName).toBe('H1');
    expect(q(m, '.wg-live__status-title').tagName).toBe('H2');
    expect(q(m, '.wg-live__info-heading').tagName).toBe('H2');
    expect(q(m, '.wg-live__programme-heading').tagName).toBe('H3');
  });

  it('shows time with its zone, performers and a static programme (never "now playing")', () => {
    const m = mountView();
    expect(text(q(m, '.wg-live__player-meta'))).toContain('演出者：示範樂手 A、示範樂手 B');
    expect(text(q(m, '.wg-live__player-meta'))).toContain('台北時間');
    expect(q(m, '.wg-live__player-meta time').getAttribute('datetime')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const programme = q(m, '.wg-live__programme');
    expect(text(programme.querySelector('.wg-live__programme-heading'))).toBe('節目單');
    expect(Array.from(programme.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      '示範曲目 一',
      '示範曲目 二',
      '示範曲目 三',
    ]);
    expect(programme.textContent).not.toMatch(/正在演出|Now playing/i);
    for (const li of Array.from(programme.querySelectorAll('li'))) expect(li.textContent).not.toMatch(/正在|目前播放|Now/i);
    expect(programme.textContent).toContain('不代表目前正在播放的曲目');
  });

  it('renders no empty labels when performers and programme are missing', () => {
    const m = mountView({
      event: makeEvent({ performers: [], programme: [], description: '', slug: 'demo-live-binaural-atmos' }),
    });
    expect(text(q(m, '.wg-live__player-meta'))).not.toContain('演出者');
    expect(maybe(m, '.wg-live__programme')).toBeNull();
  });

  it('splits the description on newlines into paragraphs of plain text', () => {
    const m = mountView();
    const paragraphs = Array.from(m.mount.querySelectorAll('.wg-live__info-text'));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.textContent).toContain('這是介面示範活動');
  });

  it('renders admin text as text, never as markup (no innerHTML)', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const m = mountView({
      event: makeEvent({ title: evil, description: evil, programme: [evil], performers: [evil], slug: 'demo-live-binaural-atmos' }),
    });
    expect(m.mount.querySelector('img[src="x"], script')).toBeNull();
    expect(q(m, '.wg-live__player-title-text').textContent).toBe(evil);
    expect(m.mount.querySelector('[onerror]')).toBeNull();
  });

  it('audio events get poster art in the stage; video events get a poster attribute on the video', () => {
    const audio = mountView();
    expect(audio.mount.querySelector('.wg-live__stage .wg-live__stage-art img')?.getAttribute('width')).toBe('1200');
    document.body.replaceChildren();
    const video = mountView({ event: makeEvent({ mediaKind: 'video', slug: 'demo-live-binaural-atmos', poster: null, posterUrl: '/p.jpg' }) });
    const el = q<HTMLVideoElement>(video, 'video');
    expect(el.getAttribute('poster')).toMatch(/\/p\.jpg$/);
    expect(video.mount.querySelector('.wg-live__stage-art')).toBeNull();
  });

  it('links to the help page', () => {
    const m = mountView();
    const link = q(m, '.wg-live__help-link a');
    expect(link.getAttribute('href')).toBe(LINKS.help);
    expect(link.textContent).toBe('聆聽說明');
  });

  it('sets aria-busy handling to the caller (the view only fills the mount)', () => {
    const m = mountView();
    expect(m.mount.querySelectorAll('.wg-live__player-view')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */

describe('gates (plan 6.2)', () => {
  const sel = {
    status: '.wg-live__status-title',
    controls: '.wg-live__controls',
    selector: '.wg-live__mode-selector',
    play: '.wg-live__play',
  };

  it('live and ready: mode selector visible, Start enabled', () => {
    const m = mountView({ state: readyState() });
    expect(q(m, sel.controls).hidden).toBe(false);
    expect(q(m, sel.selector).hidden).toBe(false);
    expect(q(m, sel.play).hasAttribute('aria-disabled')).toBe(false);
    expect(text(q(m, sel.play))).toBe('開始聆聽');
  });

  it('scheduled: 演出尚未開始 with the time; selection works but Start is disabled with a reason', () => {
    const m = mountView({ state: makeState({ event: { status: 'scheduled' }, entitlement: 'entitled', player: { status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' } }) });
    expect(text(q(m, sel.status))).toBe('演出尚未開始');
    expect(text(q(m, '.wg-live__status-detail'))).toContain('開始時間：');
    expect(q(m, sel.selector).hidden).toBe(false);
    expect(q(m, sel.play).getAttribute('aria-disabled')).toBe('true');
    expect(text(q(m, '.wg-live__start-reason'))).toContain('演出開始前');
    expect(text(q(m, '.wg-live__status-actions'))).toContain('聆聽說明');
  });

  it('doors open: 即將開放聆聽, selector works, Start disabled', () => {
    const m = mountView({ state: makeState({ event: { status: 'doors_open' }, player: { status: 'selecting', selectedMode: 'atmos' } }) });
    expect(text(q(m, sel.status))).toBe('即將開放聆聽');
    expect(q(m, sel.selector).hidden).toBe(false);
    expect(q(m, sel.play).getAttribute('aria-disabled')).toBe('true');
    expect(text(q(m, '.wg-live__start-reason'))).toContain('開放後即可開始');
  });

  it('intermission is a normal open gate with an extra note', () => {
    const m = mountView({ state: playingState('binaural', { event: { status: 'intermission' } }) });
    expect(text(q(m, '.wg-live__status'))).toContain('演出中場休息');
    expect(q(m, sel.controls).hidden).toBe(false);
  });

  it('ended: 本場演出已結束, back to the events, no controls and no replay', () => {
    const m = mountView({ state: makeState({ event: { status: 'ended' } }) });
    expect(text(q(m, sel.status))).toBe('本場演出已結束');
    expect(q(m, sel.controls).hidden).toBe(true);
    expect(text(q(m, '.wg-live__status-actions'))).toContain('返回活動列表');
    expect(m.mount.textContent).not.toContain('回放');
  });

  it('cancelled: 本場活動已取消 with the contact link, no controls', () => {
    const m = mountView({ state: makeState({ event: { status: 'cancelled' } }) });
    expect(text(q(m, sel.status))).toBe('本場活動已取消');
    expect(q(m, sel.controls).hidden).toBe(true);
    expect(text(q(m, '.wg-live__status-actions'))).toContain('聯絡我們');
  });

  it('source not configured: 播放來源尚未開放 and 查看活動資訊 moves focus to the info heading', () => {
    const m = mountView({ state: makeState({ source: 'not_configured', isDemoMedia: false }) });
    expect(text(q(m, sel.status))).toBe('播放來源尚未開放');
    expect(q(m, sel.controls).hidden).toBe(true);
    const button = Array.from(m.mount.querySelectorAll<HTMLButtonElement>('.wg-live__status-actions button')).find(
      (b) => b.textContent === '查看活動資訊',
    );
    expect(button?.hidden).toBe(false);
    button?.click();
    expect(document.activeElement).toBe(q(m, '.wg-live__info-heading'));
    expect(q(m, '.wg-live__info-heading').getAttribute('tabindex')).toBe('-1');
  });

  it('entitlement panel sits next to the status message, never instead of it', () => {
    const m = mountView({ state: makeState({ entitlement: 'guest', player: { status: 'selecting', selectedMode: 'binaural' } }) });
    expect(text(q(m, sel.status))).toBeTruthy();
    const panel = q(m, '.wg-live__entitlement');
    expect(panel.hidden).toBe(false);
    expect(text(panel)).toContain('請先登入');
    expect(panel.querySelector('a')?.getAttribute('href')).toBe(LINKS.account);
  });

  it('gate changes update the same DOM in place (live -> ended -> live)', () => {
    const m = mountView({ state: readyState() });
    const controls = q(m, sel.controls);
    const heading = q(m, sel.status);
    m.controller.set(makeState({ event: { status: 'ended' } }));
    expect(controls.hidden).toBe(true);
    m.controller.set(readyState());
    expect(controls.hidden).toBe(false);
    expect(q(m, sel.controls)).toBe(controls);
    expect(q(m, sel.status)).toBe(heading);
  });

  it('shows the live status badge from the event status', () => {
    const m = mountView({ state: readyState() });
    expect(text(q(m, '.wg-live__player-status-badge'))).toBe('演出中');
    m.controller.set(makeState({ event: { status: 'intermission' } }));
    expect(text(q(m, '.wg-live__player-status-badge'))).toBe('中場休息');
  });
});

/* ------------------------------------------------------------------ */

describe('mode selection and Start', () => {
  it('selecting a radio calls controller.selectMode', () => {
    const m = mountView({ state: makeState() });
    const radio = q<HTMLInputElement>(m, 'input[value="atmos"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(m.controller.calls.selectMode).toHaveBeenCalledWith('atmos');
  });

  it('reflects the preselected mode in the radio group', () => {
    const m = mountView({ state: readyState('atmos') });
    expect(q<HTMLInputElement>(m, 'input[value="atmos"]').checked).toBe(true);
    expect(q<HTMLInputElement>(m, 'input[value="binaural"]').checked).toBe(false);
  });

  it('with no mode selected Start is disabled with the reason 請先選擇聆聽模式', () => {
    const m = mountView({ state: makeState() });
    expect(q(m, '.wg-live__play').getAttribute('aria-disabled')).toBe('true');
    expect(text(q(m, '.wg-live__start-reason'))).toBe('請先選擇聆聽模式');
    q(m, '.wg-live__play').click();
    expect(m.controller.calls.start).not.toHaveBeenCalled();
  });

  it.each([
    ['guest', '請先登入'],
    ['not_entitled', '尚未取得觀看資格'],
    ['unavailable', '暫時無法確認觀看資格'],
    ['unknown', '正在確認觀看資格'],
  ] as const)('Start stays disabled while entitlement is %s', (entitlement, reason) => {
    const m = mountView({ state: makeState({ entitlement, player: { status: 'selecting', selectedMode: 'binaural', preparedMode: 'binaural' } }) });
    expect(q(m, '.wg-live__play').getAttribute('aria-disabled')).toBe('true');
    expect(text(q(m, '.wg-live__start-reason'))).toBe(reason);
    q(m, '.wg-live__play').click();
    expect(m.controller.calls.start).not.toHaveBeenCalled();
  });

  it('Start is disabled until the descriptor is prepared', () => {
    const m = mountView({ state: makeState({ entitlement: 'entitled', player: { status: 'selecting', selectedMode: 'atmos', preparedMode: null } }) });
    expect(q(m, '.wg-live__play').getAttribute('aria-disabled')).toBe('true');
    expect(text(q(m, '.wg-live__start-reason'))).toBe('正在確認播放來源');
    m.controller.set(readyState('atmos'));
    expect(q(m, '.wg-live__play').hasAttribute('aria-disabled')).toBe(false);
    expect(q(m, '.wg-live__start-reason').hidden).toBe(true);
  });

  it('clicking an enabled Start calls controller.start() synchronously', () => {
    const m = mountView({ state: readyState() });
    q(m, '.wg-live__play').click();
    expect(m.controller.calls.start).toHaveBeenCalledTimes(1);
  });

  it('after starting, the selector gives way to the current mode label and the switch button', () => {
    const m = mountView({ state: readyState() });
    expect(q(m, '.wg-live__mode-selector').hidden).toBe(false);
    m.controller.set(playingState('binaural', { player: { status: 'loading', confirmedPlaying: false, activeMode: null } }));
    expect(q(m, '.wg-live__mode-selector').hidden).toBe(true);
    expect(q(m, '.wg-live__switch').hidden).toBe(false);
    expect(q(m, '.wg-live__switch').getAttribute('aria-disabled')).toBe('true');
  });

  it('after a first-start failure the selector comes back so another mode can be chosen', () => {
    const error: PlayerError = { code: 'unsupported', mode: 'atmos', publicCode: 'E-SRC-01' };
    const m = mountView({
      state: makeState({ entitlement: 'entitled', player: { status: 'failed', selectedMode: 'atmos', error } }),
    });
    expect(q(m, '.wg-live__mode-selector').hidden).toBe(false);
    expect(q(m, '.wg-live__play').hidden).toBe(true);
  });
});

describe('current mode label (plan 6.10)', () => {
  it('says 已選擇 until the adapter confirms playing, then 目前播放', () => {
    const m = mountView({ state: readyState('atmos') });
    expect(text(q(m, '.wg-live__mode-label'))).toBe('已選擇：Dolby Atmos 音軌');
    m.controller.set(playingState('atmos', { player: { status: 'loading', confirmedPlaying: false, activeMode: null } }));
    expect(text(q(m, '.wg-live__mode-label'))).toBe('已選擇：Dolby Atmos 音軌');
    m.controller.set(playingState('atmos'));
    expect(text(q(m, '.wg-live__mode-label'))).toBe('目前播放：Dolby Atmos 音軌');
  });

  it('never claims certification or device output', () => {
    const m = mountView({ state: playingState('atmos') });
    expect(m.mount.textContent).not.toMatch(/認證|7\.1\.4|已連線|Dolby Vision|擴大機/);
  });
});

describe('demo disclaimer', () => {
  it('is present for demo media in both modes, before and during playback', () => {
    for (const mode of ['binaural', 'atmos'] as const) {
      for (const state of [readyState(mode), playingState(mode)]) {
        document.body.replaceChildren();
        const m = mountView({ state });
        const notice = q(m, '.wg-live__demo-notice');
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toBe('操作示範音訊，非 Binaural／Atmos 驗證素材');
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe('in-place rendering (plan 6.6)', () => {
  it('never recreates the media element, the stage, the player group or the main button', () => {
    const m = mountView({ state: readyState() });
    const media = q(m, 'audio');
    const stage = q(m, '.wg-live__stage');
    const group = q(m, '.wg-live__player');
    const play = q(m, '.wg-live__play');
    const heading = q(m, '.wg-live__status-title');
    const selector = q(m, '.wg-live__mode-selector');

    const failure: PlayerError = { code: 'network', mode: 'binaural', publicCode: 'E-NET-01' };
    const sequence: AppState[] = [
      playingState('binaural', { player: { status: 'loading', confirmedPlaying: false, activeMode: null } }),
      playingState('binaural'),
      playingState('binaural', { player: { status: 'paused' } }),
      playingState('binaural', { player: { status: 'reconnecting' } }),
      playingState('binaural', { player: { status: 'switching', pendingMode: 'atmos' } }),
      playingState('binaural', { player: { status: 'failed', error: failure, confirmedPlaying: false } }),
      makeState({ event: { status: 'ended' } }),
      readyState(),
      playingState('binaural'),
    ];
    for (const next of sequence) {
      m.controller.set(next);
      expect(m.mount.querySelectorAll('audio')).toHaveLength(1);
      expect(q(m, 'audio')).toBe(media);
      expect(q(m, '.wg-live__stage')).toBe(stage);
      expect(q(m, '.wg-live__player')).toBe(group);
      expect(q(m, '.wg-live__play')).toBe(play);
      expect(q(m, '.wg-live__status-title')).toBe(heading);
      expect(q(m, '.wg-live__mode-selector')).toBe(selector);
      expect(media.parentElement).toBe(stage);
    }
  });

  it('does not add controls, autoplay or source children to the media element', () => {
    const m = mountView({ state: readyState() });
    m.controller.set(playingState('binaural'));
    const media = q<HTMLAudioElement>(m, 'audio');
    expect(media.hasAttribute('controls')).toBe(false);
    expect(media.hasAttribute('autoplay')).toBe(false);
    expect(media.querySelector('source')).toBeNull();
  });

  it('keeps the number of DOM nodes stable across repeated identical states', () => {
    const m = mountView({ state: playingState() });
    const before = m.mount.querySelectorAll('*').length;
    for (let i = 0; i < 5; i++) m.controller.set(playingState());
    expect(m.mount.querySelectorAll('*').length).toBe(before);
  });

  it('shows pause while playing and 開始聆聽 after play_blocked, calling togglePlay (not start)', () => {
    const m = mountView({ state: playingState() });
    expect(text(q(m, '.wg-live__play'))).toBe('暫停');
    const blocked: PlayerError = { code: 'play_blocked', mode: 'binaural', publicCode: 'E-PLY-01' };
    m.controller.set(playingState('binaural', { player: { status: 'paused', error: blocked, confirmedPlaying: false } }));
    expect(text(q(m, '.wg-live__status-title'))).toBe('請點擊開始聆聽');
    expect(text(q(m, '.wg-live__play'))).toBe('開始聆聽');
    q(m, '.wg-live__play').click();
    expect(m.controller.calls.togglePlay).toHaveBeenCalledTimes(1);
    expect(m.controller.calls.start).not.toHaveBeenCalled();
  });

  it('renders the controls from the capabilities only', () => {
    const m = mountView({ state: playingState('binaural', { capabilities: { ...FULL_CAPS, volume: false } }) });
    expect(q(m, '.wg-live__mute').hidden).toBe(false);
    expect(q(m, '.wg-live__volume').hidden).toBe(true);
    expect(q(m, '.wg-live__live').hidden).toBe(true);
    expect(q(m, '.wg-live__fullscreen').hidden).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('switch dialog (plan 6.6)', () => {
  const dialogOf = (m: Mounted): HTMLDialogElement => q<HTMLDialogElement>(m, 'dialog.wg-live__dialog');

  it('is only offered when playing with two modes available', () => {
    const idle = mountView({ state: readyState() });
    expect(q(idle, '.wg-live__switch').hidden).toBe(true);
    document.body.replaceChildren();
    const playing = mountView({ state: playingState() });
    expect(q(playing, '.wg-live__switch').hidden).toBe(false);
    expect(q(playing, '.wg-live__switch').textContent).toBe('切換模式');
    document.body.replaceChildren();
    const single = mountView({ state: playingState(), event: makeEvent({ availableModes: ['binaural'], slug: 'demo-live-binaural-atmos' }) });
    expect(q(single, '.wg-live__switch').hidden).toBe(true);
  });

  it('opens a modal naming both modes and prefetches the other mode', () => {
    const m = mountView({ state: playingState('binaural') });
    q(m, '.wg-live__switch').click();
    const dialog = dialogOf(m);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(text(dialog)).toContain('目前模式為「Binaural」');
    expect(text(dialog)).toContain('「Dolby Atmos 音軌」');
    expect(text(dialog)).toContain('短暫中斷');
    expect(m.controller.calls.prepareSwitch).toHaveBeenCalledWith('atmos');
  });

  it('names Atmos as the current mode and offers Binaural when Atmos plays', () => {
    const m = mountView({ state: playingState('atmos') });
    q(m, '.wg-live__switch').click();
    expect(text(dialogOf(m))).toContain('目前模式為「Dolby Atmos 音軌」');
    expect(m.controller.calls.prepareSwitch).toHaveBeenCalledWith('binaural');
  });

  it('confirm calls switchMode synchronously and closes; focus returns to the trigger', () => {
    const m = mountView({ state: playingState('binaural') });
    const trigger = q<HTMLButtonElement>(m, '.wg-live__switch');
    trigger.focus();
    trigger.click();
    q<HTMLButtonElement>(m, '.wg-live__dialog-confirm').click();
    expect(m.controller.calls.switchMode).toHaveBeenCalledTimes(1);
    expect(m.controller.calls.switchMode).toHaveBeenCalledWith('atmos');
    expect(dialogOf(m).hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('cancel and Escape only close; the stream is untouched', () => {
    const m = mountView({ state: playingState('binaural') });
    const trigger = q<HTMLButtonElement>(m, '.wg-live__switch');
    trigger.focus();
    trigger.click();
    q<HTMLButtonElement>(m, '.wg-live__dialog-cancel').click();
    expect(dialogOf(m).hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    dialogOf(m).dispatchEvent(new Event('cancel', { cancelable: true }));
    dialogOf(m).close();
    expect(m.controller.calls.switchMode).not.toHaveBeenCalled();
    expect(m.controller.calls.stop).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('while switching the trigger is aria-disabled (never `disabled`) and its click is guarded', () => {
    const m = mountView({ state: playingState('binaural', { player: { status: 'switching', pendingMode: 'atmos' } }) });
    const trigger = q<HTMLButtonElement>(m, '.wg-live__switch');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.disabled).toBe(false);
    trigger.click();
    expect(dialogOf(m).hasAttribute('open')).toBe(false);
    expect(m.controller.calls.prepareSwitch).not.toHaveBeenCalled();
  });

  it('closes by itself when the event ends, and focus falls back to the status heading (trigger is gone)', () => {
    const m = mountView({ state: playingState('binaural') });
    const trigger = q<HTMLButtonElement>(m, '.wg-live__switch');
    trigger.focus();
    trigger.click();
    expect(dialogOf(m).hasAttribute('open')).toBe(true);
    m.controller.set(makeState({ event: { status: 'ended' } }));
    expect(dialogOf(m).hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(q(m, '.wg-live__status-title'));
  });

  it('after a failed switch it offers the old mode and the Binaural fallback, and the status stays honest', () => {
    const error: PlayerError = { code: 'network', mode: 'atmos', publicCode: 'E-NET-01' };
    const m = mountView({
      state: playingState('binaural', { player: { status: 'failed', error, confirmedPlaying: false, activeMode: null, selectedMode: 'atmos' } }),
    });
    const labels = Array.from(m.mount.querySelectorAll<HTMLElement>('.wg-live__status-actions button'))
      .filter((b) => !b.hidden)
      .map((b) => b.textContent);
    expect(labels).toEqual(['重試', '重新載入Binaural', '改用耳機 Binaural']);
    expect(text(q(m, '.wg-live__status-detail'))).toContain('切換失敗，仍保留原模式：Binaural');
    expect(text(q(m, '.wg-live__mode-label'))).not.toContain('目前播放');
  });
});

/* ------------------------------------------------------------------ */

describe('keyboard (plan 6.10)', () => {
  function key(target: Element, init: KeyboardEventInit & { key: string }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('Space and K on the player group toggle playback and are prevented', () => {
    const m = mountView({ state: playingState() });
    const group = q(m, '.wg-live__player');
    expect(key(group, { key: ' ' }).defaultPrevented).toBe(true);
    expect(key(q(m, '.wg-live__stage'), { key: 'k' }).defaultPrevented).toBe(true);
    expect(m.controller.calls.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('ignores Space on a button inside the player, and modifier combos', () => {
    const m = mountView({ state: playingState() });
    expect(key(q(m, '.wg-live__play'), { key: ' ' }).defaultPrevented).toBe(false);
    expect(key(q(m, '.wg-live__player'), { key: 'k', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(m.controller.calls.togglePlay).not.toHaveBeenCalled();
  });

  it('does not hijack keys outside the player or from inside the dialog', () => {
    const m = mountView({ state: playingState() });
    expect(key(q(m, '.wg-live__info'), { key: ' ' }).defaultPrevented).toBe(false);
    q(m, '.wg-live__switch').click();
    expect(key(q(m, '.wg-live__dialog-confirm'), { key: 'k' }).defaultPrevented).toBe(false);
    expect(key(document.body, { key: ' ' }).defaultPrevented).toBe(false);
    expect(m.controller.calls.togglePlay).not.toHaveBeenCalled();
  });

  it('stops listening after destroy()', () => {
    const m = mountView({ state: playingState() });
    const group = q(m, '.wg-live__player');
    m.instance.destroy();
    expect(key(group, { key: 'k' }).defaultPrevented).toBe(false);
    expect(m.controller.calls.togglePlay).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

describe('announcements (plan 6.10)', () => {
  it('announces nothing for the state the page loads in', () => {
    const m = mountView({ state: readyState() });
    expect(m.announce).not.toHaveBeenCalled();
  });

  it('announces a new message once, coalesced, and not again for the same state', () => {
    const m = mountView({ state: readyState() });
    m.controller.set(playingState('binaural', { player: { status: 'loading', confirmedPlaying: false, activeMode: null } }));
    expect(m.announce).toHaveBeenLastCalledWith('正在連接音訊', undefined);
    m.controller.set(playingState('binaural', { player: { status: 'loading', confirmedPlaying: false, activeMode: null, volume: 0.5 } }));
    m.controller.set(playingState('binaural'));
    expect(m.announce).toHaveBeenLastCalledWith('目前播放：Binaural', undefined);
    expect(m.announce).toHaveBeenCalledTimes(2);
    m.controller.set(playingState('binaural', { player: { volume: 0.3 } }));
    expect(m.announce).toHaveBeenCalledTimes(2);
  });

  it('announces failures immediately', () => {
    const m = mountView({ state: playingState() });
    const error: PlayerError = { code: 'decode', mode: 'binaural', publicCode: 'E-DEC-01' };
    m.controller.set(playingState('binaural', { player: { status: 'failed', error, confirmedPlaying: false } }));
    expect(m.announce).toHaveBeenLastCalledWith(expect.stringContaining('播放失敗'), { immediate: true });
  });

  it('announces a network failure (retries used up) as 無法播放，請重試, not as "reconnecting"', () => {
    const m = mountView({ state: playingState() });
    const error: PlayerError = { code: 'network', mode: 'binaural', publicCode: 'E-NET-01' };
    m.controller.set(playingState('binaural', { player: { status: 'failed', error, confirmedPlaying: false } }));
    expect(m.announce).toHaveBeenLastCalledWith('無法播放，請重試', { immediate: true });
  });

  it('announces a blocked play() immediately as 請點擊開始聆聽', () => {
    const m = mountView({ state: playingState() });
    const error: PlayerError = { code: 'play_blocked', mode: 'binaural', publicCode: 'E-PLY-01' };
    m.controller.set(playingState('binaural', { player: { status: 'paused', error, confirmedPlaying: false } }));
    expect(m.announce).toHaveBeenLastCalledWith('請點擊開始聆聽', { immediate: true });
  });

  it('announces event status changes and never the countdown or a time', () => {
    const m = mountView({ state: makeState({ event: { status: 'doors_open' }, player: { status: 'selecting', selectedMode: 'binaural' } }) });
    m.controller.set(readyState());
    const messages = m.announce.mock.calls.map((c) => c[0]);
    expect(messages).toEqual(['活動狀態更新：演出中']);
    for (const message of messages) expect(message).not.toMatch(/\d{1,2}:\d{2}|倒數|剩/);
  });

  it('does not put a live region inside the view (only the root status region announces)', () => {
    const m = mountView({ state: playingState() });
    expect(m.mount.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('dev panel (plan D17)', () => {
  it('is absent when the controller has no dev controls (production)', () => {
    const m = mountView({ dev: null });
    expect(maybe(m, '.wg-live__dev')).toBeNull();
    expect(m.mount.textContent).not.toContain('開發用示範面板');
    expect(m.mount.querySelector('details, select')).toBeNull();
  });

  it('is rendered, labelled and collapsed when dev controls exist', () => {
    const dev = fakeDev();
    const m = mountView({ dev });
    const panel = q<HTMLDetailsElement>(m, '.wg-live__dev');
    expect(panel.open).toBe(false);
    expect(text(panel.querySelector('summary'))).toBe('開發用示範面板（正式站不顯示）');
    expect(q(m, '.wg-live__player-view').lastElementChild).toBe(panel);
    expect(q(m, '.wg-live__player').contains(panel)).toBe(false);
  });

  it('drives the dev controls', () => {
    const dev = fakeDev();
    const m = mountView({ dev });
    const select = q<HTMLSelectElement>(m, '.wg-live__dev-select');
    select.value = 'cancelled';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dev.setEventStatus).toHaveBeenCalledWith('cancelled');
  });

  it('shows the simulated-status notice from the state', () => {
    const dev = fakeDev();
    const m = mountView({ dev });
    m.controller.set(makeState({ event: { status: 'ended', simulated: true } }));
    expect(q(m, '.wg-live__dev-simulated').hidden).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('lifecycle', () => {
  it('destroy() unsubscribes, destroys the controller and the poller, and removes the DOM; it is idempotent', () => {
    const m = mountView({ state: playingState() });
    expect(m.controller.listenerCount()).toBe(1);
    m.instance.destroy();
    expect(m.controller.listenerCount()).toBe(0);
    expect(m.controller.calls.destroy).toHaveBeenCalledTimes(1);
    expect(pollerStop).toHaveBeenCalledTimes(1);
    expect(m.mount.querySelector('.wg-live__player-view')).toBeNull();
    expect(() => m.instance.destroy()).not.toThrow();
    expect(m.controller.calls.destroy).toHaveBeenCalledTimes(1);
    expect(() => m.controller.set(readyState())).not.toThrow();
  });

  it('destroy() closes an open dialog', () => {
    const m = mountView({ state: playingState() });
    q(m, '.wg-live__switch').click();
    m.instance.destroy();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('stop() (pagehide) stops the controller without destroying it', () => {
    const m = mountView({ state: playingState() });
    m.instance.stop?.();
    expect(m.controller.calls.stop).toHaveBeenCalledTimes(1);
    expect(m.controller.calls.destroy).not.toHaveBeenCalled();
  });

  it('refresh() (bfcache pageshow) polls the event now', () => {
    const m = mountView();
    m.instance.refresh?.();
    expect(pollerRefresh).toHaveBeenCalledTimes(1);
  });

  it('stop() and refresh() are harmless after destroy()', () => {
    const m = mountView();
    m.instance.destroy();
    m.instance.stop?.();
    m.instance.refresh?.();
    expect(m.controller.calls.stop).not.toHaveBeenCalled();
    expect(pollerRefresh).not.toHaveBeenCalled();
  });

  it('when the poller reports the event gone, playback is released and 找不到這場活動 is shown', () => {
    const before = pageRegistry.size();
    const m = mountView({ state: playingState() });
    pollerOptions?.onGone?.();
    expect(m.controller.calls.destroy).toHaveBeenCalledTimes(1);
    expect(m.mount.querySelector('audio')).toBeNull();
    expect(text(q(m, '.wg-live__status-title'))).toBe('找不到這場活動');
    expect(m.announce).toHaveBeenLastCalledWith('找不到這場活動', { immediate: true });
    expect(pageRegistry.size()).toBe(before);
    // destroy() afterwards (the registry sweep) must not throw or double-destroy.
    expect(() => m.instance.destroy()).not.toThrow();
    expect(m.controller.calls.destroy).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */

describe('review fixes (ui-a11y)', () => {
  const decode: PlayerError = { code: 'decode', mode: 'binaural', publicCode: 'E-DEC-01' };
  const failedStart = (): AppState =>
    makeState({ entitlement: 'entitled', player: { status: 'failed', selectedMode: 'binaural', error: decode } });
  const visibleActions = (m: Mounted): HTMLElement[] =>
    Array.from(m.mount.querySelectorAll<HTMLElement>('.wg-live__status-actions button')).filter((b) => !b.hidden);

  describe('UI-02 focus does not fall to <body> when the focused control hides', () => {
    it('Start hides on failure: focus moves to the status heading', () => {
      const m = mountView({ state: readyState() });
      const primary = q<HTMLButtonElement>(m, '.wg-live__play');
      primary.focus();
      expect(document.activeElement).toBe(primary);
      m.controller.set(failedStart());
      expect(primary.hidden).toBe(true);
      expect(document.activeElement).toBe(q(m, '.wg-live__status-title'));
    });

    it('重試 hides once the retry is under way: focus moves to the status heading', () => {
      const m = mountView({ state: failedStart() });
      const retry = visibleActions(m).find((b) => b.textContent === '重試') as HTMLElement;
      expect(retry).toBeDefined();
      retry.focus();
      m.controller.set(makeState({ entitlement: 'entitled', player: { status: 'loading', selectedMode: 'binaural' } }));
      expect(retry.hidden).toBe(true);
      expect(document.activeElement).toBe(q(m, '.wg-live__status-title'));
    });

    it('the entitlement 重試 hides with its panel: focus moves to the status heading', () => {
      const m = mountView({ state: makeState({ entitlement: 'unavailable', player: { status: 'selecting', selectedMode: 'binaural' } }) });
      const retry = Array.from(m.mount.querySelectorAll<HTMLButtonElement>('.wg-live__entitlement button')).find((b) => !b.hidden) as HTMLElement;
      retry.focus();
      expect(document.activeElement).toBe(retry);
      m.controller.set(makeState({ entitlement: 'unknown', player: { status: 'selecting', selectedMode: 'binaural' } }));
      expect(document.activeElement).toBe(q(m, '.wg-live__status-title'));
    });

    it('a control that stays visible keeps focus, and so does one that is outside the view', () => {
      const m = mountView({ state: playingState('binaural') });
      const primary = q<HTMLButtonElement>(m, '.wg-live__play');
      primary.focus();
      m.controller.set(playingState('binaural', { player: { status: 'paused', confirmedPlaying: false } }));
      expect(document.activeElement).toBe(primary);

      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      m.controller.set(failedStart());
      expect(document.activeElement).toBe(outside);
    });
  });

  describe('UI-03 the status-panel 切換模式 action', () => {
    const modeUnavailable = (): AppState =>
      makeState({ entitlement: 'entitled', notReady: 'mode_unavailable', player: { status: 'selecting', selectedMode: 'atmos' } });

    it('before anything started it selects the other mode directly, with no dialog, and focuses that radio', () => {
      const m = mountView({ state: modeUnavailable() });
      const trigger = visibleActions(m).find((b) => b.textContent === '切換模式') as HTMLElement;
      expect(trigger).toBeDefined();
      trigger.focus();
      trigger.click();
      expect(m.controller.calls.selectMode).toHaveBeenCalledWith('binaural');
      expect(m.controller.calls.selectMode).toHaveBeenCalledTimes(1);
      expect(m.controller.calls.prepareSwitch).not.toHaveBeenCalled();
      expect(q<HTMLDialogElement>(m, 'dialog.wg-live__dialog').hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(q(m, 'input.wg-live__mode-input[value="binaural"]'));
    });

    it('keeps the focus on the radio after the not-ready state clears and the action disappears', () => {
      const m = mountView({ state: modeUnavailable() });
      const trigger = visibleActions(m).find((b) => b.textContent === '切換模式') as HTMLElement;
      trigger.focus();
      trigger.click();
      m.controller.set(readyState('binaural'));
      expect(trigger.hidden).toBe(true);
      expect(q<HTMLInputElement>(m, 'input.wg-live__mode-input[value="binaural"]').checked).toBe(true);
      expect(document.activeElement).toBe(q(m, 'input.wg-live__mode-input[value="binaural"]'));
    });

    it('an unsupported Binaural start still opens the dialog, aimed at Atmos', () => {
      const unsupported: PlayerError = { code: 'unsupported', mode: 'binaural', publicCode: 'E-SRC-01' };
      const m = mountView({
        state: makeState({ entitlement: 'entitled', player: { status: 'failed', selectedMode: 'binaural', error: unsupported } }),
      });
      (visibleActions(m).find((b) => b.textContent === '切換模式') as HTMLElement).click();
      expect(q<HTMLDialogElement>(m, 'dialog.wg-live__dialog').hasAttribute('open')).toBe(true);
      expect(m.controller.calls.prepareSwitch).toHaveBeenCalledWith('atmos');
      expect(m.controller.calls.selectMode).not.toHaveBeenCalled();
    });

    it('after a failed switch to Binaural the dialog targets the last good mode, not the one that just failed', () => {
      const m = mountView({
        state: playingState('atmos', {
          player: { status: 'failed', error: decode, selectedMode: 'binaural', confirmedPlaying: false },
        }),
      });
      q(m, '.wg-live__switch').click();
      expect(m.controller.calls.prepareSwitch).toHaveBeenCalledWith('atmos');
      expect(text(q(m, 'dialog.wg-live__dialog'))).toContain('目前模式為「Binaural」');
    });
  });

  describe('UI-05 the 60 s poll keeps unchanged info nodes', () => {
    it('an equal but distinct event object replaces nothing', () => {
      const m = mountView({ state: readyState() });
      const list = q(m, '.wg-live__programme-list');
      const paragraph = q(m, '.wg-live__info-text');
      const when = q(m, '.wg-live__info-when time');
      const state = m.controller.getState();
      const data = state.event.data as PublicEvent;
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((r) => records.push(...r));
      observer.observe(q(m, '.wg-live__player-view'), { childList: true, subtree: true });
      m.controller.set({ ...state, event: { ...state.event, data: structuredClone(data) } });
      expect(q(m, '.wg-live__programme-list')).toBe(list);
      expect(q(m, '.wg-live__info-text')).toBe(paragraph);
      expect(q(m, '.wg-live__info-when time')).toBe(when);
      expect(records.filter((r) => r.type === 'childList' && (r.target as Element).closest?.('.wg-live__info, .wg-live__player-meta'))).toEqual([]);
      observer.disconnect();
    });

    it('a real change to the programme or the description still re-renders', () => {
      const m = mountView({ state: readyState() });
      const list = q(m, '.wg-live__programme-list');
      const state = m.controller.getState();
      const data = state.event.data as PublicEvent;
      m.controller.set({ ...state, event: { ...state.event, data: { ...data, programme: ['新曲目'], description: '新的說明' } } });
      expect(q(m, '.wg-live__programme-list')).not.toBe(list);
      expect(Array.from(m.mount.querySelectorAll('.wg-live__programme-list li')).map((li) => li.textContent)).toEqual(['新曲目']);
      expect(text(q(m, '.wg-live__info-text'))).toBe('新的說明');
    });
  });

  describe('UI-06 event-status announcements', () => {
    it('live -> intermission while playing is announced, once', () => {
      const m = mountView({ state: playingState('binaural') });
      m.controller.set(playingState('binaural', { event: { status: 'intermission' } }));
      expect(m.announce).toHaveBeenCalledTimes(1);
      expect(m.announce).toHaveBeenLastCalledWith('活動狀態更新：中場休息');
      m.controller.set(playingState('binaural', { event: { status: 'intermission' }, player: { volume: 0.4 } }));
      expect(m.announce).toHaveBeenCalledTimes(1);
      m.controller.set(playingState('binaural', { event: { status: 'live' } }));
      expect(m.announce).toHaveBeenLastCalledWith('活動狀態更新：演出中');
      expect(m.announce).toHaveBeenCalledTimes(2);
    });

    it('picking another mode after a failure does not claim an event status update', () => {
      const m = mountView({ state: failedStart() });
      m.controller.set(readyState('atmos'));
      m.controller.set(readyState('binaural'));
      const messages = m.announce.mock.calls.map((c) => c[0]);
      expect(messages.filter((message) => message.includes('活動狀態更新'))).toEqual([]);
    });

    it('a real status change while waiting is still announced', () => {
      const m = mountView({ state: readyState('binaural', { event: { status: 'intermission' } }) });
      m.controller.set(readyState('binaural'));
      expect(m.announce).toHaveBeenLastCalledWith('活動狀態更新：演出中', undefined);
    });
  });

  describe('UI-07 an event with no listening mode', () => {
    it('does not tell the user to choose a mode (status heading and Start reason)', () => {
      const none = makeEvent({ availableModes: [] });
      const m = mountView({ event: none, state: makeState({ entitlement: 'entitled' }, none) });
      expect(text(q(m, '.wg-live__status-title'))).toBe('聆聽模式即將公布');
      expect(text(q(m, '.wg-live__start-reason'))).toBe('聆聽模式即將公布');
      expect(m.mount.textContent).not.toContain('請先選擇聆聽模式');
      expect(Array.from(m.mount.querySelectorAll<HTMLInputElement>('input.wg-live__mode-input')).every((i) => i.disabled)).toBe(true);
    });
  });

  describe('UI-08 keyboard shortcut advertising', () => {
    it('the group does not advertise Space; the primary button carries the shortcuts', () => {
      const m = mountView({ state: playingState('binaural') });
      expect(q(m, '.wg-live__player').hasAttribute('aria-keyshortcuts')).toBe(false);
      expect(q(m, '.wg-live__play').getAttribute('aria-keyshortcuts')).toBe('Space K');
    });
  });
});

/* ------------------------------------------------------------------ */

describe('source hygiene (plan D12)', () => {
  const files = [
    'src/views/player.ts',
    'src/components/player-shell.ts',
    'src/components/mode-selector.ts',
    'src/components/player-controls.ts',
    'src/components/status-panel.ts',
    'src/components/entitlement-panel.ts',
    'src/components/dialog.ts',
    'src/components/dev-panel.ts',
    'src/i18n/copy-player.ts',
  ];

  it.each(files)('%s builds DOM without markup sinks or inline handlers', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc/);
    expect(source).not.toMatch(/setAttribute\(\s*['"`]on/i);
    expect(source).not.toMatch(/\beval\(|new Function\(/);
  });

  it('adds no Service Worker, localStorage use or global exposure in the view layer', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/serviceWorker/);
      expect(source).not.toMatch(/window\.WGLive|window\[['"]WGLive/);
    }
  });
});
