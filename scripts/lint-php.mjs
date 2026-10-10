#!/usr/bin/env node
// PHP gate (M1-PLAN D8, 7.1). No local PHP is needed: everything runs in Docker.
//
//   1. Lists every .php file under plugin/ and scripts/ (Node) and FAILS when there are none.
//   2. `find ... -print0 | xargs -0 -n1 php -l` per file on php:7.4-cli and php:8.3-cli, with the
//      repository bind-mounted read-only.
//   3. PHPCS + PHPCompatibilityWP (testVersion 7.4-) with phpcs.xml.dist, in the composer:2 image.
//      The tools are installed into node_modules/.cache/wg-live-phpcs (git-ignored, survives between
//      runs) from the exact versions in PHPCS_TOOLS below.
//
// All docker calls use spawn with an argument array (no shell on the host).
//
// Exit codes: 0 = ok, 1 = lint failures, 2 = Docker unavailable / setup failure / no PHP files.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SYNTAX_IMAGES = ['php:7.4-cli', 'php:8.3-cli'];
export const COMPOSER_IMAGE = 'composer:2';
/** Directories (relative to the repo root) whose PHP files are linted. */
export const PHP_ROOTS = ['plugin', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git']);

/**
 * Exact pins. PHPCompatibilityWP 2.x sits on PHPCompatibility 9.3.5 (2019), which knows PHP up to
 * 8.0 only. PHPCompatibilityWP 3.0.0-alpha2 builds on PHPCompatibility 10.0.0-alpha2, which adds the
 * PHP 8.1-8.5 sniffs, so that pair is used for the 7.4- check.
 * Re-check packagist.org/packages/phpcompatibility/phpcompatibility-wp for a stable 3.x release.
 */
export const PHPCS_TOOLS = {
  'squizlabs/php_codesniffer': '3.13.6',
  'phpcompatibility/phpcompatibility-wp': '3.0.0-alpha2',
  'phpcompatibility/php-compatibility': '10.0.0-alpha2',
  'phpcompatibility/phpcompatibility-paragonie': '2.0.0-alpha2',
  'dealerdirect/phpcodesniffer-composer-installer': '1.2.1',
};

/**
 * @param {string} dir absolute directory
 * @returns {string[]} absolute paths of .php files
 */
export function findPhp(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...findPhp(join(dir, entry.name)));
    } else if (entry.name.endsWith('.php')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Forward slashes keep Docker Desktop on Windows happy: D:/path/to/repo @param {string} p */
const dockerPath = (p) => p.split('\\').join('/');

/**
 * @param {string[]} args docker arguments
 * @param {{ inherit?: boolean }} [opts]
 */
function docker(args, opts = {}) {
  const r = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: opts.inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
  });
  return r;
}

// Run in the container: list files, lint each one separately.
const LINT_SCRIPT = 'find "$@" -type f -name "*.php" -not -path "*/node_modules/*" -not -path "*/vendor/*" -print0 | sort -z | xargs -0 -n1 php -l';

/**
 * @param {string} root repo root
 * @param {string} image
 * @param {number} expected number of files Node found
 * @returns {boolean} ok
 */
function lintSyntax(root, image, expected) {
  console.log(`lint-php: php -l, ${expected} file(s), ${image}`);
  const r = docker(['run', '--rm', '-v', `${dockerPath(root)}:/app:ro`, '-w', '/app', image, 'sh', '-c', LINT_SCRIPT, 'sh', ...PHP_ROOTS]);
  if (r.error) {
    console.error(`lint-php: could not run docker: ${r.error.message}`);
    process.exit(2);
  }
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter(Boolean);
  const ok = lines.filter((l) => l.startsWith('No syntax errors detected'));
  const rest = lines.filter((l) => !l.startsWith('No syntax errors detected'));
  for (const l of rest) console.error(`  ${l}`);
  if (r.status !== 0) {
    console.error(`lint-php: FAILED php -l on ${image} (exit ${r.status})`);
    return false;
  }
  if (ok.length !== expected) {
    console.error(`lint-php: ${image} checked ${ok.length} file(s) but ${expected} exist`);
    return false;
  }
  return true;
}

