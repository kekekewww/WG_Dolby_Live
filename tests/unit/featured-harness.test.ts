/**
 * The dist harness homepage (dev/dist/home.html) cannot run PHP, so dev/featured-card.mjs prints the markup of
 * plugin/wg-live/templates/featured.php for the harness events. The template is the source of truth: this test
 * fails when the harness markup drifts from it (class names, element nesting, copy, the three states).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harnessEvents, harnessLinks, parseHarnessOptions } from '../../dev/core.mjs';
import { excerpt, readPhpCopy, renderFeaturedCard, timeParts } from '../../dev/featured-card.mjs';
import { DEFAULT_FEATURED_SLUG, featuredCardFor } from '../../dev/serve-dist.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const TEMPLATE = readFileSync(resolve(ROOT, 'plugin/wg-live/templates/featured.php'), 'utf8');
const links = harnessLinks('/dev/dist/');
const NOW = Date.parse('2026-10-12T10:00:00Z');
const events = harnessEvents(NOW);
const bySlug = (slug: string) => {
  const e = events.find((x) => x.slug === slug);
  if (!e) throw new Error(`no harness event ${slug}`);
  return e;
};

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

/** Class tokens of the template that are written out (not built by PHP at run time). */
function templateClasses(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const m of TEMPLATE.matchAll(/wg-live-featured[\w-]*/g)) {
    const token = m[0];
    // "wg-live-featured--<?php echo ... ?>" and "wg-live-featured__tile--<?php ...": the status / variant is appended by PHP.
    if (token.endsWith('--')) prefixes.push(token);
    else exact.add(token);
  }
  return { exact, prefixes };
}

function classesOf(doc: Document): Set<string> {
  const out = new Set<string>();
  for (const el of doc.querySelectorAll('[class]')) for (const c of el.classList) out.add(c);
  return out;
}

/** "tag.firstClass" and "parentTag.parentClass > tag.firstClass" for every element that has a class. */
function structureOf(root: Element): Set<string> {
  const out = new Set<string>();
  const label = (el: Element) => `${el.tagName.toLowerCase().replace(/^h[23]$/, 'h')}.${el.classList[0] ?? ''}`;
  for (const el of root.querySelectorAll('[class]')) {
    out.add(label(el));
    let parent = el.parentElement;
    while (parent && !parent.hasAttribute('class')) parent = parent.parentElement;
    if (parent && parent.tagName !== 'BODY') out.add(`${label(parent)} > ${label(el)}`);
  }
  return out;
}

/** The template with its PHP removed: the heading echo becomes <h>, class lists keep only their written tokens. */
function templateStructure(): Set<string> {
  const html = TEMPLATE.replace(/<\?php[\s\S]*?\?>/g, (php) => (/esc_html\( \$wg_heading \)/.test(php) ? 'HEADING' : ''))
    .replace(/<(\/?)HEADING/g, '<$1h')
    .replace(/<HEADING/g, '<h')
    .replace(/class="([^"]*)"/g, (_m, value: string) => `class="${value.trim().replace(/--$/, '')}"`);
  return structureOf(parse(html).body);
}

const WITH_POSTER = bySlug('demo-live-binaural-atmos');
const SQUARE_POSTER = bySlug('demo-scheduled');
const NO_POSTER = { ...bySlug('demo-ended'), replayAvailable: true };

