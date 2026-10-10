import { describe, expect, it } from 'vitest';
import { countdownText, formatEventDateTime } from '../../../src/util/time';

describe('formatEventDateTime', () => {
  it('formats Taipei time in zh-TW with the weekday and 台北時間', () => {
    const t = formatEventDateTime('2026-10-24T11:30:00Z', 'Asia/Taipei');
    expect(t.date).toBe('2026年10月24日（六）');
    expect(t.time).toBe('19:30');
    expect(t.zoneLabel).toBe('台北時間');
    expect(t.full).toBe('2026年10月24日（六）19:30 台北時間');
    expect(t.machine).toBe('2026-10-24T11:30:00Z');
  });

  it('rolls the date over in the event zone (midnight is 00:00, not 24:00)', () => {
    const t = formatEventDateTime('2026-10-23T16:00:00Z', 'Asia/Taipei');
    expect(t.date).toBe('2026年10月24日（六）');
    expect(t.time).toBe('00:00');
    expect(formatEventDateTime('2026-10-23T15:59:00Z', 'Asia/Taipei').full).toBe('2026年10月23日（五）23:59 台北時間');
  });

  it('keeps single-digit month/day unpadded and hours/minutes padded', () => {
    const t = formatEventDateTime('2027-01-03T00:05:00Z', 'Asia/Taipei');
    expect(t.full).toBe('2027年1月3日（日）08:05 台北時間');
  });

  it('uses the event zone, not the viewer zone, and labels other zones with the Intl short name', () => {
    const t = formatEventDateTime('2026-10-24T11:30:00Z', 'America/New_York');
    expect(t.date).toBe('2026年10月24日（六）');
    expect(t.time).toBe('07:30');
    expect(t.zoneLabel).not.toBe('台北時間');
    expect(t.zoneLabel).not.toBe('');
    expect(t.full).toBe(`2026年10月24日（六）07:30 ${t.zoneLabel}`);
    const utc = formatEventDateTime('2026-10-24T11:30:00Z', 'UTC');
    expect(utc.time).toBe('11:30');
    expect(utc.zoneLabel).toMatch(/UTC|GMT/);
  });

  it('falls back to Asia/Taipei for an unknown zone', () => {
    expect(formatEventDateTime('2026-10-24T11:30:00Z', 'Mars/Olympus').full).toBe('2026年10月24日（六）19:30 台北時間');
  });

  it('handles an invalid timestamp without throwing', () => {
    const t = formatEventDateTime('not a date', 'Asia/Taipei');
    expect(t.machine).toBe('');
    expect(t.date).toBe('');
    expect(t.full).toBe('時間待公布');
  });
});

describe('countdownText', () => {
  const target = '2026-10-24T11:30:00Z';
  const at = Date.parse(target);

  it('shows days, hours and minutes, skipping zero units', () => {
    expect(countdownText(target, at - (3 * 1440 + 4 * 60 + 12) * 60_000)).toBe('3 天 4 小時 12 分鐘');
    expect(countdownText(target, at - 1440 * 60_000)).toBe('1 天');
    expect(countdownText(target, at - (2 * 60 + 5) * 60_000)).toBe('2 小時 5 分鐘');
    expect(countdownText(target, at - 59 * 60_000)).toBe('59 分鐘');
  });

  it('works at minute granularity: any remaining seconds round up to a minute', () => {
    expect(countdownText(target, at - 30_000)).toBe('1 分鐘');
    expect(countdownText(target, at - 59.5 * 60_000)).toBe('1 小時');
    expect(countdownText(target, at - 60_001)).toBe('2 分鐘');
  });

  it('is null once the time has been reached or passed, or when invalid', () => {
    expect(countdownText(target, at)).toBeNull();
    expect(countdownText(target, at + 1)).toBeNull();
    expect(countdownText('nope', at)).toBeNull();
  });
});
