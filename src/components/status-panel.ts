/**
 * Status panel (spec 6, plan 6.2 / 6.5 / 6.6 / 6.7).
 *
 * Shows the visible status heading (tabindex="-1": the focus fallback when the switch trigger is
 * gone), the detail line, the demo-media disclaimer, error recovery actions and the generic public
 * error code. All text comes from the state selectors; the DOM is built once and updated in place.
 *
 * The「已選擇／目前播放」mode label is a separate small component (createModeLabel) because the
 * mobile order (spec 5.3) puts the current mode under the transport controls.
 */
import { h, safeUrl } from '../dom';
import { statusCopy } from '../i18n/copy';
import { formatEventDateTime } from '../util/time';
import { selectErrorActions, selectGate, selectModeLabel, selectStatusMessage } from '../state/model';
import type { AppState, ListeningMode, PlayerController, PublicEvent, SiteLinks } from '../types';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4';

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** A real link, or null when the URL is missing or unsafe (nothing is rendered then). */
function linkOr(
  href: string | null,
  text: string,
  className = 'wg-live__btn wg-live__btn--ghost',
): HTMLAnchorElement | null {
  const safe = safeUrl(href);
  if (safe === null) return null;
  return h('a', { className, href: safe, text, hidden: true });
}

/* ------------------------------------------------------------------ */
/* Mode label                                                          */
/* ------------------------------------------------------------------ */

export interface ModeLabel {
  el: HTMLElement;
  update(state: AppState): void;
}

/** 已選擇：… before playback is confirmed, 目前播放：… afterwards (plan 6.10). Never claims device output. */
export function createModeLabel(): ModeLabel {
  const text = h('p', { className: 'wg-live__mode-label', hidden: true });
  const note = h('p', { className: 'wg-live__mode-note wg-live__small wg-live__muted', text: statusCopy.modeLabelNote, hidden: true });
  const el = h('div', { className: 'wg-live__mode-info' }, text, note);
  return {
    el,
    update(state): void {
      const label = selectModeLabel(state);
      text.hidden = label === null;
      note.hidden = label === null;
      setText(text, label ?? '');
    },
  };
}

/* ------------------------------------------------------------------ */
/* Status panel                                                        */
/* ------------------------------------------------------------------ */

export interface StatusPanelOptions {
  controller: PlayerController;
  headingTag: HeadingTag;
  links: SiteLinks;
  event: PublicEvent;
  /** The「切換模式」action: the view opens the dialog and remembers `trigger` for focus return. */
  onSwitchMode(trigger: HTMLElement): void;
  /** The「查看活動資訊」action: the view moves focus to the info section. */
  onViewEvent(): void;
}

export interface StatusPanel {
  el: HTMLElement;
  /** `tabindex="-1"` heading; the focus fallback (plan 6.6). */
  heading: HTMLElement;
  update(state: AppState): void;
  destroy(): void;
}

type ActionId = 'retry' | 'reload_last_good' | 'fallback_binaural' | 'switch_mode' | 'view_event' | 'back_to_events';

