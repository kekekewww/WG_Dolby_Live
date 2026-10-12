import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootConfig } from '../../../src/types';
import type { ViewContext, ViewInstance } from '../../../src/views/types';

type Mounter = (mount: HTMLElement, boot: BootConfig, ctx: ViewContext) => ViewInstance;

interface Probe {
  mount: HTMLElement;
  boot: BootConfig;
  ctx: ViewContext;
  instance: ViewInstance & { destroy: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> };
}

const calls: Record<'events' | 'player' | 'help', Probe[]> = { events: [], player: [], help: [] };
let throwOnMount = false;

function fakeMounter(view: keyof typeof calls): Mounter {
  return (mount, boot, ctx) => {
    if (throwOnMount) throw new Error('boom https://secret.example/stream');
    const instance = { destroy: vi.fn(), stop: vi.fn(), refresh: vi.fn() };
    calls[view].push({ mount, boot, ctx, instance });
    mount.append(document.createTextNode(`mounted:${view}`));
    return instance;
  };
}

vi.mock('../../../src/views/events', () => ({ mountEventsView: (...a: Parameters<Mounter>) => fakeMounter('events')(...a) }));
vi.mock('../../../src/views/player', () => ({ mountPlayerView: (...a: Parameters<Mounter>) => fakeMounter('player')(...a) }));
vi.mock('../../../src/views/help', () => ({ mountHelpView: (...a: Parameters<Mounter>) => fakeMounter('help')(...a) }));

function config(view: string): string {
  return JSON.stringify({
    schema: 1,
    pluginVersion: '0.1.0',
    view,
    deploymentMode: 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: '/wp-json/wg-live/v1/' },
    links: { home: '/' },
    events: [],
    help: { faq: [], compatibility: [], supportNote: '' },
    devTools: false,
  });
}

/** Builds the PHP-rendered container (plan 3.1). */
function makeRoot(view: 'events' | 'player' | 'help', opts: { config?: boolean; statusRegion?: boolean } = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = `wg-live wg-live--${view}`;
  root.dataset.wgLiveView = view;
  if (opts.config !== false) {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.className = 'wg-live__config';
    script.textContent = config(view);
    root.append(script);
  }
  if (opts.statusRegion !== false) {
    const region = document.createElement('div');
    region.className = 'wg-live__sr-status';
    region.setAttribute('role', 'status');
    root.append(region);
  }
  const mount = document.createElement('div');
  mount.className = 'wg-live__mount';
  mount.setAttribute('aria-busy', 'true');
  const skeleton = document.createElement('div');
  skeleton.className = 'wg-live__skeleton';
  mount.append(skeleton);
  root.append(mount);
  return root;
}

/**
 * An element built by another JavaScript realm (an iframe's window), like the widget DOM the Elementor editor
 * builds in the parent window and shows inside the preview frame: `instanceof Element` is false for it.
 */
function foreignElement(html: string): HTMLElement {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const doc = iframe.contentDocument as Document;
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  const element = holder.firstElementChild as HTMLElement;
  iframe.remove();
  return element;
}

/** Every window/document listener a freshly loaded copy of main.ts registers, so tests can drop them. */
const registered: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }> = [];

async function loadMain(): Promise<typeof import('../../../src/main')> {
  vi.resetModules();
  return import('../../../src/main');
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      if (listener) registered.push({ target, type, listener });
      original(type, listener, options);
    });
  }
  document.body.replaceChildren();
  calls.events.length = 0;
  calls.player.length = 0;
  calls.help.length = 0;
  throwOnMount = false;
  delete (window as unknown as { elementorFrontend?: unknown }).elementorFrontend;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const { target, type, listener } of registered.splice(0)) target.removeEventListener(type, listener);
  vi.useRealTimers();
  document.body.replaceChildren();
  delete (window as unknown as { elementorFrontend?: unknown }).elementorFrontend;
  delete (document as unknown as { readyState?: string }).readyState;
});

describe('exports', () => {
  it('exports exactly mountAll, mountWithin and version', async () => {
    const main = await loadMain();
    expect(Object.keys(main).sort()).toEqual(['mountAll', 'mountWithin', 'version']);
    expect(main.version).toMatch(/^\d+\.\d+\.\d+/);
    expect((window as unknown as { WGLive?: unknown }).WGLive).toBeUndefined();
  });
});

