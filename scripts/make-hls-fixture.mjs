#!/usr/bin/env node
// Writes the local HLS test fixture (M2-PLAN C4): tests/.fixtures/hls/{binaural,atmos}/index.m3u8 + init.mp4 + seg_NNN.m4s,
// made from the bundled demo clip (plugin/wg-live/assets/demo/demo-video-1.mp4). Used only by the dev harness and the
// e2e suite; tests/.fixtures/ is gitignored and never packaged.
//
//   binaural: H.264 + AAC stereo
//   atmos:    H.264 + E-AC-3 5.1. NOT Dolby Atmos (no JOC/object metadata): it exercises the E-AC-3 decode path only.
//
// fMP4 segments of 4 s (keyframe every 4 s), a VOD playlist. ffmpeg must be on PATH, or set FFMPEG to its path.
//
//   npm run demo:hls

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = join(ROOT, 'plugin', 'wg-live', 'assets', 'demo', 'demo-video-1.mp4');
export const OUT = join(ROOT, 'tests', '.fixtures', 'hls');
const SEGMENT_S = 4;
const FPS = 24;

/** @type {Record<'binaural' | 'atmos', string[]>} */
export const AUDIO = {
  binaural: ['-c:a', 'aac', '-ac', '2', '-b:a', '128k'],
  atmos: ['-c:a', 'eac3', '-ac', '6', '-b:a', '384k'],
};

/**
 * Arguments for one playlist. ffmpeg runs with the output folder as its working directory: it writes the fMP4 init
 * segment next to its working directory, not next to the playlist, so every output name is relative.
 * @param {'binaural' | 'atmos'} mode
 * @returns {string[]}
 */
export function ffmpegArgs(mode) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', SOURCE,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-b:v', '900k',
    '-g', String(SEGMENT_S * FPS), '-keyint_min', String(SEGMENT_S * FPS), '-sc_threshold', '0',
    ...AUDIO[mode],
    '-f', 'hls',
    '-hls_time', String(SEGMENT_S),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', 'seg_%03d.m4s',
    'index.m3u8',
  ];
}

function main() {
  const bin = process.env.FFMPEG || 'ffmpeg';
  rmSync(OUT, { recursive: true, force: true });
  for (const mode of /** @type {const} */ (['binaural', 'atmos'])) {
    const dir = join(OUT, mode);
    mkdirSync(dir, { recursive: true });
    const r = spawnSync(bin, ffmpegArgs(mode), { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      console.error(`demo:hls: ffmpeg failed for ${mode}: ${r.error?.message ?? r.stderr}`);
      return 1;
    }
    console.log(`demo:hls: wrote ${join('tests', '.fixtures', 'hls', mode, 'index.m3u8')}`);
  }
  writeFileSync(
    join(OUT, 'README.txt'),
    'Local HLS test fixture (M2-PLAN C4), made by `npm run demo:hls` from demo-video-1.mp4.\n' +
      'binaural: H.264 + AAC stereo. atmos: H.264 + E-AC-3 5.1 -- NOT Dolby Atmos, only the E-AC-3 decode path.\n' +
      'Never ship, never use as Binaural/Atmos validation material.\n',
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
