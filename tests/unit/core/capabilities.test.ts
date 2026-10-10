import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('probeVolumeControl', () => {
  it('is true when the volume write reads back', async () => {
    const { probeVolumeControl, volumeProbeResult } = await import('../../../src/util/capabilities');
    expect(volumeProbeResult()).toBeNull();
    const p = probeVolumeControl();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(true);
    expect(volumeProbeResult()).toBe(true);
  });

  it('is false when volume is read-only, like iOS', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => undefined);
    const { probeVolumeControl } = await import('../../../src/util/capabilities');
    const p = probeVolumeControl();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(false);
  });

  it('is false (never throws) when setting volume throws', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => {
      throw new DOMException('nope', 'NotSupportedError');
    });
    const { probeVolumeControl } = await import('../../../src/util/capabilities');
    await expect(probeVolumeControl()).resolves.toBe(false);
  });

  it('runs once: later calls share the same promise', async () => {
    const create = vi.spyOn(document, 'createElement');
    const { probeVolumeControl } = await import('../../../src/util/capabilities');
    const a = probeVolumeControl();
    const b = probeVolumeControl();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(1);
    await a;
    expect(create.mock.calls.filter(([tag]) => tag === 'audio')).toHaveLength(1);
  });
});
