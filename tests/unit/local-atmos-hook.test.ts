// @vitest-environment node
// The dev-only local Atmos hook (docs/implementation/ATMOS-LOCAL-TEST.md). Uses a temp file of fake bytes:
// no real media is read, copied or committed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_VIDEO_FILES,
  LOCAL_ATMOS_DEFAULT_TYPE,
  LOCAL_ATMOS_URL,
  handleRest,
  harnessEvents,
  localAtmosHook,
  resolvePlayback,
} from '../../dev/harness';
import { createDistServer } from '../../dev/serve-dist.mjs';

const NOW = Date.UTC(2026, 9, 10, 4, 0, 0);
const dir = mkdtempSync(join(tmpdir(), 'wg-atmos-hook-'));
const FILE = join(dir, 'fake-master.mp4');
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
writeFileSync(FILE, BYTES);
const [live, , , pending] = harnessEvents(NOW) as [
  ReturnType<typeof harnessEvents>[number],
  unknown,
  unknown,
  ReturnType<typeof harnessEvents>[number],
];

const saved = { file: process.env.WG_DEV_ATMOS_FILE, type: process.env.WG_DEV_ATMOS_TYPE };
function restoreEnv(): void {
  for (const [key, value] of [['WG_DEV_ATMOS_FILE', saved.file], ['WG_DEV_ATMOS_TYPE', saved.type]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('localAtmosHook()', () => {
  it('is off when the variable is unset, empty, missing a file or pointing at a directory', () => {
    expect(localAtmosHook({})).toBeNull();
    expect(localAtmosHook({ WG_DEV_ATMOS_FILE: '' })).toBeNull();
    expect(localAtmosHook({ WG_DEV_ATMOS_FILE: join(dir, 'nope.mp4') })).toBeNull();
    expect(localAtmosHook({ WG_DEV_ATMOS_FILE: dir })).toBeNull();
  });

  it('is on for an existing file, with the default or the given MIME type', () => {
    expect(localAtmosHook({ WG_DEV_ATMOS_FILE: FILE })).toMatchObject({ mimeType: LOCAL_ATMOS_DEFAULT_TYPE });
    expect(LOCAL_ATMOS_DEFAULT_TYPE).toBe('video/mp4; codecs="avc1.640028, ec-3"');
    expect(localAtmosHook({ WG_DEV_ATMOS_FILE: FILE, WG_DEV_ATMOS_TYPE: 'video/mp4' })?.mimeType).toBe('video/mp4');
  });
});

describe('resolvePlayback() with the hook', () => {
  const env = { WG_DEV_ATMOS_FILE: FILE };

  it('replaces only the live demo event ATMOS descriptor, never Binaural and never another event', () => {
    expect(resolvePlayback({ disabled: false, event: live, mode: 'atmos', env })).toEqual({
      kind: 'demo',
      url: LOCAL_ATMOS_URL,
      mimeType: LOCAL_ATMOS_DEFAULT_TYPE,
    });
    expect(resolvePlayback({ disabled: false, event: live, mode: 'binaural', env })).toMatchObject({ url: DEMO_VIDEO_FILES.binaural });
    expect(resolvePlayback({ disabled: false, event: pending, mode: 'atmos', env })).toMatchObject({ kind: 'not_ready' });
  });

  it('does not change the result when unset', () => {
    expect(resolvePlayback({ disabled: false, event: live, mode: 'atmos', env: {} })).toMatchObject({ url: DEMO_VIDEO_FILES.atmos });
  });

  it('is picked up by the REST mock through the process environment, and the public event data still has no URL', () => {
    process.env.WG_DEV_ATMOS_FILE = FILE;
    const answer = handleRest({ method: 'GET', route: 'playback', searchParams: new URLSearchParams({ event: '9001', mode: 'atmos' }), disabled: false, now: NOW });
    expect(answer.body).toMatchObject({ kind: 'demo', url: LOCAL_ATMOS_URL });
    expect(JSON.stringify(harnessEvents(NOW))).not.toContain('local-atmos');
    expect(JSON.stringify(harnessEvents(NOW))).not.toContain(dir);
  });
});

describe('/demo/local-atmos.mp4 on the dist server', () => {
  const server = createDistServer();
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('is a 404 while the hook is off', async () => {
    delete process.env.WG_DEV_ATMOS_FILE;
    expect((await fetch(`${base}${LOCAL_ATMOS_URL}`)).status).toBe(404);
  });

  it('streams the file with Range support and a video/mp4 content type (codecs stripped)', async () => {
    process.env.WG_DEV_ATMOS_FILE = FILE;
    const full = await fetch(`${base}${LOCAL_ATMOS_URL}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await full.arrayBuffer()).equals(BYTES)).toBe(true);

    const part = await fetch(`${base}${LOCAL_ATMOS_URL}`, { headers: { Range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(Buffer.from(await part.arrayBuffer()).equals(BYTES.subarray(10, 20))).toBe(true);

    const tail = await fetch(`${base}${LOCAL_ATMOS_URL}`, { headers: { Range: 'bytes=990-' } });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).equals(BYTES.subarray(990))).toBe(true);
  });

  it('cannot be used to read other files: the other names stay in the demo directories', async () => {
    process.env.WG_DEV_ATMOS_FILE = FILE;
    expect((await fetch(`${base}/demo/fake-master.mp4`)).status).toBe(404);
  });
});
