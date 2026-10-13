#!/usr/bin/env node
// Validates the release ZIP (spec 13.4, 15.1; M1-PLAN 7.3).
//
//   node scripts/check-artifact.mjs [--allow-dirty] [path-to-zip]
//
// Default: the newest artifacts/wg-live-*.zip. The ZIP is read in memory with fflate.
// A build from a dirty or uncommitted tree is a failure unless --allow-dirty is given.
// Exit codes: 0 = ok, 1 = problems found, 2 = usage / IO error.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync as nodeGzip } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { checkCss, DEFAULT_BLOCKS } from './check-css-scope.mjs';
import { DIST_FILES, isTextEntry, parsePluginVersion, parseStableTag, parseVersionConstant } from './package.mjs';

export const ROOT_DIR = 'wg-live';
export const DIST_DIR = `${ROOT_DIR}/assets/dist`;
/** The only files allowed in assets/dist (M1-PLAN 7.3 item 4). */
export { DIST_FILES };
export const JS_BUDGET_BYTES = 100 * 1024;
export const CSS_BUDGET_BYTES = 30 * 1024;
/**
 * Per-page budgets (M1-PLAN 7.3 item 8), gzip level 9: the player page loads wg-live.js and
 * wg-live.css, the homepage only wg-live-featured.css. They are separate budgets, not a sum.
 */
export const BUDGETS = [
  { page: 'player', file: 'wg-live.js', max: JS_BUDGET_BYTES },
  { page: 'player', file: 'wg-live.css', max: CSS_BUDGET_BYTES },
  { page: 'homepage', file: 'wg-live-featured.css', max: CSS_BUDGET_BYTES },
];
export const FORBIDDEN_STRINGS = ['localhost', '127.0.0.1', ':5173', ':5174', '/@vite', '@vite/client'];

const FORBIDDEN_DIRS = new Set([
  'node_modules',
  'evidence',
  'screenshots',
  'playwright-report',
  'playwright',
  'test-results',
  'tests',
  'test',
  '__tests__',
]);
/** The two bundled demo videos: the only .mp4 files allowed, at exactly this path below wg-live/. */
const DEMO_VIDEO = /^assets\/demo\/demo-video-\d\.mp4$/;
const FORBIDDEN_EXT = /(?:\.(?:ts|tsx|map|woff2?|ttf|otf|eot|zip|sql|log|gz|tgz|tar|7z|bak|orig|swp|sqlite|db|webm|mp4|mov|pem|key|env|phar)|~)$/i;

/**
 * The allowlist of ZIP paths below wg-live/, written out independently of package.mjs shouldShip() so that
 * a packager mistake is caught here (M1-PLAN 7.3). Anything not matching is "not on the allowlist".
 */
const ALLOWED_PATHS = [
  /^(?:wg-live|uninstall)\.php$/,
  /^readme\.txt$/,
  /^(?:license|licence|copying|notice|third-party|third_party)(?:\.txt|\.md)?$/i,
  /^(?:includes|templates)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.php$/,
  /^licenses\/[A-Za-z0-9._-]+\.(?:txt|md)$/i,
  /^assets\/dist\/(?:wg-live\.js|wg-live\.css|wg-live-featured\.css|build-info\.json)$/,
  /^assets\/admin\/[A-Za-z0-9._-]+\.(?:js|css)$/i,
  /^assets\/demo\/(?:[A-Za-z0-9_-]+\.mp3|demo-video-\d\.mp4|poster-demo(?:-square)?\.svg|LICENSE-demo\.txt)$/,
];
/** @param {string} rel path below wg-live/ */
const isAllowedPath = (rel) => ALLOWED_PATHS.some((re) => re.test(rel));

/** Files the plugin needs at runtime besides the require_once targets of wg-live.php (relative to wg-live/). */
export const REQUIRED_FILES = [
  'wg-live.php',
  'uninstall.php',
  'readme.txt',
  'templates/events.php',
  'templates/featured.php',
  'templates/help.php',
  'templates/player.php',
  'templates/partials/container.php',
  'assets/demo/demo-tone-1.mp3',
  'assets/demo/demo-tone-2.mp3',
  'assets/demo/demo-video-1.mp4',
  'assets/demo/demo-video-2.mp4',
  'assets/demo/poster-demo.svg',
  'assets/demo/LICENSE-demo.txt',
  'assets/admin/admin.js',
  'assets/admin/admin.css',
];

