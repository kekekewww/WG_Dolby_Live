import type { AdapterEnv, MediaHost, PlaybackAdapter } from '../types';
import { createNativeMediaAdapter } from './native-media';

/**
 * DemoAdapter (spec 9.1): native-media over the shared element, kind 'demo'.
 *
 * Demo sources are short test files, so the element loops (`media.loop = true` from load();
 * plan 6.4: demo sources loop and never report `ended`). The "操作示範音訊，非 Binaural／Atmos
 * 驗證素材" label is a UI concern (state.isDemoMedia); this adapter makes no claim about the audio.
 */
export function createDemoAdapter(host: MediaHost, env: AdapterEnv): PlaybackAdapter {
  return createNativeMediaAdapter(host, env, { kind: 'demo', loop: true });
}