describe('harness featured card = templates/featured.php', () => {
  it('prints only class names the template writes (or builds from a documented prefix)', () => {
    const { exact, prefixes } = templateClasses();
    expect(exact.size).toBeGreaterThan(20);
    for (const event of [WITH_POSTER, SQUARE_POSTER, NO_POSTER]) {
      const doc = parse(renderFeaturedCard({ state: 'event', event, links }));
      for (const c of classesOf(doc)) {
        const known = exact.has(c) || prefixes.some((p) => c.startsWith(p));
        expect(known, `class ${c} is not in templates/featured.php`).toBe(true);
      }
    }
  });

  it('prints every class the template writes (poster, placeholder, tile, replay note, CTA, empty state)', () => {
    const printed = new Set<string>();
    const add = (html: string) => {
      for (const c of classesOf(parse(html))) printed.add(c);
    };
    for (const event of [WITH_POSTER, SQUARE_POSTER, NO_POSTER]) add(renderFeaturedCard({ state: 'event', event, links }));
    add(renderFeaturedCard({ state: 'empty', links }));
    const missing = [...templateClasses().exact].filter((c) => !printed.has(c));
    expect(missing).toEqual([]);
  });

  it('nests the elements the way the template does', () => {
    const fromTemplate = templateStructure();
    expect(fromTemplate.size).toBeGreaterThan(20);
    expect(fromTemplate.has('div.wg-live-featured__poster-frame > img.wg-live-featured__poster')).toBe(true);
    const printed = new Set<string>();
    const add = (html: string) => {
      for (const s of structureOf(parse(html).body)) printed.add(s);
    };
    for (const event of [WITH_POSTER, NO_POSTER]) add(renderFeaturedCard({ state: 'event', event, links }));
    add(renderFeaturedCard({ state: 'empty', links }));
    const normalise = (set: Set<string>) =>
      new Set([...set].map((s) => s.replace(/wg-live-featured--[a-z_-]+/g, 'wg-live-featured--*').replace(/tile--[a-z]+/g, 'tile--*')));
    // The template's structure sentences use the written class only; compare as sets of "parent > child" pairs.
    expect([...normalise(fromTemplate)].filter((s) => !normalise(printed).has(s))).toEqual([]);
    expect([...normalise(printed)].filter((s) => !normalise(fromTemplate).has(s))).toEqual([]);
  });

  it('event card: labelled by the title (and the demo badge), poster, tile, status, one CTA', () => {
    const doc = parse(renderFeaturedCard({ state: 'event', event: WITH_POSTER, links, id: 'wg-live-featured-9' }));
    const card = doc.querySelector('section.wg-live-featured--event');
    expect(card?.className).toBe('wg-live-featured wg-live-featured--event wg-live-featured--live');
    expect(card?.getAttribute('aria-labelledby')).toBe('wg-live-featured-9-title wg-live-featured-9-demo');
    expect(doc.querySelector('h2#wg-live-featured-9-title')?.textContent).toBe(WITH_POSTER.title);
    expect(doc.querySelector('img.wg-live-featured__poster')?.getAttribute('loading')).toBe('lazy');
    expect(doc.querySelector('.wg-live-featured__tile')?.getAttribute('aria-hidden')).toBe('true');
    expect(doc.querySelector('.wg-live-featured__tile--live')).not.toBeNull();
    expect(doc.querySelector('.wg-live-featured__badge--status')?.textContent).toBe('演出中');
    expect(doc.querySelector('.wg-live-featured__badge--demo')?.textContent).toBe('介面示範');
    // The date stays readable for assistive technology while the tile shows it visually.
    expect(doc.querySelector('.wg-live-featured__when.wg-live-featured__visually-hidden time')?.getAttribute('datetime')).toBe(WITH_POSTER.startsAt);
    const ctas = doc.querySelectorAll('a.wg-live-featured__cta');
    expect(ctas).toHaveLength(1);
    expect(ctas[0]?.textContent).toBe('體驗播放介面');
    expect(ctas[0]?.getAttribute('href')).toBe('/dev/dist/listen.html?wg_event=demo-live-binaural-atmos');
  });

  it('a poster-less event shows the placeholder, never an empty block; ended links to the details; replay note shows', () => {
    const doc = parse(renderFeaturedCard({ state: 'event', event: NO_POSTER, links }));
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('.wg-live-featured__placeholder')?.getAttribute('aria-hidden')).toBe('true');
    expect(doc.querySelector('.wg-live-featured__placeholder-title')?.textContent).toBe('介面示範 · WG Studio Live');
    expect(doc.querySelector('.wg-live-featured__placeholder-note')?.textContent).toBe('操作示範，非正式演出');
    expect(doc.querySelector('.wg-live-featured__tile--over')).not.toBeNull();
    expect(doc.querySelector('.wg-live-featured__note')?.textContent).toBe('回放資訊待公布');
    expect(doc.querySelector('a.wg-live-featured__cta')?.textContent).toBe('查看活動資訊');
    expect(doc.querySelector('a.wg-live-featured__cta')?.getAttribute('href')).toBe('/dev/dist/index.html');
  });

  it('empty state (spec 16.2): the fallback sentence AND a link to Live; disabled: the text only', () => {
    const empty = parse(renderFeaturedCard({ state: 'empty', links })).querySelector('section');
    expect(empty?.className).toBe('wg-live-featured wg-live-featured--empty');
    expect(empty?.querySelector('.wg-live-featured__text')?.textContent).toBe('線上音樂會資訊即將公布');
    const link = empty?.querySelector('a.wg-live-featured__link');
    expect(link?.textContent).toBe('前往 Live');
    expect(link?.getAttribute('href')).toBe('/dev/dist/index.html');
    const disabled = parse(renderFeaturedCard({ state: 'disabled', links })).querySelector('section');
    expect(disabled?.className).toBe('wg-live-featured wg-live-featured--empty');
    expect(disabled?.textContent?.trim()).toBe('線上音樂會資訊即將公布');
    expect(disabled?.querySelector('a')).toBeNull();
  });

  it('the template gives the empty state its link and the disabled state none (source of truth)', () => {
    expect(TEMPLATE).toMatch(/'empty' === \$wg_state && ! empty\( \$args\['live_url'\] \)/);
    expect(TEMPLATE).toContain('wg-live-featured__link');
  });

  it('formats the date like Shortcodes::format_time()/tile_parts()', () => {
    const copy = readPhpCopy();
    // 2026-10-12 is a Monday; Asia/Taipei is UTC+8.
    const t = timeParts('2026-10-12T10:41:00Z', 'Asia/Taipei', copy);
    expect(t.full).toBe('2026年10月12日（一）18:41 台北時間');
    expect(t.tile).toEqual({ month: '2026年10月', day: '12', when: '週一 18:41', zone: '台北時間' });
    expect(timeParts('2026-10-04T16:30:00Z', 'Asia/Taipei', copy).tile?.day).toBe('05'); // crosses midnight in Taipei
    expect(timeParts('nope', 'Asia/Taipei', copy)).toEqual({ full: '', tile: null });
    expect(excerpt('字'.repeat(100), 80)).toHaveLength(80);
    expect(excerpt('短文', 80)).toBe('短文');
  });

  it('home.html variants: default = the live demo event, featured=none = empty, harness=disabled = text only', () => {
    const request = (search: string) => {
      const url = new URL(`http://localhost/dev/dist/home.html${search}`);
      return featuredCardFor(url, parseHarnessOptions(url.search, { pageBase: '/dev/dist/' }));
    };
    expect(DEFAULT_FEATURED_SLUG).toBe('demo-live-binaural-atmos');
    expect(request('')).toContain('wg-live-featured--event');
    expect(request('')).toContain('體驗播放介面');
    expect(request('?featured=demo-scheduled')).toContain('wg-live-featured--scheduled');
    expect(request('?featured=none')).toContain('wg-live-featured--empty');
    expect(request('?featured=none')).toContain('前往 Live');
    expect(request('?featured=no-such-event')).toContain('前往 Live');
    expect(request('?harness=disabled')).not.toContain('<a ');
    expect(request('?harness=disabled')).toContain('線上音樂會資訊即將公布');
  });
});