describe('mounting', () => {
  it('mounts at import time when the DOM is already parsed, dispatching by data-wg-live-view', async () => {
    document.body.append(makeRoot('events'), makeRoot('help'));
    await loadMain();
    expect(calls.events).toHaveLength(1);
    expect(calls.help).toHaveLength(1);
    expect(calls.player).toHaveLength(0);
  });

  it('replaces the skeleton, clears aria-busy and marks the root mounted', async () => {
    const root = makeRoot('events');
    document.body.append(root);
    await loadMain();
    const mount = root.querySelector('.wg-live__mount') as HTMLElement;
    expect(mount.getAttribute('aria-busy')).toBe('false');
    expect(root.dataset.wgLiveMounted).toBe('1');
    expect(mount.querySelector('.wg-live__skeleton')).toBeNull();
    expect(mount.textContent).toBe('mounted:events');
  });

  it('hands the view a validated BootConfig and a ViewContext', async () => {
    const root = makeRoot('help');
    document.body.append(root);
    await loadMain();
    const probe = calls.help[0] as Probe;
    expect(probe.boot.view).toBe('help');
    expect(probe.boot.rest.root).toBe('/wp-json/wg-live/v1/');
    expect(probe.ctx.root).toBe(root);
    expect(typeof probe.ctx.announce).toBe('function');
    expect(typeof probe.ctx.env.volumeSettable).toBe('boolean');
  });

  it('waits for DOMContentLoaded while the document is still loading', async () => {
    document.body.append(makeRoot('events'));
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    await loadMain();
    expect(calls.events).toHaveLength(0);
    delete (document as unknown as { readyState?: string }).readyState;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(calls.events).toHaveLength(1);
  });

  it('players wait for the volume probe and get its result in env', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => undefined);
    document.body.append(makeRoot('player'), makeRoot('events'));
    await loadMain();
    expect(calls.events).toHaveLength(1); // other views mount immediately
    expect(calls.player).toHaveLength(0); // the player is still waiting for the probe
    await vi.advanceTimersByTimeAsync(5);
    expect(calls.player).toHaveLength(1);
    expect(calls.player[0]?.ctx.env.volumeSettable).toBe(false);
  });

  it('shows 「Live 介面暫時無法載入」 when the config is unreadable, and does not call the view', async () => {
    const root = makeRoot('events', { config: false });
    document.body.append(root);
    await loadMain();
    const mount = root.querySelector('.wg-live__mount') as HTMLElement;
    expect(calls.events).toHaveLength(0);
    expect(mount.textContent).toContain('Live 介面暫時無法載入');
    expect(mount.getAttribute('aria-busy')).toBe('false');
    expect(mount.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('shows the same readable error when a view throws, without leaking the error text', async () => {
    throwOnMount = true;
    const root = makeRoot('events');
    document.body.append(root);
    await loadMain();
    const mount = root.querySelector('.wg-live__mount') as HTMLElement;
    expect(mount.textContent).toContain('Live 介面暫時無法載入');
    expect(mount.textContent).not.toContain('secret.example');
    expect(mount.getAttribute('aria-busy')).toBe('false');
  });
});

describe('registry', () => {
  it('is idempotent: repeated mountAll / mountWithin never mount a root twice', async () => {
    const root = makeRoot('events');
    document.body.append(root);
    const main = await loadMain();
    main.mountAll();
    main.mountAll();
    main.mountWithin(document);
    main.mountWithin(root);
    main.mountWithin(root.parentElement);
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]?.instance.destroy).not.toHaveBeenCalled();
  });

  it('mountWithin mounts a root added later, including the scope element itself', async () => {
    const main = await loadMain();
    const wrapper = document.createElement('div');
    const root = makeRoot('help');
    wrapper.append(root);
    document.body.append(wrapper);
    main.mountWithin(wrapper);
    expect(calls.help).toHaveLength(1);
    const alone = makeRoot('events');
    document.body.append(alone);
    main.mountWithin(alone);
    expect(calls.events).toHaveLength(1);
    main.mountWithin(null);
  });

  it('sweeps detached roots: destroys their instances on the next mountAll / mountWithin', async () => {
    const first = makeRoot('events');
    document.body.append(first);
    const main = await loadMain();
    const instance = calls.events[0]?.instance;
    first.remove(); // Elementor re-render replaced the widget
    expect(instance?.destroy).not.toHaveBeenCalled();
    const second = makeRoot('events');
    document.body.append(second);
    main.mountAll();
    expect(instance?.destroy).toHaveBeenCalledTimes(1);
    expect(calls.events).toHaveLength(2);
    main.mountAll();
    expect(instance?.destroy).toHaveBeenCalledTimes(1); // destroyed once only
    second.remove();
    main.mountWithin(document);
    expect(calls.events[1]?.instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('a root that is removed while its player still waits for the probe is never mounted', async () => {
    const root = makeRoot('player');
    document.body.append(root);
    await loadMain();
    root.remove();
    await vi.advanceTimersByTimeAsync(5);
    expect(calls.player).toHaveLength(0);
  });

  it('does not take over a root another copy of the bundle already mounted', async () => {
    const root = makeRoot('events');
    root.dataset.wgLiveMounted = '1';
    document.body.append(root);
    await loadMain();
    expect(calls.events).toHaveLength(0);
  });
});

describe('double bundle and detached players (PS-8, PS-9)', () => {
  it('PS-9: two copies of the bundle mount a player root exactly once, although the probe is async', async () => {
    const root = makeRoot('player');
    document.body.append(root);
    await loadMain(); // copy 1: the probe is pending
    expect(root.dataset.wgLiveMounted).toBe('pending');
    await loadMain(); // copy 2 runs mountAll() before copy 1's probe settled
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.player).toHaveLength(1);
    expect(root.dataset.wgLiveMounted).toBe('1');
  });

  it('PS-9: a pending root is released when it leaves the document before the probe settles', async () => {
    const root = makeRoot('player');
    document.body.append(root);
    await loadMain();
    root.remove();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.player).toHaveLength(0);
    expect(root.hasAttribute('data-wg-live-mounted')).toBe(false);
  });

  it('PS-8: a detached-root announcement from a poller destroys the instance without any mount call', async () => {
    const root = makeRoot('events');
    document.body.append(root);
    await loadMain();
    const instance = calls.events[0]?.instance;
    root.remove();
    expect(instance?.destroy).not.toHaveBeenCalled();
    document.dispatchEvent(new CustomEvent('wg-live:detached'));
    expect(instance?.destroy).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new CustomEvent('wg-live:detached'));
    expect(instance?.destroy).toHaveBeenCalledTimes(1);
  });

  it('PS-8: attached roots survive the announcement', async () => {
    const root = makeRoot('events');
    document.body.append(root);
    await loadMain();
    document.dispatchEvent(new CustomEvent('wg-live:detached'));
    expect(calls.events[0]?.instance.destroy).not.toHaveBeenCalled();
  });
});

