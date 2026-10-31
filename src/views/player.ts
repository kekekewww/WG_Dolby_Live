/**
 * Player view (`/live/listen/`, spec 5.3, plan 6.2 - 6.10).
 *
 * Resolves the event (shortcode `event` attribute wins over `?wg_event=`), builds the
 * coordinator with its providers and renders the whole page ONCE. After that every state change
 * only updates the existing nodes in place (plan 6.6): the media element, the focused control and
 * the open dialog keep their identity. Disabled mode and an unknown event render a message and the
 * way out, without creating a controller or sending a request.
 *
 * DOM order = spec 5.3 mobile order: title + status, stage, main controls, current mode, switch,
 * programme / info, help link. The title area lives INSIDE `.wg-live__player` (HYBRID, A porting note 1)
 * so that from 768px CSS `order` can put the stage first, then the one control bar (once playback is
 * engaged), then the title and status; below 768px the DOM order is also the visual order.
 */
import { createStageArt, createPlayerShell } from '../components/player-shell';
import { createModeSelector } from '../components/mode-selector';
import { createPlayerControls, handlePlayerKeydown } from '../components/player-controls';
import { createModeLabel, createStatusPanel, createUnavailablePanel } from '../components/status-panel';
import { createEntitlementPanel } from '../components/entitlement-panel';
import { createSwitchDialog } from '../components/dialog';
import { createDevPanel } from '../components/dev-panel';
import { h, isFocusable, safeUrl, uid } from '../dom';
import { DEMO_EVENT_BADGE, playerCopy, statusCopy } from '../i18n/copy';
import { createAdapterFactory } from '../adapters/factory';
import { prepareHlsLibrary } from '../adapters/hls';
import { createEntitlementPlaceholder } from '../adapters/entitlement-placeholder';
import { createLiveEntitlementProvider, createRestEntitlementProvider, createRestEventProvider, createRestPlaybackProvider, createRestSession } from '../adapters/providers';
import { createPlayerController } from '../state/coordinator';
import type { CoordinatorDeps } from '../state/coordinator';
import { startEventPoller } from '../state/event-poller';
import { pageRegistry } from '../state/page-registry';
import { isUrgentAnnouncement, selectAnnouncement, selectGate, selectModeLabel, selectSwitchTarget } from '../state/model';
import { readModePreference, writeModePreference } from '../util/storage';
import { readEventParam, readModeParam } from '../util/url';
import { formatEventDateTime } from '../util/time';
import type { AppState, BootConfig, EventStatus, ListeningMode, PublicEvent } from '../types';
import type { ViewContext, ViewInstance } from './types';

type Heading = 'h1' | 'h2' | 'h3' | 'h4';

