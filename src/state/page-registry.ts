/**
 * One active player per page (M1-PLAN 6.8). Every controller registers itself; when one enters
 * `loading`, all the others `stop()`. The PHP shortcode already renders only the first player view
 * per request, so this is the client-side guard for Elementor re-renders and second bundles.
 */
import type { PlayerController } from '../types';

const controllers = new Set<PlayerController>();

export const pageRegistry = {
  /** Add a controller. Returns the function that removes it (call it from destroy()). */
  register(controller: PlayerController): () => void {
    controllers.add(controller);
    return () => {
      controllers.delete(controller);
    };
  },

  /** `controller` is about to load: stop every other registered controller. */
  notifyLoading(controller: PlayerController): void {
    for (const other of [...controllers]) {
      if (other === controller) continue;
      try {
        other.stop();
      } catch {
        // One broken controller must not keep the active one from starting.
      }
    }
  },

  /** Number of registered controllers (tests). */
  size(): number {
    return controllers.size;
  },
};
