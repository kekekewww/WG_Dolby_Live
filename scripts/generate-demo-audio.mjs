#!/usr/bin/env node
// Generates the bundled demo audio with ffmpeg (spec 11.3, M1-PLAN D7).
//
// Two audibly distinct, gentle pieces, synthesized from scratch (so the project owns them outright;
// see plugin/wg-live/assets/demo/LICENSE-demo.txt). Both are 30 s, 44.1 kHz stereo, encoded as
// 96 kbps MP3, normalised to a peak of about -18 dBFS, with a 2 s fade in and out. No full-scale
// test tones.
//
//   demo-tone-1.mp3  default for the binaural mode: C major, warm sine voices, slow chords
//                    Cmaj7 - Am7 - Fmaj7 - G6, slow pan drift
//   demo-tone-2.mp3  default for the atmos mode: A minor, hollow triangle-like voices with a soft
//                    tremolo and a higher register, five chords Am9 - Fmaj7 - Cmaj7 - Em7 - Dm9,
//                    faster pan drift
//
// Different keys, progressions, timbres and pacing make a mode switch observable by ear.
// MP3 plays in the Chromium, Firefox and WebKit builds that Playwright ships.
//
// The script also removes the legacy demo-tone.m4a and demo-tone.mp3 and verifies the result with
// ffprobe (duration, channels, codec, bit rate) and md5 (the two files must differ).
//
// Usage: node scripts/generate-demo-audio.mjs        (ffmpeg and ffprobe must be on PATH)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'plugin', 'wg-live', 'assets', 'demo');

const SAMPLE_RATE = 44100;
const DURATION = 30; // seconds
const FADE = 2; // seconds, in and out
const TARGET_PEAK_DB = -18;
const BITRATE = '96k';
const MAX_BYTES = 420 * 1024;
const LEGACY_FILES = ['demo-tone.m4a', 'demo-tone.mp3'];

/**
 * @typedef {{
 *   name: string,
 *   file: string,
 *   chords: number[][],
 *   panRate: number,
 *   harmonics: [number, number][],
 *   tremolo: { rate: number, depth: number } | null,
 * }} Piece
 */

/** @type {Piece[]} */
const PIECES = [
  {
    name: 'one',
    file: 'demo-tone-1.mp3',
    panRate: 0.11,
    // sine with a quiet second harmonic
    harmonics: [
      [1, 1],
      [2, 0.18],
    ],
    tremolo: null,
    // Cmaj7 - Am7 - Fmaj7 - G6
    chords: [
      [261.63, 329.63, 392.0, 493.88],
      [220.0, 261.63, 329.63, 392.0],
      [174.61, 220.0, 261.63, 329.63],
      [196.0, 246.94, 293.66, 329.63],
    ],
  },
  {
    name: 'two',
    file: 'demo-tone-2.mp3',
    panRate: 0.19,
    // triangle-like: odd harmonics with alternating sign
    harmonics: [
      [1, 1],
      [3, -0.111],
      [5, 0.04],
    ],
    tremolo: { rate: 3.1, depth: 0.14 },
    // Am9 - Fmaj7 - Cmaj7 - Em7 - Dm9 (a fifth of 6 s each)
    chords: [
      [220.0, 261.63, 329.63, 392.0, 493.88],
      [174.61, 220.0, 261.63, 329.63],
      [261.63, 329.63, 392.0, 493.88],
      [164.81, 196.0, 246.94, 329.63],
      [146.83, 220.0, 261.63, 349.23, 440.0],
    ],
  },
];

/** @param {number} n */
const f = (n) => n.toFixed(4);

/**
 * Build the aevalsrc expression pair (left|right) for a piece.
 * Every chord has a raised-cosine window; neighbours overlap by `ramp` seconds.
 * Every voice has a fixed detune between the channels (gentle chorus) and its own slow pan.
 * @param {Piece} piece
 */
function buildExpression(piece) {
  const segment = DURATION / piece.chords.length;
  const ramp = 1.5;
  /** @type {string[]} */
  const left = [];
  /** @type {string[]} */
  const right = [];
  piece.chords.forEach((chord, k) => {
    const a = k * segment - ramp / 2;
    const b = (k + 1) * segment + ramp / 2;
    const win =
      `(0.5-0.5*cos(PI*clip((t-${f(a)})/${f(ramp)},0,1)))*` +
      `(0.5-0.5*cos(PI*clip((${f(b)}-t)/${f(ramp)},0,1)))`;
    chord.forEach((hz, v) => {
      const phase = (k * 1.3 + v * 1.7) % (2 * Math.PI);
      const pan = `(0.5+0.35*sin(2*PI*${f(piece.panRate * (0.8 + v * 0.15))}*t+${f(phase)}))`;
      const trem = piece.tremolo
        ? `(1+${f(piece.tremolo.depth)}*sin(2*PI*${f(piece.tremolo.rate * (1 + v * 0.07))}*t+${f(phase)}))*`
        : '';
      const voice = (/** @type {number} */ freq) =>
        `${trem}(${piece.harmonics.map(([mult, amp]) => `${f(amp)}*sin(2*PI*${f(freq * mult)}*t)`).join('+')})`;
      left.push(`${win}*(1-${pan})*${voice(hz)}`);
      right.push(`${win}*${pan}*${voice(hz * 1.0022)}`);
    });
  });
  const scale = 0.12; // headroom before the measured normalisation pass
  return `${f(scale)}*(${left.join('+')})|${f(scale)}*(${right.join('+')})`;
}

