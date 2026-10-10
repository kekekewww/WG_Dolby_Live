import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { demoEvents } from '../../../src/fixtures/demo-events';
import { eventsCopy } from '../../../src/i18n/copy-events';
import { DEMO_EVENT_BADGE, DEMO_MEDIA_NOTICE, statusCopy } from '../../../src/i18n/copy-status';
import type { BootConfig, EventStatus, PublicEvent } from '../../../src/types';
import { mountEventsView } from '../../../src/views/events';
import type { ViewContext, ViewInstance } from '../../../src/views/types';

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function makeEvent(overrides: Partial<PublicEvent> = {}): PublicEvent {
  const n = overrides.id ?? 1;
  return {
    id: n,
    slug: `event-${n}`,
    title: `Concert ${n}`,
    performers: ['Alice', 'Bob'],
    description: 'First paragraph.\nSecond paragraph.',
    startsAt: iso(NOW + 5 * DAY),
    displayTimezone: 'Asia/Taipei',
    status: 'scheduled',
    posterUrl: null,
    mediaKind: 'audio',
    availableModes: ['binaural', 'atmos'],
    programme: ['Song one', 'Song two'],
    productUrl: null,
    replayAvailable: false,
    isDemo: false,
    poster: null,
    sourceKind: 'not_configured',
    ...overrides,
  };
}

function makeBoot(overrides: Partial<BootConfig> = {}): BootConfig {
  return {
    schema: 1,
    pluginVersion: '0.1.0',
    view: 'events',
    deploymentMode: 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: 'https://sounds.example.com/wp-json/wg-live/v1/' },
    links: {
      home: 'https://sounds.example.com/',
      events: 'https://sounds.example.com/live/',
      player: 'https://sounds.example.com/live/listen/',
      help: 'https://sounds.example.com/live/help/',
      account: null,
      store: null,
      contact: null,
    },
    fixedEventSlug: null,
    featuredEventSlug: null,
    heading: 'h2',
    events: [],
    help: { faq: [], compatibility: [], supportNote: '' },
    devTools: false,
    ...overrides,
  };
}

let mount: HTMLElement;
let rootEl: HTMLElement;
let view: ViewInstance | null = null;

function mountView(boot: BootConfig): HTMLElement {
  const ctx: ViewContext = { root: rootEl, announce: vi.fn(), env: { volumeSettable: true } };
  view = mountEventsView(mount, boot, ctx);
  return mount;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  rootEl = document.createElement('div');
  rootEl.className = 'wg-live';
  mount = document.createElement('div');
  mount.className = 'wg-live__mount';
  rootEl.append(mount);
  document.body.append(rootEl);
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function cards(el: ParentNode = mount): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('article.wg-live__event-card'));
}

function cardBySlug(slug: string): HTMLElement {
  const card = mount.querySelector<HTMLElement>(`article[data-event-slug="${slug}"]`);
  if (!card) throw new Error(`card ${slug} not rendered`);
  return card;
}

