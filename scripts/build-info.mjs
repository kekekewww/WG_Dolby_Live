#!/usr/bin/env node
// Writes plugin/wg-live/assets/dist/build-info.json (M1-PLAN D3).
//
// build-info.json records the version, the git commit and the SHA-256 of each file in the FIXED set
// {wg-live.js, wg-live.css, wg-live-featured.css}. The build fails when any of them is missing.
// Anything else the Vite builds left in dist (the unused JS chunk of the CSS-only "featured" build,
// source maps, stray chunks) is removed so the artifact check sees exactly the fixed set.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OUTPUT = 'build-info.json';
/** The fixed dist set (M1-PLAN D3, 7.3). Order is the order in build-info.json. */
export const FIXED_FILES = ['wg-live.js', 'wg-live.css', 'wg-live-featured.css'];

/** @param {string} root @returns {string} */
function gitCommit(root) {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  return r.status === 0 && out ? out : 'uncommitted';
}

/**
 * @param {{ root: string, dist?: string, log?: (line: string) => void, now?: Date, commit?: string }} options
 * @returns {{ version: string, commit: string, builtAt: string, files: Record<string, { bytes: number, sha256: string }> }}
 * @throws {Error} when dist or one of the fixed files is missing
 */
export function writeBuildInfo({ root, dist = join(root, 'plugin', 'wg-live', 'assets', 'dist'), log = () => {}, now = new Date(), commit }) {
  if (!existsSync(dist)) {
    throw new Error(`${dist} does not exist (run the Vite builds first)`);
  }

  for (const name of readdirSync(dist)) {
    if (name === OUTPUT || FIXED_FILES.includes(name)) continue;
    rmSync(join(dist, name), { recursive: true, force: true });
    log(`removed stray ${name}`);
  }

  // Vite's library CSS output keeps an internal marker comment (/*$vite$:1*/); drop it.
  for (const name of FIXED_FILES) {
    const file = join(dist, name);
    if (!name.endsWith('.css') || !existsSync(file)) continue;
    const css = readFileSync(file, 'utf8');
    const cleaned = css.replace(/\/\*\$vite\$:\d+\*\/\s*/g, '');
    if (cleaned !== css) writeFileSync(file, cleaned);
  }

  const missing = FIXED_FILES.filter((name) => !existsSync(join(dist, name)) || !statSync(join(dist, name)).isFile());
  if (missing.length > 0) {
    throw new Error(`missing build output: ${missing.join(', ')}`);
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  /** @type {Record<string, { bytes: number, sha256: string }>} */
  const files = {};
  for (const name of FIXED_FILES) {
    const data = readFileSync(join(dist, name));
    files[name] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }

  const info = {
    version: String(pkg.version),
    commit: commit ?? gitCommit(root),
    builtAt: now.toISOString(),
    files,
  };
  writeFileSync(join(dist, OUTPUT), JSON.stringify(info, null, 2) + '\n');
  return info;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const info = writeBuildInfo({ root, log: (line) => console.log(`build-info: ${line}`) });
    console.log(`build-info: wrote ${OUTPUT} (${Object.keys(info.files).length} files, version ${info.version}, commit ${info.commit})`);
    return 0;
  } catch (err) {
    console.error(`build-info: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
