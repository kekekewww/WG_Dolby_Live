/**
 * PHP and TypeScript each hold their own copy of a few viewer-facing strings (plan 6.10: the demo
 * badge, the disabled message, the featured fallback, the CTA labels...). The PHP templates cannot
 * import src/i18n, so this test reads the PHP source and fails when the two drift apart.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_EVENT_BADGE, eventsCopy, statusCopy } from '../../src/i18n/copy';

const ROOT = resolve(import.meta.dirname, '../..');
const SHORTCODES_PHP = readFileSync(resolve(ROOT, 'plugin/wg-live/includes/class-shortcodes.php'), 'utf8');

function unquote(raw: string): string {
  return raw.replace(/\\(['\\])/g, '$1');
}

/** `const NAME = 'text';` constants of the Shortcodes class. */
function phpStringConstants(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/gm)) {
    out[m[1] as string] = unquote(m[2] as string);
  }
  return out;
}

/** The pairs of a `const NAME = array( 'k' => 'v', ... );` block. */
function phpArrayConstant(source: string, name: string): Record<string, string> {
  const block = new RegExp(`const\\s+${name}\\s*=\\s*array\\(([\\s\\S]*?)\\);`).exec(source);
  if (!block) throw new Error(`const ${name} not found`);
  const out: Record<string, string> = {};
  for (const m of (block[1] as string).matchAll(/'((?:[^'\\]|\\.)*)'\s*=>\s*'((?:[^'\\]|\\.)*)'/g)) {
    out[unquote(m[1] as string)] = unquote(m[2] as string);
  }
  return out;
}

function phpListConstant(source: string, name: string): string[] {
  const block = new RegExp(`const\\s+${name}\\s*=\\s*array\\(([\\s\\S]*?)\\);`).exec(source);
  if (!block) throw new Error(`const ${name} not found`);
  return Array.from((block[1] as string).matchAll(/'((?:[^'\\]|\\.)*)'/g), (m) => unquote(m[1] as string));
}

const php = phpStringConstants(SHORTCODES_PHP);

describe('PHP copy stays in sync with src/i18n', () => {
  it('parses the constants it compares', () => {
    expect(Object.keys(php).length).toBeGreaterThan(15);
  });

  it.each<[string, string]>([
    ['DEMO_BADGE', DEMO_EVENT_BADGE],
    ['POSTER_BRAND', eventsCopy.posterPlaceholder.brand],
    ['POSTER_DEMO_NOTE', eventsCopy.posterPlaceholder.demoNote],
    ['DISABLED_TITLE', statusCopy.gate.disabled.title],
    ['DISABLED_DETAIL', statusCopy.gate.disabled.detail],
    ['FEATURED_FALLBACK', eventsCopy.empty.detail],
    ['NOT_FOUND_TITLE', statusCopy.gate.eventNotFound.title],
    ['NOT_FOUND_DETAIL', statusCopy.gate.eventNotFound.detail],
    ['BOOT_ERROR', statusCopy.bootError],
    ['BOOT_ERROR_HINT', statusCopy.bootErrorHint],
    ['NOSCRIPT', statusCopy.noscript],
    ['CTA_VIEW_DETAILS', statusCopy.cta.viewDetails],
    ['CTA_DEMO', statusCopy.cta.demo],
    ['CTA_ENTER', statusCopy.cta.enter],
    ['CTA_VIEW_EVENT', statusCopy.cta.viewEvent],
    ['REPLAY_PENDING', statusCopy.cta.replayPending],
    ['LINK_EVENTS', statusCopy.action.backToEvents],
    ['LINK_HELP', statusCopy.action.help],
    ['LINK_CONTACT', statusCopy.action.contact],
    ['LINK_HOME', statusCopy.action.backHome],
    ['TIME_ZONE_TAIPEI', statusCopy.time.taipei],
  ])('%s equals the TypeScript string', (name, expected) => {
    expect(php[name]).toBe(expected);
  });

  it('uses the pinned wording for the three plan 6.10 strings', () => {
    expect(php.DEMO_BADGE).toBe('介面示範');
    expect(php.DISABLED_TITLE).toBe('線上音樂會尚未開放');
    // The spec text once had a simplified 会; the plan pins 會.
    expect(php.FEATURED_FALLBACK).toBe('線上音樂會資訊即將公布');
  });

  it('STATUS_LABELS equals statusCopy.eventStatus', () => {
    expect(phpArrayConstant(SHORTCODES_PHP, 'STATUS_LABELS')).toEqual(statusCopy.eventStatus);
  });

  it('WEEKDAYS matches the weekday characters of util/time.ts', () => {
    const timeSource = readFileSync(resolve(ROOT, 'src/util/time.ts'), 'utf8');
    const ts = /const WEEKDAYS = \[([^\]]*)\]/.exec(timeSource);
    expect(ts).not.toBeNull();
    const tsDays = Array.from((ts?.[1] ?? '').matchAll(/'([^']+)'/g), (m) => m[1]);
    expect(phpListConstant(SHORTCODES_PHP, 'WEEKDAYS')).toEqual(tsDays);
  });

  it('makes no capability claims in the PHP viewer copy (spec 2.4, 5.3)', () => {
    for (const file of ['includes/class-shortcodes.php', 'templates/featured.php', 'templates/partials/container.php']) {
      const source = readFileSync(resolve(ROOT, 'plugin/wg-live', file), 'utf8');
      expect(source).not.toMatch(/Atmos certified|7\.1\.4|已認證|杜比認證/);
    }
  });
});