function accessibleName(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

function ctaOf(card: HTMLElement): HTMLElement {
  const el = card.querySelector<HTMLElement>('.wg-live__btn--primary');
  if (!el) throw new Error('no primary CTA');
  return el;
}

describe('events view: structure (plan 6.1)', () => {
  it('shows the Live title, the 線上音樂會 subtitle and the intro as an h2 by default', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    const title = mount.querySelector('.wg-live__view-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Live');
    expect(mount.querySelector('.wg-live__view-subtitle')?.textContent).toBe('線上音樂會');
    expect(mount.querySelector('.wg-live__view-intro')?.textContent).toBe('以耳機或家庭劇院，聆聽維光音樂的現場演出。');
  });

  it('promotes the title to h1 when boot.heading is h1 and shifts the levels below it', () => {
    mountView(makeBoot({ heading: 'h1', events: [makeEvent(), makeEvent({ id: 2 })] }));
    expect(mount.querySelector('.wg-live__view-title')?.tagName).toBe('H1');
    expect(mount.querySelectorAll('h1')).toHaveLength(1);
    const sectionHeadings = Array.from(mount.querySelectorAll('.wg-live__events-section .wg-live__heading')).map((e) => e.tagName);
    expect(sectionHeadings).toHaveLength(4);
    expect(sectionHeadings.every((t) => t === 'H2')).toBe(true);
    expect(mount.querySelector('.wg-live__event-card-title')?.tagName).toBe('H3');
  });

  it('keeps h3 section headings and h4 card titles under the default h2', () => {
    mountView(makeBoot({ events: [makeEvent(), makeEvent({ id: 2 })] }));
    expect(mount.querySelector('.wg-live__featured > .wg-live__heading')?.tagName).toBe('H3');
    expect(mount.querySelector('.wg-live__event-card-title')?.tagName).toBe('H4');
  });

  it('orders the sections: featured, 聆聽方式, other events, FAQ summary', () => {
    mountView(makeBoot({ events: [makeEvent({ id: 1 }), makeEvent({ id: 2 })] }));
    const headings = Array.from(mount.querySelectorAll('.wg-live__events-section .wg-live__heading')).map((e) => e.textContent);
    expect(headings).toEqual([
      eventsCopy.featuredHeading,
      eventsCopy.guide.heading,
      eventsCopy.othersHeading,
      eventsCopy.faqHeading,
    ]);
    expect(eventsCopy.guide.heading).toBe('聆聽方式');
  });

  it('renders no skeleton leftovers and writes nothing through innerHTML', () => {
    mount.append(Object.assign(document.createElement('div'), { className: 'wg-live__skeleton' }));
    mountView(makeBoot({ events: [makeEvent()] }));
    expect(mount.querySelector('.wg-live__skeleton')).toBeNull();
  });

  it('is built without innerHTML, outerHTML or insertAdjacentHTML (D12)', () => {
    const files = [
      'src/views/events.ts',
      'src/views/help.ts',
      'src/components/event-card.ts',
      'src/components/event-list.ts',
      'src/components/listening-guide.ts',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    }
  });
});

describe('events view: featured selection and sorting', () => {
  const live = makeEvent({ id: 1, status: 'live', startsAt: iso(NOW - 10 * MIN), sourceKind: 'demo', isDemo: true });
  const later = makeEvent({ id: 2, startsAt: iso(NOW + 10 * DAY) });
  const sooner = makeEvent({ id: 3, startsAt: iso(NOW + 2 * DAY) });
  const endedRecent = makeEvent({ id: 4, status: 'ended', startsAt: iso(NOW - 2 * DAY) });
  const endedOld = makeEvent({ id: 5, status: 'ended', startsAt: iso(NOW - 20 * DAY) });
  const cancelled = makeEvent({ id: 6, status: 'cancelled', startsAt: iso(NOW + 1 * DAY) });

  it('uses the settings featured event when it is public', () => {
    mountView(makeBoot({ events: [later, sooner], featuredEventSlug: 'event-2' }));
    const featured = mount.querySelector('.wg-live__featured article') as HTMLElement;
    expect(featured.dataset.eventSlug).toBe('event-2');
    expect(featured.classList.contains('wg-live__event-card--featured')).toBe(true);
    expect(cards(mount.querySelector('.wg-live__others') as HTMLElement).map((c) => c.dataset.eventSlug)).toEqual(['event-3']);
  });

  it('falls back to the earliest event that is neither ended nor cancelled', () => {
    mountView(makeBoot({ events: [endedRecent, cancelled, later, sooner], featuredEventSlug: 'not-here' }));
    const featured = mount.querySelector('.wg-live__featured article') as HTMLElement;
    expect(featured.dataset.eventSlug).toBe('event-3');
  });

  it('lists upcoming events ascending, then ended and cancelled ones descending', () => {
    mountView(makeBoot({ events: [endedOld, later, cancelled, endedRecent, sooner, live], featuredEventSlug: 'event-1' }));
    const others = cards(mount.querySelector('.wg-live__others') as HTMLElement).map((c) => c.dataset.eventSlug);
    // Upcoming (not ended, not cancelled) ascending: 3, 2. Then ended and cancelled by startsAt descending: 6, 4, 5.
    expect(others).toEqual(['event-3', 'event-2', 'event-6', 'event-4', 'event-5']);
  });

  it('shows no filler cards and no "other events" section for a single event', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    expect(cards()).toHaveLength(1);
    expect(mount.querySelector('.wg-live__others')).toBeNull();
  });

  it('renders every event exactly once', () => {
    const events = demoEvents(NOW);
    mountView(makeBoot({ events, featuredEventSlug: events[0]?.slug ?? null }));
    expect(cards()).toHaveLength(events.length);
    expect(new Set(cards().map((c) => c.dataset.eventSlug)).size).toBe(events.length);
  });
});