/**
 * @typedef {{ check: string, ok: boolean, detail: string }} Row
 * @typedef {{ ok: boolean, problems: string[], rows: Row[] }} Result
 * @typedef {{
 *   zipName?: string,
 *   allowDirty?: boolean,
 *   packageVersion?: string | null,
 *   zipBytes?: Uint8Array | null,
 *   sha256Text?: string | null,
 * }} Options
 */

/** @param {string} name */
function forbiddenReason(name) {
  const parts = name.split('/').filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  for (const p of parts.slice(0, -1)) {
    if (FORBIDDEN_DIRS.has(p.toLowerCase())) return `forbidden directory "${p}"`;
  }
  for (const p of parts) {
    if (p === '.git' || p.startsWith('.git')) return 'git metadata';
    if (p === '.env' || p.startsWith('.env.')) return 'environment file';
    if (p === '.DS_Store') return '.DS_Store';
    if (p.startsWith('.')) return 'dotfile';
  }
  const belowRoot = parts.slice(1).join('/'); // parts[0] is the wg-live/ root
  if (FORBIDDEN_EXT.test(base) && !DEMO_VIDEO.test(belowRoot)) return `forbidden file type "${/\.[^.]+$/.exec(base)?.[0] ?? ''}"`;
  if (/^screenshot/i.test(base)) return 'screenshot';
  return null;
}

/** zlib.gzipSync(buf, { level: 9 }).length, exactly as M1-PLAN 7.3 item 8 defines it. @param {Uint8Array} data */
const gz = (data) => nodeGzip(data, { level: 9 }).length;
/** @param {Uint8Array} data */
const sha = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Pure check of an unzipped archive.
 * @param {Record<string, Uint8Array>} entries name -> bytes (directory entries have a trailing "/")
 * @param {Options} [options]
 * @returns {Result}
 */
