// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { checkEntries, checkZip } from '../../scripts/check-artifact.mjs';
import { collectFiles, entryNameProblem, packagePlugin, parsePluginVersion, parseStableTag, shouldShip } from '../../scripts/package.mjs';

const VERSION = '1.2.3';

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A passing set of files, keyed by path inside the ZIP. Tests override or remove entries. */
function goodFiles(): Record<string, string | Uint8Array> {
  const js = 'var WGLive=(function(){"use strict";return{}})();';
  const css = '.wg-live{color:inherit}.wg-live__a,.wg-live--b .wg-live__c{margin:0}';
  const featured = '.wg-live-featured{display:block}';
  const info = {
    version: VERSION,
    commit: 'abc1234',
    builtAt: '2026-01-01T00:00:00.000Z',
    files: {
      'wg-live.js': { bytes: js.length, sha256: sha256(strToU8(js)) },
      'wg-live.css': { bytes: css.length, sha256: sha256(strToU8(css)) },
      'wg-live-featured.css': { bytes: featured.length, sha256: sha256(strToU8(featured)) },
    },
  };
  return {
    'wg-live/wg-live.php': `<?php\n/**\n * Plugin Name: WG Studio Live\n * Version: ${VERSION}\n */\ndefined( 'ABSPATH' ) || exit;\n`,
    'wg-live/readme.txt': `=== WG Studio Live ===\nStable tag: ${VERSION}\n`,
    'wg-live/includes/class-plugin.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/templates/events.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/assets/dist/wg-live.js': js,
    'wg-live/assets/dist/wg-live.css': css,
    'wg-live/assets/dist/wg-live-featured.css': featured,
    'wg-live/assets/dist/build-info.json': JSON.stringify(info),
    'wg-live/assets/admin/admin.js': 'console.log(1);',
    'wg-live/assets/admin/admin.css': '.wg-live-admin{color:inherit}.wg-live-admin__row{margin:0}',
    'wg-live/assets/demo/demo-tone-1.mp3': new Uint8Array([1, 2, 3]),
    'wg-live/assets/demo/demo-tone-2.mp3': new Uint8Array([4, 5, 6]),
    'wg-live/assets/demo/poster-demo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'wg-live/assets/demo/LICENSE-demo.txt': 'demo assets',
  };
}

type Files = Record<string, string | Uint8Array | null>;

function buildZip(overrides: Files = {}): { zip: Uint8Array; sha256Text: string } {
  const merged: Files = { ...goodFiles(), ...overrides };
  const entries: Record<string, Uint8Array> = {};
  for (const name of Object.keys(merged).sort()) {
    const v = merged[name];
    if (v == null) continue;
    entries[name] = typeof v === 'string' ? strToU8(v) : v;
  }
  const zip = zipSync(entries);
  return { zip, sha256Text: `${sha256(zip)}  wg-live-${VERSION}.zip\n` };
}

function run(overrides: Files = {}, opts: { sha256Text?: string | null; packageVersion?: string } = {}) {
  const { zip, sha256Text } = buildZip(overrides);
  return checkZip(zip, {
    zipName: `wg-live-${VERSION}.zip`,
    packageVersion: opts.packageVersion ?? VERSION,
    sha256Text: opts.sha256Text === undefined ? sha256Text : opts.sha256Text,
  });
}

