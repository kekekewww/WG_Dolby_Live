/**
 * Style entry, imported by src/main.ts. The order is the cascade order: tokens, primitives, the
 * three views, dialog, dev panel, breakpoints, then user-preference queries last.
 *
 * This is a TS module instead of an index.css full of @import because scripts/check-css-scope.mjs
 * (and plan 3.3) ban @import in shipped CSS; Vite bundles these imports into one wg-live.css in this order.
 */
import './theme-bridge.css';
import './base.css';
import './events.css';
import './player.css';
import './help.css';
import './dialog.css';
import './dev-panel.css';
import './responsive.css';
import './accessibility.css';