function otherMode(mode: ListeningMode): ListeningMode {
  return mode === 'binaural' ? 'atmos' : 'binaural';
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Heading levels below the view title: h1 -> h2/h3, h2 -> h3/h4 (plan 3.3). */
function levels(base: 'h1' | 'h2'): { section: Heading; sub: Heading } {
  return base === 'h1' ? { section: 'h2', sub: 'h3' } : { section: 'h3', sub: 'h4' };
}

/* ------------------------------------------------------------------ */
/* Disabled mode / unknown event: no controller                        */
/* ------------------------------------------------------------------ */

function mountUnavailable(mount: HTMLElement, boot: BootConfig, kind: 'disabled' | 'not_found'): ViewInstance {
  const panel = createUnavailablePanel(kind, boot.links, boot.heading);
  const root = h('section', { className: 'wg-live__player-view wg-live__player-view--unavailable', dataset: { gate: kind } }, panel.el);
  mount.replaceChildren(root);
  return {
    destroy(): void {
      root.remove();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Static pieces                                                       */
/* ------------------------------------------------------------------ */

function paragraphs(text: string): HTMLElement[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => h('p', { className: 'wg-live__info-text', text: line }));
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export function mountPlayerView(mount: HTMLElement, boot: BootConfig, ctx: ViewContext): ViewInstance {
  if (boot.deploymentMode === 'disabled') return mountUnavailable(mount, boot, 'disabled');

  const slug = boot.fixedEventSlug ?? readEventParam(window.location.search);
  const found = slug === null ? null : (boot.events.find((e) => e.slug === slug) ?? null);
  if (found === null) return mountUnavailable(mount, boot, 'not_found');
  // A const (not the narrowed `found`) so function declarations below keep the non-null type.
  const event: PublicEvent = found;

  const { section: sectionTag, sub: subTag } = levels(boot.heading);

  /* ---- controller ---- */
  const shell = createPlayerShell(event.mediaKind);
  const fromParam = readModeParam(window.location.search, event.availableModes);
  const remembered = readModePreference();
  const preselect: ListeningMode | null =
    fromParam ?? (remembered !== null && event.availableModes.includes(remembered) ? remembered : null);

  const eventProvider = createRestEventProvider(boot.rest.root, boot.events);
  // M2-PLAN A3: one REST session (wp_rest nonce) for playback and entitlement; real events ask the server in live mode.
  const session = createRestSession(boot.rest);
  const placeholder = createEntitlementPlaceholder(boot.events);
  const deps: CoordinatorDeps = {
    boot,
    event,
    host: shell.host,
    // M2-PLAN D2: a provider player frame is named after the event.
    env: { ...ctx.env, frameTitle: `${event.title}・串流服務播放器` },
    adapterFactory: createAdapterFactory(),
    playbackProvider: createRestPlaybackProvider(boot.rest.root, session),
    entitlementProvider:
      boot.deploymentMode === 'live'
        ? createLiveEntitlementProvider(placeholder, createRestEntitlementProvider(boot.rest.root, session), boot.events)
        : placeholder,
    eventProvider,
    root: ctx.root,
    preselect,
    onModeRemembered: writeModePreference,
    // M2-PLAN C3: fetch the plugin's hls.js before the click, so load() and play() stay inside it.
    onSourceResolved: (source) => {
      if (source.kind === 'hls') prepareHlsLibrary(shell.host.media, ctx.env);
    },
  };
  const controller = createPlayerController(deps);
  const unregister = pageRegistry.register(controller);

  /* ---- title area ---- */
  // The demo badge sits in the meta row above the title; the heading's accessible name still includes it.
  const titleTextId = uid('wg-live-title');
  const demoBadgeId = uid('wg-live-demo-badge');
  const demoBadge = event.isDemo
    ? h('span', { className: 'wg-live__badge wg-live__badge--demo', id: demoBadgeId, text: DEMO_EVENT_BADGE })
    : null;
  const titleText = h('span', { className: 'wg-live__player-title-text', id: titleTextId, text: event.title });
  const title = h(
    boot.heading,
    {
      className: 'wg-live__player-title wg-live__heading',
      attrs: demoBadge ? { 'aria-labelledby': `${titleTextId} ${demoBadgeId}` } : {},
    },
    titleText,
  );
  const meta = h('p', { className: 'wg-live__player-meta' });
  const statusBadge = h('span', { className: 'wg-live__badge wg-live__player-status-badge' });
  const metaRow = h('div', { className: 'wg-live__meta-row' }, statusBadge, demoBadge);

  /* ---- panels ---- */
  const info = h('section', { className: 'wg-live__info' });
  const infoHeadingId = uid('wg-live-info');
  const infoHeading = h(sectionTag, {
    className: 'wg-live__info-heading wg-live__heading wg-live__heading--h3',
    id: infoHeadingId,
    tabindex: -1,
    text: playerCopy.info.heading,
  });
  const infoBody = h('div', { className: 'wg-live__info-body' });
  info.append(infoHeading, infoBody);
  info.setAttribute('aria-labelledby', infoHeadingId);

  const dialog = createSwitchDialog({
    onOpen: (target) => controller.prepareSwitch(target),
    onConfirm: (target) => {
      controller.switchMode(target).catch(() => undefined);
    },
    fallbackFocus: () => statusPanel.heading,
  });

  function currentModeForSwitch(state: AppState): ListeningMode | null {
    return state.player.activeMode ?? state.player.lastGoodMode ?? state.player.loadedMode ?? state.player.selectedMode;
  }

  function openSwitchDialog(trigger: HTMLElement): void {
    const state = controller.getState();
    if (state.player.status === 'switching' || state.player.status === 'loading') return;
    // After a failure the target is the OTHER mode than the one that failed (selectSwitchTarget), which
    // after a failed switch is the last good mode, never the mode that just failed.
    const failedTarget = state.player.status === 'failed' ? selectSwitchTarget(state) : null;
    const current = failedTarget !== null ? otherMode(failedTarget) : currentModeForSwitch(state);
    if (current === null) return;
    dialog.open(trigger, current, otherMode(current));
  }

  /**
   * The status panel's 切換模式 action (UI-03). Before anything was started (idle / selecting, for
   * example mode_unavailable) there is no stream to interrupt: select the other mode directly and
   * keep focus on the radio, because the action disappears once the not-ready state clears.
   */
  function onStatusSwitch(trigger: HTMLElement): void {
    const state = controller.getState();
    const { status } = state.player;
    if (status === 'idle' || status === 'selecting') {
      const target = selectSwitchTarget(state);
      if (target === null) return;
      controller.selectMode(target);
      const radio = selector.inputs[target];
      if (isFocusable(radio)) radio.focus({ preventScroll: true });
      return;
    }
    openSwitchDialog(trigger);
  }

  const modeLabel = createModeLabel();
  const statusPanel = createStatusPanel({
    controller,
    note: modeLabel.note,
    headingTag: sectionTag,
    links: boot.links,
    event,
    onSwitchMode: onStatusSwitch,
    onViewEvent: () => {
      infoHeading.focus();
    },
  });
  const entitlementPanel = createEntitlementPanel({ controller, links: boot.links, event });

  const selector = createModeSelector({
    onSelect: (mode) => controller.selectMode(mode),
    helpHref: safeUrl(boot.links.help),
  });
  const controls = createPlayerControls({
    controller,
    mediaKind: event.mediaKind,
    fullscreenRoot: shell.theater,
    media: shell.host.media,
  });
  const switchButton = h('button', {
    className: 'wg-live__btn wg-live__switch',
    type: 'button',
    text: statusCopy.action.switchMode,
    hidden: true,
  });
  const modeBar = h(
    'div',
    { className: 'wg-live__modebar', attrs: { role: 'group', 'aria-label': playerCopy.modeBar.groupLabel } },
    modeLabel.el,
    switchButton,
  );
  shell.controlsSlot.append(selector.el, controls.el, modeBar);

  const helpHref = safeUrl(boot.links.help);
  const helpLink = helpHref
    ? h('p', { className: 'wg-live__help-link' }, h('a', { className: 'wg-live__link', href: helpHref, text: playerCopy.helpLink }))
    : null;

  const head = h(
    'header',
    { className: 'wg-live__player-head' },
    metaRow,
    title,
    meta,
    statusPanel.el,
    entitlementPanel.el,
  );
  // Title + status first (spec 5.3), inside the player group; CSS decides the wide-screen order.
  shell.el.prepend(head);

  const devPanel = controller.dev ? createDevPanel(controller.dev) : null;

  const view = h(
    'section',
    { className: 'wg-live__player-view', dataset: { event: event.slug, mediaKind: event.mediaKind } },
    shell.el,
    // Info and the help link stay together (spec 5.3 order) and share the second column on wide screens.
    h('div', { className: 'wg-live__aside' }, info, helpLink),
    dialog.el,
    devPanel ? devPanel.el : null,
  );

  const videoMedia = event.mediaKind === 'video' ? shell.host.media : null;
  if (event.mediaKind === 'video') {
    const poster = safeUrl(event.posterUrl);
    if (poster !== null) shell.host.media.setAttribute('poster', poster);
  } else {
    shell.stage.prepend(createStageArt(event));
  }

  /* ---- in-place rendering ---- */
  let lastEventKey: string | null = null;

  /**
   * Every poll delivers a freshly parsed PublicEvent, so identity says nothing. Compare the fields this
   * block renders: an unchanged poll must not replace the description or programme nodes (a screen reader's
   * virtual cursor and a text selection live on them, plan 6.6).
   */
  function eventDetailsKey(data: PublicEvent): string {
    return JSON.stringify([data.title, data.performers, data.startsAt, data.displayTimezone, data.description, data.programme]);
  }

  function renderEventDetails(data: PublicEvent): void {
    const key = eventDetailsKey(data);
    if (lastEventKey === key) return;
    lastEventKey = key;
    setText(titleText, data.title);
    // The <video> carries the accessible name (not the stage div, which axe flags as aria-prohibited-attr).
    videoMedia?.setAttribute('aria-label', playerCopy.stage.videoLabel(data.title));

    const when = formatEventDateTime(data.startsAt, data.displayTimezone);
    const performers = data.performers.filter((name) => name.trim() !== '');
    // Two items side by side (CSS gap) instead of a ' · ' text node (A porting note 2).
    const nodes: HTMLElement[] = [];
    if (performers.length > 0) {
      nodes.push(
        h('span', {
          className: 'wg-live__player-meta-item',
          text: playerCopy.header.performers(performers.join(playerCopy.header.performersJoiner)),
        }),
      );
    }
    if (when.machine !== '') {
      nodes.push(
        h(
          'span',
          { className: 'wg-live__player-meta-item' },
          h('time', { attrs: { datetime: when.machine }, text: when.full }),
        ),
      );
    }
    meta.replaceChildren(...nodes);
    meta.hidden = nodes.length === 0;

    const main: Node[] = [...paragraphs(data.description)];
    if (when.machine !== '') {
      main.push(
        h(
          'p',
          { className: 'wg-live__info-when' },
          h('strong', { text: `${playerCopy.info.dateLabel}：` }),
          h('time', { attrs: { datetime: when.machine }, text: when.full }),
        ),
      );
    }
    // Description and date share one column; the programme is the second (HYBRID / A porting note 5).
    const body: Node[] = main.length > 0 ? [h('div', { className: 'wg-live__info-main' }, ...main)] : [];
    const programme = data.programme.filter((item) => item.trim() !== '');
    if (programme.length > 0) {
      const programmeHeadingId = `${infoHeadingId}-programme`;
      body.push(
        h(
          'section',
          { className: 'wg-live__programme', attrs: { 'aria-labelledby': programmeHeadingId } },
          h(subTag, { className: 'wg-live__programme-heading wg-live__heading wg-live__heading--h4', id: programmeHeadingId, text: playerCopy.info.programmeHeading }),
          // A real sequence: an ordered list whose numerals (01, 02...) CSS draws (list-style is none, so the
          // role keeps the list semantics in Safari).
          h('ol', { className: 'wg-live__programme-list', attrs: { role: 'list' } }, ...programme.map((item) => h('li', { text: item }))),
          h('p', { className: 'wg-live__programme-note wg-live__small wg-live__muted', text: playerCopy.info.programmeNote }),
        ),
      );
    }
    infoBody.replaceChildren(...body);
  }

  /**
   * Keyboard focus must not fall to <body> when the control that has it hides itself (Start on
   * failure, 重試, 重新載入, 改用耳機 Binaural, the entitlement 重試, WCAG 2.4.3). The status heading
   * (tabindex="-1") is the same fallback the switch dialog uses (plan 6.6).
   */
  function keepFocus(before: Element | null): void {
    if (before === null || before === statusPanel.heading || before === infoHeading) return;
    if (!view.contains(before) || dialog.el.contains(before)) return;
    if (isFocusable(before)) return;
    const now = document.activeElement;
    // Browsers move focus to <body> when a focused element is hidden; jsdom keeps the stale element.
    if (now !== null && now !== document.body && now !== before) return;
    statusPanel.heading.focus({ preventScroll: true });
  }

  function render(state: AppState): void {
    const focusedBefore = document.activeElement;
    const data: PublicEvent = state.event.data ?? event;
    renderEventDetails(data);

    const status = state.event.status ?? data.status;
    setText(statusBadge, statusCopy.eventStatus[status]);
    statusBadge.className = `wg-live__badge wg-live__player-status-badge${status === 'live' ? ' wg-live__badge--live' : status === 'cancelled' ? ' wg-live__badge--error' : ' wg-live__badge--muted'}`;

    statusPanel.update(state);
    entitlementPanel.update(state);
    modeLabel.update(state);
    controls.update(state);
    devPanel?.update(state);

    const gate = selectGate(state).kind;
    const controlsVisible = gate === 'scheduled' || gate === 'doors_open' || gate === 'open';
    const playerStatus = state.player.status;
    const preStart =
      playerStatus === 'idle' ||
      playerStatus === 'selecting' ||
      (playerStatus === 'failed' && state.player.lastGoodMode === null);
    shell.controlsSlot.hidden = !controlsVisible;

    selector.el.hidden = !(controlsVisible && preStart);
    selector.update({ selected: state.player.selectedMode, available: data.availableModes });

    const engaged = playerStatus !== 'idle' && playerStatus !== 'selecting';
    const canSwitch = controlsVisible && engaged && data.availableModes.length > 1 && currentModeForSwitch(state) !== null;
    switchButton.hidden = !canSwitch;
    if (playerStatus === 'switching' || playerStatus === 'loading') switchButton.setAttribute('aria-disabled', 'true');
    else switchButton.removeAttribute('aria-disabled');
    modeBar.hidden = !controlsVisible || (selectModeLabel(state) === null && switchButton.hidden);

    view.dataset.status = playerStatus;
    view.dataset.gate = gate;

    // A modal about a stream that is gone (ended, cancelled, not yet open) must not linger.
    if (dialog.isOpen() && (!controlsVisible || gate !== 'open' || !engaged)) dialog.close();
    dialog.notifyStatus(playerStatus);
    keepFocus(focusedBefore);
  }

  /* ---- announcements (plan 6.10): only what selectAnnouncement() says, only when it changes ---- */
  let lastAnnounced: string | null = null;
  let lastEventStatus: EventStatus | null = null;
  function announce(state: AppState): void {
    const status = state.event.status;
    const statusChanged = status !== lastEventStatus;
    lastEventStatus = status;
    const statusMessage = status !== null ? statusCopy.announce.eventStatus(status) : null;
    const gateOpen = selectGate(state).kind === 'open';
    const waiting = state.player.status === 'idle' || state.player.status === 'selecting';

    let message = selectAnnouncement(state);
    // While nothing plays selectAnnouncement() falls back to the event status. That is news only when the
    // status really changed; picking another mode after a failure must not claim 「活動狀態更新」.
    if (gateOpen && waiting && message === statusMessage && !statusChanged) message = null;

    if (message === null) {
      lastAnnounced = null;
    } else if (message !== lastAnnounced) {
      lastAnnounced = message;
      ctx.announce(message, isUrgentAnnouncement(state) ? { immediate: true } : undefined);
    }

    // live <-> intermission while the player is engaged: the player message does not change, so announce
    // the event status itself (plan 6.10). Idle / selecting and the closed gates are covered above.
    if (statusChanged && statusMessage !== null && gateOpen && !waiting && message !== statusMessage) {
      ctx.announce(statusMessage);
    }
  }

  /* ---- wiring ---- */
  const onSwitchClick = (): void => {
    if (switchButton.getAttribute('aria-disabled') === 'true') return;
    openSwitchDialog(switchButton);
  };
  switchButton.addEventListener('click', onSwitchClick);

  const onKeydown = (keyEvent: KeyboardEvent): void => {
    handlePlayerKeydown(keyEvent, controller);
  };
  shell.el.addEventListener('keydown', onKeydown);

  const initial = controller.getState();
  render(initial);
  lastAnnounced = selectAnnouncement(initial); // never announce the state the page loaded in
  lastEventStatus = initial.event.status;
  mount.replaceChildren(view);

  let destroyed = false;
  const unsubscribe = controller.subscribe((state) => {
    if (destroyed) return;
    render(state);
    announce(state);
  });

  /** Release everything this view owns (idempotent). The caller decides what the mount shows next. */
  function teardown(): void {
    if (destroyed) return;
    destroyed = true;
    poller.stop();
    unsubscribe();
    shell.el.removeEventListener('keydown', onKeydown);
    switchButton.removeEventListener('click', onSwitchClick);
    dialog.destroy();
    selector.destroy();
    controls.destroy();
    statusPanel.destroy();
    entitlementPanel.destroy();
    devPanel?.destroy();
    unregister();
    controller.destroy();
    view.remove();
  }

  const poller = startEventPoller({
    provider: eventProvider,
    slug: event.slug,
    root: ctx.root,
    onEvent: (next) => controller.updateEvent(next),
    onGone: () => {
      // The event was unpublished or removed while the page was open: stop the media and say so.
      if (destroyed) return;
      teardown();
      const gone = createUnavailablePanel('not_found', boot.links, boot.heading);
      mount.replaceChildren(h('section', { className: 'wg-live__player-view wg-live__player-view--unavailable', dataset: { gate: 'not_found' } }, gone.el));
      ctx.announce(statusCopy.gate.eventNotFound.title, { immediate: true });
    },
  });

  return {
    destroy: teardown,
    stop(): void {
      if (!destroyed) controller.stop();
    },
    refresh(): void {
      if (!destroyed) poller.refreshNow();
    },
  };
}