describe('check-artifact', () => {
  it('passes a clean artifact', () => {
    const r = run();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows.every((row) => row.ok)).toBe(true);
  });

  it('fails when wg-live.php is missing', () => {
    const r = run({ 'wg-live/wg-live.php': null });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain('wg-live/wg-live.php is missing');
  });

  it('fails with more than one root or a wrong root', () => {
    const two = run({ 'other/file.txt': 'x' });
    expect(two.ok).toBe(false);
    expect(two.problems.join('\n')).toMatch(/exactly one root/);

    const entries = { 'plugin/wg-live.php': strToU8('<?php') };
    const wrong = checkEntries(entries);
    expect(wrong.problems.join('\n')).toMatch(/exactly one root/);
  });

  it('rejects backslashes, absolute paths and ".." segments', () => {
    const r = checkEntries({
      'wg-live/wg-live.php': strToU8('<?php'),
      'wg-live\\evil.php': strToU8('x'),
      'wg-live/../x.php': strToU8('x'),
    });
    const text = r.problems.join('\n');
    expect(text).toContain('backslash');
    expect(text).toContain('".." segment');
  });

  it('flags every forbidden entry in one run', () => {
    const r = run({
      'wg-live/node_modules/x/index.js': 'x',
      'wg-live/.git/config': 'x',
      'wg-live/.env': 'SECRET=1',
      'wg-live/.env.local': 'SECRET=1',
      'wg-live/src/main.ts': 'export {}',
      'wg-live/assets/dist/wg-live.js.map': '{}',
      'wg-live/assets/fonts/a.woff2': new Uint8Array([0]),
      'wg-live/assets/fonts/b.ttf': new Uint8Array([0]),
      'wg-live/assets/fonts/c.otf': new Uint8Array([0]),
      'wg-live/backup.zip': new Uint8Array([0]),
      'wg-live/playwright-report/index.html': 'x',
      'wg-live/test-results/a.txt': 'x',
      'wg-live/screenshots/home.png': new Uint8Array([0]),
      'wg-live/evidence/log.txt': 'x',
      'wg-live/.DS_Store': new Uint8Array([0]),
      'wg-live/assets/demo/.gitkeep': '',
    });
    expect(r.ok).toBe(false);
    const forbidden = r.problems.filter((p) => p.startsWith('forbidden entries'));
    for (const needle of [
      'node_modules',
      '.git/config',
      '.env"',
      '.env.local',
      'main.ts',
      '.map',
      'a.woff2',
      'b.ttf',
      'c.otf',
      'backup.zip',
      'playwright-report',
      'test-results',
      'screenshots',
      'evidence',
      '.DS_Store',
      '.gitkeep',
    ]) {
      expect(forbidden.join('\n'), needle).toContain(needle);
    }
  });

  it('flags dev-server strings in js, css and php but not in other files', () => {
    const r = run({
      'wg-live/assets/dist/wg-live.js': 'fetch("http://localhost:5174/x")',
      'wg-live/includes/class-plugin.php': "<?php\n$u = 'http://127.0.0.1/x';\n",
      'wg-live/templates/events.php': "<?php\n// /@vite/client\n",
      'wg-live/readme.txt': `Stable tag: ${VERSION}\nUse localhost for tests.\n`,
    });
    const text = r.problems.filter((p) => p.startsWith('dev strings')).join('\n');
    expect(text).toContain('wg-live/assets/dist/wg-live.js:1 contains "localhost"');
    expect(text).toContain('":5174"');
    expect(text).toContain('class-plugin.php:2 contains "127.0.0.1"');
    expect(text).toContain('"/@vite"');
    expect(text).not.toContain('readme.txt');
  });

  it('flags unscoped CSS selectors with file and line', () => {
    const r = run({ 'wg-live/assets/dist/wg-live.css': '.wg-live{color:red}\nbody{margin:0}\n' });
    const text = r.problems.filter((p) => p.startsWith('css scope')).join('\n');
    expect(text).toContain('wg-live/assets/dist/wg-live.css:2');
    expect(text).toContain('"body"');
  });

  it('enforces the per-page gzip size budgets', () => {
    // Random bytes do not compress, so these exceed the budgets even after gzip.
    const bigJs = randomBytes(110 * 1024);
    const r = run({ 'wg-live/assets/dist/wg-live.js': bigJs });
    expect(r.problems.some((p) => p.startsWith('size budgets') && p.includes('player page') && p.includes('wg-live.js'))).toBe(true);

    // Hex of random bytes: ~64 KB of text that gzips to ~32 KB, just over the 30 KiB budget.
    const bigCss = `.wg-live{content:"${randomBytes(32 * 1024).toString('hex')}"}`;
    const player = run({ 'wg-live/assets/dist/wg-live.css': bigCss });
    expect(player.problems.some((p) => p.startsWith('size budgets') && p.includes('player page') && p.includes('wg-live.css'))).toBe(true);

    const home = run({ 'wg-live/assets/dist/wg-live-featured.css': bigCss.replace('.wg-live{', '.wg-live-featured{') });
    expect(home.problems.some((p) => p.startsWith('size budgets') && p.includes('homepage') && p.includes('wg-live-featured.css'))).toBe(true);
    expect(home.problems.filter((p) => p.startsWith('size budgets') && p.includes('player'))).toEqual([]);
  });

  it('budgets are per file, not summed', () => {
    // Two CSS files of about 20 KiB gzip each: over 30 KiB combined, but within each budget.
    const css = (block: string) => `.${block}{content:"${randomBytes(21 * 1024).toString('hex')}"}`;
    const r = run({ 'wg-live/assets/dist/wg-live.css': css('wg-live'), 'wg-live/assets/dist/wg-live-featured.css': css('wg-live-featured') });
    expect(r.problems.filter((p) => p.startsWith('size budgets'))).toEqual([]);
  });

  it('passes a script just under the budget', () => {
    const js = Buffer.alloc(300 * 1024, 'a'); // compresses to almost nothing
    const r = run({ 'wg-live/assets/dist/wg-live.js': js });
    expect(r.problems.filter((p) => p.startsWith('size budgets'))).toEqual([]);
  });

  it('applies the package allowlist: no .m4a, no unknown folders, admin assets are fine', () => {
    expect(run().problems).toEqual([]); // goodFiles has assets/admin/*, demo mp3 + poster + license
    const r = run({
      'wg-live/assets/demo/demo-tone.m4a': new Uint8Array([1]),
      'wg-live/assets/other/x.js': 'x',
      'wg-live/assets/admin/admin.png': new Uint8Array([1]),
      'wg-live/composer.json': '{}',
    });
    const text = r.problems.filter((p) => p.startsWith('allowlist')).join('\n');
    expect(text).toContain('demo-tone.m4a');
    expect(text).toContain('assets/other/x.js');
    expect(text).toContain('admin.png');
    expect(text).toContain('composer.json');
  });

  it('scope-checks admin CSS too (wg-live-admin is an allowed block there, but not in dist)', () => {
    const bad = run({ 'wg-live/assets/admin/admin.css': '.wrap h2{color:red}' });
    expect(bad.problems.join('\n')).toContain('wg-live/assets/admin/admin.css:1');
    const notInDist = run({ 'wg-live/assets/dist/wg-live.css': '.wg-live-admin{color:red}' });
    expect(notInDist.problems.some((p) => p.startsWith('css scope'))).toBe(true);
  });

  it('fails on dev-server strings only in js, css and php', () => {
    const r = run({ 'wg-live/assets/admin/admin.js': 'fetch("http://localhost:8888")' });
    expect(r.problems.join('\n')).toContain('admin.js:1 contains "localhost"');
  });

  it('requires equal versions everywhere', () => {
    const header = run({ 'wg-live/wg-live.php': "<?php\n/**\n * Version: 9.9.9\n */\n" });
    expect(header.problems.join('\n')).toContain('versions differ');

    const readme = run({ 'wg-live/readme.txt': '=== X ===\nStable tag: 0.0.1\n' });
    expect(readme.problems.join('\n')).toContain('readme Stable tag=0.0.1');

    const pkg = run({}, { packageVersion: '2.0.0' });
    expect(pkg.problems.join('\n')).toContain('package.json=2.0.0');

    const info = JSON.parse(String(goodFiles()['wg-live/assets/dist/build-info.json']));
    info.version = '0.0.9';
    const build = run({ 'wg-live/assets/dist/build-info.json': JSON.stringify(info) });
    expect(build.problems.join('\n')).toContain('build-info.json=0.0.9');
  });

  it('checks the dist file set and build-info hashes', () => {
    const extra = run({ 'wg-live/assets/dist/chunk.js': 'x' });
    expect(extra.problems.join('\n')).toContain('chunk.js is not an allowed dist file');

    const missing = run({ 'wg-live/assets/dist/wg-live-featured.css': null });
    expect(missing.problems.join('\n')).toContain('wg-live-featured.css is missing');

    const tampered = run({ 'wg-live/assets/dist/wg-live.js': 'var WGLive={tampered:true};' });
    expect(tampered.problems.join('\n')).toContain('wg-live.js does not match its SHA-256');
  });

  it('checks the .sha256 file', () => {
    expect(run({}, { sha256Text: null }).problems.join('\n')).toContain('the .sha256 file is missing');

    const wrongHash = `${'0'.repeat(64)}  wg-live-${VERSION}.zip\n`;
    expect(run({}, { sha256Text: wrongHash }).problems.join('\n')).toContain('does not match the ZIP');

    const { zip } = buildZip();
    const wrongName = `${sha256(zip)}  other.zip\n`;
    expect(run({}, { sha256Text: wrongName }).problems.join('\n')).toContain('names "other.zip"');

    expect(run({}, { sha256Text: 'garbage' }).problems.join('\n')).toContain('format');
  });

  it('reports a corrupt ZIP instead of throwing', () => {
    const r = checkZip(new Uint8Array([1, 2, 3, 4]), {});
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('not a readable ZIP');
  });

  it('lists all problems at once', () => {
    const r = run({
      'wg-live/wg-live.php': null,
      'wg-live/src/a.ts': 'x',
      'wg-live/assets/dist/wg-live.css': 'body{}',
    });
    const checks = new Set(r.problems.map((p) => p.split(':')[0]));
    expect(checks.has('main file')).toBe(true);
    expect(checks.has('forbidden entries')).toBe(true);
    expect(checks.has('css scope')).toBe(true);
  });
});

