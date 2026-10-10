import type { AdapterFactory } from '../types';
import { createDemoAdapter } from './demo';
import { createHlsAdapter } from './hls';
import { createIframeAdapter } from './iframe';
import { createInertAdapter } from './inert';

/**
 * Maps a source kind to its adapter. 'hls' and 'iframe' return inert M1 stubs (plan 6.9).
 * A kind this build does not know also gets an inert adapter instead of a throw, so a bad
 * value can never break a click handler.
 */
export function createAdapterFactory(): AdapterFactory {
  return (kind, host, env) => {
    switch (kind) {
      case 'demo':
        return createDemoAdapter(host, env);
      case 'hls':
        return createHlsAdapter();
      case 'iframe':
        return createIframeAdapter();
      default:
        return createInertAdapter('iframe');
    }
  };
}