describe('events view: empty and disabled states', () => {
  it('shows the empty state copy and a help link when there are no events', () => {
    mountView(makeBoot({ events: [] }));
    expect(mount.textContent).toContain('目前沒有已公布的線上音樂會');
    expect(mount.textContent).toContain('線上音樂會資訊即將公布');
    const help = mount.querySelector<HTMLAnchorElement>('.wg-live__panel--empty a');
    expect(help?.getAttribute('href')).toBe('https://sounds.example.com/live/help/');
    expect(cards()).toHaveLength(0);
    expect(mount.querySelector('.wg-live__faq')).toBeNull();
  });

  it('omits the help link in the empty state when no help page is bound', () => {
    mountView(makeBoot({ events: [], links: { ...makeBoot().links, help: null } }));
    expect(mount.querySelector('.wg-live__panel--empty a')).toBeNull();
  });

  it('disabled mode shows 線上音樂會尚未開放 with home and contact links, and no events', () => {
    mountView(
      makeBoot({
        deploymentMode: 'disabled',
        events: [makeEvent()], // must not leak even if the server sent one
        links: { ...makeBoot().links, contact: 'mailto:hello@example.com' },
      }),
    );
    expect(mount.textContent).toContain('線上音樂會尚未開放');
    const hrefs = Array.from(mount.querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://sounds.example.com/', 'mailto:hello@example.com']);
    expect(cards()).toHaveLength(0);
    expect(mount.querySelector('.wg-live__featured')).toBeNull();
    expect(mount.querySelector('.wg-live__guide')).toBeNull();
  });

  it('disabled mode without a contact link shows the home link only', () => {
    mountView(makeBoot({ deploymentMode: 'disabled' }));
    expect(mount.querySelectorAll('a')).toHaveLength(1);
  });
});

describe('events view: card fields', () => {
  it('shows the title, performers, date with zone, status badge and modes', () => {
    const event = makeEvent({ startsAt: '2026-10-24T11:30:00Z', status: 'scheduled' });
    mountView(makeBoot({ events: [event] }));
    const card = cardBySlug('event-1');
    expect(card.querySelector('.wg-live__event-card-title-text')?.textContent).toBe('Concert 1');
    expect(card.querySelector('.wg-live__event-card-performers')?.textContent).toBe('演出者：Alice、Bob');
    const time = card.querySelector('time');
    expect(time?.textContent).toBe('2026年10月24日（六）19:30 台北時間');
    expect(time?.getAttribute('datetime')).toBe('2026-10-24T11:30:00Z');
    expect(card.querySelector('.wg-live__event-card-status')?.textContent).toBe('尚未開始');
    expect(Array.from(card.querySelectorAll('.wg-live__event-card-mode')).map((e) => e.textContent)).toEqual([
      '耳機 Binaural',
      '家庭劇院 Dolby Atmos',
    ]);
  });

  it('shows a text status badge for every status', () => {
    const statuses: EventStatus[] = ['scheduled', 'doors_open', 'live', 'intermission', 'ended', 'cancelled'];
    const events = statuses.map((status, i) => makeEvent({ id: i + 1, status }));
    mountView(makeBoot({ events, featuredEventSlug: 'event-1' }));
    for (const [i, status] of statuses.entries()) {
      const badge = cardBySlug(`event-${i + 1}`).querySelector('.wg-live__event-card-status');
      expect(badge?.textContent, status).toBe(statusCopy.eventStatus[status]);
    }
    expect(statusCopy.eventStatus.live).toBe('演出中');
  });

  it('shows 聆聽模式即將公布 when no mode is available, and one chip for a single mode', () => {
    mountView(
      makeBoot({
        events: [makeEvent({ id: 1, availableModes: [] }), makeEvent({ id: 2, availableModes: ['binaural'] })],
        featuredEventSlug: 'event-1',
      }),
    );
    expect(cardBySlug('event-1').textContent).toContain('聆聽模式即將公布');
    expect(cardBySlug('event-1').querySelector('.wg-live__event-card-mode')).toBeNull();
    expect(cardBySlug('event-2').querySelectorAll('.wg-live__event-card-mode')).toHaveLength(1);
    expect(cardBySlug('event-2').textContent).not.toContain('聆聽模式即將公布');
  });

  it('renders no performers label when there are no performers', () => {
    mountView(makeBoot({ events: [makeEvent({ performers: [] })] }));
    expect(cardBySlug('event-1').querySelector('.wg-live__event-card-performers')).toBeNull();
    expect(cardBySlug('event-1').textContent).not.toContain('演出者');
  });

  it('puts the 介面示範 badge inside the accessible name of demo events only', () => {
    mountView(
      makeBoot({
        events: [makeEvent({ id: 1, isDemo: true, title: 'Demo concert' }), makeEvent({ id: 2, title: 'Real concert' })],
        featuredEventSlug: 'event-1',
      }),
    );
    const demo = cardBySlug('event-1');
    expect(accessibleName(demo)).toContain('Demo concert');
    expect(accessibleName(demo)).toContain(DEMO_EVENT_BADGE);
    expect(DEMO_EVENT_BADGE).toBe('介面示範');
    const real = cardBySlug('event-2');
    expect(accessibleName(real)).toBe('Real concert');
    expect(real.textContent).not.toContain(DEMO_EVENT_BADGE);
  });

  it('keeps hostile text as text (no markup from titles, performers, descriptions or programme)', () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    mountView(
      makeBoot({
        events: [makeEvent({ title: evil, performers: [evil], description: evil, programme: [evil] })],
      }),
    );
    expect(mount.querySelector('img')).toBeNull();
    expect(mount.querySelector('script')).toBeNull();
    expect(cardBySlug('event-1').querySelector('.wg-live__event-card-title-text')?.textContent).toBe(evil);
    expect(mount.querySelector('[onerror]')).toBeNull();
  });
});