export function createStatusPanel(options: StatusPanelOptions): StatusPanel {
  const { controller, links, event } = options;
  const disposers: Array<() => void> = [];
  const listen = (target: HTMLElement, handler: () => void): void => {
    target.addEventListener('click', handler);
    disposers.push(() => target.removeEventListener('click', handler));
  };
  const button = (className: string, label: string): HTMLButtonElement =>
    h('button', { className: `wg-live__btn ${className}`, type: 'button', text: label, hidden: true });

  const heading = h(options.headingTag, {
    className: 'wg-live__status-title wg-live__heading wg-live__heading--h3',
    tabindex: -1,
  });
  const detail = h('p', { className: 'wg-live__status-detail', hidden: true });
  const demoNotice = h('p', {
    className: 'wg-live__demo-notice',
    text: statusCopy.demo.mediaNotice,
    hidden: true,
  });
  const code = h('p', { className: 'wg-live__error-code wg-live__small wg-live__muted', hidden: true });

  const retry = button('wg-live__btn--secondary', statusCopy.action.retry);
  const reload = button('wg-live__btn--secondary', '');
  const fallback = button('wg-live__btn--secondary', statusCopy.action.fallbackBinaural);
  const switchMode = button('wg-live__btn--secondary', statusCopy.action.switchMode);
  const viewEvent = button('wg-live__btn--ghost', statusCopy.action.viewEvent);
  const backToEvents = linkOr(links.events, statusCopy.action.backToEvents);
  const contact = linkOr(links.contact, statusCopy.action.contact);
  const help = linkOr(links.help, statusCopy.action.help);
  const home = linkOr(links.home, statusCopy.action.backHome);

  const actions = h(
    'div',
    { className: 'wg-live__actions wg-live__actions--stack wg-live__status-actions', hidden: true },
    retry,
    reload,
    fallback,
    switchMode,
    viewEvent,
    backToEvents,
    contact,
    help,
    home,
  );

  const el = h(
    'section',
    { className: 'wg-live__status', dataset: { tone: 'neutral' } },
    heading,
    detail,
    demoNotice,
    actions,
    code,
  );

  listen(retry, () => controller.retry().catch(() => undefined));
  listen(reload, () => controller.reloadLastGood().catch(() => undefined));
  // The fallback click is the user gesture; its descriptor was prefetched when the button appeared.
  listen(fallback, () => controller.switchMode('binaural').catch(() => undefined));
  listen(switchMode, () => {
    if (switchMode.getAttribute('aria-disabled') === 'true') return;
    options.onSwitchMode(switchMode);
  });
  listen(viewEvent, () => options.onViewEvent());

  let prefetchKey = '';

  function prefetch(mode: ListeningMode, key: string): void {
    if (prefetchKey === key) return;
    prefetchKey = key;
    // Not inside the subscriber call stack: the controller may notify synchronously.
    queueMicrotask(() => controller.prepareSwitch(mode));
  }

  function update(state: AppState): void {
    const message = selectStatusMessage(state);
    const gate = selectGate(state);
    setText(heading, message.title);
    el.dataset.tone = message.tone;

    let detailText = message.detail;
    if (detailText === null && gate.kind === 'scheduled') {
      const when = formatEventDateTime(event.startsAt, event.displayTimezone);
      if (when.machine !== '') detailText = statusCopy.startsAt(when.full);
    }
    detail.hidden = detailText === null || detailText === '';
    setText(detail, detailText ?? '');

    demoNotice.hidden = !(state.isDemoMedia || state.source === 'demo');

    const error = state.player.error;
    code.hidden = error === null;
    setText(code, error ? `${statusCopy.errorCodeLabel}：${error.publicCode}` : '');

    const wanted = new Set<ActionId>(selectErrorActions(state));
    // A failed state always offers a way out, but resuming needs the same conditions as Start (D6): a denied
    // or unknown entitlement never gets a retry that would start sound (PS-6).
    if (state.player.status === 'failed' && wanted.size === 0 && state.entitlement === 'entitled') wanted.add('retry');

    const lastGood = state.player.lastGoodMode;
    retry.hidden = !wanted.has('retry');
    reload.hidden = !wanted.has('reload_last_good') || lastGood === null;
    if (lastGood !== null) setText(reload, statusCopy.action.reloadLastGood(statusCopy.modeName[lastGood]));
    fallback.hidden = !wanted.has('fallback_binaural');
    viewEvent.hidden = !wanted.has('view_event');

    const switching = state.player.status === 'switching' || state.player.status === 'loading';
    switchMode.hidden = !wanted.has('switch_mode');
    if (switching) switchMode.setAttribute('aria-disabled', 'true');
    else switchMode.removeAttribute('aria-disabled');

    // Gate links (plan 6.2): ended -> events, cancelled -> contact, scheduled -> help.
    const showEvents = wanted.has('back_to_events') || gate.kind === 'ended';
    if (backToEvents) backToEvents.hidden = !showEvents;
    if (contact) contact.hidden = gate.kind !== 'cancelled' && gate.kind !== 'disabled';
    if (help) help.hidden = gate.kind !== 'scheduled';
    if (home) home.hidden = gate.kind !== 'disabled';

    actions.hidden = Array.from(actions.children).every((child) => (child as HTMLElement).hidden);

    if (!fallback.hidden && state.player.error) {
      prefetch('binaural', `fb:${state.player.error.publicCode}:${state.player.error.mode ?? ''}`);
    } else if (!reload.hidden && lastGood !== null) {
      prefetch(lastGood, `rl:${lastGood}:${error?.publicCode ?? ''}`);
    } else if (fallback.hidden && reload.hidden) {
      prefetchKey = '';
    }
  }

  return {
    el,
    heading,
    update,
    destroy(): void {
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* States without a controller                                         */
/* ------------------------------------------------------------------ */

export interface UnavailablePanel {
  el: HTMLElement;
  heading: HTMLElement;
}

/**
 * Deployment mode `disabled` (plan D16) and event-not-found (plan 6.2 gate 1). No controller, no
 * requests: just the message and the way out (home + contact, or back to the list).
 */
export function createUnavailablePanel(
  kind: 'disabled' | 'not_found',
  links: SiteLinks,
  headingTag: HeadingTag,
): UnavailablePanel {
  const copy = kind === 'disabled' ? statusCopy.gate.disabled : statusCopy.gate.eventNotFound;
  const heading = h(headingTag, {
    className: 'wg-live__status-title wg-live__heading wg-live__heading--h3',
    tabindex: -1,
    text: copy.title,
  });
  const linkEls: Array<HTMLAnchorElement | null> =
    kind === 'disabled'
      ? [linkOr(links.home, statusCopy.action.backHome), linkOr(links.contact, statusCopy.action.contact)]
      : [linkOr(links.events, statusCopy.action.backToEvents), linkOr(links.help, statusCopy.action.help)];
  for (const link of linkEls) if (link) link.hidden = false;
  const visible = linkEls.filter((l): l is HTMLAnchorElement => l !== null);

  const el = h(
    'section',
    { className: 'wg-live__status wg-live__status--unavailable', dataset: { tone: 'neutral', gate: kind } },
    heading,
    h('p', { className: 'wg-live__status-detail', text: copy.detail }),
    visible.length > 0 ? h('div', { className: 'wg-live__actions wg-live__actions--stack wg-live__status-actions' }, ...visible) : null,
  );
  return { el, heading };
}
