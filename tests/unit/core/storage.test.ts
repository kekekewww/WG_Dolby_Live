import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readModePreference, writeModePreference } from '../../../src/util/storage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mode preference storage', () => {
  it('round-trips the two valid modes under wg-live:mode', () => {
    expect(readModePreference()).toBeNull();
    writeModePreference('atmos');
    expect(window.localStorage.getItem('wg-live:mode')).toBe('atmos');
    expect(readModePreference()).toBe('atmos');
    writeModePreference('binaural');
    expect(readModePreference()).toBe('binaural');
  });

  it('ignores corrupt stored values', () => {
    window.localStorage.setItem('wg-live:mode', 'surround');
    expect(readModePreference()).toBeNull();
    window.localStorage.setItem('wg-live:mode', '');
    expect(readModePreference()).toBeNull();
  });

  it('returns null when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readModePreference()).toBeNull();
  });

  it('returns null when merely touching localStorage throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readModePreference()).toBeNull();
    expect(() => writeModePreference('atmos')).not.toThrow();
  });

  it('swallows setItem failures such as a full quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => writeModePreference('binaural')).not.toThrow();
  });
});