describe('events view: poster', () => {
  const poster = {
    url: 'https://sounds.example.com/wp-content/uploads/poster.jpg',
    width: 1200,
    height: 675,
    alt: '海報：Concert',
    srcset: 'https://sounds.example.com/wp-content/uploads/poster-600.jpg 600w, https://sounds.example.com/wp-content/uploads/poster.jpg 1200w',
    sizes: '(min-width: 768px) 45vw, 100vw',
  };

  it('renders width, height, alt, srcset and sizes; featured is eager, others are lazy', () => {
    mountView(
      makeBoot({
        events: [makeEvent({ id: 1, poster, posterUrl: poster.url }), makeEvent({ id: 2, poster, posterUrl: poster.url })],
        featuredEventSlug: 'event-1',
      }),
    );
    const featured = cardBySlug('event-1').querySelector('img') as HTMLImageElement;
    const other = cardBySlug('event-2').querySelector('img') as HTMLImageElement;
    for (const img of [featured, other]) {
      expect(img.getAttribute('width')).toBe('1200');
      expect(img.getAttribute('height')).toBe('675');
      expect(img.getAttribute('alt')).toBe('海報：Concert');
      expect(img.getAttribute('srcset')).toContain('poster-600.jpg 600w');
      expect(img.getAttribute('sizes')).toBe('(min-width: 768px) 45vw, 100vw');
      expect(img.getAttribute('decoding')).toBe('async');
    }
    expect(featured.getAttribute('loading')).toBe('eager');
    expect(other.getAttribute('loading')).toBe('lazy');
  });

  it('reserves a 16:9 box with empty alt when only a poster URL is known', () => {
    mountView(makeBoot({ events: [makeEvent({ posterUrl: 'https://sounds.example.com/p.jpg', poster: null })] }));
    const img = cardBySlug('event-1').querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('1600');
    expect(img.getAttribute('height')).toBe('900');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('renders no image for events without a poster, and drops a poster whose URL is unsafe', () => {
    mountView(
      makeBoot({
        events: [
          makeEvent({ id: 1, poster: null, posterUrl: null }),
          makeEvent({ id: 2, poster: { ...poster, url: 'javascript:alert(1)' } }),
        ],
        featuredEventSlug: 'event-1',
      }),
    );
    expect(cardBySlug('event-1').querySelector('img')).toBeNull();
    expect(cardBySlug('event-2').querySelector('img')).toBeNull();
    expect(cardBySlug('event-2').classList.contains('wg-live__event-card--has-media')).toBe(false);
  });
});

describe('events view: primary CTA per status (plan 6.1 table)', () => {
  it('live: 進入聆聽 links to the player with wg_event', () => {
    mountView(makeBoot({ events: [makeEvent({ status: 'live' })] }));
    const cta = ctaOf(cardBySlug('event-1'));
    expect(cta.tagName).toBe('A');
    expect(cta.textContent).toBe('進入聆聽');
    expect(cta.getAttribute('href')).toContain('/live/listen/');
    expect(cta.getAttribute('href')).toContain('wg_event=event-1');
  });

  it.each(['doors_open', 'intermission'] as const)('%s: 進入聆聽', (status) => {
    mountView(makeBoot({ events: [makeEvent({ status })] }));
    expect(ctaOf(cardBySlug('event-1')).textContent).toBe('進入聆聽');
  });

  it('demo event with a demo source: 體驗播放介面 (also while scheduled)', () => {
    mountView(makeBoot({ events: [makeEvent({ status: 'scheduled', isDemo: true, sourceKind: 'demo' })] }));
    const cta = ctaOf(cardBySlug('event-1'));
    expect(cta.tagName).toBe('A');
    expect(cta.textContent).toBe('體驗播放介面');
    expect(cta.getAttribute('href')).toContain('wg_event=event-1');
  });

  it('scheduled: 查看活動 expands the details instead of navigating', () => {
    mountView(makeBoot({ events: [makeEvent({ status: 'scheduled' })] }));
    const card = cardBySlug('event-1');
    const cta = ctaOf(card);
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.textContent).toBe('查看活動');
    expect(cta.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(cta.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(panel.hidden).toBe(true);
    cta.click();
    expect(cta.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(Array.from(panel.querySelectorAll('.wg-live__event-details-text')).map((p) => p.textContent)).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
    expect(panel.textContent).toContain('Song one');
    cta.click();
    expect(cta.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('ended: 查看活動資訊 expands; no replay button, and the replay text only when replayAvailable', () => {
    mountView(
      makeBoot({
        events: [makeEvent({ id: 1, status: 'ended' }), makeEvent({ id: 2, status: 'ended', replayAvailable: true })],
        featuredEventSlug: 'event-1',
      }),
    );
    for (const slug of ['event-1', 'event-2']) {
      const card = cardBySlug(slug);
      const cta = ctaOf(card);
      expect(cta.tagName).toBe('BUTTON');
      expect(cta.textContent).toBe('查看活動資訊');
      cta.click();
      expect(card.querySelector('a[href*="wg_event"]')).toBeNull();
      expect(card.textContent).not.toMatch(/回放(連結|播放|觀看)|觀看回放/);
    }
    expect(cardBySlug('event-1').textContent).not.toContain('回放資訊待公布');
    expect(cardBySlug('event-2').textContent).toContain('回放資訊待公布');
    expect(cardBySlug('event-2').querySelectorAll('a')).toHaveLength(0);
  });

  it('cancelled: 查看活動資訊 expands the cancellation notice with a contact link', () => {
    mountView(
      makeBoot({
        events: [makeEvent({ status: 'cancelled' })],
        links: { ...makeBoot().links, contact: 'https://sounds.example.com/contact/' },
      }),
    );
    const card = cardBySlug('event-1');
    const cta = ctaOf(card);
    expect(cta.textContent).toBe('查看活動資訊');
    cta.click();
    const panel = document.getElementById(cta.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('本場活動已取消');
    const contact = panel.querySelector<HTMLAnchorElement>('a');
    expect(contact?.getAttribute('href')).toBe('https://sounds.example.com/contact/');
    expect(contact?.textContent).toBe('聯絡我們');
  });

  it('cancelled without a contact link shows the notice without a link', () => {
    mountView(makeBoot({ events: [makeEvent({ status: 'cancelled' })] }));
    const card = cardBySlug('event-1');
    ctaOf(card).click();
    expect(card.textContent).toContain('本場活動已取消');
    expect(card.querySelectorAll('.wg-live__event-details a')).toHaveLength(0);
  });

  it('link CTAs get a secondary 活動簡介 toggle so the description stays reachable', () => {
    mountView(makeBoot({ events: [makeEvent({ status: 'live' })] }));
    const card = cardBySlug('event-1');
    const toggle = card.querySelector<HTMLButtonElement>('.wg-live__btn--ghost.wg-live__event-card-toggle');
    expect(toggle?.textContent).toBe('活動簡介');
    const panel = document.getElementById(toggle?.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(panel.hidden).toBe(true);
    toggle?.click();
    expect(panel.hidden).toBe(false);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('falls back to the details toggle when the player page is not bound', () => {
    mountView(makeBoot({ links: { ...makeBoot().links, player: null }, events: [makeEvent({ status: 'live' })] }));
    const cta = ctaOf(cardBySlug('event-1'));
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.getAttribute('aria-expanded')).toBe('false');
  });

  it('gives each CTA a distinct accessible name that starts with its visible label', () => {
    mountView(makeBoot({ events: [makeEvent({ id: 1, status: 'live' }), makeEvent({ id: 2, status: 'live' })], featuredEventSlug: 'event-1' }));
    const a = ctaOf(cardBySlug('event-1')).getAttribute('aria-label');
    const b = ctaOf(cardBySlug('event-2')).getAttribute('aria-label');
    expect(a).toBe('進入聆聽：Concert 1');
    expect(b).toBe('進入聆聽：Concert 2');
  });
});

describe('events view: secondary CTAs', () => {
  const links = { ...makeBoot().links, account: 'https://sounds.example.com/my-account/' };

  it('shows 購票 and 登入 only when their links exist', () => {
    mountView(
      makeBoot({
        links,
        events: [makeEvent({ id: 1, productUrl: 'https://sounds.example.com/product/ticket/' }), makeEvent({ id: 2 })],
        featuredEventSlug: 'event-1',
      }),
    );
    const withProduct = cardBySlug('event-1');
    expect(withProduct.querySelector('.wg-live__event-card-buy')?.getAttribute('href')).toBe('https://sounds.example.com/product/ticket/');
    expect(withProduct.querySelector('.wg-live__event-card-buy')?.textContent).toBe('購票');
    expect(withProduct.querySelector('.wg-live__event-card-login')?.getAttribute('href')).toBe('https://sounds.example.com/my-account/');
    expect(withProduct.querySelector('.wg-live__event-card-login')?.textContent).toBe('登入');
    const without = cardBySlug('event-2');
    expect(without.querySelector('.wg-live__event-card-buy')).toBeNull();
    expect(without.querySelector('.wg-live__event-card-login')).not.toBeNull();
  });

  it('shows neither when no link exists, and never invents a ticket or login claim', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    const card = cardBySlug('event-1');
    expect(card.querySelector('.wg-live__event-card-buy')).toBeNull();
    expect(card.querySelector('.wg-live__event-card-login')).toBeNull();
    expect(card.textContent).not.toMatch(/已購票|已登入|已取得/);
  });

  it('does not offer 購票 or 登入 on ended or cancelled events', () => {
    mountView(
      makeBoot({
        links,
        events: [
          makeEvent({ id: 1, status: 'ended', productUrl: 'https://sounds.example.com/product/ticket/' }),
          makeEvent({ id: 2, status: 'cancelled', productUrl: 'https://sounds.example.com/product/ticket/' }),
        ],
        featuredEventSlug: 'event-1',
      }),
    );
    expect(mount.querySelector('.wg-live__event-card-buy')).toBeNull();
    expect(mount.querySelector('.wg-live__event-card-login')).toBeNull();
  });

  it('drops a product URL that is not http(s)', () => {
    mountView(makeBoot({ events: [makeEvent({ productUrl: 'javascript:alert(1)' })] }));
    expect(cardBySlug('event-1').querySelector('.wg-live__event-card-buy')).toBeNull();
    expect(mount.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('events view: demo notice', () => {
  it('shows the demo media notice in the details of demo events with a demo source', () => {
    mountView(makeBoot({ events: [makeEvent({ isDemo: true, sourceKind: 'demo', status: 'live' })] }));
    expect(cardBySlug('event-1').querySelector('.wg-live__event-details')?.textContent).toContain(DEMO_MEDIA_NOTICE);
    expect(DEMO_MEDIA_NOTICE).toBe('操作示範音訊，非 Binaural／Atmos 驗證素材');
  });

  it('makes no capability claims anywhere on the page', () => {
    mountView(makeBoot({ events: demoEvents(NOW), featuredEventSlug: 'demo-live-binaural-atmos' }));
    expect(mount.textContent).not.toMatch(/已認證|認證|7\.1\.4|已連線|全部設備|所有設備|頻譜|觀眾人數/);
  });
});

describe('events view: countdown', () => {
  it('shows the remaining time for scheduled events as plain text, not a live region', () => {
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + 3 * DAY + 4 * 60 * MIN + 12 * MIN) })] }));
    const countdown = mount.querySelector('.wg-live__event-card-countdown') as HTMLElement;
    expect(countdown.hidden).toBe(false);
    expect(countdown.textContent).toBe('距離開始：3 天 4 小時 12 分鐘');
    expect(countdown.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(countdown.hasAttribute('aria-live')).toBe(false);
  });

  it('has no countdown for live, ended or cancelled events', () => {
    mountView(
      makeBoot({
        events: [makeEvent({ id: 1, status: 'live' }), makeEvent({ id: 2, status: 'ended' }), makeEvent({ id: 3, status: 'cancelled' })],
        featuredEventSlug: 'event-1',
      }),
    );
    expect(mount.querySelector('.wg-live__event-card-countdown')).toBeNull();
  });

  it('updates in place on the minute tick without rebuilding the card', () => {
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + 10 * MIN) })] }));
    const card = cardBySlug('event-1');
    const countdown = card.querySelector('.wg-live__event-card-countdown') as HTMLElement;
    expect(countdown.textContent).toBe('距離開始：10 分鐘');
    vi.advanceTimersByTime(3 * MIN);
    expect(countdown.textContent).toBe('距離開始：7 分鐘');
    expect(cardBySlug('event-1')).toBe(card);
    expect(card.querySelector('.wg-live__event-card-countdown')).toBe(countdown);
  });

  it('keeps the expanded state when the countdown updates', () => {
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + 10 * MIN) })] }));
    const cta = ctaOf(cardBySlug('event-1'));
    cta.click();
    vi.advanceTimersByTime(2 * MIN);
    expect(cta.getAttribute('aria-expanded')).toBe('true');
  });

  it('hides the countdown once the start time has passed', () => {
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + 2 * MIN) })] }));
    const countdown = mount.querySelector('.wg-live__event-card-countdown') as HTMLElement;
    vi.advanceTimersByTime(5 * MIN);
    expect(countdown.hidden).toBe(true);
    expect(countdown.textContent).toBe('');
  });

  it('stops its timer on destroy, and when the root leaves the document', () => {
    const clear = vi.spyOn(window, 'clearInterval');
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + DAY) })] }));
    expect(vi.getTimerCount()).toBe(1);
    view?.destroy();
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    view = null;

    mount.replaceChildren();
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + DAY) })] }));
    expect(vi.getTimerCount()).toBe(1);
    rootEl.remove(); // Elementor re-render: the root is detached
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(mount.querySelector('.wg-live__events')).toBeNull();
  });

  it('starts no timer when no event is scheduled', () => {
    mountView(makeBoot({ events: [makeEvent({ status: 'live' })] }));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('events view: FAQ summary', () => {
  it('shows the first three admin FAQ entries with a help link', () => {
    const faq = [1, 2, 3, 4].map((n) => ({ question: `Q${n}`, answer: `A${n}\nline two` }));
    mountView(makeBoot({ events: [makeEvent()], help: { faq, compatibility: [], supportNote: '' } }));
    const questions = Array.from(mount.querySelectorAll('.wg-live__faq-question')).map((e) => e.textContent);
    expect(questions).toEqual(['Q1', 'Q2', 'Q3']);
    expect(mount.querySelectorAll('.wg-live__faq-item')).toHaveLength(3);
    expect(mount.querySelectorAll('.wg-live__faq-item')[0]?.querySelectorAll('.wg-live__faq-answer p')).toHaveLength(2);
    expect(mount.querySelector('.wg-live__faq-more')?.getAttribute('href')).toBe('https://sounds.example.com/live/help/');
  });

  it('falls back to the fixed defaults when the admin FAQ is empty', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    const questions = Array.from(mount.querySelectorAll('.wg-live__faq-question')).map((e) => e.textContent);
    expect(questions).toEqual(eventsCopy.defaultFaq.map((item) => item.question));
    expect(questions).toHaveLength(3);
  });

  it('uses native details/summary so it works without script', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    const item = mount.querySelector('.wg-live__faq-item') as HTMLDetailsElement;
    expect(item.tagName).toBe('DETAILS');
    expect(item.querySelector('summary')).not.toBeNull();
  });
});

