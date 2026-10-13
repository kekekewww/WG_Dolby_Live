// Typed entry to the dev-harness core (dev/core.mjs). Tests and tooling import from here.
//
// BootConfig (src/types.ts) is built by buildBootConfig(): it fills every field, including
// featuredEventSlug and heading. Variants are chosen with query parameters on the page URL
// (see parseHarnessOptions): ?harness=disabled|plain|nodev, ?featured=, ?heading=, ?fixed=.
export {
  CONFIG_TOKEN,
  DEFAULT_OPTIONS,
  DEMO_FILES,
  DEMO_MIME,
  DEMO_VIDEO_FILES,
  DEMO_VIDEO_MIME,
  DISABLED_PREFIX,
  HARNESS_LINKS,
  PLAIN_REST_ROOT,
  REST_ROOT,
  buildBootConfig,
  encodeConfig,
  entitlementFor,
  handleRest,
  harnessEvents,
  harnessLinks,
  injectConfig,
  matchRestUrl,
  parseHarnessOptions,
  resolvePlayback,
  restRootFor,
} from './core.mjs';
export type { HarnessOptions } from './core.mjs';
