/**
 * Boot-time capability probes (plan 6.10). Feature detection only, never the user agent.
 */

let volumeProbe: Promise<boolean> | null = null;
let volumeResult: boolean | null = null;

const PROBE_TIMEOUT_MS = 50;

/**
 * Can HTMLMediaElement.volume be set? iOS/iPadOS keep it read-only. The probe writes a value
 * to a detached element and reads it back after one task. It runs once; later calls share the
 * result. It never throws and always settles within ~50 ms (a timeout counts as "no").
 */
export function probeVolumeControl(): Promise<boolean> {
  if (volumeProbe) return volumeProbe;
  volumeProbe = new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      volumeResult = value;
      resolve(value);
    };
    try {
      const probe = document.createElement('audio');
      probe.volume = 0.5;
      window.setTimeout(() => {
        try {
          settle(Math.abs(probe.volume - 0.5) < 0.01);
        } catch {
          settle(false);
        }
      }, 0);
    } catch {
      settle(false);
      return;
    }
    window.setTimeout(() => settle(false), PROBE_TIMEOUT_MS);
  });
  return volumeProbe;
}

/** The probe result if it has already settled, else null (events/help views don't wait for it). */
export function volumeProbeResult(): boolean | null {
  return volumeResult;
}
