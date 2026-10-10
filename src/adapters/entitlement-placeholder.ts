import type { EntitlementProvider, EntitlementResult, PublicEvent } from '../types';

export type EntitlementOverride = EntitlementResult['status'];

export interface EntitlementPlaceholder extends EntitlementProvider {
  /**
   * Dev panel only: replace the displayed result for DEMO events. null restores the default rule.
   * It changes the client display and nothing else; it is never sent to the server, and the server
   * decides playback by itself (plan D6).
   */
  setOverride(status: EntitlementOverride | null): void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Client mirror of the M1 server rule (plan D6, WG_Live\Entitlement::check):
 *   - a demo event whose source is the demo source -> entitled
 *   - any other known event                        -> unavailable ('not_implemented'): real ticket checks are M2
 *   - an unknown event id                          -> unavailable ('event_not_found')
 * Nothing here ever grants access to a real (non-demo) event, and an override is honoured for
 * demo events only. No fail-open path: anything unexpected is 'unavailable'.
 */
export function createEntitlementPlaceholder(events: PublicEvent[]): EntitlementPlaceholder {
  const byId = new Map<number, PublicEvent>();
  for (const event of events) byId.set(event.id, event);
  let override: EntitlementOverride | null = null;

  return {
    get(eventId: number, signal?: AbortSignal): Promise<EntitlementResult> {
      if (signal?.aborted) return Promise.reject(abortError());
      const event = byId.get(eventId);
      if (!event) return Promise.resolve({ status: 'unavailable', reason: 'event_not_found' });
      if (!event.isDemo) return Promise.resolve({ status: 'unavailable', reason: 'not_implemented' });

      if (override !== null) {
        switch (override) {
          case 'guest':
            return Promise.resolve({ status: 'guest' });
          case 'not_entitled':
            return Promise.resolve({ status: 'not_entitled' });
          case 'entitled':
            return Promise.resolve({ status: 'entitled' });
          case 'unavailable':
            return Promise.resolve({ status: 'unavailable', reason: 'simulated' });
          default:
            // 'unknown' or anything unexpected never lets playback through.
            return Promise.resolve({ status: 'unavailable', reason: 'simulated' });
        }
      }

      if (event.sourceKind === 'demo') return Promise.resolve({ status: 'entitled' });
      return Promise.resolve({ status: 'unavailable', reason: 'not_implemented' });
    },

    setOverride(status: EntitlementOverride | null): void {
      override = status;
    },
  };
}
