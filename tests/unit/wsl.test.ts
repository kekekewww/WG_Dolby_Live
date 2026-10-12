import { describe, expect, it } from 'vitest';
import { SYNC_EXCLUDES, toWslPath } from '../../scripts/wsl.mjs';

describe('scripts/wsl.mjs', () => {
  it('maps Windows drive paths to /mnt/<drive>', () => {
    expect(toWslPath('D:\\Developing\\WG-Dolby-Stream')).toBe('/mnt/d/Developing/WG-Dolby-Stream');
    expect(toWslPath('C:/Users/kevin/')).toBe('/mnt/c/Users/kevin');
  });

  it('never mirrors dependencies, git metadata or evidence into WSL', () => {
    for (const dir of ['.git/', 'node_modules/', 'evidence/', 'artifacts/', 'test-results/']) {
      expect(SYNC_EXCLUDES).toContain(dir);
    }
  });
});
