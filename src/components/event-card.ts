/**
 * Event card (plan 6.1 "Card fields" and CTA table).
 *
 * Built with h() and textContent only (D12). The card owns no timers: the view calls tick() once a
 * minute so the countdown text changes in place without rebuilding the DOM (focus and the expanded
 * state survive). The countdown is plain text, never a live region (plan 6.10).
 *
 * Accessible name: the article is labelled by its title heading, and the 「介面示範」 badge sits
 * inside that heading, so demo status is part of the name (plan 6.10).
 */
import { h, uid } from '../dom';
import { DEMO_EVENT_BADGE, DEMO_MEDIA_NOTICE, eventsCopy, statusCopy } from '../i18n/copy';
import { selectPrimaryCta } from '../state/model';
import type { BootConfig, EventStatus, PosterImage, PublicEvent } from '../types';
import { countdownText, formatEventDateTime } from '../util/time';

export type CardHeadingTag = 'h2' | 'h3' | 'h4';

export interface EventCardOptions {
  event: PublicEvent;
  boot: BootConfig;
  /** Featured card: larger layout, poster is not lazy-loaded. */
  featured: boolean;
  /** Heading level of the card title (one below the section heading). */
  headingTag: CardHeadingTag;
  nowMs: number;
  /** Aborts the card's listeners when the view is destroyed. */
  signal?: AbortSignal;
}

export interface EventCardInstance {
  el: HTMLElement;
  /** Refresh time-dependent text (the countdown). Never rebuilds DOM. */
  tick(nowMs: number): void;
}

const BADGE_TONE: Record<EventStatus, string> = {
  scheduled: 'info',
  doors_open: 'info',
  live: 'live',
  intermission: 'warning',
  ended: 'muted',
  cancelled: 'error',
};

/** Newlines are paragraph breaks in plain-text fields (types.ts). Always textContent. */
export function paragraphNodes(text: string, className: string): HTMLElement[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => h('p', { className, text: line }));
}

function posterOf(event: PublicEvent): PosterImage | null {
  if (event.poster) return event.poster;
  // Only the bare URL is known: reserve a 16:9 box so the layout does not shift.
  if (event.posterUrl) {
    return { url: event.posterUrl, width: 1600, height: 900, alt: '', srcset: null, sizes: null };
  }
  return null;
}

function buildPoster(event: PublicEvent, featured: boolean): HTMLElement | null {
  const poster = posterOf(event);
  if (!poster) return null;
  const img = h('img', {
    className: 'wg-live__event-card-img',
    attrs: {
      src: poster.url,
      width: poster.width,
      height: poster.height,
      alt: poster.alt,
      srcset: poster.srcset,
      sizes: poster.srcset ? poster.sizes : null,
      // The featured poster is the likely LCP element: never lazy.
      loading: featured ? 'eager' : 'lazy',
      decoding: 'async',
      fetchpriority: featured ? 'high' : null,
    },
  });
  // A rejected URL (safeUrl) leaves no src: skip the empty box.
  if (!img.hasAttribute('src')) return null;
  return h('div', { className: 'wg-live__event-card-media' }, img);
}

function buildModes(event: PublicEvent): HTMLElement {
  if (event.availableModes.length === 0) {
    return h('p', { className: 'wg-live__event-card-modes wg-live__muted', text: eventsCopy.card.modesPending });
  }
  const chips = event.availableModes.map((mode) =>
    h('li', { className: 'wg-live__event-card-mode', text: eventsCopy.card.modeChip[mode] }),
  );
  return h(
    'div',
    { className: 'wg-live__event-card-modes' },
    h('span', { className: 'wg-live__event-card-modes-label', text: `${eventsCopy.card.modes}：` }),
    h('ul', { className: 'wg-live__event-card-mode-list', attrs: { role: 'list' } }, ...chips),
  );
}