export function checkEntries(entries, options = {}) {
  const { zipName, allowDirty = false, packageVersion = null, zipBytes = null, sha256Text = null } = options;
  /** @type {string[]} */
  const problems = [];
  /** @type {Row[]} */
  const rows = [];

  /**
   * @param {string} check
   * @param {string[]} found problems for this check
   * @param {string} okDetail
   */
  const record = (check, found, okDetail) => {
    problems.push(...found.map((p) => `${check}: ${p}`));
    rows.push({ check, ok: found.length === 0, detail: found.length === 0 ? okDetail : `${found.length} problem(s)` });
  };

  const names = Object.keys(entries);
  const files = names.filter((n) => !n.endsWith('/'));
  const text = (/** @type {string} */ n) => {
    const d = entries[n];
    return d ? strFromU8(d) : '';
  };

  // 1. Names, single root, order.
  {
    /** @type {string[]} */
    const p = [];
    if (names.length === 0) p.push('the ZIP is empty');
    for (const n of names) {
      if (n.includes('\\')) p.push(`"${n}" contains a backslash`);
      if (n.startsWith('/')) p.push(`"${n}" is an absolute path`);
      if (/^[A-Za-z]:/.test(n)) p.push(`"${n}" starts with a drive letter`);
      if (n.split('/').includes('..')) p.push(`"${n}" contains a ".." segment`);
      if (n.split('/').slice(0, -1).includes('')) p.push(`"${n}" contains an empty path segment`);
    }
    const roots = new Set(names.map((n) => n.split('/')[0] ?? ''));
    if (names.length > 0 && !(roots.size === 1 && roots.has(ROOT_DIR))) {
      p.push(`expected exactly one root "${ROOT_DIR}/", found: ${[...roots].map((r) => `"${r}"`).join(', ')}`);
    }
    const sorted = [...names].sort();
    if (names.some((n, i) => n !== sorted[i])) p.push('entries are not sorted');
    record('single root + names', p, `${files.length} file(s) under ${ROOT_DIR}/`);
  }

  // 2. Main file.
  record(
    'main file',
    entries[`${ROOT_DIR}/wg-live.php`] ? [] : [`${ROOT_DIR}/wg-live.php is missing`],
    `${ROOT_DIR}/wg-live.php present`,
  );

  // 3. Forbidden entries.
  {
    /** @type {string[]} */
    const p = [];
    for (const n of names) {
      const reason = forbiddenReason(n);
      if (reason) p.push(`"${n}": ${reason}`);
    }
    record('forbidden entries', p, 'none');
  }

  // 3b. Allowlist: everything in the ZIP must be something package.mjs would have shipped
  //     (so a hand-made ZIP cannot sneak in e.g. demo-tone.m4a or an unknown assets/ folder).
  {
    /** @type {string[]} */
    const p = [];
    for (const n of files) {
      if (!n.startsWith(`${ROOT_DIR}/`) || forbiddenReason(n)) continue; // reported by the checks above
      const rel = n.slice(ROOT_DIR.length + 1);
      if (!isAllowedPath(rel)) p.push(`"${n}" is not on the package allowlist`);
    }
    record('allowlist', p, 'every entry is on the package allowlist');
  }

  // 3c. Required files: everything wg-live.php require_once's plus the templates, demo and admin assets.
  //     Uploading a ZIP over an active plugin with a missing include is a site-wide fatal error.
  {
    /** @type {string[]} */
    const p = [];
    const main = entries[`${ROOT_DIR}/wg-live.php`];
    const required = new Set(REQUIRED_FILES);
    if (main) {
      for (const m of strFromU8(main).matchAll(/require_once\s+WG_LIVE_DIR\s*\.\s*'([^']+)'/g)) if (m[1]) required.add(m[1]);
    }
    for (const rel of [...required].sort()) {
      if (!entries[`${ROOT_DIR}/${rel}`]) p.push(`${ROOT_DIR}/${rel} is missing`);
    }
    record('required files', p, `${required.size} required file(s) present`);
  }

  // 3d. Line endings: text files ship with LF (package.mjs normalises them), so the ZIP of one commit is
  //     the same on every checkout. A CRLF here means the ZIP was not made by package.mjs, or dist has CRLF.
  {
    /** @type {string[]} */
    const p = [];
    for (const n of files) {
      const rel = n.slice(ROOT_DIR.length + 1);
      const isDistText = rel.startsWith('assets/dist/') && /\.(?:js|css|json)$/.test(rel);
      const bytes = entries[n];
      if (!bytes || !(isTextEntry(rel) || isDistText)) continue;
      for (let i = 0; i + 1 < bytes.length; i++) {
        if (bytes[i] === 13 && bytes[i + 1] === 10) {
          p.push(`"${n}" has CRLF line endings`);
          break;
        }
      }
    }
    record('line endings', p, 'text files use LF');
  }

  // 4. dist contents and build-info hashes.
  /** @type {{ version?: unknown, commit?: unknown, dirty?: unknown, files?: Record<string, { sha256?: string }> } | null} */
  let buildInfo = null;
  {
    /** @type {string[]} */
    const p = [];
    const present = files.filter((n) => n.startsWith(`${DIST_DIR}/`)).map((n) => n.slice(DIST_DIR.length + 1));
    for (const need of DIST_FILES) if (!present.includes(need)) p.push(`${DIST_DIR}/${need} is missing`);
    for (const extra of present) if (!DIST_FILES.includes(extra)) p.push(`${DIST_DIR}/${extra} is not an allowed dist file`);
    const infoBytes = entries[`${DIST_DIR}/build-info.json`];
    if (infoBytes) {
      try {
        buildInfo = JSON.parse(strFromU8(infoBytes));
        for (const [name, meta] of Object.entries(buildInfo?.files ?? {})) {
          const data = entries[`${DIST_DIR}/${name}`];
          if (!data) p.push(`build-info.json lists ${name} but it is not in the ZIP`);
          else if (meta?.sha256 !== sha(data)) p.push(`${name} does not match its SHA-256 in build-info.json`);
        }
        for (const name of DIST_FILES) {
          if (name !== 'build-info.json' && !buildInfo?.files?.[name]) p.push(`build-info.json has no hash for ${name}`);
        }
      } catch {
        p.push('build-info.json is not valid JSON');
      }
    }
    record('dist contents', p, DIST_FILES.join(', '));
  }

  // 5. Dev-server strings in shipped JS / CSS / PHP.
  {
    /** @type {string[]} */
    const p = [];
    for (const n of files) {
      if (!/\.(js|css|php)$/i.test(n)) continue;
      const body = text(n);
      const lower = body.toLowerCase();
      for (const needle of FORBIDDEN_STRINGS) {
        const at = lower.indexOf(needle.toLowerCase());
        if (at >= 0) {
          const line = body.slice(0, at).split('\n').length;
          p.push(`${n}:${line} contains "${needle}"`);
        }
      }
    }
    record('dev strings', p, `none of ${FORBIDDEN_STRINGS.join(' ')}`);
  }

  // 6. CSS scope.
  {
    /** @type {string[]} */
    const p = [];
    const cssFiles = files.filter((n) => n.toLowerCase().endsWith('.css'));
    for (const n of cssFiles) {
      // The wp-admin screen stylesheet may also use its own BEM block (.wg-live-admin).
      const blocks = n.startsWith(`${ROOT_DIR}/assets/admin/`) ? [...DEFAULT_BLOCKS, 'wg-live-admin'] : DEFAULT_BLOCKS;
      for (const v of checkCss(text(n), n, { blocks })) p.push(`${v.file}:${v.line}: ${v.message}`);
    }
    record('css scope', p, `${cssFiles.length} CSS file(s) scoped`);
  }

  // 7. Budgets (gzip level 9, per page).
  {
    /** @type {string[]} */
    const p = [];
    /** @type {string[]} */
    const parts = [];
    for (const { page, file, max } of BUDGETS) {
      const data = entries[`${DIST_DIR}/${file}`];
      if (!data) {
        p.push(`${page} page: ${DIST_DIR}/${file} is missing, cannot measure`);
        continue;
      }
      const size = gz(data);
      parts.push(`${file} ${(size / 1024).toFixed(1)}/${max / 1024} KiB`);
      if (size > max) p.push(`${page} page: ${file} is ${size} bytes gzip (budget ${max})`);
    }
    record('size budgets', p, `${parts.join(', ')} gzip`);
  }

  // 8. Versions.
  {
    /** @type {string[]} */
    const p = [];
    /** @type {Record<string, string | null>} */
    const versions = {};
    if (packageVersion != null) versions['package.json'] = packageVersion;
    const php = entries[`${ROOT_DIR}/wg-live.php`];
    versions['plugin header'] = php ? parsePluginVersion(strFromU8(php)) : null;
    const readme = entries[`${ROOT_DIR}/readme.txt`];
    versions['readme Stable tag'] = readme ? parseStableTag(strFromU8(readme)) : null;
    versions['WG_LIVE_VERSION'] = php ? parseVersionConstant(strFromU8(php)) : null;
    versions['build-info.json'] = typeof buildInfo?.version === 'string' ? buildInfo.version : null;
    const fromName = zipName ? /^wg-live-(.+)\.zip$/.exec(zipName)?.[1] : undefined;
    if (fromName) versions['zip file name'] = fromName;
    for (const [k, v] of Object.entries(versions)) if (!v) p.push(`${k}: version not found`);
    const distinct = new Set(Object.values(versions).filter(Boolean));
    if (distinct.size > 1) p.push(`versions differ: ${Object.entries(versions).map(([k, v]) => `${k}=${v ?? '?'}`).join(', ')}`);
    record('versions', p, [...distinct].join(', ') || '-');
  }

  // 8b. Build provenance: the build must come from a clean, committed tree (spec 18.3, 19.4).
  {
    /** @type {string[]} */
    const p = [];
    const commit = typeof buildInfo?.commit === 'string' ? buildInfo.commit : '';
    const hasSha = /^[0-9a-f]{40}$/.test(commit);
    if (!buildInfo) p.push('build-info.json is missing or unreadable');
    else {
      if (!hasSha && !(allowDirty && commit === 'uncommitted')) p.push(`commit "${commit || '(missing)'}" is not a full 40-character git SHA`);
      if (buildInfo.dirty === true) {
        if (!allowDirty) p.push('the build was made from a dirty working tree (dirty: true); rebuild from a clean commit or pass --allow-dirty');
      } else if (buildInfo.dirty !== false) p.push('build-info.json has no boolean "dirty" field');
    }
    const note = buildInfo?.dirty === true ? ' (dirty build allowed)' : '';
    record('build commit', p, `${commit}${note}`);
  }

  // 9. Checksum file.
  if (zipBytes) {
    /** @type {string[]} */
    const p = [];
    if (sha256Text == null) p.push('the .sha256 file is missing');
    else {
      const m = /^([0-9a-f]{64}) {2}(\S.*?)\r?\n?$/i.exec(sha256Text);
      if (!m) p.push('the .sha256 file is not in "<hex>  <name>" format');
      else {
        if ((m[1] ?? '').toLowerCase() !== sha(zipBytes)) p.push('the .sha256 file does not match the ZIP');
        if (zipName && m[2] !== zipName) p.push(`the .sha256 file names "${m[2]}" instead of "${zipName}"`);
      }
    }
    record('sha256 file', p, sha(zipBytes));
  }

  return { ok: problems.length === 0, problems, rows };
}

