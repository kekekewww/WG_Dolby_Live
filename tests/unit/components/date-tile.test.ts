import { describe, expect, it } from 'vitest';
import { createDateTile } from '../../../src/components/date-tile';
import type { EventStatus } from '../../../src/types';

const ISO = '2026-10-24T11:30:00Z'; // Saturday 19:30 in Taipei

describe('date tile', () => {
  it('shows month and year, a two-digit day, weekday and time, and the zone label', () => {
    const tile = createDateTile(ISO, 'Asia/Taipei', 'scheduled', 'sm');
    expect(tile.querySelector('.wg-live__date-tile-month')?.textContent).toBe('2026年10月');
    expect(tile.querySelector('.wg-live__date-tile-day')?.textContent).toBe('24');
    expect(tile.querySelector('.wg-live__date-tile-when')?.textContent).toBe('週六 19:30');
    expect(tile.querySelector('.wg-live__date-tile-zone')?.textContent).toBe('台北時間');
  });

  it('pads single-digit days and uses the event zone for the calendar date', () => {
    const tile = createDateTile('2026-10-04T18:30:00Z', 'Asia/Taipei', 'ended', 'sm'); // already 5 Oct in Taipei
    expect(tile.querySelector('.wg-live__date-tile-day')?.textContent).toBe('05');
    expect(tile.querySelector('.wg-live__date-tile-when')?.textContent).toBe('週一 02:30');
  });

  it('is decorative: aria-hidden, no focusable content', () => {
    const tile = createDateTile(ISO, 'Asia/Taipei', 'live', 'lg');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('a, button, [tabindex]')).toBeNull();
  });

  it.each<[EventStatus, string]>([
    ['live', 'live'],
    ['doors_open', 'live'],
    ['intermission', 'live'],
    ['scheduled', 'scheduled'],
    ['ended', 'over'],
    ['cancelled', 'over'],
  ])('status %s uses the %s variant', (status, variant) => {
    const tile = createDateTile(ISO, 'Asia/Taipei', status, 'md');
    expect(tile.classList.contains(`wg-live__date-tile--${variant}`)).toBe(true);
    expect(tile.classList.contains('wg-live__date-tile--md')).toBe(true);
  });

  it('survives an invalid date and an unknown zone without throwing', () => {
    expect(() => createDateTile('not a date', 'Asia/Taipei', 'scheduled', 'sm')).not.toThrow();
    const tile = createDateTile(ISO, 'Mars/Olympus', 'scheduled', 'sm');
    expect(tile.querySelector('.wg-live__date-tile-day')?.textContent).toBe('24');
  });
});
