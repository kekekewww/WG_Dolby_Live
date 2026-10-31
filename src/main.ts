/**
 * Entry point of the wg-live bundle (IIFE `WGLive`, plan D3/D19).
 *
 * Public API: { mountAll, mountWithin, version }. Vite's `lib.name` creates the global;
 * nothing is assigned to `window` by hand.
 *
 * Boot rules (plan 3.2): mount when the DOM is ready (also when loaded late with `defer`
 * or a delay-JS optimizer), wire Elementor's frontend hooks when they exist (and again on
 * `elementor/frontend/init`), keep a registry so remounting is idempotent and detached
 * roots are destroyed, stop media on `pagehide`, refresh data on a bfcache `pageshow`.
 */
import './styles/index';
import { version as packageVersion } from '../package.json';
import { readBootConfig } from './boot';
import { h } from './dom';
import { statusCopy } from './i18n/copy-status';
import { DETACHED_EVENT } from './state/event-poller';
import { probeVolumeControl, volumeProbeResult } from './util/capabilities';
import type { BootConfig, LiveView } from './types';
import type { ViewContext, ViewInstance } from './views/types';
import { mountEventsView } from './views/events';
import { mountHelpView } from './views/help';
import { mountPlayerView } from './views/player';

export const version: string = packageVersion;

const ROOT_SELECTOR = '.wg-live[data-wg-live-view]';
const ANNOUNCE_WINDOW_MS = 750;

type ViewMounter = (mount: HTMLElement, boot: BootConfig, ctx: ViewContext) => ViewInstance;

const VIEW_MOUNTERS: Record<LiveView, ViewMounter> = {
  events: mountEventsView,
  player: mountPlayerView,
  help: mountHelpView,
};

/* ------------------------------------------------------------------ */
/* Live-region announcer (plan 6.10)                                   */
/* ------------------------------------------------------------------ */

interface Announcer {
  announce(message: string, opts?: { immediate?: boolean }): void;
  dispose(): void;
}

function findOrCreateStatusRegion(root: HTMLElement): HTMLElement {
  const existing = Array.from(root.querySelectorAll<HTMLElement>('.wg-live__sr-status')).find(
    (el) => el.closest('.wg-live') === root,
  );
  if (existing) return existing;
  const region = h('div', { className: 'wg-live__sr-status', attrs: { role: 'status', 'aria-atomic': 'true' } });
  root.prepend(region);
  return region;
}

function createAnnouncer(root: HTMLElement): Announcer {
  let timer: number | null = null;
  let pending: string | null = null;
  let lastWritten: string | null = null;

  const write = (message: string): void => {
    // Identical consecutive messages are not repeated.
    if (message === lastWritten) return;
    lastWritten = message;
    findOrCreateStatusRegion(root).textContent = message;
  };

  const flush = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      const message = pending;
      pending = null;
      write(message);
    }
  };

  return {
    announce(message, opts) {
      if (typeof message !== 'string' || message === '') return;
      if (opts?.immediate) {
        // An urgent message that discards a different queued one (retry: 「正在連接音訊」 swallowed by the
        // same failure again) is a new event for the listener: do not dedupe it against what was written
        // before the discarded message (UI-04).
        if (pending !== null && pending !== message) lastWritten = null;
        pending = null;
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        write(message);
        return;
      }
      // Coalesce: the window opens at the first message, the latest message wins.
      pending = message;
      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          flush();
        }, ANNOUNCE_WINDOW_MS);
      }
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Registry (plan 3.2)                                                 */
/* ------------------------------------------------------------------ */

interface Entry {
  root: HTMLElement;
  view: LiveView;
  instance: ViewInstance | null;
  announcer: Announcer;
  destroyed: boolean;
}

const entries = new WeakMap<Element, Entry>();
const active = new Set<Entry>();

function destroyEntry(entry: Entry): void {
  if (entry.destroyed) return;
  entry.destroyed = true;
  active.delete(entry);
  entries.delete(entry.root);
  entry.announcer.dispose();
  try {
    entry.instance?.destroy();
  } catch {
    // A failing destroy must not block the others.
  }
  entry.instance = null;
  entry.root.removeAttribute('data-wg-live-mounted');
}

/** Destroy every instance whose root left the document (Elementor re-render, SPA-style swaps). */
function sweepDetached(): void {
  for (const entry of Array.from(active)) {
    if (!entry.root.isConnected) destroyEntry(entry);
  }
}

function showBootError(root: HTMLElement, mount: HTMLElement): void {
  mount.replaceChildren(
    h(
      'div',
      { className: 'wg-live__boot-error', attrs: { role: 'alert' } },
      h('p', { className: 'wg-live__boot-error-title', text: statusCopy.bootError }),
      h('p', { className: 'wg-live__boot-error-hint', text: statusCopy.bootErrorHint }),
    ),
  );
  mount.setAttribute('aria-busy', 'false');
  root.setAttribute('data-wg-live-mounted', '1');
}

function asView(value: string | undefined): LiveView | null {
  return value === 'events' || value === 'player' || value === 'help' ? value : null;
}

function findMount(root: HTMLElement): HTMLElement {
  const existing = Array.from(root.querySelectorAll<HTMLElement>('.wg-live__mount')).find(
    (el) => el.closest('.wg-live') === root,
  );
  if (existing) return existing;
  const created = h('div', { className: 'wg-live__mount' });
  root.append(created);
  return created;
}

