// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_FILES, writeBuildInfo } from '../../scripts/build-info.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeRoot(files: Record<string, string>): { root: string; dist: string } {
  const root = mkdtempSync(join(tmpdir(), 'wg-live-bi-'));
  dirs.push(root);
  const dist = join(root, 'plugin', 'wg-live', 'assets', 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'wg-live', version: '3.2.1' }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dist, name), body);
  return { root, dist };
}

const GOOD = { 'wg-live.js': 'var WGLive={};', 'wg-live.css': '.wg-live{a:b}', 'wg-live-featured.css': '.wg-live-featured{a:b}' };

describe('build-info', () => {
  it('records version, commit and SHA-256 of exactly the fixed files', () => {
    const { root, dist } = fakeRoot(GOOD);
    const info = writeBuildInfo({ root, commit: 'abc1234', now: new Date('2026-01-02T03:04:05Z') });
    expect(info.version).toBe('3.2.1');
    expect(info.commit).toBe('abc1234');
    expect(info.builtAt).toBe('2026-01-02T03:04:05.000Z');
    expect(Object.keys(info.files)).toEqual(FIXED_FILES);
    expect(info.files['wg-live.js']?.sha256).toBe(createHash('sha256').update('var WGLive={};').digest('hex'));
    expect(JSON.parse(readFileSync(join(dist, 'build-info.json'), 'utf8'))).toEqual(info);
  });

  it.each(FIXED_FILES)('fails when %s is missing', (name) => {
    const files: Record<string, string> = { ...GOOD };
    delete files[name];
    const { root } = fakeRoot(files);
    expect(() => writeBuildInfo({ root, commit: 'x' })).toThrow(new RegExp(`missing build output: ${name.replace(/\./g, '\\.')}`));
  });

  it('fails when dist does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'wg-live-bi-'));
    dirs.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    expect(() => writeBuildInfo({ root, commit: 'x' })).toThrow(/does not exist/);
  });

  it('removes stray files (featured JS chunk, maps, chunks) and the Vite CSS marker', () => {
    const { root, dist } = fakeRoot({
      ...GOOD,
      'wg-live-featured.js': '',
      'wg-live.js.map': '{}',
      'chunk-abc.js': 'x',
      'wg-live.css': '/*$vite$:1*/.wg-live{a:b}',
    });
    const logs: string[] = [];
    const info = writeBuildInfo({ root, commit: 'x', log: (l) => logs.push(l) });
    expect(readdirSync(dist).sort()).toEqual(['build-info.json', ...FIXED_FILES].sort());
    expect(logs.join('\n')).toContain('removed stray wg-live-featured.js');
    expect(readFileSync(join(dist, 'wg-live.css'), 'utf8')).toBe('.wg-live{a:b}');
    // the hash is of the cleaned file
    expect(info.files['wg-live.css']?.sha256).toBe(createHash('sha256').update('.wg-live{a:b}').digest('hex'));
    expect(existsSync(join(dist, 'chunk-abc.js'))).toBe(false);
  });
});
