import type { AdapterFactory } from '../types';
import { createDemoAdapter } from './demo';
import { createHlsAdapter } from './hls';
import { createIframeAdapter } from './iframe';
import { createInertAdapter } from './inert';

/**
 * Maps a source kind to its adapter. 'iframe' is still an inert stub (until M2-PLAN D2).
 * A kind this build does not know also gets an inert adapter instead of a throw, so a bad
 * value can never break a click handler.
 */
export function createAdapterFactory(): AdapterFactory {
  return (kind, host, env) => {
    switch (kind) {
      case 'demo':
        return createDemoAdapter(host, env);
      case 'hls':
        return createHlsAdapter(host, env);
      case 'iframe':
        return createIframeAdapter(host, env);
      default:
        return createInertAdapter('iframe');
    }
  };
}
