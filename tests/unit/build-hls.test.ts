// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHls, HLS_FILE, NOTICES_FILE } from '../../scripts/build-hls.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function build(): { js: string; notices: string } {
  const dist = mkdtempSync(join(tmpdir(), 'wg-live-hls-'));
  dirs.push(dist);
  buildHls({ root: ROOT, dist });
  return { js: readFileSync(join(dist, HLS_FILE), 'utf8'), notices: readFileSync(join(dist, NOTICES_FILE), 'utf8') };
}

describe('build-hls (M2-PLAN C1)', () => {
  it('wraps the pinned hls.js so that only window.WGLiveHls is defined; another plugin\'s window.Hls is untouched', () => {
    const { js } = build();
    const theirs = { from: 'another plugin' };
    const sandbox: Record<string, unknown> = { Hls: theirs };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    const ctx = createContext(sandbox);
    runInContext(js, ctx);
    expect(sandbox.Hls).toBe(theirs);
    expect(typeof sandbox.WGLiveHls).toBe('function');
    expect((sandbox.WGLiveHls as { version: string }).version).toBe('1.7.3');
    expect(Object.keys(sandbox).sort()).toEqual(['Hls', 'WGLiveHls', 'self', 'window']);
  });

  it('ships the library bytes unchanged, without a source map reference, with LF line endings', () => {
    const { js } = build();
    const upstream = readFileSync(join(ROOT, 'node_modules', 'hls.js', 'dist', 'hls.min.js'), 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '');
    expect(js).toContain(upstream);
    expect(js).not.toMatch(/sourceMappingURL/);
    expect(js).not.toContain('\r');
    expect(js.startsWith('/*! WG Studio Live: hls.js 1.7.3')).toBe(true);
  });

  it('writes the third-party notice from the package license', () => {
    const { notices } = build();
    expect(notices).toContain('hls.js 1.7.3');
    expect(notices).toContain('Apache License, Version 2.0');
    expect(notices).toContain('Dailymotion');
    expect(notices).toContain('Brightcove');
    expect(notices).not.toContain('\r');
  });

  it('refuses any other hls.js version than the pinned one', () => {
    const dist = mkdtempSync(join(tmpdir(), 'wg-live-hls-'));
    dirs.push(dist);
    expect(() => buildHls({ root: ROOT, dist, expectVersion: '9.9.9' })).toThrow(/hls\.js 1\.7\.3 is installed, expected 9\.9\.9/);
  });
});
