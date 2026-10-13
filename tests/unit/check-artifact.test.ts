// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { checkEntries, checkZip, REQUIRED_FILES } from '../../scripts/check-artifact.mjs';
import { collectFiles, entryNameProblem, isTextEntry, packagePlugin, parsePluginVersion, parseStableTag, parseVersionConstant, shouldShip, toLf } from '../../scripts/package.mjs';

const VERSION = '1.2.3';
const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const MAIN_PHP = (version: string, constant: string = version) =>
  `<?php\n/**\n * Plugin Name: WG Studio Live\n * Version: ${version}\n */\ndefined( 'ABSPATH' ) || exit;\ndefine( 'WG_LIVE_VERSION', '${constant}' );\nrequire_once WG_LIVE_DIR . 'includes/class-events.php';\nrequire_once WG_LIVE_DIR . 'includes/class-plugin.php';\n`;

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
    commit: COMMIT,
    dirty: false,
    builtAt: '2026-01-01T00:00:00.000Z',
    files: {
      'wg-live.js': { bytes: js.length, sha256: sha256(strToU8(js)) },
      'wg-live.css': { bytes: css.length, sha256: sha256(strToU8(css)) },
      'wg-live-featured.css': { bytes: featured.length, sha256: sha256(strToU8(featured)) },
    },
  };
  return {
    'wg-live/wg-live.php': MAIN_PHP(VERSION),
    'wg-live/uninstall.php': "<?php\ndefined( 'WP_UNINSTALL_PLUGIN' ) || exit;\n",
    'wg-live/readme.txt': `=== WG Studio Live ===\nStable tag: ${VERSION}\n`,
    'wg-live/includes/class-plugin.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/includes/class-events.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/templates/events.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/templates/featured.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/templates/help.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/templates/player.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
    'wg-live/templates/partials/container.php': "<?php\ndefined( 'ABSPATH' ) || exit;\n",
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

  it('fails when a shipped text file or a dist file has CRLF line endings', () => {
    const r = run({ 'wg-live/includes/class-events.php': "<?php\r\ndefined( 'ABSPATH' ) || exit;\r\n", 'wg-live/assets/admin/admin.css': '.wg-live-admin{color:inherit}\r\n' });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      'line endings: "wg-live/assets/admin/admin.css" has CRLF line endings',
      'line endings: "wg-live/includes/class-events.php" has CRLF line endings',
    ]);
    // Binary files may contain the bytes 0D 0A.
    expect(run({ 'wg-live/assets/demo/demo-tone-1.mp3': new Uint8Array([0x49, 0x44, 0x33, 13, 10, 0]) }).ok).toBe(true);
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
    const header = run({ 'wg-live/wg-live.php': MAIN_PHP('9.9.9', VERSION) });
    expect(header.problems.join('\n')).toContain('versions differ');

    // TR-04: the WG_LIVE_VERSION constant is compared too
    const constant = run({ 'wg-live/wg-live.php': MAIN_PHP(VERSION, '0.0.9') });
    expect(constant.ok).toBe(false);
    expect(constant.problems.join('\n')).toContain('WG_LIVE_VERSION=0.0.9');
    expect(constant.rows.find((r) => r.check === 'versions')?.ok).toBe(false);
    const noConstant = run({ 'wg-live/wg-live.php': MAIN_PHP(VERSION).replace(/define\([^;]*;/, '') });
    expect(noConstant.problems.join('\n')).toContain('WG_LIVE_VERSION: version not found');

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

describe('check-artifact: required files (TR-02)', () => {
  const required = [...REQUIRED_FILES, 'includes/class-events.php', 'includes/class-plugin.php'];

  it.each(required)('fails when %s is missing', (rel) => {
    const r = run({ [`wg-live/${rel}`]: null });
    expect(r.ok).toBe(false);
    expect(r.problems.filter((p) => p.startsWith('required files')).join('\n')).toContain(`wg-live/${rel} is missing`);
    expect(r.rows.find((row) => row.check === 'required files')?.ok).toBe(false);
  });

  it('a clean ZIP passes the required-files check', () => {
    const r = run();
    expect(r.rows.find((row) => row.check === 'required files')?.ok).toBe(true);
  });

  it('follows the require_once targets of wg-live.php, whatever they are', () => {
    const php = `${MAIN_PHP(VERSION)}require_once WG_LIVE_DIR . 'includes/class-new-thing.php';\n`;
    const r = run({ 'wg-live/wg-live.php': php });
    expect(r.problems.join('\n')).toContain('wg-live/includes/class-new-thing.php is missing');
  });
});

describe('check-artifact: build provenance (TR-01 / F2)', () => {
  const info = (extra: Record<string, unknown>) => {
    const base = JSON.parse(String(goodFiles()['wg-live/assets/dist/build-info.json']));
    return JSON.stringify({ ...base, ...extra });
  };
  const withInfo = (extra: Record<string, unknown>, allowDirty = false) => {
    const { zip, sha256Text } = buildZip({ 'wg-live/assets/dist/build-info.json': info(extra) });
    return checkZip(zip, { zipName: `wg-live-${VERSION}.zip`, packageVersion: VERSION, sha256Text, allowDirty });
  };

  it('reports the commit on a clean build', () => {
    const r = run();
    const row = r.rows.find((x) => x.check === 'build commit');
    expect(row?.ok).toBe(true);
    expect(row?.detail).toContain(COMMIT);
  });

  it('fails a dirty build unless allowDirty is set', () => {
    const bad = withInfo({ dirty: true });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join('\n')).toContain('dirty working tree');
    const allowed = withInfo({ dirty: true }, true);
    expect(allowed.problems).toEqual([]);
    expect(allowed.rows.find((x) => x.check === 'build commit')?.detail).toContain('dirty build allowed');
  });

  it('fails an "uncommitted", short or missing commit', () => {
    for (const commit of ['uncommitted', 'abc1234', undefined]) {
      const r = withInfo({ commit, dirty: false });
      expect(r.problems.join('\n'), String(commit)).toContain('full 40-character git SHA');
    }
    expect(withInfo({ commit: 'uncommitted', dirty: true }, true).problems).toEqual([]);
  });

  it('requires a boolean dirty field', () => {
    expect(withInfo({ dirty: undefined }).problems.join('\n')).toContain('no boolean "dirty" field');
  });
});

describe('package.mjs helpers', () => {
  it('treats PHP, text, SVG, CSS, JS and LICENSE as text, but not media or the hashed dist files', () => {
    for (const rel of ['wg-live.php', 'readme.txt', 'LICENSE', 'assets/demo/poster-demo.svg', 'assets/demo/LICENSE-demo.txt', 'assets/admin/admin.js', 'assets/admin/admin.css', 'templates/partials/container.php']) {
      expect(isTextEntry(rel), rel).toBe(true);
    }
    for (const rel of ['assets/demo/demo-tone-1.mp3', 'assets/dist/wg-live.js', 'assets/dist/wg-live.css', 'assets/dist/build-info.json', 'assets/demo/poster.png', '.php']) {
      expect(isTextEntry(rel), rel).toBe(false);
    }
  });

  it('toLf turns CRLF into LF and keeps a lone CR', () => {
    expect(new TextDecoder().decode(toLf(strToU8('a\r\nb\rc\n\r\n')))).toBe('a\nb\rc\n\n');
    const lf = strToU8('already\nLF\n');
    expect(toLf(lf)).toBe(lf);
  });

  it('parses the WG_LIVE_VERSION constant', () => {
    expect(parseVersionConstant("<?php\ndefine( 'WG_LIVE_VERSION', '0.1.0' );")).toBe('0.1.0');
    expect(parseVersionConstant('define("WG_LIVE_VERSION","2.0.0-rc.1");')).toBe('2.0.0-rc.1');
    expect(parseVersionConstant("define( 'OTHER', '1.0.0' );")).toBeNull();
  });

  it('ships only recognised file types (TR-03)', () => {
    const skip = [
      'includes/class-settings.php.bak',
      'includes/class-x.php~',
      'includes/backup.sql.gz',
      'includes/dump.sql',
      'includes/credentials.json',
      'includes/x.phar',
      'includes/Thumbs.db',
      'includes/notes.md',
      'includes/x.php.orig',
      'includes/x.php.swp',
      'includes/key.pem',
      'includes/private.key',
      'includes/site.sqlite',
      'includes/data.7z',
      'templates/notes.md',
      'templates/clip.mp4',
      'licenses/a.exe',
      'licenses/hls.js.txt.bak',
      'licenses/sub/hls.js.txt',
      'phpinfo.php',
      'config.php',
      'LICENSE-keys.pem',
      'LICENSE.bak',
      'readme.md',
    ];
    for (const p of skip) expect(shouldShip(p), p).toBe(false);
    for (const p of ['includes/sub/class-a.php', 'templates/partials/container.php', 'licenses/hls.js.md', 'NOTICE', 'NOTICE.txt']) {
      expect(shouldShip(p), p).toBe(true);
    }
  });

  it('check-artifact has its own allowlist: a .php.bak, a dump and a credentials file are rejected even if present', () => {
    const r = run({
      'wg-live/includes/class-settings.php.bak': '<?php',
      'wg-live/includes/backup.sql.gz': new Uint8Array([1]),
      'wg-live/includes/credentials.json': '{}',
      'wg-live/phpinfo.php': '<?php',
    });
    const text = r.problems.join('\n');
    expect(text).toContain('class-settings.php.bak');
    expect(text).toContain('backup.sql.gz');
    expect(text).toContain('credentials.json');
    expect(text).toContain('phpinfo.php');
  });

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

  function fakeRepo(opts: { header?: string; stable?: string; constant?: string; buildInfo?: boolean; tamper?: boolean; info?: Record<string, unknown> } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'wg-live-pkg-'));
    dirs.push(root);
    const plugin = join(root, 'plugin', 'wg-live');
    for (const d of ['includes', 'templates', 'assets/dist', 'assets/demo', 'assets/admin', 'assets/fonts', 'node_modules/x', 'tests']) {
      mkdirSync(join(plugin, d), { recursive: true });
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'wg-live', version: VERSION }));
    writeFileSync(join(plugin, 'wg-live.php'), MAIN_PHP(opts.header ?? VERSION, opts.constant ?? VERSION));
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
    if (opts.buildInfo !== false) writeFileSync(join(plugin, 'assets', 'dist', 'build-info.json'), JSON.stringify({ version: VERSION, commit: COMMIT, dirty: false, files, ...opts.info }));
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

  it('gives the same ZIP for an LF and a CRLF checkout of the same files, and leaves binaries alone', () => {
    const root = fakeRepo();
    const plugin = join(root, 'plugin', 'wg-live');
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 13, 10, 0]);
    const write = (eol: string) => {
      writeFileSync(join(plugin, 'assets', 'demo', 'poster-demo.svg'), ['<svg>', '<g/>', '</svg>', ''].join(eol));
      writeFileSync(join(plugin, 'includes', 'a.php'), ['<?php', '// a', ''].join(eol));
      writeFileSync(join(plugin, 'assets', 'demo', 'demo-tone-1.mp3'), mp3);
    };
    write('\n');
    const lf = packagePlugin({ root });
    write('\r\n');
    const crlf = packagePlugin({ root });
    expect(crlf.sha256).toBe(lf.sha256);

    const zip = new Uint8Array(readFileSync(crlf.zipPath));
    const entries = unzipSync(zip);
    expect(new TextDecoder().decode(entries['wg-live/includes/a.php'])).toBe('<?php\n// a\n');
    expect(entries['wg-live/assets/demo/demo-tone-1.mp3']).toEqual(mp3);
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

  it('fails when the WG_LIVE_VERSION constant differs from package.json (TR-04)', () => {
    expect(() => packagePlugin({ root: fakeRepo({ constant: '0.0.9' }) })).toThrow(/WG_LIVE_VERSION is 0\.0\.9/);
  });

  it('refuses a dirty, uncommitted or stale build unless allowDirty (TR-01 / F2)', () => {
    expect(() => packagePlugin({ root: fakeRepo({ info: { dirty: true } }) })).toThrow(/dirty working tree/);
    expect(() => packagePlugin({ root: fakeRepo({ info: { dirty: undefined } }) })).toThrow(/dirty working tree/);
    expect(() => packagePlugin({ root: fakeRepo({ info: { commit: 'uncommitted', dirty: true } }) })).toThrow(/committed tree/);
    expect(() => packagePlugin({ root: fakeRepo({ info: { commit: 'abc1234' } }) })).toThrow(/committed tree/);
    expect(() => packagePlugin({ root: fakeRepo({ info: { commit: undefined } }) })).toThrow(/committed tree/);

    // tree edited after the build, or HEAD moved on since
    expect(() => packagePlugin({ root: fakeRepo(), git: { commit: COMMIT, dirty: true } })).toThrow(/uncommitted changes since the build/);
    expect(() => packagePlugin({ root: fakeRepo(), git: { commit: OTHER_COMMIT, dirty: false } })).toThrow(/is not HEAD/);
    expect(packagePlugin({ root: fakeRepo(), git: { commit: COMMIT, dirty: false } }).files.length).toBeGreaterThan(0);

    // explicit override for a throw-away package
    const root = fakeRepo({ info: { commit: 'uncommitted', dirty: true } });
    expect(packagePlugin({ root, allowDirty: true, git: { commit: OTHER_COMMIT, dirty: true } }).files.length).toBeGreaterThan(0);
  });

  it('reports regular files it does not ship instead of dropping them silently (TR-02)', () => {
    const root = fakeRepo();
    writeFileSync(join(root, 'plugin', 'wg-live', 'assets', 'img.png'), 'png');
    mkdirSync(join(root, 'plugin', 'wg-live', 'languages'));
    writeFileSync(join(root, 'plugin', 'wg-live', 'languages', 'wg-live-zh_TW.mo'), 'mo');
    const r = packagePlugin({ root });
    expect(r.skipped).toContain('assets/img.png');
    expect(r.skipped).toContain('languages/wg-live-zh_TW.mo');
    expect(r.skipped).toContain('assets/demo/demo-tone.m4a');
    expect(r.skipped).not.toContain('.gitkeep');
    expect(r.files).not.toContain('languages/wg-live-zh_TW.mo');
  });

  it('fails clearly when wg-live.php or readme.txt do not exist yet', () => {
    const root = fakeRepo();
    rmSync(join(root, 'plugin', 'wg-live', 'wg-live.php'));
    expect(() => packagePlugin({ root })).toThrow(/wg-live\.php not found/);
  });
});
