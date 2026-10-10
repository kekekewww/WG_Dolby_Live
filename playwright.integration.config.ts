import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * WordPress integration tests (M1-PLAN 7.2). wp-env (npm run wp:start) is started separately; there is
 * no webServer here. Needs Docker, the dev site on :8888 (WP_ENVIRONMENT_TYPE=local) and the tests site
 * on :8889 (production), both seeded by the afterStart lifecycle script.
 *
 * WordPress on wp-env is slow on Windows (the WordPress files sit on a 9p mount, 5-25 s per uncached
 * request), so timeouts are generous and the read-only specs run in parallel.
 *
 * Two phases per browser:
 *   chromium, webkit              read-only specs and specs that only add their own fixture events. They
 *                                 run in parallel with each other.
 *   <browser>-state-<file>        *.state.spec.ts: they change shared site state (deployment mode, plugin
 *                                 activation, page slugs, settings) and restore it. Each file is its own
 *                                 project and the projects are chained (dependencies), so they run strictly
 *                                 one after another, after the first phase: chromium files, then webkit files.
 * `npm run test:integration -- --no-deps --project='chromium-state-*'` runs one phase alone.
 */
const STATE_SPEC = '**/*.state.spec.ts';

const workers = process.env.CI ? 2 : 4;

// The state specs change shared site state and must never overlap, not even with each other: one project per
// file, chained with dependencies (chromium files first, then webkit).
const STATE_FILES = ['disabled', 'settings', 'deactivate'];
const BROWSERS = [
  { name: 'chromium', device: devices['Desktop Chrome'] },
  { name: 'webkit', device: devices['Desktop Safari'] },
];

const stateProjects: Project[] = [];
let previous = ['chromium', 'webkit'];
for (const browser of BROWSERS) {
  for (const file of STATE_FILES) {
    const name = `${browser.name}-state-${file}`;
    stateProjects.push({ name, testMatch: `**/${file}.state.spec.ts`, fullyParallel: false, dependencies: previous, use: { ...browser.device } });
    previous = [name];
  }
}

const projects: Project[] = [
  { name: 'chromium', testIgnore: STATE_SPEC, use: { ...devices['Desktop Chrome'] } },
  { name: 'webkit', testIgnore: STATE_SPEC, use: { ...devices['Desktop Safari'] } },
  ...stateProjects,
];

export default defineConfig({
  testDir: 'tests/integration',
  outputDir: 'test-results/integration',
  fullyParallel: true,
  workers,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-integration', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8888',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
  },
  projects,
});
