import { afterEach, describe, expect, it } from 'vitest';
import { parsePublicEvent, parsePublicEvents, readBootConfig } from '../../../src/boot';
import { demoEvents } from '../../../src/fixtures/demo-events';
import type { PublicEvent } from '../../../src/types';

afterEach(() => {
  document.body.replaceChildren();
});

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    pluginVersion: '0.1.0',
    view: 'events',
    deploymentMode: 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: 'https://sounds.example.com/wp-json/wg-live/v1/' },
    links: {
      home: 'https://sounds.example.com/',
      events: 'https://sounds.example.com/live/',
      player: 'https://sounds.example.com/live/listen/',
      help: 'https://sounds.example.com/live/help/',
      account: 'https://sounds.example.com/my-account/',
      store: null,
      contact: 'mailto:hello@example.com',
    },
    fixedEventSlug: null,
    featuredEventSlug: 'demo-live-binaural-atmos',
    heading: 'h2',
    events: demoEvents(Date.UTC(2026, 9, 10, 12)),
    help: { faq: [{ question: 'Q', answer: 'A' }], compatibility: [], supportNote: 'note' },
    devTools: false,
    ...overrides,
  };
}

function makeRoot(config: unknown | null, view = 'events'): HTMLElement {
  const root = document.createElement('div');
  root.className = 'wg-live';
  root.dataset.wgLiveView = view;
  if (config !== null) {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.className = 'wg-live__config';
    script.textContent = typeof config === 'string' ? config : JSON.stringify(config);
    root.append(script);
  }
  document.body.append(root);
  return root;
}