/** @param {string} cacheDir */
function composerJson(cacheDir) {
  const json = {
    name: 'wg-live/phpcs-tools',
    description: 'PHPCS tooling for wg-live (installed by scripts/lint-php.mjs, never shipped)',
    type: 'project',
    license: 'proprietary',
    'minimum-stability': 'alpha',
    'prefer-stable': true,
    require: PHPCS_TOOLS,
    config: {
      'allow-plugins': { 'dealerdirect/phpcodesniffer-composer-installer': true },
      'sort-packages': true,
    },
  };
  return { path: join(cacheDir, 'composer.json'), text: JSON.stringify(json, null, 2) + '\n' };
}

/**
 * Install the PHPCS tools when the pins changed or vendor/ is missing.
 * @param {string} cacheDir
 * @returns {boolean} ok
 */
function ensurePhpcs(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const { path, text } = composerJson(cacheDir);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const phpcsBin = join(cacheDir, 'vendor', 'squizlabs', 'php_codesniffer', 'bin', 'phpcs');
  if (current === text && existsSync(phpcsBin)) return true;

  console.log('lint-php: installing PHPCS + PHPCompatibilityWP into the cache (first run or pins changed)');
  writeFileSync(path, text);
  const r = docker(
    [
      'run', '--rm', '-v', `${dockerPath(cacheDir)}:/cache`, '-w', '/cache', '-e', 'COMPOSER_HOME=/cache/.composer',
      COMPOSER_IMAGE, 'update', '--no-interaction', '--no-progress', '--prefer-dist', '--no-scripts',
    ],
    { inherit: true },
  );
  if (r.error || r.status !== 0) {
    console.error(`lint-php: composer install of the PHPCS tools failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`);
    writeFileSync(path, ''); // force a retry next time
    return false;
  }
  return existsSync(phpcsBin);
}

/**
 * @param {string} root
 * @param {string} cacheDir
 * @returns {boolean} ok
 */
function runPhpcs(root, cacheDir) {
  console.log('lint-php: PHPCS + PHPCompatibilityWP (testVersion 7.4-), phpcs.xml.dist');
  const script = 'cd /app && php /cache/vendor/squizlabs/php_codesniffer/bin/phpcs --standard=phpcs.xml.dist';
  const r = docker(
    ['run', '--rm', '-v', `${dockerPath(root)}:/app:ro`, '-v', `${dockerPath(cacheDir)}:/cache:ro`, '--entrypoint', 'sh', COMPOSER_IMAGE, '-c', script],
    { inherit: true },
  );
  if (r.error) {
    console.error(`lint-php: could not run docker: ${r.error.message}`);
    process.exit(2);
  }
  if (r.status !== 0) {
    console.error(`lint-php: FAILED PHPCS (exit ${r.status})`);
    return false;
  }
  return true;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = PHP_ROOTS.flatMap((d) => findPhp(join(root, d)))
    .map((f) => relative(root, f).split('\\').join('/'))
    .sort();

  if (files.length === 0) {
    console.error(`lint-php: no .php files found under ${PHP_ROOTS.join(', ')} - refusing to pass an empty lint`);
    return 2;
  }

  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error('lint-php: Docker is not available or not running. Start Docker Desktop and retry.');
    return 2;
  }

  let failed = false;
  for (const image of SYNTAX_IMAGES) {
    if (!lintSyntax(root, image, files.length)) failed = true;
  }
  if (failed) return 1; // fix syntax errors before running the compatibility sniffs

  const cacheDir = join(root, 'node_modules', '.cache', 'wg-live-phpcs');
  if (!ensurePhpcs(cacheDir)) return 2;
  if (!runPhpcs(root, cacheDir)) return 1;

  console.log(`lint-php: ok (${files.length} file(s): php -l on ${SYNTAX_IMAGES.join(' + ')}, PHPCompatibilityWP 7.4-)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
