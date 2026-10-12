/**
 * Date tile (docs/design/HYBRID.md, "From C"): month and year (small), the day as a big Karla
 * numeral, then the weekday, time and zone. Status variants: live or doors open is solid yellow,
 * scheduled is a Paper outline, ended or cancelled is a muted outline. The status text label is
 * always present on the card itself.
 *
 * The tile is decorative and redundant: it is aria-hidden because the card keeps its
 * `<time datetime>` text (which carries the full date for screen readers). Built with h() and
 * textContent only. The node has no listeners, so it can be rebuilt or dropped at any time.
 */
import { h } from '../dom';
import { eventsCopy } from '../i18n/copy';
import type { EventStatus } from '../types';
import { formatEventDateTime } from '../util/time';

export type DateTileSize = 'lg' | 'md' | 'sm';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function variantFor(status: EventStatus): 'live' | 'scheduled' | 'over' {
  switch (status) {
    case 'live':
    case 'doors_open':
    case 'intermission':
      return 'live';
    case 'scheduled':
      return 'scheduled';
    case 'ended':
    case 'cancelled':
      return 'over';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

interface TileParts {
  year: number;
  month: number;
  day: number;
  weekday: string;
}

/** Calendar parts of `iso` in `timeZone` (en-US numeric parts, so the viewer's locale cannot change them). */
function calendarParts(iso: string, timeZone: string): TileParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  }
  const num = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = num('year');
  const month = num('month');
  const day = num('day');
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  return { year, month, day, weekday };
}

export function createDateTile(iso: string, timeZone: string, status: EventStatus, size: DateTileSize): HTMLElement {
  const parts = calendarParts(iso, timeZone);
  const formatted = formatEventDateTime(iso, timeZone);
  const copy = eventsCopy.tile;

  const tile = h(
    'div',
    {
      className: `wg-live__date-tile wg-live__date-tile--${size} wg-live__date-tile--${variantFor(status)}`,
      attrs: { 'aria-hidden': 'true' },
      dataset: { tileStatus: status },
    },
    h('span', { className: 'wg-live__date-tile-month', text: parts ? copy.month(parts.year, parts.month) : '' }),
    h('span', { className: 'wg-live__date-tile-day', text: parts ? String(parts.day).padStart(2, '0') : '--' }),
    h('span', {
      className: 'wg-live__date-tile-when',
      text: parts ? `${copy.weekday(parts.weekday)} ${formatted.time}` : formatted.full,
    }),
    parts ? h('span', { className: 'wg-live__date-tile-zone', text: formatted.zoneLabel }) : null,
  );
  return tile;
}