describe('page lifecycle', () => {
  it('pagehide calls stop() on every mounted view', async () => {
    document.body.append(makeRoot('player'), makeRoot('events'));
    await loadMain();
    await vi.advanceTimersByTimeAsync(5);
    window.dispatchEvent(new Event('pagehide'));
    expect(calls.player[0]?.instance.stop).toHaveBeenCalledTimes(1);
    expect(calls.events[0]?.instance.stop).toHaveBeenCalledTimes(1);
  });

  it('pageshow refreshes only when restored from the bfcache', async () => {
    document.body.append(makeRoot('events'));
    await loadMain();
    const plain = new Event('pageshow');
    Object.defineProperty(plain, 'persisted', { value: false });
    window.dispatchEvent(plain);
    expect(calls.events[0]?.instance.refresh).not.toHaveBeenCalled();
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    expect(calls.events[0]?.instance.refresh).toHaveBeenCalledTimes(1);
  });

  it('never registers unload or beforeunload listeners', async () => {
    registered.length = 0;
    await loadMain();
    const types = registered.map((r) => r.type);
    expect(types).not.toContain('unload');
    expect(types).not.toContain('beforeunload');
    expect(types).toContain('pagehide');
    expect(types).toContain('pageshow');
  });
});

describe('Elementor wiring', () => {
  interface Hooks {
    addAction: ReturnType<typeof vi.fn>;
  }

  it('mounts normally when elementorFrontend exists but has no hooks yet, and wires on elementor/frontend/init', async () => {
    (window as unknown as { elementorFrontend: unknown }).elementorFrontend = {};
    document.body.append(makeRoot('events'));
    const main = await loadMain();
    expect(calls.events).toHaveLength(1);

    const hooks: Hooks = { addAction: vi.fn() };
    (window as unknown as { elementorFrontend: { hooks: Hooks } }).elementorFrontend.hooks = hooks;
    expect(hooks.addAction).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('elementor/frontend/init'));
    expect(hooks.addAction.mock.calls.map(([name]) => name)).toEqual([
      'frontend/element_ready/shortcode.default',
      'frontend/element_ready/global',
    ]);

    // A second init event must not register twice.
    window.dispatchEvent(new Event('elementor/frontend/init'));
    expect(hooks.addAction).toHaveBeenCalledTimes(2);

    // The registered handler mounts roots inside the widget scope (jQuery-like collection).
    const widget = document.createElement('div');
    widget.append(makeRoot('help'));
    document.body.append(widget);
    const handler = hooks.addAction.mock.calls[0]?.[1] as (scope: unknown) => void;
    handler({ 0: widget });
    expect(calls.help).toHaveLength(1);
    handler(widget); // plain element scope works too
    handler(null); // junk scope is ignored
    expect(calls.help).toHaveLength(1);
    expect(main.version).toBeTruthy();
  });

  it('wires immediately when the hooks already exist', async () => {
    const hooks: Hooks = { addAction: vi.fn() };
    (window as unknown as { elementorFrontend: { hooks: Hooks } }).elementorFrontend = { hooks };
    await loadMain();
    expect(hooks.addAction).toHaveBeenCalledTimes(2);
  });

  it('survives hooks that throw, and does not block mounting', async () => {
    const hooks = {
      addAction: vi.fn(() => {
        throw new Error('elementor broke');
      }),
    };
    (window as unknown as { elementorFrontend: { hooks: typeof hooks } }).elementorFrontend = { hooks };
    document.body.append(makeRoot('events'));
    await expect(loadMain()).resolves.toBeDefined();
    expect(calls.events).toHaveLength(1);
  });

  it('mounts widget DOM built by another realm (the Elementor editor builds it in the parent window)', async () => {
    const hooks: Hooks = { addAction: vi.fn() };
    (window as unknown as { elementorFrontend: { hooks: Hooks } }).elementorFrontend = { hooks };
    await loadMain();
    const handler = hooks.addAction.mock.calls[0]?.[1] as (scope: unknown) => void;

    const foreign = foreignElement(`<div class="elementor-widget-shortcode">${makeRoot('help').outerHTML}</div>`);
    expect(foreign instanceof Element).toBe(false);
    document.body.append(foreign);

    handler({ 0: foreign }); // the jQuery collection Elementor passes
    expect(calls.help).toHaveLength(1);
  });

  it('mountWithin accepts a foreign-realm root as the scope itself', async () => {
    const main = await loadMain();
    const foreignRoot = foreignElement(makeRoot('events').outerHTML);
    expect(foreignRoot instanceof Element).toBe(false);
    document.body.append(foreignRoot);
    main.mountWithin(foreignRoot);
    expect(calls.events).toHaveLength(1);
    main.mountWithin(foreignRoot); // idempotent
    expect(calls.events).toHaveLength(1);
  });

  it('re-registers on a new hooks object (Elementor init() creates a fresh EventManager) but not on the same one', async () => {
    const first: Hooks = { addAction: vi.fn() };
    (window as unknown as { elementorFrontend: { hooks: Hooks } }).elementorFrontend = { hooks: first };
    await loadMain();
    expect(first.addAction).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('elementor/frontend/init'));
    expect(first.addAction).toHaveBeenCalledTimes(2);

    const second: Hooks = { addAction: vi.fn() };
    (window as unknown as { elementorFrontend: { hooks: Hooks } }).elementorFrontend.hooks = second;
    window.dispatchEvent(new Event('elementor/frontend/init'));
    expect(second.addAction).toHaveBeenCalledTimes(2);
  });

  it('a handler that throws inside mountWithin does not propagate to Elementor', async () => {
    const hooks: Hooks = { addAction: vi.fn() };
    (window as unknown as { elementorFrontend: { hooks: Hooks } }).elementorFrontend = { hooks };
    await loadMain();
    const handler = hooks.addAction.mock.calls[0]?.[1] as (scope: unknown) => void;
    const bad = { 0: { get nodeType(): number { throw new Error('x'); } } };
    expect(() => handler(bad)).not.toThrow();
  });
});

