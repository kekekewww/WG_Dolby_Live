#!/usr/bin/env node
// Builds the installable plugin ZIP (spec 15.1, M1-PLAN 7.3):
//
//   artifacts/wg-live-<version>.zip         single root folder "wg-live/", allowlist only
//   artifacts/wg-live-<version>.zip.sha256  "<hex>  wg-live-<version>.zip" (sha256sum -c format)
//
// Run `npm run build` first (needs plugin/wg-live/assets/dist/build-info.json).
// Entries are sorted, use forward slashes and carry a fixed mtime, so the same inputs
// give the same bytes.
//
// Exit codes: 0 = ok, 1 = a precondition failed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';

export const PLUGIN_SLUG = 'wg-live';

/** Fixed timestamp (local-time constructor, because ZIP stores DOS local time). */
const FIXED_MTIME = new Date(2020, 0, 1, 0, 0, 0);

/** Directory names that never ship, wherever they appear. */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  'vendor-bin',
  'tests',
  'test',
  '__tests__',
  'evidence',
  'screenshots',
  'playwright-report',
  'test-results',
  'artifacts',
]);

/** File extensions that never ship. */
const EXCLUDED_EXT = /\.(ts|tsx|map|woff2?|ttf|otf|eot|zip|sql|log)$/i;

/** The fixed dist set (M1-PLAN 7.3 item 4): the three bundles plus build-info.json. */
export const DIST_FILES = ['wg-live.js', 'wg-live.css', 'wg-live-featured.css', 'build-info.json'];
/** Demo assets that ship: MP3 files, the poster and the license (no .m4a, M1-PLAN D7). */
const DEMO_FILE = /^(?:[A-Za-z0-9_-]+\.mp3|poster-demo\.svg|LICENSE-demo\.txt)$/;
/** Admin screen assets (assets/admin/**): scripts and styles only. */
const ADMIN_ASSET = /\.(?:js|css)$/i;
const TOP_LEVEL_LICENSE = /^(license|licence|copying|notice|third-party|third_party)[^/]*$/i;

/**
 * Is this plugin-relative path (forward slashes) part of the release?
 * @param {string} rel e.g. "assets/dist/wg-live.js"
 * @returns {boolean}
 */
export function shouldShip(rel) {
  if (!rel || rel.includes('\\') || rel.startsWith('/')) return false;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return false; // dotfiles, .gitkeep
  if (parts.some((p) => EXCLUDED_SEGMENTS.has(p.toLowerCase()))) return false;
  if (EXCLUDED_EXT.test(rel)) return false;

  const first = parts[0] ?? '';
  const name = parts[parts.length - 1] ?? '';

  if (parts.length === 1) {
    return name.endsWith('.php') || name === 'readme.txt' || TOP_LEVEL_LICENSE.test(name);
  }
  if (first === 'templates' || first === 'includes') return true;
  if (first === 'licenses') return true; // third-party license notices
  if (first === 'assets') {
    const second = parts[1] ?? '';
    if (second === 'dist') return parts.length === 3 && DIST_FILES.includes(name);
    if (second === 'admin') return parts.length >= 3 && ADMIN_ASSET.test(name);
    if (second === 'demo') return parts.length === 3 && DEMO_FILE.test(name);
  }
  return false;
}

/**
 * All shipped files under a plugin directory, as sorted forward-slash relative paths.
 * @param {string} pluginDir
 * @returns {string[]}
 */
export function collectFiles(pluginDir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Prune excluded/dot directories early.
        if (entry.name.startsWith('.') || EXCLUDED_SEGMENTS.has(entry.name.toLowerCase())) continue;
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile() && shouldShip(rel)) {
        out.push(rel);
      }
    }
  };
  walk(pluginDir, '');
  return out.sort();
}

