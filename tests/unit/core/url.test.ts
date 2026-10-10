import { describe, expect, it } from 'vitest';
import { EVENT_SLUG_PATTERN } from '../../../src/types';
import { EVENT_SLUG_RE, isValidSlug, playerHref, readEventParam, readModeParam, restUrl } from '../../../src/util/url';

describe('isValidSlug', () => {
  it.each(['a', 'demo-live', 'concert-2026', '2026', 'a-b-c-d', 'a'.repeat(100)])('accepts %s', (s) => {
    expect(isValidSlug(s)).toBe(true);
  });

  it.each([
    '',
    'A',
    'Demo',
    '-a',
    'a-',
    'a--b',
    'a_b',
    'a b',
    'a.b',
    'a/b',
    'a\n',
    '\na',
    '%E4%B8%AD',
    'a%2Db',
    '中文',
    '維光音樂會',
    'a'.repeat(101),
    '<script>',
    '../etc',
  ])('rejects %j', (s) => {
    expect(isValidSlug(s)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidSlug(null)).toBe(false);
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(12)).toBe(false);
    expect(isValidSlug(['a'])).toBe(false);
  });

  it('EVENT_SLUG_RE is built from the shared pattern', () => {
    expect(EVENT_SLUG_RE.source).toBe(new RegExp(EVENT_SLUG_PATTERN).source);
  });
});

describe('readEventParam', () => {
  it('reads a valid slug from a query string with or without the question mark', () => {
    expect(readEventParam('?wg_event=demo-live')).toBe('demo-live');
    expect(readEventParam('wg_event=demo-live&wg_mode=atmos')).toBe('demo-live');
  });

  it('rejects absent, empty, Chinese, percent-encoded, uppercase and repeated values', () => {
    expect(readEventParam('')).toBeNull();
    expect(readEventParam('?other=1')).toBeNull();
    expect(readEventParam('?wg_event=')).toBeNull();
    expect(readEventParam('?wg_event=' + encodeURIComponent('音樂會'))).toBeNull();
    expect(readEventParam('?wg_event=%E9%9F%B3')).toBeNull();
    expect(readEventParam('?wg_event=%2e%2e')).toBeNull();
    expect(readEventParam('?wg_event=Demo')).toBeNull();
    expect(readEventParam('?wg_event=a&wg_event=b')).toBeNull();
    expect(readEventParam('?wg_event=a%0A')).toBeNull();
  });
});

describe('readModeParam', () => {
  it('returns the mode only when valid and allowed', () => {
    expect(readModeParam('?wg_mode=binaural', ['binaural', 'atmos'])).toBe('binaural');
    expect(readModeParam('?wg_mode=atmos', ['binaural', 'atmos'])).toBe('atmos');
    expect(readModeParam('?wg_mode=atmos', ['binaural'])).toBeNull();
    expect(readModeParam('?wg_mode=atmos', [])).toBeNull();
  });

  it('returns null for unknown, empty, repeated or missing values (F12)', () => {
    expect(readModeParam('?wg_mode=surround', ['binaural', 'atmos'])).toBeNull();
    expect(readModeParam('?wg_mode=', ['binaural', 'atmos'])).toBeNull();
    expect(readModeParam('?wg_mode=ATMOS', ['binaural', 'atmos'])).toBeNull();
    expect(readModeParam('?wg_mode=atmos&wg_mode=binaural', ['binaural', 'atmos'])).toBeNull();
    expect(readModeParam('', ['binaural', 'atmos'])).toBeNull();
  });
});

describe('restUrl', () => {
  const pretty = 'https://sounds.example.com/wp-json/wg-live/v1/';
  const plain = 'https://sounds.example.com/index.php?rest_route=/wg-live/v1/';

  it('joins a pretty-permalink root', () => {
    expect(restUrl(pretty, 'events')).toBe('https://sounds.example.com/wp-json/wg-live/v1/events');
    expect(restUrl(pretty, '/events/demo-live')).toBe('https://sounds.example.com/wp-json/wg-live/v1/events/demo-live');
  });

  it('adds a missing trailing slash on the root', () => {
    expect(restUrl('https://x.test/wp-json/wg-live/v1', 'events')).toBe('https://x.test/wp-json/wg-live/v1/events');
  });

  it('appends the path to the rest_route value for plain permalinks', () => {
    expect(restUrl(plain, 'events')).toBe('https://sounds.example.com/index.php?rest_route=/wg-live/v1/events');
    expect(restUrl(plain, 'events/demo-live')).toBe(
      'https://sounds.example.com/index.php?rest_route=/wg-live/v1/events/demo-live',
    );
  });

  it('keeps an encoded rest_route encoded', () => {
    expect(restUrl('https://x.test/index.php?rest_route=%2Fwg-live%2Fv1%2F', 'events/a')).toBe(
      'https://x.test/index.php?rest_route=%2Fwg-live%2Fv1%2Fevents%2Fa',
    );
  });

  it('uses ? for the first param on a pretty root and & on a plain root', () => {
    expect(restUrl(pretty, 'playback', { event: 9001, mode: 'atmos' })).toBe(
      'https://sounds.example.com/wp-json/wg-live/v1/playback?event=9001&mode=atmos',
    );
    expect(restUrl(plain, 'playback', { event: 9001, mode: 'atmos' })).toBe(
      'https://sounds.example.com/index.php?rest_route=/wg-live/v1/playback&event=9001&mode=atmos',
    );
  });

  it('supports relative roots (dev harness) and encodes params and path segments', () => {
    expect(restUrl('/wp-json/wg-live/v1/', 'events')).toBe('/wp-json/wg-live/v1/events');
    expect(restUrl('/wp-json/wg-live/v1/', 'events', { q: 'a b&c' })).toBe('/wp-json/wg-live/v1/events?q=a%20b%26c');
    expect(restUrl(pretty, 'events/a b')).toBe('https://sounds.example.com/wp-json/wg-live/v1/events/a%20b');
  });
});

describe('playerHref', () => {
  it('adds wg_event and optionally wg_mode', () => {
    expect(playerHref('https://x.test/live/listen/', 'demo-live')).toBe('https://x.test/live/listen/?wg_event=demo-live');
    expect(playerHref('https://x.test/live/listen/', 'demo-live', 'atmos')).toBe(
      'https://x.test/live/listen/?wg_event=demo-live&wg_mode=atmos',
    );
  });

  it('keeps relative links relative and preserves existing query and hash', () => {
    expect(playerHref('/dev/listen.html', 'a-1', 'binaural')).toBe('/dev/listen.html?wg_event=a-1&wg_mode=binaural');
    expect(playerHref('https://x.test/?page_id=12#top', 'a-1')).toBe('https://x.test/?page_id=12&wg_event=a-1#top');
  });

  it('replaces stale wg_event / wg_mode already on the link', () => {
    expect(playerHref('https://x.test/l/?wg_event=old&wg_mode=atmos', 'new-1', null)).toBe(
      'https://x.test/l/?wg_event=new-1',
    );
  });

  it('returns null for a missing/unsafe link or an invalid slug', () => {
    expect(playerHref(null, 'a')).toBeNull();
    expect(playerHref('', 'a')).toBeNull();
    expect(playerHref('javascript:alert(1)', 'a')).toBeNull();
    expect(playerHref('https://x.test/l/', 'Bad Slug')).toBeNull();
    expect(playerHref('https://x.test/l/', '音樂會')).toBeNull();
  });
});