function finishMount(entry: Entry, boot: BootConfig, env: ViewContext['env']): void {
  if (entry.destroyed || !entry.root.isConnected) {
    destroyEntry(entry);
    return;
  }
  const mount = findMount(entry.root);
  const ctx: ViewContext = {
    root: entry.root,
    announce: (message, opts) => entry.announcer.announce(message, opts),
    env,
  };
  try {
    mount.replaceChildren(); // drop the skeleton right before the view renders
    entry.instance = VIEW_MOUNTERS[entry.view](mount, boot, ctx);
    mount.setAttribute('aria-busy', 'false');
    entry.root.setAttribute('data-wg-live-mounted', '1');
  } catch {
    // Nothing about the failure (messages may contain URLs) is logged.
    entry.instance = null;
    showBootError(entry.root, mount);
  }
}

function mountRoot(root: HTMLElement): void {
  if (entries.has(root)) return; // idempotent
  // A second copy of the bundle (double enqueue, optimizer quirks) must not mount over the first.
  // Any value counts, including the 'pending' marker set below: player roots finish mounting only after
  // the async volume probe, and both copies run mountAll() before either probe settles.
  if (root.hasAttribute('data-wg-live-mounted')) return;
  const view = asView(root.dataset.wgLiveView);
  if (!view) return;
  root.setAttribute('data-wg-live-mounted', 'pending');

  const entry: Entry = { root, view, instance: null, announcer: createAnnouncer(root), destroyed: false };
  entries.set(root, entry);
  active.add(entry);

  const mount = findMount(root);
  const boot = readBootConfig(root);
  if (!boot) {
    showBootError(root, mount);
    return;
  }

  if (view === 'player') {
    // Players wait for the (fast) volume probe so capabilities are right on first render.
    void probeVolumeControl().then((volumeSettable) => finishMount(entry, boot, { volumeSettable, hlsScriptUrl: boot.assets.hls }));
  } else {
    finishMount(entry, boot, { volumeSettable: volumeProbeResult() ?? false, hlsScriptUrl: boot.assets.hls });
  }
}

/** Mount every `.wg-live[data-wg-live-view]` in the document. Safe to call repeatedly. */
export function mountAll(): void {
  sweepDetached();
  document.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(mountRoot);
}

/**
 * Is this value a DOM element? Deliberately not `instanceof Element`: in the Elementor editor the
 * widget DOM is built by the editor (the parent window) and then lives in the preview frame, so its
 * prototype chain belongs to another realm and `instanceof Element` is false for a real element.
 */
function isElementNode(value: unknown): value is Element {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Partial<Element>;
  return node.nodeType === 1 && typeof node.matches === 'function' && typeof node.querySelectorAll === 'function';
}

/** Mount roots inside (or equal to) `scope`; used for Elementor widget renders. */
export function mountWithin(scope: ParentNode | Element | null | undefined): void {
  sweepDetached();
  if (!scope) return;
  if (isElementNode(scope) && scope.matches(ROOT_SELECTOR)) mountRoot(scope as HTMLElement);
  scope.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(mountRoot);
}

/* ------------------------------------------------------------------ */
/* Elementor wiring (plan 3.2)                                         */
/* ------------------------------------------------------------------ */

interface ElementorHooks {
  addAction(name: string, handler: (scope: unknown) => void): void;
}

/** The hooks object our actions were registered on. Elementor's init() creates a new one, so compare identity. */
let wiredHooks: ElementorHooks | null = null;

function scopeElement(scope: unknown): ParentNode | null {
  if (scope && typeof scope === 'object') {
    const first = (scope as { 0?: unknown })[0]; // jQuery collection
    if (isElementNode(first)) return first;
    if (isElementNode(scope)) return scope;
  }
  return null;
}

function wire(): void {
  try {
    const frontend = (window as unknown as { elementorFrontend?: { hooks?: ElementorHooks } }).elementorFrontend;
    const hooks = frontend?.hooks;
    if (!hooks || typeof hooks.addAction !== 'function') return;
    if (wiredHooks === hooks) return;
    const onReady = (scope: unknown): void => {
      try {
        mountWithin(scopeElement(scope));
      } catch {
        // Never let a widget render break Elementor.
      }
    };
    hooks.addAction('frontend/element_ready/shortcode.default', onReady);
    hooks.addAction('frontend/element_ready/global', onReady);
    wiredHooks = hooks;
  } catch {
    // Elementor wiring must never block mounting.
  }
}

function wireElementorLate(): void {
  window.addEventListener('elementor/frontend/init', wire);
  try {
    // Elementor triggers this event through jQuery, which native listeners don't see.
    const jq = (window as unknown as { jQuery?: (target: Window) => { on(type: string, fn: () => void): unknown } })
      .jQuery;
    if (typeof jq === 'function') jq(window).on('elementor/frontend/init', wire);
  } catch {
    // jQuery is optional.
  }
  wire();
}

/* ------------------------------------------------------------------ */
/* Page lifecycle                                                      */
/* ------------------------------------------------------------------ */

window.addEventListener('pagehide', () => {
  for (const entry of Array.from(active)) {
    try {
      entry.instance?.stop?.();
    } catch {
      // keep stopping the others
    }
  }
});

window.addEventListener('pageshow', (event) => {
  if (!(event as PageTransitionEvent).persisted) return;
  for (const entry of Array.from(active)) {
    try {
      entry.instance?.refresh?.();
    } catch {
      // keep refreshing the others
    }
  }
});

// A poller that finds its root detached asks for a sweep, so players no timer watches (paused, failed,
// selecting) are still destroyed when their widget is removed without a later mount call (PS-8).
document.addEventListener(DETACHED_EVENT, sweepDetached);

wireElementorLate();

if (document.readyState !== 'loading') {
  mountAll();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    mountAll();
  });
}