/** @param {string} php @returns {string | null} the "Version:" value of the plugin header */
export function parsePluginVersion(php) {
  const header = php.slice(0, 8192);
  const m = /^[ \t/*#@]*Version:[ \t]*([^\s*]+)/im.exec(header);
  return m ? (m[1] ?? null) : null;
}

/** @param {string} readme @returns {string | null} the "Stable tag:" value */
export function parseStableTag(readme) {
  const m = /^[ \t=*]*Stable tag:[ \t]*([^\s=*]+)/im.exec(readme);
  return m ? (m[1] ?? null) : null;
}

/**
 * Why a ZIP entry name is unacceptable (M1-PLAN 7.3 item 2), or null. The same rules are enforced
 * again by check-artifact.mjs on the finished ZIP.
 * @param {string} name full entry name, e.g. "wg-live/assets/dist/wg-live.js"
 * @returns {string | null}
 */
export function entryNameProblem(name) {
  if (name.includes('\\')) return 'contains a backslash';
  if (name.startsWith('/')) return 'is an absolute path';
  if (/^[A-Za-z]:/.test(name)) return 'starts with a drive letter';
  const segments = name.split('/');
  if (segments.includes('..')) return 'contains a ".." segment';
  if (segments.slice(0, -1).includes('')) return 'contains an empty path segment';
  if (!name.startsWith(`${PLUGIN_SLUG}/`)) return `does not start with "${PLUGIN_SLUG}/"`;
  return null;
}

/**
 * Create the ZIP bytes for a list of plugin-relative files.
 * @param {string} pluginDir
 * @param {string[]} files sorted relative paths
 * @returns {Uint8Array}
 */
export function createZip(pluginDir, files) {
  /** @type {Record<string, [Uint8Array, { mtime: Date, level: 9 }]>} */
  const entries = {};
  for (const rel of [...files].sort()) {
    const problem = entryNameProblem(`${PLUGIN_SLUG}/${rel}`);
    if (problem) throw new Error(`refusing to package "${rel}": the entry name ${problem}`);
    entries[`${PLUGIN_SLUG}/${rel}`] = [new Uint8Array(readFileSync(join(pluginDir, ...rel.split('/')))), { mtime: FIXED_MTIME, level: 9 }];
  }
  return zipSync(entries);
}

/**
 * @param {{ root: string }} opts
 * @returns {{ version: string, zipPath: string, shaPath: string, sha256: string, files: string[], bytes: number }}
 */
export function packagePlugin({ root }) {
  const pluginDir = join(root, 'plugin', PLUGIN_SLUG);
  const distInfo = join(pluginDir, 'assets', 'dist', 'build-info.json');
  if (!existsSync(distInfo)) {
    throw new Error('plugin/wg-live/assets/dist/build-info.json not found: run npm run build first');
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = String(pkg.version ?? '');
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version "${version}" is not a valid semver`);
  }

  const phpFile = join(pluginDir, 'wg-live.php');
  const readmeFile = join(pluginDir, 'readme.txt');
  if (!existsSync(phpFile)) throw new Error('plugin/wg-live/wg-live.php not found: the plugin main file must exist before packaging');
  if (!existsSync(readmeFile)) throw new Error('plugin/wg-live/readme.txt not found: the readme with "Stable tag" must exist before packaging');

  const headerVersion = parsePluginVersion(readFileSync(phpFile, 'utf8'));
  if (headerVersion !== version) {
    throw new Error(`plugin header Version is ${headerVersion ?? '(missing)'} but package.json version is ${version}`);
  }
  const stableTag = parseStableTag(readFileSync(readmeFile, 'utf8'));
  if (stableTag !== version) {
    throw new Error(`readme.txt Stable tag is ${stableTag ?? '(missing)'} but package.json version is ${version}`);
  }
  /** @type {{ version?: unknown, files?: Record<string, { sha256?: string }> }} */
  let buildInfo;
  try {
    buildInfo = JSON.parse(readFileSync(distInfo, 'utf8'));
  } catch (err) {
    throw new Error(`build-info.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (buildInfo.version !== version) {
    throw new Error(`build-info.json version is ${String(buildInfo.version)} but package.json version is ${version}: run npm run build again`);
  }
  // The dist files must be the ones build-info.json describes (stale or hand-edited build).
  for (const name of DIST_FILES) {
    if (name === 'build-info.json') continue;
    const file = join(pluginDir, 'assets', 'dist', name);
    if (!existsSync(file)) throw new Error(`plugin/wg-live/assets/dist/${name} not found: run npm run build first`);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (buildInfo.files?.[name]?.sha256 !== actual) {
      throw new Error(`plugin/wg-live/assets/dist/${name} does not match build-info.json: run npm run build again`);
    }
  }

  const files = collectFiles(pluginDir);
  const zip = createZip(pluginDir, files);

  const outDir = join(root, 'artifacts');
  mkdirSync(outDir, { recursive: true });
  const zipName = `wg-live-${version}.zip`;
  const zipPath = join(outDir, zipName);
  writeFileSync(zipPath, zip);

  const sha256 = createHash('sha256').update(zip).digest('hex');
  const shaPath = `${zipPath}.sha256`;
  writeFileSync(shaPath, `${sha256}  ${zipName}\n`);

  return { version, zipPath, shaPath, sha256, files, bytes: zip.length };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const r = packagePlugin({ root });
    for (const f of r.files) console.log(`  wg-live/${f}`);
    console.log(`package: ${r.files.length} file(s), ${r.bytes} bytes`);
    console.log(`package: wrote ${r.zipPath}`);
    console.log(`package: wrote ${r.shaPath}`);
    console.log(`package: sha256 ${r.sha256}`);
    return 0;
  } catch (err) {
    console.error(`package: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
