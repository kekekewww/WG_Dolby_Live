#!/usr/bin/env node
// Generates the bundled demo video with ffmpeg (spec 5.3 media area, M1-PLAN D7).
//
// Every concert is streamed with video, so the demo needs a picture as well as sound. Two clips, one per
// listening mode, so a mode switch is visible and audible:
//
//   demo-video-1.mp4  binaural mode: 示範影片 1, audio track = demo-tone-1.mp3
//   demo-video-2.mp4  atmos mode:    示範影片 2, audio track = demo-tone-2.mp3
//
// The picture is drawn from scratch: the demo poster's dark field (#111111 to #2b2b2b), its thin Studio
// Yellow accent, the captions 「介面示範 · WG Studio Live」 and 「操作示範影片，非 Binaural／Atmos 驗證素材」,
// an elapsed-time counter and a yellow progress line, so playback progress is visible. No spectrum, meter or
// anything that suggests a capability the demo does not have. The audio is the project's own demo tones
// (scripts/generate-demo-audio.mjs), so the clips contain no third-party material; the captions are rendered
// with Noto Sans TC (SIL OFL 1.1), and the font itself is not shipped.
//
// Format: H.264 Main 3.1, 960x540, 24 fps, yuv420p, keyframe every 2 s, +faststart; AAC-LC 96 kbps 44.1 kHz
// stereo; 30 s (the length of the audio). Plays natively in Safari (iOS and macOS), Chrome, Edge and Firefox,
// and in the Chromium, Firefox and WebKit builds that Playwright ships. Encoded single-threaded with bitexact
// flags, so re-running gives the same bytes with the same ffmpeg build.
//
// Usage: node scripts/generate-demo-video.mjs
//   ffmpeg and ffprobe must be on PATH. The font is found automatically (Noto Sans TC on Windows, Linux or
//   macOS); set WG_DEMO_FONT=<path to a Noto Sans TC .ttf/.otf> to choose one.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = join(root, 'plugin', 'wg-live', 'assets', 'demo');

const WIDTH = 960;
const HEIGHT = 540;
const FPS = 24;
const DURATION = 30; // seconds; the demo audio is 30 s and the player loops demo sources
const MAX_BYTES = 1536 * 1024;

const COLORS = { night: '0x111111', field: '0x2b2b2b', paper: '0xf0f5fa', mist: '0xc0c8d0', yellow: '0xf0d62b' };

/** @typedef {{ file: string, audio: string, title: string, mode: string, reverse: boolean }} Clip */

/** @type {Clip[]} */
const CLIPS = [
  { file: 'demo-video-1.mp4', audio: 'demo-tone-1.mp3', title: '示範影片 1', mode: 'Binaural 模式的示範來源', reverse: false },
  { file: 'demo-video-2.mp4', audio: 'demo-tone-2.mp3', title: '示範影片 2', mode: 'Atmos 模式的示範來源', reverse: true },
];

const BRAND = '介面示範 · WG Studio Live';
const CAPTION = '操作示範影片，非 Binaural／Atmos 驗證素材';
// drawtext expansion: elapsed mm:ss of the current loop.
const TIMECODE = '%{eif:floor(t/60):d:2}:%{eif:mod(floor(t),60):d:2}';

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(bin, args, cwd) {
  const r = spawnSync(bin, args, { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ${bin}: ${r.error.message} (is it on PATH?)`);
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed (${r.status}):\n${r.stderr}`);
  return r;
}

/** A Noto Sans TC font file, or a clear error. */
function findFont() {
  const fromEnv = process.env.WG_DEMO_FONT;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`WG_DEMO_FONT=${fromEnv} does not exist`);
    return fromEnv;
  }
  const dirs = [
    'C:/Windows/Fonts',
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts'),
    '/usr/share/fonts/opentype/noto',
    '/usr/share/fonts/truetype/noto',
    '/usr/share/fonts/noto',
    '/Library/Fonts',
    join(homedir(), 'Library', 'Fonts'),
  ];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    const hit = readdirSync(dir).find((n) => /^NotoSansTC.*\.(?:ttf|otf)$/i.test(n));
    if (hit) return join(dir, hit);
  }
  throw new Error('Noto Sans TC was not found. Install it, or set WG_DEMO_FONT to its .ttf/.otf file.');
}

/**
 * The filter graph for one clip. Runs with cwd = the work dir, so font and text files are plain relative
 * names (no Windows drive-letter escaping inside the filter graph).
 * @param {Clip} clip
 */
