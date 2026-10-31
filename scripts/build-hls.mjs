#!/usr/bin/env node
// Writes plugin/wg-live/assets/dist/wg-live-hls.js and THIRD-PARTY-NOTICES.txt (M2-PLAN C1).
//
// wg-live-hls.js is the pinned hls.js full UMD build (node_modules/hls.js/dist/hls.min.js), byte for byte, inside a
// wrapper that gives it a private `module`/`exports`. The UMD then takes its CommonJS branch, so the wrapper alone
// decides what becomes global: window.WGLiveHls. A window.Hls from the theme or another plugin is never read or
// replaced. The library is not run through Vite: its transmux worker is started from its own function source
// (__HLS_WORKER_BUNDLE__.toString()), so the shipped bytes stay exactly as published.
//
// The full build, not hls.light: light leaves out alternate audio (EXT-X-MEDIA audio groups), the usual CMAF
// layout, and would play such a stream as silent video. The file loads only for hls sources and sits outside the
// core budget; check-artifact reports its size on its own line.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HLS_FILE = 'wg-live-hls.js';
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

/**
 * The two files as strings (the dev harness serves the script from memory).
 * @param {{ root: string, expectVersion?: string }} options
 * @returns {{ version: string, js: string, notices: string }}
 * @throws {Error} when hls.js is missing or not the pinned version
 */
export function renderHls({ root, expectVersion }) {
  const pkgDir = join(root, 'node_modules', 'hls.js');
  const lib = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pinned = expectVersion ?? String(own.dependencies?.['hls.js'] ?? '');
  if (lib.version !== pinned) {
    throw new Error(`hls.js ${lib.version} is installed, expected ${pinned} (run npm ci)`);
  }

  const source = readFileSync(join(pkgDir, 'dist', 'hls.min.js'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n');
  const js =
    `/*! WG Studio Live: hls.js ${lib.version} (Apache-2.0, see ${NOTICES_FILE}). Defines window.WGLiveHls only. */\n` +
    '(function(){var module={exports:{}};var exports=module.exports;\n' +
    source.trimEnd() +
    '\n;window.WGLiveHls=module.exports;})();\n';

  const license = readFileSync(join(pkgDir, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
  const notices =
    'WG Studio Live (wg-live) bundles the following third-party software.\n\n' +
    `hls.js ${lib.version}\n` +
    'https://github.com/video-dev/hls.js\n' +
    `File: assets/dist/${HLS_FILE}\n` +
    'License: Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0)\n\n' +
    `${license}\n`;
  return { version: lib.version, js, notices };
}

/**
 * @param {{ root: string, dist?: string, expectVersion?: string }} options
 * @returns {{ version: string, bytes: number }}
 * @throws {Error} when hls.js is missing or not the pinned version
 */
export function buildHls({ root, dist = join(root, 'plugin', 'wg-live', 'assets', 'dist'), expectVersion }) {
  const { version, js, notices } = renderHls({ root, expectVersion });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, HLS_FILE), js);
  writeFileSync(join(dist, NOTICES_FILE), notices);
  return { version, bytes: Buffer.byteLength(js) };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { version, bytes } = buildHls({ root });
    console.log(`build-hls: wrote ${HLS_FILE} (hls.js ${version}, ${bytes} bytes) and ${NOTICES_FILE}`);
    return 0;
  } catch (err) {
    console.error(`build-hls: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