describe('events view: listening guide', () => {
  it('explains both modes with the spec strings and links to the help page', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    const guide = mount.querySelector('.wg-live__guide') as HTMLElement;
    expect(guide.textContent).toContain('耳機聆聽 · Binaural');
    expect(guide.textContent).toContain('使用耳機聆聽錄音室製作的雙耳版本。');
    expect(guide.textContent).toContain('家庭劇院 · Dolby Atmos');
    expect(guide.textContent).toContain('選用 Atmos 音軌不等於系統已確認最終設備輸出。');
    expect(guide.querySelector('a')?.getAttribute('href')).toBe('https://sounds.example.com/live/help/');
  });

  it('omits the help link when there is no help page', () => {
    mountView(makeBoot({ events: [makeEvent()], links: { ...makeBoot().links, help: null } }));
    expect(mount.querySelector('.wg-live__guide a')).toBeNull();
  });
});

describe('events view: lifecycle', () => {
  it('destroy removes its DOM and is idempotent', () => {
    mountView(makeBoot({ events: [makeEvent()] }));
    expect(mount.querySelector('.wg-live__events')).not.toBeNull();
    view?.destroy();
    view?.destroy();
    expect(mount.querySelector('.wg-live__events')).toBeNull();
  });

  it('refresh() does not rebuild the DOM', () => {
    mountView(makeBoot({ events: [makeEvent({ startsAt: iso(NOW + DAY) })] }));
    const card = cardBySlug('event-1');
    view?.refresh?.();
    expect(cardBySlug('event-1')).toBe(card);
  });

  it('mounting again into the same element replaces the content (no duplicate cards)', () => {
    const boot = makeBoot({ events: [makeEvent()] });
    mountView(boot);
    view?.destroy();
    mountView(boot);
    expect(cards()).toHaveLength(1);
  });
});