/**
 * Unzip in memory and check.
 * @param {Uint8Array} zipBytes
 * @param {Options} [options]
 * @returns {Result}
 */
export function checkZip(zipBytes, options = {}) {
  /** @type {Record<string, Uint8Array>} */
  let entries;
  try {
    entries = unzipSync(zipBytes);
  } catch (err) {
    const msg = `the file is not a readable ZIP (${err instanceof Error ? err.message : String(err)})`;
    return { ok: false, problems: [`zip: ${msg}`], rows: [{ check: 'zip', ok: false, detail: msg }] };
  }
  return checkEntries(entries, { ...options, zipBytes });
}

/**
 * @param {string} artifactsDir
 * @returns {string | null}
 */
export function findNewestZip(artifactsDir) {
  if (!existsSync(artifactsDir)) return null;
  const zips = readdirSync(artifactsDir)
    .filter((n) => /^wg-live-.+\.zip$/.test(n))
    .map((n) => ({ path: join(artifactsDir, n), mtime: statSync(join(artifactsDir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return zips[0]?.path ?? null;
}

/** @param {Row[]} rows */
function printTable(rows) {
  const w = Math.max(...rows.map((r) => r.check.length), 5);
  for (const r of rows) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.check.padEnd(w)}  ${r.detail}`);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const allowDirty = process.argv.slice(2).includes('--allow-dirty');
  const args = process.argv.slice(2).filter((a) => a !== '--allow-dirty');
  if (args.length > 1 || args.some((a) => a.startsWith('-'))) {
    console.error('usage: node scripts/check-artifact.mjs [--allow-dirty] [path-to-zip]');
    return 2;
  }
  const zipPath = args[0] ? resolve(args[0]) : findNewestZip(join(root, 'artifacts'));
  if (!zipPath || !existsSync(zipPath)) {
    console.error(`check-artifact: ${zipPath ?? 'no artifacts/wg-live-*.zip'} not found (run npm run package first)`);
    return 2;
  }

  let packageVersion;
  try {
    packageVersion = String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  } catch {
    console.error('check-artifact: could not read package.json');
    return 2;
  }
  const shaPath = `${zipPath}.sha256`;
  const result = checkZip(new Uint8Array(readFileSync(zipPath)), {
    zipName: basename(zipPath),
    allowDirty,
    packageVersion,
    sha256Text: existsSync(shaPath) ? readFileSync(shaPath, 'utf8') : null,
  });

  console.log(`check-artifact: ${zipPath}`);
  printTable(result.rows);
  if (!result.ok) {
    console.error(`check-artifact: FAILED with ${result.problems.length} problem(s):`);
    for (const p of result.problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log('check-artifact: ok');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
