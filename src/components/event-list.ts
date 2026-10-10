/**
 * Event list: a grid of event cards (plan 6.1 section 4). The list is a real <ul> (with an explicit
 * role so Safari keeps the list semantics although the markers are removed).
 */
import { h } from '../dom';
import type { BootConfig, PublicEvent } from '../types';
import { createEventCard, type CardHeadingTag } from './event-card';

export interface EventListOptions {
  events: PublicEvent[];
  boot: BootConfig;
  headingTag: CardHeadingTag;
  nowMs: number;
  /** id of the heading that names the list. */
  labelledBy: string;
  signal?: AbortSignal;
}

export interface EventListInstance {
  el: HTMLElement;
  /** Refresh countdown text on every card; does not rebuild any DOM. */
  tick(nowMs: number): void;
}

export function createEventList(opts: EventListOptions): EventListInstance {
  const cards = opts.events.map((event) =>
    createEventCard({
      event,
      boot: opts.boot,
      featured: false,
      headingTag: opts.headingTag,
      nowMs: opts.nowMs,
      signal: opts.signal,
    }),
  );
  const list = h(
    'ul',
    { className: 'wg-live__event-list', attrs: { role: 'list', 'aria-labelledby': opts.labelledBy } },
    ...cards.map((card) => h('li', { className: 'wg-live__event-list-item' }, card.el)),
  );
  return {
    el: list,
    tick(nowMs: number): void {
      for (const card of cards) card.tick(nowMs);
    },
  };
}
