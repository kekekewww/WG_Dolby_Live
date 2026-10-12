// The homepage featured card for the dist harness (dev/dist/home.html, stress-home.html).
//
// In WordPress this card is printed by plugin/wg-live/templates/featured.php (no JavaScript). The harness has
// no PHP, so this module renders the SAME markup (same elements, same class names, same attribute order) from
// the harness events. The PHP files stay the source of truth:
//   - every viewer-facing string and the weekday list are read from class-shortcodes.php at render time;
//   - tests/unit/featured-harness.test.ts compares the class names and the element structure with the template.
// Change the template first, then this file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './core.mjs';

const SHORTCODES_PHP = join(ROOT, 'plugin', 'wg-live', 'includes', 'class-shortcodes.php');

/** @param {string} raw */
const unquote = (raw) => raw.replace(/\\(['\\])/g, '$1');

/**
 * `const NAME = 'text';` constants plus the `const NAME = array( ... );` blocks of Shortcodes.
 * @returns {{ str: Record<string, string>, map: Record<string, Record<string, string>>, list: Record<string, string[]> }}
 */
export function readPhpCopy() {
  const source = readFileSync(SHORTCODES_PHP, 'utf8');
  /** @type {Record<string, string>} */
  const str = {};
  for (const m of source.matchAll(/^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/gm)) str[String(m[1])] = unquote(String(m[2]));
  /** @type {Record<string, Record<string, string>>} */
  const map = {};
  /** @type {Record<string, string[]>} */
  const list = {};
  for (const m of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*array\(([\s\S]*?)\);/g)) {
    const name = String(m[1]);
    const body = String(m[2]);
    const pairs = [...body.matchAll(/'((?:[^'\\]|\\.)*)'\s*=>\s*'((?:[^'\\]|\\.)*)'/g)];
    if (pairs.length > 0) map[name] = Object.fromEntries(pairs.map((p) => [unquote(String(p[1])), unquote(String(p[2]))]));
    else list[name] = [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((p) => unquote(String(p[1])));
  }
  return { str, map, list };
}

/** esc_html / esc_attr / esc_url for the harness (all values are harness data, but keep the habit). */
const esc = (/** @type {unknown} */ v) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

/** @param {string} iso @param {string} zone */
function calendar(iso, zone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const d = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayIndex = new Date(Date.UTC(Number(d.year), Number(d.month) - 1, Number(d.day))).getUTCDay();
  return { year: String(d.year), month: Number(d.month), day: Number(d.day), hh: String(d.hour).padStart(2, '0'), mm: String(d.minute).padStart(2, '0'), weekdayIndex };
}

/**
 * Mirrors Shortcodes::format_time() and Shortcodes::tile_parts().
 * @param {string} iso
 * @param {string} zone
 * @param {{ str: Record<string, string>, list: Record<string, string[]> }} copy
 */
export function timeParts(iso, zone, copy) {
  const c = calendar(iso, zone);
  if (!c) return { full: '', tile: null };
  const weekday = copy.list.WEEKDAYS?.[c.weekdayIndex] ?? '';
  const label = copy.str.TIME_ZONE_TAIPEI ?? '';
  return {
    full: `${c.year}年${c.month}月${c.day}日（${weekday}）${c.hh}:${c.mm} ${label}`,
    tile: { month: `${c.year}年${c.month}月`, day: String(c.day).padStart(2, '0'), when: `週${weekday} ${c.hh}:${c.mm}`, zone: label },
  };
}

/**
 * Mirrors Shortcodes::excerpt().
 * @param {string} text
 * @param {number} max
 */
export function excerpt(text, max) {
  const t = String(text).replace(/\s+/gu, ' ').trim();
  const chars = [...t];
  if (chars.length <= max) return t;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * Mirrors Shortcodes::primary_cta().
 * @param {{ slug: string, status: string, isDemo: boolean, sourceKind: string }} event
 * @param {{ events: string | null, player: string | null }} links
 * @param {Record<string, string>} str
 */
export function primaryCta(event, links, str) {
  const player = links.player ? `${links.player}?wg_event=${encodeURIComponent(event.slug)}` : null;
  if (event.status === 'cancelled' || event.status === 'ended') return { label: str.CTA_VIEW_DETAILS, href: links.events };
  if (event.isDemo && event.sourceKind === 'demo') return { label: str.CTA_DEMO, href: player };
  if (event.status === 'doors_open' || event.status === 'live' || event.status === 'intermission') return { label: str.CTA_ENTER, href: player };
  return { label: str.CTA_VIEW_EVENT, href: links.events };
}

/**
 * @typedef {{ url: string, width: number, height: number, alt: string, srcset: string | null, sizes: string | null }} Poster
 * @typedef {{ slug: string, title: string, description: string, startsAt: string, displayTimezone: string, status: string,
 *             isDemo: boolean, sourceKind: string, replayAvailable: boolean, poster: Poster | null }} FeaturedEvent
 */

/**
 * @param {{ state: 'disabled' | 'empty' | 'event', event?: FeaturedEvent | null,
 *           links: { events: string | null, player: string | null }, id?: string, heading?: 'h2' | 'h3' }} input
 * @returns {string} the markup templates/featured.php prints
 */
export function renderFeaturedCard({ state, event = null, links, id = 'wg-live-featured-1', heading = 'h2' }) {
  const copy = readPhpCopy();
  const { str } = copy;

  if (state !== 'event' || event === null) {
    const link =
      state === 'empty'
        ? `\n  <p class="wg-live-featured__actions"><a class="wg-live-featured__link" href="${esc(links.events)}">${esc(str.LINK_LIVE)}</a></p>`
        : '';
    return `<section class="wg-live-featured wg-live-featured--empty">\n  <p class="wg-live-featured__text">${esc(str.FEATURED_FALLBACK)}</p>${link}\n</section>`;
  }

  const titleId = `${id}-title`;
  const badgeId = `${id}-demo`;
  const labelledBy = titleId + (event.isDemo ? ` ${badgeId}` : '');
  const status = event.status;
  const time = timeParts(event.startsAt, event.displayTimezone, copy);
  const tile = time.tile;
  const variant = ['live', 'doors_open', 'intermission'].includes(status) ? 'live' : status === 'scheduled' ? 'scheduled' : 'over';
  const cta = primaryCta(event, links, str);
  const text = excerpt(event.description, 80);
  const poster = event.poster;
  const replayPending = status === 'ended' && event.replayAvailable ? str.REPLAY_PENDING : null;

  const demoPrefix = event.isDemo ? `${esc(str.DEMO_BADGE)} · ` : '';
  const demoNote = event.isDemo ? `\n        <span class="wg-live-featured__placeholder-note">${esc(str.POSTER_DEMO_NOTE)}</span>` : '';
  const posterHtml = poster
    ? `<img class="wg-live-featured__poster" src="${esc(poster.url)}" width="${esc(poster.width)}" height="${esc(poster.height)}" alt="${esc(poster.alt)}"${poster.srcset ? ` srcset="${esc(poster.srcset)}"` : ''}${poster.srcset && poster.sizes ? ` sizes="${esc(poster.sizes)}"` : ''} loading="lazy" decoding="async">`
    : `<div class="wg-live-featured__placeholder" aria-hidden="true">
        <span class="wg-live-featured__placeholder-bar"></span>
        <span class="wg-live-featured__placeholder-title">${demoPrefix}${esc(str.POSTER_BRAND)}</span>${demoNote}
      </div>`;

  const tileHtml = tile
    ? `
    <div class="wg-live-featured__tile wg-live-featured__tile--${variant}" aria-hidden="true">
      <span class="wg-live-featured__tile-month">${esc(tile.month)}</span>
      <span class="wg-live-featured__tile-day">${esc(tile.day)}</span>
      <span class="wg-live-featured__tile-when">${esc(tile.when)}</span>
      <span class="wg-live-featured__tile-zone">${esc(tile.zone)}</span>
    </div>`
    : '';

  const demoBadge = event.isDemo ? ` <span class="wg-live-featured__badge wg-live-featured__badge--demo" id="${esc(badgeId)}">${esc(str.DEMO_BADGE)}</span>` : '';
  const whenHtml =
    time.full !== ''
      ? `\n    <p class="wg-live-featured__when${tile ? ' wg-live-featured__visually-hidden' : ''}"><time class="wg-live-featured__time" datetime="${esc(event.startsAt)}">${esc(time.full)}</time></p>`
      : '';
  const textHtml = text !== '' ? `\n    <p class="wg-live-featured__text">${esc(text)}</p>` : '';
  const replayHtml = replayPending ? `\n    <p class="wg-live-featured__note">${esc(replayPending)}</p>` : '';
  const ctaHtml = cta.href
    ? `\n    <p class="wg-live-featured__actions"><a class="wg-live-featured__cta" href="${esc(cta.href)}" aria-describedby="${esc(titleId)}">${esc(cta.label)}</a></p>`
    : '';

  return `<section class="wg-live-featured wg-live-featured--event wg-live-featured--${esc(status)}" aria-labelledby="${esc(labelledBy)}">
  <div class="wg-live-featured__media">
    <div class="wg-live-featured__poster-frame">
      ${posterHtml}
    </div>${tileHtml}
  </div>
  <div class="wg-live-featured__body">
    <p class="wg-live-featured__meta"><span class="wg-live-featured__badge wg-live-featured__badge--status">${esc(copy.map.STATUS_LABELS?.[status] ?? '')}</span>${demoBadge}</p>
    <${heading} class="wg-live-featured__title" id="${esc(titleId)}">${esc(event.title)}</${heading}>${whenHtml}${textHtml}${replayHtml}${ctaHtml}
  </div>
</section>`;
}