describe('package.mjs helpers', () => {
  it('parses the plugin header Version and the readme Stable tag', () => {
    expect(parsePluginVersion('<?php\n/**\n * Plugin Name: X\n * Version:           0.1.0\n * Requires PHP: 7.4\n */')).toBe('0.1.0');
    expect(parsePluginVersion('<?php\n// nothing')).toBeNull();
    expect(parseStableTag('=== X ===\nStable tag: 0.1.0\n')).toBe('0.1.0');
    expect(parseStableTag('=== X ===\n')).toBeNull();
  });

  it('applies the allowlist', () => {
    const ship = [
      'wg-live.php',
      'uninstall.php',
      'readme.txt',
      'LICENSE',
      'LICENSE.txt',
      'includes/class-plugin.php',
      'templates/events.php',
      'assets/dist/wg-live.js',
      'assets/dist/wg-live.css',
      'assets/dist/build-info.json',
      'assets/dist/wg-live-featured.css',
      'assets/admin/admin.js',
      'assets/admin/admin.css',
      'assets/demo/demo-tone-1.mp3',
      'assets/demo/demo-tone-2.mp3',
      'assets/demo/poster-demo.svg',
      'assets/demo/LICENSE-demo.txt',
      'licenses/hls.js.txt',
    ];
    const skip = [
      '.gitkeep',
      'assets/dist/.gitkeep',
      'assets/dist/wg-live.js.map',
      'node_modules/x/index.js',
      'includes/node_modules/x.js',
      'assets/fonts/a.woff2',
      'includes/b.ttf',
      'includes/c.otf',
      'src/main.ts',
      'includes/types.d.ts',
      'backup.zip',
      'tests/a.php',
      'evidence/a.txt',
      'screenshots/a.png',
      'package.json',
      'composer.json',
      'assets/demo/notes.md',
      'assets/demo/demo-tone.m4a',
      'assets/demo/demo-tone.wav',
      'assets/demo/poster-other.svg',
      'assets/dist/chunk-abc.js',
      'assets/dist/wg-live-featured.js',
      'assets/dist/sub/wg-live.js',
      'assets/admin/admin.png',
      'assets/admin/admin.js.map',
      'assets/demo/sub/x.mp3',
      'assets/other/x.js',
      'docs/readme.txt',
    ];
    for (const p of ship) expect(shouldShip(p), p).toBe(true);
    for (const p of skip) expect(shouldShip(p), p).toBe(false);
  });
});

