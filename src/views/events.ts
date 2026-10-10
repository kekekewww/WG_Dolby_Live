/**
 * Events view, `/live/` (plan 6.1, spec 5.1).
 *
 * Sections in order: view title, featured event, 聆聽方式, other events, FAQ summary. Disabled mode
 * (plan D16) shows only the "not open yet" panel with home and contact links.
 *
 * The view is rendered from the bootstrap only: no request, no player, no hls.js. The only timer is
 * the minute tick that refreshes countdown text in place; it stops when the view is destroyed or
 * its root leaves the document (plan 3.2).
 */
import { h, uid } from '../dom';
import { eventsCopy, statusCopy } from '../i18n/copy';
import { createEventCard, type CardHeadingTag } from '../components/event-card';
import { createEventList } from '../components/event-list';
import { createListeningGuide } from '../components/listening-guide';
import { orderEvents } from '../state/model';
import type { BootConfig, FaqItem } from '../types';
import type { ViewContext, ViewInstance } from './types';

const TICK_MS = 30_000;
const FAQ_SUMMARY_COUNT = 3;

interface Levels {
  /** Section headings. */
  section: 'h2' | 'h3';
  /** Card titles. */
  card: CardHeadingTag;
}

function levelsFor(heading: 'h1' | 'h2'): Levels {
  return heading === 'h1' ? { section: 'h2', card: 'h3' } : { section: 'h3', card: 'h4' };
}

function link(href: string | null, label: string, className: string): HTMLElement | null {
  if (!href) return null;
  const a = h('a', { className, attrs: { href }, text: label });
  return a.hasAttribute('href') ? a : null;
}

function buildHeader(boot: BootConfig, withIntro: boolean): HTMLElement {
  return h(
    'header',
    { className: 'wg-live__events-header' },
    h(boot.heading, { className: 'wg-live__heading wg-live__view-title', text: eventsCopy.title }),
    h('p', { className: 'wg-live__view-subtitle', text: eventsCopy.subtitle }),
    withIntro ? h('p', { className: 'wg-live__view-intro wg-live__muted', text: eventsCopy.intro }) : null,
  );
}

function buildDisabled(boot: BootConfig, levels: Levels): HTMLElement {
  const copy = statusCopy.gate.disabled;
  const home = link(boot.links.home, eventsCopy.disabled.homeLink, 'wg-live__btn wg-live__btn--primary');
  const contact = link(boot.links.contact, eventsCopy.disabled.contactLink, 'wg-live__btn wg-live__btn--secondary');
  return h(
    'section',
    { className: 'wg-live__panel wg-live__panel--disabled' },
    h(levels.section, { className: 'wg-live__heading wg-live__heading--h3', text: copy.title }),
    h('p', { className: 'wg-live__muted', text: copy.detail }),
    home || contact
      ? h('div', { className: 'wg-live__actions wg-live__actions--stack' }, home, contact)
      : null,
  );
}

function buildEmpty(boot: BootConfig, levels: Levels): HTMLElement {
  const help = link(boot.links.help, statusCopy.action.help, 'wg-live__btn wg-live__btn--secondary');
  return h(
    'section',
    { className: 'wg-live__panel wg-live__panel--empty' },
    h(levels.section, { className: 'wg-live__heading wg-live__heading--h3', text: eventsCopy.empty.title }),
    h('p', { className: 'wg-live__muted', text: eventsCopy.empty.detail }),
    help ? h('div', { className: 'wg-live__actions wg-live__actions--stack' }, help) : null,
  );
}

function faqItems(boot: BootConfig): FaqItem[] {
  const admin = boot.help.faq.filter((item) => item.question.trim() !== '');
  return admin.length > 0 ? admin.slice(0, FAQ_SUMMARY_COUNT) : eventsCopy.defaultFaq.map((item) => ({ ...item }));
}

