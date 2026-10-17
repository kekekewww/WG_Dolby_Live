import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { wgLiveDev } from './dev/mock-rest.ts';

const OUT_DIR = 'plugin/wg-live/assets/dist';

/** M1-PLAN D15. Keep in sync with "browserslist" in package.json. */
const BROWSER_TARGETS = ['es2020', 'safari15.4', 'ios15.4', 'chrome100', 'edge100', 'firefox100'];

/**
 * Build #2 (`--mode featured`, entry src/featured.ts = theme-bridge.css + featured.css) only needs the CSS. Rolldown still
 * emits an (empty) JS entry chunk for a CSS entry, so drop it from the bundle
 * (scripts/build-info.mjs also removes strays).
 */
function dropFeaturedJs(): Plugin {
  return {
    name: 'wg-live:drop-featured-js',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (name.endsWith('.js')) delete bundle[name];
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const featured = mode === 'featured';

  return {
    appType: 'mpa',
    plugins: command === 'serve' ? [wgLiveDev()] : featured ? [dropFeaturedJs()] : [],
    build: {
      outDir: OUT_DIR,
      // Build #1 cleans the directory; build #2 (featured) must keep build #1's files.
      emptyOutDir: !featured,
      sourcemap: false,
      // Browser floor (M1-PLAN D15): Safari/iOS 15.4, Chrome/Edge 100, Firefox 100.
      target: BROWSER_TARGETS,
      cssTarget: BROWSER_TARGETS.filter((t) => t !== 'es2020'),
      // Nothing from a public/ directory may end up in the plugin dist (D3).
      copyPublicDir: false,
      cssMinify: true,
      cssCodeSplit: featured,
      lib: {
        entry: featured ? { 'wg-live-featured': 'src/featured.ts' } : 'src/main.ts',
        name: 'WGLive',
        formats: featured ? ['es'] : ['iife'],
        fileName: () => (featured ? 'wg-live-featured.js' : 'wg-live.js'),
        cssFileName: featured ? 'wg-live-featured' : 'wg-live',
      },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.ts'],
      setupFiles: ['tests/setup/vitest.setup.ts'],
      // Several suites spawn git, node or an HTTP server and create jsdom per file; 5 s timed out at 7-8 s on a busy machine.
      // A hang still fails, just later.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  };
});
