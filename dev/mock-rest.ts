import type { Plugin } from 'vite';
import { injectConfig, injectSiteMock, matchRestUrl, parseHarnessOptions, sendRest, serveDemoFile, serveHls } from './core.mjs';

/**
 * Vite dev-server plugin (never packaged). Stateless (M1-PLAN D11); the logic lives in dev/core.mjs
 * so that the dist server (dev/serve-dist.mjs) answers identically. It
 *  - mocks GET wg-live/v1/{events, events/:slug, playback} per M1-PLAN section 5 / 5.1, in the pretty
 *    form (/wp-json/wg-live/v1/...) and the plain-permalink form (/index.php?rest_route=/wg-live/v1/...),
 *    each also under /disabled/ (deployment mode disabled),
 *  - serves /demo/* (demo-tone-N.mp3 for audio events, demo-video-N.mp4 for video events, poster) with Range support,
 *  - maps /, /listen.html, /help.html to the harness pages under /dev/,
 *  - injects the BootConfig (fixtures, per-request "now") and the realistic site chrome (dev/site-mock.html)
 *    into the pages.
 */

const PAGE_ALIASES: Record<string, string> = {
  '/': '/dev/index.html',
  '/index.html': '/dev/index.html',
  '/listen.html': '/dev/listen.html',
  '/help.html': '/dev/help.html',
};

export { resolvePlayback } from './core.mjs';

export function wgLiveDev(): Plugin {
  return {
    name: 'wg-live:dev-harness',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        const rest = matchRestUrl(url.pathname, url.searchParams);
        if (rest) {
          sendRest(req, res, rest, url);
          return;
        }
        if (url.pathname.startsWith('/demo/')) {
          serveDemoFile(req, res, url);
          return;
        }
        // M2-PLAN C4: the local HLS fixture and the plugin's own hls.js file (?harness=hls).
        if (serveHls(req, res, url)) return;
        const alias = PAGE_ALIASES[url.pathname];
        if (alias) req.url = alias + url.search;
        next();
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const search = new URL(ctx.originalUrl ?? ctx.path, 'http://localhost').search;
        return injectSiteMock(injectConfig(html, Date.now(), parseHarnessOptions(search, { pageBase: '/dev/' })), '/dev/');
      },
    },
  };
}
