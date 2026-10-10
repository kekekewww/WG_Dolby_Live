// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_SLUG_MAX_LENGTH, EVENT_SLUG_PATTERN } from '../../src/types';

// Plan D14: the event 代稱 pattern exists once in PHP and once in TypeScript, and both must stay identical.
const eventsPhp = readFileSync(join(import.meta.dirname, '..', '..', 'plugin', 'wg-live', 'includes', 'class-events.php'), 'utf8');

/** Value of a single-quoted PHP string constant, with PHP's two escapes (\\ and \') resolved. */
function phpStringConst(source: string, name: string): string {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'\\s*;`).exec(source);
  if (!match) throw new Error(`const ${name} (single-quoted string) not found in class-events.php`);
  return (match[1] ?? '').replace(/\\([\\'])/g, '$1');
}

function phpIntConst(source: string, name: string): number {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(source);
  if (!match) throw new Error(`const ${name} (integer) not found in class-events.php`);
  return Number(match[1]);
}

describe('event slug pattern: PHP <-> TypeScript sync (plan D14)', () => {
  it('Events::SLUG_PATTERN equals EVENT_SLUG_PATTERN', () => {
    expect(phpStringConst(eventsPhp, 'SLUG_PATTERN')).toBe(EVENT_SLUG_PATTERN);
  });

  it('Events::SLUG_MAX_LENGTH equals EVENT_SLUG_MAX_LENGTH', () => {
    expect(phpIntConst(eventsPhp, 'SLUG_MAX_LENGTH')).toBe(EVENT_SLUG_MAX_LENGTH);
  });

  it('the delimited PHP regex is built from the same constant and uses the D modifier (no trailing newline)', () => {
    // PCRE "$" also matches before a final "\n"; the D modifier makes it strict like the TypeScript check.
    expect(eventsPhp).toMatch(/const\s+SLUG_REGEX\s*=\s*'\/'\s*\.\s*self::SLUG_PATTERN\s*\.\s*'\/D'\s*;/);
  });

  it('the shared pattern accepts and rejects the documented examples', () => {
    const re = new RegExp(phpStringConst(eventsPhp, 'SLUG_PATTERN'));
    for (const ok of ['a', 'demo-live', 'concert-2026', '2026', 'a-b-c']) expect(re.test(ok)).toBe(true);
    for (const bad of ['', 'A', '-a', 'a-', 'a--b', 'a_b', 'a b', '音樂會', 'a\n']) expect(re.test(bad)).toBe(false);
  });
});