describe('readBootConfig', () => {
  it('reads a valid config', () => {
    const boot = readBootConfig(makeRoot(validConfig()));
    expect(boot).not.toBeNull();
    expect(boot?.schema).toBe(1);
    expect(boot?.view).toBe('events');
    expect(boot?.deploymentMode).toBe('demo');
    expect(boot?.events).toHaveLength(3);
    expect(boot?.featuredEventSlug).toBe('demo-live-binaural-atmos');
    expect(boot?.links.contact).toBe('mailto:hello@example.com');
    expect(boot?.links.store).toBeNull();
    expect(boot?.help.faq).toEqual([{ question: 'Q', answer: 'A' }]);
    expect(boot?.devTools).toBe(false);
  });

  it('returns null without a config script, with bad JSON, or with a wrong schema', () => {
    expect(readBootConfig(makeRoot(null))).toBeNull();
    expect(readBootConfig(makeRoot('{not json'))).toBeNull();
    expect(readBootConfig(makeRoot(''))).toBeNull();
    expect(readBootConfig(makeRoot('[1,2]'))).toBeNull();
    expect(readBootConfig(makeRoot('null'))).toBeNull();
    expect(readBootConfig(makeRoot(validConfig({ schema: 2 })))).toBeNull();
    expect(readBootConfig(makeRoot(validConfig({ schema: '1' })))).toBeNull();
  });

  it('returns null without a usable REST root', () => {
    expect(readBootConfig(makeRoot(validConfig({ rest: {} })))).toBeNull();
    expect(readBootConfig(makeRoot(validConfig({ rest: { root: 'javascript:alert(1)' } })))).toBeNull();
    expect(readBootConfig(makeRoot(validConfig({ rest: null })))).toBeNull();
  });

  it('drops unknown fields everywhere', () => {
    const cfg = validConfig({ secret: 'token', links: { home: '/', evil: 'https://x.test' }, extra: { a: 1 } });
    const events = (cfg.events as PublicEvent[]).map((e) => ({ ...e, sourceUrl: 'https://cdn.test/stream.m3u8', token: 'x' }));
    cfg.events = events;
    const boot = readBootConfig(makeRoot(cfg));
    expect(boot).not.toBeNull();
    const json = JSON.stringify(boot);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('token');
    expect(json).not.toContain('evil');
    expect(json).not.toContain('stream.m3u8');
    expect(Object.keys(boot ?? {}).sort()).toEqual(
      [
        'deploymentMode',
        'devTools',
        'events',
        'featuredEventSlug',
        'fixedEventSlug',
        'heading',
        'help',
        'links',
        'pluginVersion',
        'rest',
        'schema',
        'timezone',
        'view',
      ].sort(),
    );
  });

  it('fails closed on the deployment mode and on devTools', () => {
    expect(readBootConfig(makeRoot(validConfig({ deploymentMode: 'live' })))?.deploymentMode).toBe('disabled');
    expect(readBootConfig(makeRoot(validConfig({ deploymentMode: undefined })))?.deploymentMode).toBe('disabled');
    expect(readBootConfig(makeRoot(validConfig({ devTools: 'true' })))?.devTools).toBe(false);
    expect(readBootConfig(makeRoot(validConfig({ devTools: 1 })))?.devTools).toBe(false);
    expect(readBootConfig(makeRoot(validConfig({ devTools: true })))?.devTools).toBe(true);
  });

  it('rejects invalid slugs and defaults heading to h2', () => {
    const boot = readBootConfig(
      makeRoot(validConfig({ fixedEventSlug: '音樂會', featuredEventSlug: 'Bad Slug', heading: 'h3' })),
    );
    expect(boot?.fixedEventSlug).toBeNull();
    expect(boot?.featuredEventSlug).toBeNull();
    expect(boot?.heading).toBe('h2');
    expect(readBootConfig(makeRoot(validConfig({ heading: 'h1', fixedEventSlug: 'demo-live' })))?.heading).toBe('h1');
    expect(readBootConfig(makeRoot(validConfig({ fixedEventSlug: 'demo-live' })))?.fixedEventSlug).toBe('demo-live');
  });

  it('nulls unsafe links, keeps mailto only for contact', () => {
    const boot = readBootConfig(
      makeRoot(
        validConfig({
          links: {
            home: 'javascript:alert(1)',
            events: 'data:text/html,x',
            player: '/live/listen/',
            help: 'mailto:a@b.test',
            account: 'https://u:p@evil.test/',
            store: 'https://shop.test/',
            contact: 'mailto:ok@b.test',
          },
        }),
      ),
    );
    expect(boot?.links.home).toBe('/');
    expect(boot?.links.events).toBeNull();
    expect(boot?.links.player).toBe('/live/listen/');
    expect(boot?.links.help).toBeNull();
    expect(boot?.links.account).toBeNull();
    expect(boot?.links.store).toBe('https://shop.test/');
    expect(boot?.links.contact).toBe('mailto:ok@b.test');
  });

  it('uses the DOM data-wg-live-view as the view, falling back to the config', () => {
    expect(readBootConfig(makeRoot(validConfig({ view: 'help' }), 'player'))?.view).toBe('player');
    const root = makeRoot(validConfig({ view: 'help' }), 'nonsense');
    expect(readBootConfig(root)?.view).toBe('help');
    expect(readBootConfig(makeRoot(validConfig({ view: 'nope' }), 'nonsense'))).toBeNull();
  });

  it('falls back to defaults for missing optional blocks', () => {
    const cfg = validConfig();
    delete cfg.help;
    delete cfg.links;
    delete cfg.timezone;
    delete cfg.events;
    const boot = readBootConfig(makeRoot(cfg));
    expect(boot?.help).toEqual({ faq: [], compatibility: [], supportNote: '' });
    expect(boot?.links.home).toBe('/');
    expect(boot?.timezone).toBe('Asia/Taipei');
    expect(boot?.events).toEqual([]);
  });

  it('ignores a config script that belongs to a nested .wg-live', () => {
    const outer = document.createElement('div');
    outer.className = 'wg-live';
    outer.dataset.wgLiveView = 'events';
    const inner = makeRoot(validConfig());
    outer.append(inner);
    document.body.append(outer);
    expect(readBootConfig(outer)).toBeNull();
    expect(readBootConfig(inner)).not.toBeNull();
  });
});

