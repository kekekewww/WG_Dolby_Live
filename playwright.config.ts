import { defineConfig, devices } from '@playwright/test';

/**
 * Harness tests (M1-PLAN D11, 7.1). Two kinds of project:
 *
 *  - harness-dev-{chromium,firefox,webkit}: the Vite dev harness (http://localhost:5174/dev/*.html)
 *    runs src/main.ts through Vite. Specs: tests/e2e/**\/*.spec.ts except *.dist.spec.ts.
 *  - harness-dist: chromium smoke against the BUILT plugin/wg-live/assets/dist files, loaded by
 *    dev/serve-dist.mjs (http://localhost:5175/dev/dist/*.html) as WordPress does (<link> + <script
 *    defer>). Specs: tests/e2e/**\/*.dist.spec.ts. The server runs `npm run build` first.
 *
 * Playwright WebKit is not Safari: real-device Safari results go into evidence/test-results.
 * `npm run test:e2e` runs everything; test:e2e:dev and test:e2e:dist run one kind.
 *
 * The dist server runs `npm run build`, which EMPTIES plugin/wg-live/assets/dist, the folder wp-env serves. Playwright
 * starts every webServer whatever --project is selected, so the dist entry is only started when harness-dist is
 * selected (or no project is: the full run), or WG_E2E_DIST=1. WG_E2E_DIST=0 never starts it. Even so, do not run
 * `npm run test:e2e` / `test:e2e:dist` while the wp-env integration suite (npm run test:integration) is running.
 */

// WG_E2E_DEV_PORT lets the suite run when another project already holds 5174 (reuseExistingServer would otherwise attach to it).
export const DEV_PORT = Number(process.env.WG_E2E_DEV_PORT ?? 5174);
export const DIST_PORT = 5175;

const DEV_URL = `http://localhost:${DEV_PORT}`;
const DIST_URL = `http://localhost:${DIST_PORT}`;
const DIST_SPEC = '**/*.dist.spec.ts';

/** Project names from the command line (--project=a, --project a, repeated); empty = no filter. */
export function selectedProjects(argv: readonly string[]): string[] {
  const out: string[] = [];
  argv.forEach((arg, i) => {
    if (arg.startsWith('--project=')) out.push(arg.slice('--project='.length));
    else if (arg === '--project' && argv[i + 1]) out.push(String(argv[i + 1]));
  });
  return out;
}

/** Does this run need the built dist (and thus `npm run build`)? */
export function needsDistServer(argv: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): boolean {
  if (env.WG_E2E_DIST === '0') return false;
  if (env.WG_E2E_DIST === '1') return true;
  const selected = selectedProjects(argv);
  return selected.length === 0 || selected.includes('harness-dist');
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  // Firefox crashes/hangs at the default worker count on high-core machines (e2e report).
  workers: process.env.CI ? 2 : 6,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      url: `${DEV_URL}/dev/index.html`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    ...(needsDistServer()
      ? [
          {
            command: `npm run build && node dev/serve-dist.mjs --port ${DIST_PORT}`,
            url: `${DIST_URL}/dev/dist/index.html`,
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]
      : []),
  ],
  projects: [
    { name: 'harness-dev-chromium', testIgnore: DIST_SPEC, use: { ...devices['Desktop Chrome'], baseURL: DEV_URL } },
    { name: 'harness-dev-firefox', testIgnore: DIST_SPEC, use: { ...devices['Desktop Firefox'], baseURL: DEV_URL } },
    { name: 'harness-dev-webkit', testIgnore: DIST_SPEC, use: { ...devices['Desktop Safari'], baseURL: DEV_URL } },
    { name: 'harness-dist', testMatch: DIST_SPEC, use: { ...devices['Desktop Chrome'], baseURL: DIST_URL } },
  ],
});
