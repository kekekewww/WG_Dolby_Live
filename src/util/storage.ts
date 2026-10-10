import type { ListeningMode } from '../types';

/** The only thing we ever store: the last chosen listening mode (spec 5.2). Never entitlement, never tokens. */
const MODE_KEY = 'wg-live:mode';

export function readModePreference(): ListeningMode | null {
  try {
    const value = window.localStorage.getItem(MODE_KEY);
    return value === 'binaural' || value === 'atmos' ? value : null;
  } catch {
    // Private mode, blocked storage, or a SecurityError on access.
    return null;
  }
}

export function writeModePreference(mode: ListeningMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Quota exceeded or storage unavailable: the preference is a convenience only.
  }
}