describe('help content validation', () => {
  it('forces pending when verified/not_working has no test date, and keeps a dated verified row', () => {
    const row = { device: 'd', os: 'o', browser: 'b', outputPath: 'p', sourceFormat: 'f', notes: '' };
    const boot = readBootConfig(
      makeRoot(
        validConfig({
          help: {
            faq: [{ question: '', answer: 'x' }, { question: 'ok', answer: 'y' }, { question: 3, answer: 'z' }],
            compatibility: [
              { ...row, status: 'verified', testedAt: null },
              { ...row, status: 'verified', testedAt: '2026-10-01' },
              { ...row, status: 'not_working', testedAt: 'yesterday' },
              { ...row, status: 'whatever', testedAt: '2026-10-01' },
              'junk',
            ],
            supportNote: 5,
          },
        }),
      ),
    );
    expect(boot?.help.faq).toEqual([{ question: 'ok', answer: 'y' }]);
    expect(boot?.help.compatibility.map((r) => [r.status, r.testedAt])).toEqual([
      ['pending', null],
      ['verified', '2026-10-01'],
      ['pending', null],
      ['pending', null],
    ]);
    expect(boot?.help.supportNote).toBe('');
  });
});

describe('parsePublicEvent(s)', () => {
  const good = demoEvents(Date.UTC(2026, 9, 10, 12))[0] as PublicEvent;

  it('accepts a complete event unchanged', () => {
    expect(parsePublicEvent(good)).toEqual(good);
  });

  it('drops events with a bad id, slug, status or start time', () => {
    expect(parsePublicEvent({ ...good, id: 0 })).toBeNull();
    expect(parsePublicEvent({ ...good, id: '9001' })).toBeNull();
    expect(parsePublicEvent({ ...good, slug: '音樂會' })).toBeNull();
    expect(parsePublicEvent({ ...good, slug: '%E9%9F%B3' })).toBeNull();
    expect(parsePublicEvent({ ...good, status: 'live-now' })).toBeNull();
    expect(parsePublicEvent({ ...good, startsAt: 'soon' })).toBeNull();
    expect(parsePublicEvent(null)).toBeNull();
    expect(parsePublicEvent('x')).toBeNull();
  });

  it('sanitizes URLs, modes, zone, source kind and poster', () => {
    const e = parsePublicEvent({
      ...good,
      posterUrl: 'javascript:alert(1)',
      productUrl: 'mailto:x@y.test',
      availableModes: ['atmos', 'surround', 'atmos', 'binaural'],
      displayTimezone: 'Nowhere/Land',
      sourceKind: 'rtmp',
      mediaKind: 'hologram',
      poster: { url: 'data:image/png;base64,AA', width: 10, height: 10, alt: 'x' },
    });
    expect(e?.posterUrl).toBeNull();
    expect(e?.productUrl).toBeNull();
    expect(e?.availableModes).toEqual(['atmos', 'binaural']);
    expect(e?.displayTimezone).toBe('Asia/Taipei');
    expect(e?.sourceKind).toBe('not_configured');
    expect(e?.mediaKind).toBe('video'); // anything but 'audio' is the default kind, video
    expect(e?.poster).toBeNull();
  });

  it('defaults the media kind to video; only an explicit audio stays audio', () => {
    const withoutKind: Record<string, unknown> = { ...good };
    delete withoutKind.mediaKind;
    expect(parsePublicEvent(withoutKind)?.mediaKind).toBe('video');
    expect(parsePublicEvent({ ...good, mediaKind: null })?.mediaKind).toBe('video');
    expect(parsePublicEvent({ ...good, mediaKind: 'video' })?.mediaKind).toBe('video');
    expect(parsePublicEvent({ ...good, mediaKind: 'audio' })?.mediaKind).toBe('audio');
  });

  it('requires real booleans for isDemo and replayAvailable', () => {
    const e = parsePublicEvent({ ...good, isDemo: 'true', replayAvailable: 1 });
    expect(e?.isDemo).toBe(false);
    expect(e?.replayAvailable).toBe(false);
  });

  it('drops invalid entries and duplicate slugs from a list', () => {
    const list = parsePublicEvents([good, { ...good, id: 5 }, { nope: true }, 3, { ...good, slug: 'other-1', id: 6 }]);
    expect(list.map((e) => e.slug)).toEqual([good.slug, 'other-1']);
    expect(parsePublicEvents('x')).toEqual([]);
    expect(parsePublicEvents(null)).toEqual([]);
  });
});
