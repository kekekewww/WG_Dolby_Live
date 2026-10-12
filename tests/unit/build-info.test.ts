// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_FILES, gitState, writeBuildInfo } from '../../scripts/build-info.mjs';

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
    expect(info.dirty).toBe(false);
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

  it('records dirty: true when told so', () => {
    const { root } = fakeRoot(GOOD);
    const info = writeBuildInfo({ root, commit: 'abc1234', dirty: true });
    expect(info.dirty).toBe(true);
  });

  describe('git state (TR-01 / F2)', () => {
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
      expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
      return r.stdout.trim();
    };
    const repo = () => {
      const { root, dist } = fakeRoot(GOOD);
      git(root, 'init', '-q');
      writeFileSync(join(root, '.gitignore'), 'plugin/wg-live/assets/dist/\n');
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'main.ts'), 'export {};');
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'init');
      return { root, dist };
    };

    it('reports the full HEAD SHA, clean, and builds at the commit time so a rebuild is identical', () => {
      const { root, dist } = repo();
      const head = git(root, 'rev-parse', 'HEAD');
      expect(gitState(root)).toMatchObject({ commit: head, dirty: false });
      const a = writeBuildInfo({ root, now: new Date('2030-01-01T00:00:00Z') });
      expect(a.commit).toBe(head);
      expect(a.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(a.dirty).toBe(false);
      const bytes = readFileSync(join(dist, 'build-info.json'), 'utf8');
      const b = writeBuildInfo({ root, now: new Date('2031-06-06T00:00:00Z') });
      expect(b.builtAt).toBe(a.builtAt);
      expect(readFileSync(join(dist, 'build-info.json'), 'utf8')).toBe(bytes);
    });

    it('is dirty after an edit to a tracked file, or a new untracked file, but not for docs or the gitignored dist', () => {
      const { root } = repo();
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'note.md'), 'x');
      expect(gitState(root).dirty).toBe(false);

      writeFileSync(join(root, 'src', 'main.ts'), 'export const changed = 1;');
      expect(gitState(root).dirty).toBe(true);
      expect(writeBuildInfo({ root, now: new Date('2030-01-01T00:00:00Z') }).dirty).toBe(true);
      git(root, 'checkout', '--', 'src/main.ts');
      expect(gitState(root).dirty).toBe(false);

      writeFileSync(join(root, 'src', 'new.ts'), 'export {};');
      expect(gitState(root).dirty).toBe(true);
    });

    it('a dirty build is stamped with the build time, not a commit time', () => {
      const { root } = repo();
      writeFileSync(join(root, 'src', 'main.ts'), 'export const changed = 1;');
      const info = writeBuildInfo({ root, now: new Date('2030-01-01T00:00:00Z') });
      expect(info.builtAt).toBe('2030-01-01T00:00:00.000Z');
    });

    it('outside a git repository the commit is "uncommitted" and the tree dirty', () => {
      const { root } = fakeRoot(GOOD);
      // tmpdir is not inside a repo in CI; guard anyway so the test only asserts what it can know
      const probe = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
      if (probe.status === 0) return;
      expect(gitState(root)).toEqual({ commit: 'uncommitted', dirty: true, committedAt: null });
    });
  });
});
