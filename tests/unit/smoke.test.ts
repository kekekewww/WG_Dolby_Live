// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { demoEvents } from '../../src/fixtures/demo-events';
import * as entry from '../../src/main';
import { EVENT_SLUG_MAX_LENGTH, EVENT_SLUG_PATTERN } from '../../src/types';

describe('smoke: entry module', () => {
  it('exports exactly the public API { mountAll, mountWithin, version } (plan D19)', () => {
    expect(Object.keys(entry).sort()).toEqual(['mountAll', 'mountWithin', 'version']);
    expect(typeof entry.mountAll).toBe('function');
    expect(typeof entry.mountWithin).toBe('function');
    expect(entry.version).toBe(pkg.version);
  });

  it('never assigns window.WGLive by hand: the IIFE global comes from Vite lib.name', () => {
    expect((window as unknown as { WGLive?: unknown }).WGLive).toBeUndefined();
  });

  it('mounting a root without a readable config ends in a visible, finished state (no throw)', () => {
    document.body.replaceChildren();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="wg-live" data-wg-live-view="events"><div class="wg-live__mount" aria-busy="true"></div></div>',
    );
    expect(() => entry.mountAll()).not.toThrow();
    const mount = document.querySelector('.wg-live__mount');
    expect(mount?.getAttribute('aria-busy')).toBe('false');
    expect(mount?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(() => entry.mountAll()).not.toThrow(); // idempotent
  });
});

describe('smoke: demo fixtures', () => {
  it('are marked demo events with valid slugs, relative start times and no source URL', () => {
    const now = Date.UTC(2026, 9, 10, 12, 0, 0);
    const events = demoEvents(now);
    expect(events.length).toBeGreaterThanOrEqual(3);
    const slugs = new Set<string>();
    for (const e of events) {
      expect(e.isDemo).toBe(true);
      expect(e.title).toContain('介面示範');
      expect(e.displayTimezone).toBe('Asia/Taipei');
      expect(new RegExp(EVENT_SLUG_PATTERN).test(e.slug)).toBe(true);
      expect(e.slug.length).toBeLessThanOrEqual(EVENT_SLUG_MAX_LENGTH);
      expect(Number.isNaN(Date.parse(e.startsAt))).toBe(false);
      expect(Object.keys(e)).not.toContain('sourceUrl');
      slugs.add(e.slug);
    }
    expect(slugs.size).toBe(events.length);
    const statuses = events.map((e) => e.status);
    expect(statuses).toContain('live');
    expect(statuses).toContain('scheduled');
    expect(statuses).toContain('ended');
  });
});
