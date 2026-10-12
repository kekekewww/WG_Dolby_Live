// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { needsDistServer, selectedProjects } from '../../playwright.config';

describe('playwright.config: dist webServer (TR-06)', () => {
  it('reads --project=x and --project x, repeated', () => {
    expect(selectedProjects(['test', '--project=a', '--project', 'b', '--grep', 'c'])).toEqual(['a', 'b']);
    expect(selectedProjects(['test'])).toEqual([]);
  });

  it('the full run and the dist project build; the dev projects must not (the build empties the wp-env dist folder)', () => {
    expect(needsDistServer(['test'], {})).toBe(true);
    expect(needsDistServer(['test', '--project=harness-dist'], {})).toBe(true);
    expect(needsDistServer(['test', '--project=harness-dev-chromium', '--project=harness-dev-firefox', '--project=harness-dev-webkit'], {})).toBe(false);
    expect(needsDistServer(['test', '--project', 'harness-dev-chromium'], {})).toBe(false);
  });

  it('WG_E2E_DIST overrides the inference', () => {
    expect(needsDistServer(['test'], { WG_E2E_DIST: '0' })).toBe(false);
    expect(needsDistServer(['test', '--project=harness-dev-chromium'], { WG_E2E_DIST: '1' })).toBe(true);
  });
});