function buildFaq(boot: BootConfig, levels: Levels): HTMLElement {
  const headingId = uid('wg-live-faq-heading');
  const items = faqItems(boot).map((item) =>
    h(
      'details',
      { className: 'wg-live__faq-item' },
      h('summary', { className: 'wg-live__faq-question', text: item.question }),
      h(
        'div',
        { className: 'wg-live__faq-answer' },
        ...item.answer
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .map((line) => h('p', { text: line })),
      ),
    ),
  );
  const more = link(boot.links.help, eventsCopy.faqHelpLink, 'wg-live__faq-more');
  return h(
    'section',
    { className: 'wg-live__events-section wg-live__faq', attrs: { 'aria-labelledby': headingId } },
    h(levels.section, { className: 'wg-live__heading wg-live__heading--h3', attrs: { id: headingId }, text: eventsCopy.faqHeading }),
    h('div', { className: 'wg-live__faq-list' }, ...items),
    more ? h('p', { className: 'wg-live__faq-more-row' }, more) : null,
  );
}

export function mountEventsView(mount: HTMLElement, boot: BootConfig, ctx: ViewContext): ViewInstance {
  const levels = levelsFor(boot.heading);
  const abort = new AbortController();
  const tickers: Array<(nowMs: number) => void> = [];
  const root = h('div', { className: 'wg-live__events' });

  if (boot.deploymentMode === 'disabled') {
    root.append(buildHeader(boot, false), buildDisabled(boot, levels));
  } else if (boot.events.length === 0) {
    root.append(buildHeader(boot, true), buildEmpty(boot, levels));
  } else {
    const nowMs = Date.now();
    const { featured, others } = orderEvents(boot.events, boot.featuredEventSlug, nowMs);
    root.append(buildHeader(boot, true));

    if (featured) {
      const headingId = uid('wg-live-featured-heading');
      const card = createEventCard({
        event: featured,
        boot,
        featured: true,
        headingTag: levels.card,
        nowMs,
        signal: abort.signal,
      });
      tickers.push((t) => card.tick(t));
      root.append(
        h(
          'section',
          { className: 'wg-live__events-section wg-live__featured', attrs: { 'aria-labelledby': headingId } },
          h(levels.section, { className: 'wg-live__heading wg-live__heading--h3', attrs: { id: headingId }, text: eventsCopy.featuredHeading }),
          card.el,
        ),
      );
    }

    root.append(
      h('div', { className: 'wg-live__events-section' }, createListeningGuide({ headingTag: levels.section, helpUrl: boot.links.help })),
    );

    if (others.length > 0) {
      const headingId = uid('wg-live-others-heading');
      const list = createEventList({
        events: others,
        boot,
        headingTag: levels.card,
        nowMs,
        labelledBy: headingId,
        signal: abort.signal,
      });
      tickers.push((t) => list.tick(t));
      root.append(
        h(
          'section',
          { className: 'wg-live__events-section wg-live__others' },
          h(levels.section, {
            className: 'wg-live__heading wg-live__heading--h3',
            attrs: { id: headingId },
            text: featured ? eventsCopy.othersHeading : eventsCopy.allHeading,
          }),
          list.el,
        ),
      );
    }

    root.append(buildFaq(boot, levels));
  }

  mount.replaceChildren(root);

  /* ---- minute tick for countdown text (not a live region) ---- */
  let timer: number | null = null;
  let destroyed = false;

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    document.removeEventListener('visibilitychange', onVisibility);
    abort.abort();
    root.remove();
  };

  const tick = (): void => {
    if (destroyed) return;
    if (!ctx.root.isConnected) {
      destroy();
      return;
    }
    const nowMs = Date.now();
    for (const fn of tickers) fn(nowMs);
  };

  function onVisibility(): void {
    if (document.visibilityState === 'visible') tick();
  }

  // Only scheduled events show a countdown.
  if (tickers.length > 0 && boot.events.some((e) => e.status === 'scheduled')) {
    timer = window.setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
  }

  return {
    destroy,
    refresh: tick,
  };
}
