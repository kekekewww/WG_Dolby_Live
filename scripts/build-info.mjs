#!/usr/bin/env node
// Writes plugin/wg-live/assets/dist/build-info.json (M1-PLAN D3).
//
// build-info.json records the version, the git commit (full SHA) with a `dirty` flag, and the SHA-256 of each file in the FIXED set
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

/** Paths that do not influence the built artifact; changes there do not make a build "dirty". */
const NON_BUILD_PATHS = ['docs', 'evidence', 'tests', '.claude'];
export const UNCOMMITTED = 'uncommitted';

/**
 * The git state a build is made from (spec 18.3, 19.4: a shipped build must be reproducible from its commit).
 * `dirty` is true when tracked files differ from HEAD or there are untracked, non-ignored files outside the
 * build-irrelevant paths (docs, evidence, tests, .claude); the gitignored dist/ and artifacts/ never count.
 * Without git (or without a commit) the commit is "uncommitted" and the tree counts as dirty.
 * @param {string} root
 * @returns {{ commit: string, dirty: boolean, committedAt: string | null }}
 */
export function gitState(root) {
  const git = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']);
  const commit = (head.stdout ?? '').trim();
  if (head.status !== 0 || !/^[0-9a-f]{40}$/.test(commit)) return { commit: UNCOMMITTED, dirty: true, committedAt: null };
  const status = git(['status', '--porcelain', '--', '.', ...NON_BUILD_PATHS.map((p) => `:(exclude)${p}`)]);
  const dirty = status.status !== 0 || (status.stdout ?? '').trim() !== '';
  const when = git(['show', '-s', '--format=%cI', 'HEAD']);
  const t = Date.parse((when.stdout ?? '').trim());
  return { commit, dirty, committedAt: when.status === 0 && Number.isFinite(t) ? new Date(t).toISOString() : null };
}

/**
 * `builtAt` is the HEAD commit time on a clean tree (so rebuilding the same commit gives the same bytes), else `now`.
 * @param {{ root: string, dist?: string, log?: (line: string) => void, now?: Date, commit?: string, dirty?: boolean }} options
 * @returns {{ version: string, commit: string, dirty: boolean, builtAt: string, files: Record<string, { bytes: number, sha256: string }> }}
 * @throws {Error} when dist or one of the fixed files is missing
 */
export function writeBuildInfo({ root, dist = join(root, 'plugin', 'wg-live', 'assets', 'dist'), log = () => {}, now = new Date(), commit, dirty }) {
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

  const state = commit === undefined ? gitState(root) : { commit, dirty: dirty ?? false, committedAt: null };
  const info = {
    version: String(pkg.version),
    commit: state.commit,
    dirty: state.dirty,
    builtAt: !state.dirty && state.committedAt ? state.committedAt : now.toISOString(),
    files,
  };
  writeFileSync(join(dist, OUTPUT), JSON.stringify(info, null, 2) + '\n');
  return info;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const info = writeBuildInfo({ root, log: (line) => console.log(`build-info: ${line}`) });
    console.log(`build-info: wrote ${OUTPUT} (${Object.keys(info.files).length} files, version ${info.version}, commit ${info.commit}${info.dirty ? ' (DIRTY tree)' : ''})`);
    if (info.dirty) console.warn('build-info: the working tree is not clean; npm run package will refuse this build unless --allow-dirty is given');
    return 0;
  } catch (err) {
    console.error(`build-info: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