function filterGraph(clip) {
  const x0 = clip.reverse ? WIDTH : 0;
  const x1 = clip.reverse ? 0 : WIDTH;
  // The installed Noto Sans TC is a variable font and drawtext renders its thin default instance; a border in
  // the text colour brings the strokes close to the 400-500 weights of the site (HYBRID.md type roles).
  const text = (/** @type {string} */ file, /** @type {number} */ size, /** @type {string} */ color, /** @type {string} */ x, /** @type {string} */ y, weight = 1) =>
    `drawtext=fontfile=font.ttf:textfile=${file}:fontsize=${size}:fontcolor=${color}:borderw=${weight}:bordercolor=${color}:x=${x}:y=${y}`;
  return [
    `gradients=s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION}:c0=${COLORS.night}:c1=${COLORS.field}:nb_colors=2:x0=${x0}:y0=0:x1=${x1}:y1=${HEIGHT}:speed=0:seed=1[field]`,
    `color=c=${COLORS.yellow}:s=${WIDTH}x4:r=${FPS}:d=${DURATION}[line]`,
    // The progress line grows from the left over the clip; it restarts with the loop.
    `[field][line]overlay=x='-w+W*t/${DURATION}':y=H-4:eval=frame[bg]`,
    '[bg]' + [
      `drawbox=x=80:y=200:w=96:h=6:color=${COLORS.yellow}:t=fill`,
      text('brand.txt', 26, COLORS.mist, '80', '64'),
      text('title.txt', 84, COLORS.paper, '80', '226', 2),
      text('mode.txt', 38, COLORS.paper, '80', '338'),
      text('caption.txt', 26, COLORS.mist, '80', `${HEIGHT - 92}`),
      text('timecode.txt', 30, COLORS.paper, `w-tw-80`, `${HEIGHT - 94}`),
      'format=yuv420p[v]',
    ].join(','),
  ].join(';');
}

/**
 * @param {string} file
 * @returns {{ codecs: string[], width: number, height: number, duration: number }}
 */
function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.width);
  return { codecs: j.streams.map((s) => s.codec_name), width: v?.width ?? 0, height: v?.height ?? 0, duration: Number(j.format.duration) };
}

function main() {
  const font = findFont();
  const work = mkdtempSync(join(tmpdir(), 'wg-live-demo-video-'));
  try {
    copyFileSync(font, join(work, 'font.ttf'));
    writeFileSync(join(work, 'brand.txt'), BRAND);
    writeFileSync(join(work, 'caption.txt'), CAPTION);
    writeFileSync(join(work, 'timecode.txt'), TIMECODE);

    /** @type {string[]} */
    const digests = [];
    for (const clip of CLIPS) {
      const audio = join(demoDir, clip.audio);
      if (!existsSync(audio)) throw new Error(`${clip.audio} is missing; run node scripts/generate-demo-audio.mjs first`);
      writeFileSync(join(work, 'title.txt'), clip.title);
      writeFileSync(join(work, 'mode.txt'), clip.mode);
      const out = join(demoDir, clip.file);
      run('ffmpeg', [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
        '-i', audio,
        '-filter_complex', filterGraph(clip),
        '-map', '[v]', '-map', '0:a',
        '-t', String(DURATION),
        '-c:v', 'libx264', '-profile:v', 'main', '-level:v', '3.1', '-preset', 'slow', '-crf', '30',
        '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-threads', '1',
        '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
        '-movflags', '+faststart', '-map_metadata', '-1',
        '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
        out,
      ], work);

      const p = probe(out);
      const bytes = statSync(out).size;
      if (p.codecs.join(',') !== 'h264,aac') throw new Error(`${clip.file}: unexpected codecs ${p.codecs.join(',')}`);
      if (p.width !== WIDTH || p.height !== HEIGHT) throw new Error(`${clip.file}: ${p.width}x${p.height}`);
      if (Math.abs(p.duration - DURATION) > 0.5) throw new Error(`${clip.file}: duration ${p.duration}`);
      if (bytes > MAX_BYTES) throw new Error(`${clip.file}: ${bytes} bytes is over the ${MAX_BYTES} byte limit`);
      const digest = createHash('md5').update(readFileSync(out)).digest('hex');
      digests.push(digest);
      console.log(`${clip.file}: ${p.codecs.join('+')} ${p.width}x${p.height} ${p.duration.toFixed(2)} s, ${(bytes / 1024).toFixed(0)} KiB, md5 ${digest}`);
    }
    if (digests[0] === digests[1]) throw new Error('the two clips are identical');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