function buildDetails(event: PublicEvent, boot: BootConfig, id: string): HTMLElement {
  const panel = h('div', { className: 'wg-live__event-details', attrs: { id }, hidden: true });

  const description = paragraphNodes(event.description, 'wg-live__event-details-text');
  panel.append(...description);

  if (event.programme.length > 0) {
    panel.append(
      h('p', { className: 'wg-live__event-details-label', text: eventsCopy.card.programme }),
      h(
        'ul',
        { className: 'wg-live__event-programme', attrs: { role: 'list' } },
        ...event.programme.map((item) => h('li', { className: 'wg-live__event-programme-item', text: item })),
      ),
    );
  }

  if (event.status === 'cancelled') {
    const notice = h(
      'div',
      { className: 'wg-live__notice wg-live__notice--error', attrs: { role: 'note' } },
      h('p', { className: 'wg-live__notice-title', text: statusCopy.gate.cancelled.title }),
      h('p', { className: 'wg-live__notice-text', text: statusCopy.gate.cancelled.detail }),
    );
    const contact = boot.links.contact;
    if (contact) {
      const link = h('a', {
        className: 'wg-live__event-details-link',
        attrs: { href: contact },
        text: eventsCopy.card.contactForCancel,
      });
      if (link.hasAttribute('href')) notice.append(h('p', { className: 'wg-live__notice-text' }, link));
    }
    panel.append(notice);
  } else if (event.status === 'ended') {
    const notice = h(
      'div',
      { className: 'wg-live__notice', attrs: { role: 'note' } },
      h('p', { className: 'wg-live__notice-title', text: statusCopy.gate.ended.title }),
    );
    // M1 never has a replay button; the text appears only when the admin marked a replay as available.
    if (event.replayAvailable) {
      notice.append(h('p', { className: 'wg-live__notice-text', text: statusCopy.cta.replayPending }));
    }
    panel.append(notice);
  }

  if (event.isDemo && event.sourceKind === 'demo') {
    panel.append(h('p', { className: 'wg-live__event-details-note wg-live__muted wg-live__small', text: DEMO_MEDIA_NOTICE }));
  }
  return panel;
}