/**
 * @param {string} bin
 * @param {string[]} args
 */
function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    throw new Error(`could not run ${bin}: ${r.error.message} (is it on PATH?)`);
  }
  if (r.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} failed (${r.status}):\n${r.stderr}`);
  }
  return r;
}

/**
 * @param {string} file
 * @returns {number} max_volume in dB
 */
function measurePeak(file) {
  const r = run('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(r.stderr);
  if (!m) throw new Error(`could not read max_volume for ${file}`);
  return Number(m[1]);
}

/**
 * Render a piece to a 16-bit wav in `dir` and normalise its peak to TARGET_PEAK_DB.
 * @param {Piece} piece
 * @param {string} dir
 * @returns {string} path of the normalised wav
 */
function renderPiece(piece, dir) {
  const raw = join(dir, `${piece.name}-raw.wav`);
  const src = `aevalsrc=exprs='${buildExpression(piece)}':s=${SAMPLE_RATE}:d=${DURATION}:c=stereo`;
  run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', src, '-c:a', 'pcm_s16le', raw]);
  const gain = TARGET_PEAK_DB - measurePeak(raw);

  const out = join(dir, `${piece.name}.wav`);
  const fadeOutStart = DURATION - FADE;
  run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', raw,
    '-af', `volume=${gain.toFixed(3)}dB,afade=t=in:st=0:d=${FADE}:curve=qsin,afade=t=out:st=${fadeOutStart}:d=${FADE}:curve=qsin`,
    '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s16le', out,
  ]);
  return out;
}

/**
 * @param {string} wav
 * @param {string} dest
 */
function encodeMp3(wav, dest) {
  run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', wav, '-map_metadata', '-1', '-vn',
    '-ar', String(SAMPLE_RATE), '-ac', '2',
    '-c:a', 'libmp3lame', '-b:a', BITRATE, '-id3v2_version', '0', '-write_id3v1', '0', dest,
  ]);
}

/**
 * @param {string} file
 * @returns {{ codec: string, channels: number, sampleRate: number, bitRate: number, duration: number }}
 */
function probe(file) {
  const r = run('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,channels,sample_rate,bit_rate:format=duration',
    '-of', 'json', file,
  ]);
  const j = JSON.parse(r.stdout);
  const s = j.streams?.[0] ?? {};
  return {
    codec: String(s.codec_name),
    channels: Number(s.channels),
    sampleRate: Number(s.sample_rate),
    bitRate: Number(s.bit_rate),
    duration: Number(j.format?.duration),
  };
}

const md5 = (/** @type {string} */ file) => createHash('md5').update(readFileSync(file)).digest('hex');

function main() {
  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'wg-live-demo-'));
  try {
    for (const piece of PIECES) {
      const dest = join(outDir, piece.file);
      encodeMp3(renderPiece(piece, tmp), dest);
      const bytes = statSync(dest).size;
      if (bytes >= MAX_BYTES) throw new Error(`${piece.file} is ${bytes} bytes (limit ${MAX_BYTES})`);
      console.log(`generate-demo-audio: wrote ${piece.file} (${(bytes / 1024).toFixed(0)} KB)`);
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }

  for (const legacy of LEGACY_FILES) {
    const file = join(outDir, legacy);
    if (existsSync(file)) {
      rmSync(file);
      console.log(`generate-demo-audio: removed legacy ${legacy}`);
    }
  }

  // Verify.
  const hashes = new Set();
  for (const piece of PIECES) {
    const file = join(outDir, piece.file);
    const p = probe(file);
    const peak = measurePeak(file);
    const problems = [];
    if (p.codec !== 'mp3') problems.push(`codec ${p.codec}`);
    if (p.channels !== 2) problems.push(`${p.channels} channels`);
    if (p.sampleRate !== SAMPLE_RATE) problems.push(`${p.sampleRate} Hz`);
    if (Math.abs(p.duration - DURATION) > 0.2) problems.push(`duration ${p.duration}`);
    if (Math.abs(p.bitRate - 96000) > 4000) problems.push(`bit rate ${p.bitRate}`);
    if (Math.abs(peak - TARGET_PEAK_DB) > 1.5) problems.push(`peak ${peak} dB`);
    if (problems.length > 0) throw new Error(`${piece.file} failed verification: ${problems.join(', ')}`);
    hashes.add(md5(file));
    console.log(
      `generate-demo-audio: ${piece.file}: ${p.codec} ${p.channels}ch ${p.sampleRate} Hz ${Math.round(p.bitRate / 1000)} kbps ${p.duration.toFixed(2)} s peak ${peak} dB md5 ${md5(file)}`,
    );
  }
  if (hashes.size !== PIECES.length) throw new Error('the demo files are identical (same md5)');
}

try {
  main();
} catch (err) {
  console.error(`generate-demo-audio: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