describe('announce()', () => {
  async function setup(opts: { statusRegion?: boolean } = {}): Promise<{ root: HTMLElement; region: () => HTMLElement | null; ctx: ViewContext }> {
    const root = makeRoot('events', opts);
    document.body.append(root);
    await loadMain();
    const ctx = (calls.events[0] as Probe).ctx;
    return { root, region: () => root.querySelector<HTMLElement>('.wg-live__sr-status'), ctx };
  }

  it('writes to the existing region only after the 750 ms coalescing window', async () => {
    const { region, ctx } = await setup();
    ctx.announce('正在連接音訊');
    expect(region()?.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(749);
    expect(region()?.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(region()?.textContent).toBe('正在連接音訊');
  });

  it('coalesces bursts: the latest message in the window wins, one write per window', async () => {
    const { region, ctx } = await setup();
    const regionEl = region() as HTMLElement;
    const writes: string[] = [];
    new MutationObserver(() => writes.push(regionEl.textContent ?? '')).observe(regionEl, { childList: true, characterData: true, subtree: true });
    ctx.announce('a');
    await vi.advanceTimersByTimeAsync(300);
    ctx.announce('b');
    await vi.advanceTimersByTimeAsync(300);
    ctx.announce('c');
    await vi.advanceTimersByTimeAsync(150);
    expect(regionEl.textContent).toBe('c');
    await Promise.resolve();
    expect(writes).toEqual(['c']);
  });

  it('drops identical consecutive messages but allows the same text again after a different one', async () => {
    const { region, ctx } = await setup();
    const regionEl = region() as HTMLElement;
    ctx.announce('已暫停');
    await vi.advanceTimersByTimeAsync(750);
    expect(regionEl.textContent).toBe('已暫停');
    regionEl.textContent = ''; // simulate the screen reader having consumed it
    ctx.announce('已暫停');
    await vi.advanceTimersByTimeAsync(750);
    expect(regionEl.textContent).toBe(''); // deduped
    ctx.announce('播放中');
    await vi.advanceTimersByTimeAsync(750);
    expect(regionEl.textContent).toBe('播放中');
    ctx.announce('已暫停');
    await vi.advanceTimersByTimeAsync(750);
    expect(regionEl.textContent).toBe('已暫停');
  });

  it('immediate writes at once and cancels the pending message', async () => {
    const { region, ctx } = await setup();
    ctx.announce('queued');
    ctx.announce('請點擊開始聆聽', { immediate: true });
    expect(region()?.textContent).toBe('請點擊開始聆聽');
    await vi.advanceTimersByTimeAsync(2000);
    expect(region()?.textContent).toBe('請點擊開始聆聽');
  });

  it('UI-04: an urgent repeat that discards a queued message is announced again, a plain repeat is not', async () => {
    const { region, ctx } = await setup();
    const regionEl = region() as HTMLElement;
    let writes = 0;
    new MutationObserver(() => (writes += 1)).observe(regionEl, { childList: true, characterData: true, subtree: true });
    ctx.announce('播放失敗', { immediate: true });
    await Promise.resolve();
    expect(writes).toBe(1);
    // 重試: 「正在連接音訊」 is queued, the same failure arrives before the window closes.
    ctx.announce('正在連接音訊');
    ctx.announce('播放失敗', { immediate: true });
    await Promise.resolve();
    expect(writes).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(regionEl.textContent).toBe('播放失敗');
    expect(writes).toBe(2); // the discarded loading message never shows up
    // Nothing was queued in between: still deduped.
    ctx.announce('播放失敗', { immediate: true });
    await Promise.resolve();
    expect(writes).toBe(2);
  });

  it('ignores empty messages', async () => {
    const { region, ctx } = await setup();
    ctx.announce('');
    ctx.announce('', { immediate: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(region()?.textContent).toBe('');
  });

  it('creates an empty live region when the container has none', async () => {
    const { root, region, ctx } = await setup({ statusRegion: false });
    expect(region()).toBeNull();
    ctx.announce('x', { immediate: true });
    const created = region() as HTMLElement;
    expect(created.getAttribute('role')).toBe('status');
    expect(created.getAttribute('aria-atomic')).toBe('true');
    expect(created.textContent).toBe('x');
    expect(root.querySelectorAll('.wg-live__sr-status')).toHaveLength(1);
    expect(created.closest('.wg-live__mount')).toBeNull(); // outside the aria-busy subtree
  });

  it('stops pending announcements after the root is destroyed', async () => {
    const { root, region, ctx } = await setup();
    const main = await import('../../../src/main');
    ctx.announce('late');
    root.remove();
    main.mountAll(); // sweeps the detached root
    const regionEl = region() as HTMLElement;
    await vi.advanceTimersByTimeAsync(2000);
    expect(regionEl.textContent).toBe('');
  });
});
