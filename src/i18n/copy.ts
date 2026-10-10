/**
 * Single entry point for all zh-TW UI copy (M1-PLAN section 2.1).
 * Views import from here; the per-area files are filled by their owners.
 */
import type { NotReadyReason, PlayerErrorCode } from '../types';
import { statusCopy } from './copy-status';

export { statusCopy, DEMO_EVENT_BADGE, DEMO_MEDIA_NOTICE } from './copy-status';
export { eventsCopy } from './copy-events';
export { playerCopy } from './copy-player';
export { helpCopy } from './copy-help';

/** User-facing message for a PlayerErrorCode. Generic: never a URL, token or stack. */
export function errorCopy(code: PlayerErrorCode): string {
  switch (code) {
    case 'network':
      return statusCopy.player.reconnecting;
    case 'decode':
    case 'unsupported':
      return statusCopy.player.unsupported;
    case 'not_configured':
      return statusCopy.gate.sourceNotConfigured.title;
    case 'not_entitled':
      return statusCopy.entitlement.notEntitled.message;
    case 'entitlement_unavailable':
      return statusCopy.entitlement.unavailable.message;
    case 'play_blocked':
      return statusCopy.player.playBlocked;
    case 'unknown':
      return statusCopy.player.failed;
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}

/**
 * Title of the `failed` state. A network error that used up its retries is no longer "reconnecting"
 * (nothing is retrying any more): the help page promises「無法播放，請重試」(plan 6.5, spec section 6).
 */
export function failedCopy(code: PlayerErrorCode): string {
  return code === 'network' ? statusCopy.player.failed : errorCopy(code);
}

/** UI message for a server not_ready reason (plan 6.7). */
export function notReadyCopy(reason: NotReadyReason): string {
  switch (reason) {
    case 'disabled':
      return statusCopy.gate.disabled.title;
    case 'source_not_configured':
      return statusCopy.gate.sourceNotConfigured.title;
    case 'event_not_found':
      return statusCopy.gate.eventNotFound.title;
    case 'mode_unavailable':
      return statusCopy.player.unsupported;
    case 'event_not_playable':
      // The caller shows the event-status copy (plan 6.7); this is the neutral fallback.
      return statusCopy.gate.doorsOpen.title;
    case 'not_entitled':
      return statusCopy.entitlement.notEntitled.message;
    case 'entitlement_unavailable':
      return statusCopy.entitlement.unavailable.message;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}