describe('package.mjs end to end on a fake plugin', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fakeRepo(opts: { header?: string; stable?: string; buildInfo?: boolean; tamper?: boolean } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'wg-live-pkg-'));
    dirs.push(root);
    const plugin = join(root, 'plugin', 'wg-live');
    for (const d of ['includes', 'templates', 'assets/dist', 'assets/demo', 'assets/admin', 'assets/fonts', 'node_modules/x', 'tests']) {
      mkdirSync(join(plugin, d), { recursive: true });
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'wg-live', version: VERSION }));
    writeFileSync(join(plugin, 'wg-live.php'), `<?php\n/**\n * Version: ${opts.header ?? VERSION}\n */\n`);
    writeFileSync(join(plugin, 'readme.txt'), `=== X ===\nStable tag: ${opts.stable ?? VERSION}\n`);
    writeFileSync(join(plugin, 'includes', 'a.php'), '<?php');
    writeFileSync(join(plugin, 'templates', 'b.php'), '<?php');
    const dist: Record<string, string> = { 'wg-live.js': 'js', 'wg-live.css': '.wg-live{a:b}', 'wg-live-featured.css': '.wg-live-featured{a:b}' };
    const files: Record<string, { sha256: string }> = {};
    for (const [name, body] of Object.entries(dist)) {
      files[name] = { sha256: sha256(strToU8(body)) };
      writeFileSync(join(plugin, 'assets', 'dist', name), opts.tamper && name === 'wg-live.js' ? 'edited after build' : body);
    }
    writeFileSync(join(plugin, 'assets', 'dist', 'wg-live.js.map'), '{}');
    writeFileSync(join(plugin, 'assets', 'dist', 'chunk-stray.js'), 'x');
    writeFileSync(join(plugin, 'assets', 'dist', '.gitkeep'), '');
    if (opts.buildInfo !== false) writeFileSync(join(plugin, 'assets', 'dist', 'build-info.json'), JSON.stringify({ version: VERSION, files }));
    writeFileSync(join(plugin, 'assets', 'admin', 'admin.js'), 'a');
    writeFileSync(join(plugin, 'assets', 'admin', 'admin.css'), '.wg-live-admin{a:b}');
    writeFileSync(join(plugin, 'assets', 'demo', 'demo-tone-1.mp3'), 'mp3');
    writeFileSync(join(plugin, 'assets', 'demo', 'demo-tone-2.mp3'), 'mp3b');
    writeFileSync(join(plugin, 'assets', 'demo', 'demo-tone.m4a'), 'm4a');
    writeFileSync(join(plugin, 'assets', 'demo', 'poster-demo.svg'), '<svg/>');
    writeFileSync(join(plugin, 'assets', 'demo', 'LICENSE-demo.txt'), 'license');
    writeFileSync(join(plugin, 'assets', 'fonts', 'f.woff2'), 'font');
    writeFileSync(join(plugin, 'node_modules', 'x', 'i.js'), 'x');
    writeFileSync(join(plugin, 'tests', 't.php'), '<?php');
    return root;
  }

  it('builds a reproducible single-root ZIP with a sha256 file', () => {
    const root = fakeRepo();
    const r1 = packagePlugin({ root });
    const bytes1 = readFileSync(r1.zipPath);

    const names = Object.keys(unzipSync(new Uint8Array(bytes1)));
    expect(names).toEqual([...names].sort());
    expect(names.every((n) => n.startsWith('wg-live/'))).toBe(true);
    expect(names).toContain('wg-live/wg-live.php');
    expect(names.some((n) => /node_modules|\.map$|woff|\.gitkeep|tests\//.test(n))).toBe(false);
    expect(names).toEqual([
      'wg-live/assets/admin/admin.css',
      'wg-live/assets/admin/admin.js',
      'wg-live/assets/demo/LICENSE-demo.txt',
      'wg-live/assets/demo/demo-tone-1.mp3',
      'wg-live/assets/demo/demo-tone-2.mp3',
      'wg-live/assets/demo/poster-demo.svg',
      'wg-live/assets/dist/build-info.json',
      'wg-live/assets/dist/wg-live-featured.css',
      'wg-live/assets/dist/wg-live.css',
      'wg-live/assets/dist/wg-live.js',
      'wg-live/includes/a.php',
      'wg-live/readme.txt',
      'wg-live/templates/b.php',
      'wg-live/wg-live.php',
    ]);

    expect(readFileSync(r1.shaPath, 'utf8')).toBe(`${sha256(new Uint8Array(bytes1))}  wg-live-${VERSION}.zip\n`);

    const r2 = packagePlugin({ root });
    expect(r2.sha256).toBe(r1.sha256);
    expect(collectFiles(join(root, 'plugin', 'wg-live'))).toEqual(r1.files);
  });

  it('fails when a dist file no longer matches build-info.json (stale build)', () => {
    expect(() => packagePlugin({ root: fakeRepo({ tamper: true }) })).toThrow(/wg-live.js does not match build-info.json/);
  });

  it('rejects unsafe entry names', () => {
    expect(entryNameProblem('wg-live/assets/dist/wg-live.js')).toBeNull();
    expect(entryNameProblem('wg-live\\evil.php')).toContain('backslash');
    expect(entryNameProblem('/wg-live/a.php')).toContain('absolute');
    expect(entryNameProblem('C:wg-live/a.php')).toContain('drive letter');
    expect(entryNameProblem('wg-live/../a.php')).toContain('..');
    expect(entryNameProblem('wg-live//a.php')).toContain('empty');
    expect(entryNameProblem('other/a.php')).toContain('wg-live/');
  });

  it('fails clearly when build output is missing', () => {
    expect(() => packagePlugin({ root: fakeRepo({ buildInfo: false }) })).toThrow(/run npm run build first/);
  });

  it('fails when the plugin header or Stable tag differ from package.json', () => {
    expect(() => packagePlugin({ root: fakeRepo({ header: '0.0.1' }) })).toThrow(/plugin header Version is 0\.0\.1/);
    expect(() => packagePlugin({ root: fakeRepo({ stable: '0.0.2' }) })).toThrow(/Stable tag is 0\.0\.2/);
  });

  it('fails clearly when wg-live.php or readme.txt do not exist yet', () => {
    const root = fakeRepo();
    rmSync(join(root, 'plugin', 'wg-live', 'wg-live.php'));
    expect(() => packagePlugin({ root })).toThrow(/wg-live\.php not found/);
  });
});
