/**
 * Event time formatting in the event's own zone (plan 6.1), via Intl only.
 * Example: 2026年10月24日（六）19:30 台北時間
 */
import { statusCopy } from '../i18n/copy-status';

export interface FormattedEventTime {
  /** 2026年10月24日（六） */
  date: string;
  /** 19:30 (24-hour) */
  time: string;
  /** 台北時間, or the Intl short zone name (for example GMT+9) for other zones. */
  zoneLabel: string;
  /** date + time + zone label */
  full: string;
  /** ISO 8601 UTC for <time datetime>, for example 2026-10-24T11:30:00Z. Empty when the input is invalid. */
  machine: string;
}

const DEFAULT_ZONE = 'Asia/Taipei';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function resolveZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_ZONE;
  }
}

function zoneLabelFor(date: Date, timeZone: string): string {
  if (timeZone === 'Asia/Taipei') return statusCopy.time.taipei;
  try {
    const parts = new Intl.DateTimeFormat('zh-TW', { timeZone, timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export function formatEventDateTime(iso: string, timeZone: string): FormattedEventTime {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { date: '', time: '', zoneLabel: '', full: statusCopy.time.tbd, machine: '' };
  }
  const zone = resolveZone(timeZone);

  // en-US with h23 gives plain numeric parts regardless of the viewer's locale.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = num('year');
  const month = num('month');
  const day = num('day');
  const hour = num('hour') % 24;
  const minute = num('minute');

  // Weekday of the calendar date in the event zone (locale independent).
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  const dateText = `${year}年${month}月${day}日（${weekday}）`;
  const timeText = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const zoneLabel = zoneLabelFor(date, zone);

  return {
    date: dateText,
    time: timeText,
    zoneLabel,
    full: `${dateText}${timeText} ${zoneLabel}`,
    machine: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

/**
 * "3 天 4 小時 12 分鐘" until `iso`, at minute granularity (zero units are skipped), or null when
 * the time has passed or the input is invalid. Callers prefix their own sentence and must never
 * announce it to screen readers on every tick (plan 6.10).
 */
export function countdownText(iso: string, nowMs: number): string | null {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  const diff = target - nowMs;
  if (diff <= 0) return null;

  const totalMinutes = Math.ceil(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const u = statusCopy.time.units;

  const out: string[] = [];
  if (days > 0) out.push(`${days} ${u.day}`);
  if (hours > 0) out.push(`${hours} ${u.hour}`);
  if (minutes > 0) out.push(`${minutes} ${u.minute}`);
  return out.length > 0 ? out.join(' ') : u.lessThanMinute;
}