export function createEventCard(opts: EventCardOptions): EventCardInstance {
  const { event, boot, featured, headingTag, signal } = opts;
  const titleId = uid('wg-live-event-title');
  const panelId = uid('wg-live-event-details');
  const when = formatEventDateTime(event.startsAt, event.displayTimezone);
  const poster = buildPoster(event, featured);
  const ended = event.status === 'ended' || event.status === 'cancelled';

  /* ---- title (+ demo badge inside the accessible name) ---- */
  const title = h(
    headingTag,
    { className: 'wg-live__event-card-title', attrs: { id: titleId } },
    h('span', { className: 'wg-live__event-card-title-text', text: event.title }),
    event.isDemo ? ' ' : null,
    event.isDemo ? h('span', { className: 'wg-live__badge wg-live__badge--demo', text: DEMO_EVENT_BADGE }) : null,
  );

  const statusBadge = h('span', {
    className: `wg-live__badge wg-live__badge--${BADGE_TONE[event.status]} wg-live__event-card-status`,
    dataset: { status: event.status },
    text: statusCopy.eventStatus[event.status],
  });

  const performers =
    event.performers.length > 0
      ? h(
          'p',
          { className: 'wg-live__event-card-performers' },
          h('span', { className: 'wg-live__event-card-label', text: `${eventsCopy.card.performers}：` }),
          event.performers.join('、'),
        )
      : null;

  const whenEl = h(
    'p',
    { className: 'wg-live__event-card-when' },
    when.machine !== ''
      ? h('time', { attrs: { datetime: when.machine }, text: when.full })
      : h('span', { text: when.full }),
  );

  /* ---- countdown (scheduled only; plain text, not a live region) ---- */
  let countdown: HTMLElement | null = null;
  let countdownShown: string | null = null;
  const setCountdown = (nowMs: number): void => {
    if (!countdown) return;
    const quantity = countdownText(event.startsAt, nowMs);
    const text = quantity === null ? null : eventsCopy.card.countdown(quantity);
    if (text === countdownShown) return;
    countdownShown = text;
    countdown.textContent = text ?? '';
    countdown.hidden = text === null;
  };
  if (event.status === 'scheduled') {
    countdown = h('p', { className: 'wg-live__event-card-countdown wg-live__muted', hidden: true });
    setCountdown(opts.nowMs);
  }

  /* ---- details panel and its toggles ---- */
  const panel = buildDetails(event, boot, panelId);
  const toggles: HTMLButtonElement[] = [];
  const makeToggle = (label: string, variant: 'primary' | 'ghost'): HTMLButtonElement => {
    const button = h('button', {
      className: `wg-live__btn wg-live__btn--${variant} wg-live__event-card-toggle`,
      attrs: {
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': panelId,
        'aria-label': `${label}：${event.title}`,
      },
      text: label,
    });
    button.addEventListener(
      'click',
      () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        for (const t of toggles) t.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        card.classList.toggle('wg-live__event-card--open', open);
      },
      signal ? { signal } : undefined,
    );
    toggles.push(button);
    return button;
  };

  /* ---- CTAs (plan 6.1 table; the label and target come from selectPrimaryCta) ---- */
  const actions = h('div', { className: 'wg-live__actions wg-live__actions--stack wg-live__event-card-actions' });
  const cta = selectPrimaryCta(event, boot);
  let primary: HTMLElement | null = null;
  let linkPrimary = false;
  if (cta.kind === 'link' && cta.href) {
    const link = h('a', {
      className: 'wg-live__btn wg-live__btn--primary wg-live__event-card-cta',
      attrs: { href: cta.href, 'aria-label': `${cta.label}：${event.title}` },
      text: cta.label,
    });
    if (link.hasAttribute('href')) {
      primary = link;
      linkPrimary = true;
    }
  }
  if (!primary) {
    // 'details' CTAs, and links whose target is missing or unsafe: expand the details instead.
    primary = makeToggle(cta.kind === 'details' ? cta.label : statusCopy.cta.viewDetails, 'primary');
  }
  actions.append(primary);
  if (linkPrimary) actions.append(makeToggle(eventsCopy.card.toggleInfo, 'ghost'));

  // Secondary CTAs: only when the links exist, and never on events that are over. Neither claims
  // viewing rights (plan 6.1, D18).
  if (!ended) {
    if (event.productUrl) {
      const buy = h('a', {
        className: 'wg-live__btn wg-live__btn--secondary wg-live__event-card-buy',
        attrs: { href: event.productUrl, 'aria-label': `${statusCopy.action.buy}：${event.title}` },
        text: statusCopy.action.buy,
      });
      if (buy.hasAttribute('href')) actions.append(buy);
    }
    if (boot.links.account) {
      const login = h('a', {
        className: 'wg-live__btn wg-live__btn--ghost wg-live__event-card-login',
        attrs: { href: boot.links.account, 'aria-label': `${statusCopy.action.login}：${event.title}` },
        text: statusCopy.action.login,
      });
      if (login.hasAttribute('href')) actions.append(login);
    }
  }

  const body = h(
    'div',
    { className: 'wg-live__event-card-body' },
    h('div', { className: 'wg-live__event-card-meta' }, statusBadge),
    title,
    performers,
    whenEl,
    countdown,
    buildModes(event),
    actions,
    panel,
  );

  const card = h(
    'article',
    {
      className: [
        'wg-live__event-card',
        featured ? 'wg-live__event-card--featured' : '',
        poster ? 'wg-live__event-card--has-media' : '',
        ended ? 'wg-live__event-card--over' : '',
      ]
        .filter(Boolean)
        .join(' '),
      attrs: { 'aria-labelledby': titleId },
      dataset: { eventSlug: event.slug, eventStatus: event.status },
    },
    poster,
    body,
  );

  return {
    el: card,
    tick(nowMs: number): void {
      setCountdown(nowMs);
    },
  };
}

