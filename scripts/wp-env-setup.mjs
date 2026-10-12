#!/usr/bin/env node
// wp-env lifecycle script ("afterStart" in .wp-env.json): prepares the demo site in the
// development environment and in the tests environment by running
//
//   wp eval-file wp-content/wg-live-scripts/seed-demo.php setup [force]
//
// seed-demo.php refuses unless the site is local/development or "force" is passed. The dev site (cli) is
// WP_ENVIRONMENT_TYPE=local; the tests site (tests-cli) is "production" on purpose (.wp-env.json), so it gets "force".
// Both are throw-away wp-env sites. (scripts/ is mapped to wp-content/wg-live-scripts.) The seed is idempotent, so running it after
// every `wp-env start` is safe. Needs the wg-live plugin to be active (wp-env activates it).
//
// Exit codes: 0 = ok, 1 = a container failed.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wpEnv = join(root, 'node_modules', '@wordpress', 'env', 'bin', 'wp-env');
const SEED = 'wp-content/wg-live-scripts/seed-demo.php';
/** container -> extra seed arguments */
const CONTAINERS = [
  ['cli', []],
  ['tests-cli', ['force']],
];

let failed = false;
for (const [container, extra] of CONTAINERS) {
  console.log(`wp-env-setup: seeding ${container}`);
  const r = spawnSync(process.execPath, [wpEnv, 'run', container, 'wp', 'eval-file', SEED, 'setup', ...extra], { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    failed = true;
    console.error(`wp-env-setup: seeding ${container} failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`);
  }
}
process.exitCode = failed ? 1 : 0;
