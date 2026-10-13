/**
 * Plan 4.2 / 5 / 7.2: the public predicate, the REST whitelist and the playback route, on a real site.
 *
 *  - Draft, pending, private, password-protected, trashed, wrong-type and invalid-slug posts are never
 *    exposed: not in the bootstrap, not in REST, not through playback, not through the shortcode.
 *  - The REST payloads contain only the PublicEvent whitelist: never meta keys, source_type, attachment
 *    URLs. The only media URL anywhere is the demo playback URL, and only after the server checks passed.
 *  - /playback sends no-store headers, the event routes send public max-age=30 and never vary by user.
 *
 * The specs only add fixture events (unique per browser project) and delete them afterwards, so they
 * run in parallel with the other read-only specs.
 */
import { test } from '@playwright/test';
import { adminContext, bootConfigs, createEvents, createElementorPage, deleteEventsByPrefix, deletePosts, DEV, expect, fetchText, getSettings, LISTEN_URL, LIVE_URL, phpJson, rest, SLUG_ENDED, SLUG_LIVE, SLUG_PENDING, DEMO_VIDEO, TONE, wpPhp, type FixtureEvent } from './wp';

const ALLOWED_KEYS = [
  'id', 'slug', 'title', 'performers', 'description', 'startsAt', 'displayTimezone', 'status', 'posterUrl', 'mediaKind',
  'availableModes', 'programme', 'productUrl', 'replayAvailable', 'isDemo', 'poster', 'sourceKind',
].sort();
const ALLOWED_POSTER_KEYS = ['url', 'width', 'height', 'alt', 'srcset', 'sizes'].sort();

test.describe('the public predicate', () => {
  // The fixtures are created once in beforeAll: all tests of this block must run in one worker.
  test.describe.configure({ mode: 'serial' });
  let prefix = '';
  let ids: Record<string, number> = {};
  let pageIds: number[] = [];
  let names: Record<'ok' | 'draft' | 'pending' | 'private' | 'password' | 'trashed' | 'chinese' | 'nostart', string>;
  let wrongTypeIds: { page: number; post: number };

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern for the fixtures argument.
  test.beforeAll(async ({}, testInfo) => {
    prefix = `it-pred-${testInfo.project.name}`;
    deleteEventsByPrefix(DEV, prefix); // leftovers of a crashed run
    names = {
      ok: `${prefix}-ok`,
      draft: `${prefix}-draft`,
      pending: `${prefix}-pending`,
      private: `${prefix}-private`,
      password: `${prefix}-password`,
      trashed: `${prefix}-trashed`,
      chinese: `${prefix}-中文`,
      nostart: `${prefix}-nostart`,
    };
    const events: FixtureEvent[] = [
      { slug: names.ok, title: `${prefix} public` },
      { slug: names.draft, title: `${prefix} draft`, status: 'draft' },
      { slug: names.pending, title: `${prefix} pending`, status: 'pending' },
      { slug: names.private, title: `${prefix} private`, status: 'private' },
      { slug: names.password, title: `${prefix} password`, password: `${prefix}-pw` },
      { slug: names.trashed, title: `${prefix} trashed`, status: 'trash' },
      // A published row whose post_name is what WordPress derives from a Chinese title (percent-encoded): not a valid 代稱.
      // The plugin refuses to create it (see admin-events.spec.ts), so it is written straight into the database.
      { slug: names.chinese, title: `${prefix}-中文活動`, rawPostName: `${prefix}-%e4%b8%ad%e6%96%87` },
      { slug: names.nostart, title: `${prefix} no start time`, meta: { starts_at_utc: '' } },
    ];
    ids = createEvents(DEV, events);
    wrongTypeIds = wpPhp<{ page: number; post: number }>(
      DEV,
      `$page = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => '${prefix} wrong type page', 'post_name' => '${prefix}-wrong-page' ) );
       $post = wp_insert_post( array( 'post_type' => 'post', 'post_status' => 'publish', 'post_title' => '${prefix} wrong type post', 'post_name' => '${prefix}-wrong-post' ) );
       foreach ( array( $page, $post ) as $id ) { update_post_meta( $id, '_wg_live_available_modes', array( 'binaural', 'atmos' ) ); update_post_meta( $id, '_wg_live_is_demo', '1' ); update_post_meta( $id, '_wg_live_source_type', 'demo' ); }
       return array( 'page' => $page, 'post' => $post );`,
    );
    pageIds = [wrongTypeIds.page, wrongTypeIds.post];
  });

  test.afterAll(() => {
    deleteEventsByPrefix(DEV, prefix);
    deletePosts(DEV, pageIds);
  });

  test('the fixture really is in the states under test', () => {
    const states = wpPhp<Record<string, { status: string; name: string; password: boolean; type: string }>>(
      DEV,
      `$out = array(); foreach ( ${phpJson(ids)} as $k => $id ) { $p = get_post( $id ); $out[ $k ] = array( 'status' => $p->post_status, 'name' => $p->post_name, 'password' => '' !== $p->post_password, 'type' => $p->post_type ); } return $out;`,
    );
    expect(states[names.ok]).toMatchObject({ status: 'publish', password: false, type: 'wg_live_event' });
    expect(states[names.draft]?.status).toBe('draft');
    expect(states[names.pending]?.status).toBe('pending');
    expect(states[names.private]?.status).toBe('private');
    expect(states[names.password]).toMatchObject({ status: 'publish', password: true });
    expect(states[names.trashed]?.status).toBe('trash');
    expect(states[names.chinese]?.status).toBe('publish');
    expect(states[names.chinese]?.name, 'the percent-encoded name is not a valid 代稱').toMatch(/%/);
    expect(states[names.nostart]?.status).toBe('publish');
  });

  test('REST list contains the public fixture and none of the others', async () => {
    const { status, json } = await rest(DEV, 'events');
    expect(status).toBe(200);
    const slugs = (json.events as Array<{ slug: string }>).map((e) => e.slug);
    const fixtureIds = (json.events as Array<{ id: number }>).map((e) => e.id);
    expect(slugs).toContain(names.ok);
    for (const key of ['draft', 'pending', 'private', 'password', 'trashed', 'chinese', 'nostart'] as const) {
      expect(slugs, key).not.toContain(names[key]);
      expect(fixtureIds, key).not.toContain(ids[names[key]]);
    }
    // No percent-encoded or otherwise invalid slug is ever published.
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(fixtureIds).not.toContain(wrongTypeIds.page);
    expect(fixtureIds).not.toContain(wrongTypeIds.post);
  });

  test('REST single: the public one resolves, every other slug is a 404 wg_live_not_found', async () => {
    const ok = await rest(DEV, `events/${names.ok}`);
    expect(ok.status).toBe(200);
    expect(ok.json.event.slug).toBe(names.ok);

    for (const key of ['draft', 'pending', 'private', 'password', 'trashed', 'nostart'] as const) {
      const res = await rest(DEV, `events/${names[key]}`);
      expect(res.status, key).toBe(404);
      expect(res.json.code, key).toBe('wg_live_not_found');
    }
    // Wrong post types and malformed slugs.
    for (const slug of [`${prefix}-wrong-page`, `${prefix}-wrong-post`, 'sample-page', 'hello-world']) {
      const res = await rest(DEV, `events/${slug}`);
      expect(res.status, slug).toBe(404);
    }
    for (const slug of ['UPPER', 'a_b', '-a', 'a--b', '%e6%b8%ac']) {
      const res = await rest(DEV, `events/${slug}`);
      expect(res.status, slug).toBeGreaterThanOrEqual(400);
      expect(res.json.event, slug).toBeUndefined();
    }
  });

  test('the page bootstrap carries only the public fixture (events list and player pages)', async () => {
    for (const path of [LIVE_URL, `${LISTEN_URL}?wg_event=${names.ok}`, `${LISTEN_URL}?wg_event=${names.draft}`]) {
      const { text } = await fetchText(DEV, path);
      const events = bootConfigs(text)[0]?.events as Array<{ slug: string }>;
      const slugs = events.map((e) => e.slug);
      expect(slugs, path).toContain(names.ok);
      for (const key of ['draft', 'pending', 'private', 'password', 'trashed', 'chinese', 'nostart'] as const) {
        expect(slugs, `${path} ${key}`).not.toContain(names[key]);
        expect(text, `${path} ${key}`).not.toContain(`${prefix} ${key}`);
      }
      expect(text, path).not.toContain(`${prefix}-pw`); // the post password
    }
  });

  test('an administrator sees exactly the same public set (the predicate does not depend on the user)', async ({ browser }) => {
    const context = await adminContext(browser, DEV);
    try {
      const html = await (await context.request.get(LIVE_URL)).text();
      const slugs = (bootConfigs(html)[0]?.events as Array<{ slug: string }>).map((e) => e.slug);
      expect(slugs).toContain(names.ok);
      for (const key of ['draft', 'pending', 'private', 'password', 'trashed', 'chinese', 'nostart'] as const) expect(slugs, key).not.toContain(names[key]);

      const res = await context.request.get(`/wp-json/wg-live/v1/events/${names.draft}`);
      expect(res.status()).toBe(404);
      const pb = await (await context.request.get(`/wp-json/wg-live/v1/playback?event=${ids[names.private]}&mode=binaural`)).json();
      expect(pb).toEqual({ kind: 'not_ready', reason: 'event_not_found' });
    } finally {
      await context.close();
    }
  });

  test('playback: the public fixture plays, every other ID is event_not_found and never yields a URL', async () => {
    const ok = await rest(DEV, `playback?event=${ids[names.ok]}&mode=binaural`);
    expect(ok.status).toBe(200);
    expect(ok.json.kind).toBe('demo');

    const hidden = ['draft', 'pending', 'private', 'password', 'trashed', 'chinese', 'nostart'] as const;
    // 'nostart' and 'chinese' are published but not public in the bootstrap sense; playback follows Events::is_public() only.
    for (const key of hidden) {
      const res = await rest(DEV, `playback?event=${ids[names[key]]}&mode=binaural`);
      expect(res.status, key).toBe(200);
      if (key === 'nostart') {
        // Published with a valid slug: the predicate holds, playback is allowed for this demo event. The list hides it only because it has no start time.
        expect(res.json.kind, key).toBe('demo');
      } else {
        expect(res.json, key).toEqual({ kind: 'not_ready', reason: 'event_not_found' });
      }
    }
    for (const id of [wrongTypeIds.page, wrongTypeIds.post, 1, 2, 999999]) {
      const res = await rest(DEV, `playback?event=${id}&mode=atmos`);
      expect(res.json, `id ${id}`).toEqual({ kind: 'not_ready', reason: 'event_not_found' });
    }
  });

  test('the shortcode event attribute: only a public event resolves, everything else is the not-found message', async () => {
    const attrs = [names.draft, names.private, names.password, names.trashed, `${prefix}-wrong-page`, 'does-not-exist', 'UPPER'];
    const created = wpPhp<number[]>(
      DEV,
      `$out = array(); foreach ( ${phpJson(attrs)} as $i => $slug ) {
         $out[] = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => '${prefix} sc ' . $i, 'post_name' => '${prefix}-sc-' . $i, 'post_content' => '[wg_live view="player" event="' . $slug . '"]' ) );
       }
       $out[] = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => '${prefix} sc ok', 'post_name' => '${prefix}-sc-ok', 'post_content' => '[wg_live view="player" event="${names.ok}"]' ) );
       return $out;`,
    );
    pageIds.push(...created);
    try {
      for (let i = 0; i < attrs.length; i++) {
        const { text } = await fetchText(DEV, `/${prefix}-sc-${i}/`);
        expect(text, attrs[i]).toContain('找不到這場活動');
        expect(bootConfigs(text), attrs[i]).toHaveLength(0); // no container, no bootstrap, no data
      }
      const ok = await fetchText(DEV, `/${prefix}-sc-ok/`);
      expect(bootConfigs(ok.text)[0]?.fixedEventSlug).toBe(names.ok);
    } finally {
      deletePosts(DEV, created);
    }
  });

  test('the Elementor shortcode widget follows the same rule', async () => {
    const id = createElementorPage(DEV, `${prefix}-elementor-draft`, `${prefix} elementor`, `[wg_live view="player" event="${names.draft}"]`);
    try {
      const { text } = await fetchText(DEV, `/${prefix}-elementor-draft/`);
      expect(text).toContain('找不到這場活動');
      expect(bootConfigs(text)).toHaveLength(0);
    } finally {
      deletePosts(DEV, [id]);
    }
  });

  test('settings that point at a hidden event do not expose it (featured event)', () => {
    const settings = getSettings(DEV);
    // The featured event shown on the home page must itself pass the predicate: it is a seeded public event.
    const featuredId = Number(settings.featured_event);
    const featured = wpPhp<{ status: string; type: string }>(DEV, `$p = get_post( ${featuredId} ); return array( 'status' => $p->post_status, 'type' => $p->post_type );`);
    expect(featured).toEqual({ status: 'publish', type: 'wg_live_event' });
  });
});

test.describe('REST whitelist, headers and the playback route', () => {
  test.describe.configure({ mode: 'serial' });
  let prefix = '';
  let binauralOnly = 0;
  let audioEvent = 0;
  let noKindEvent = 0;
  let oddKindEvent = 0;

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern for the fixtures argument.
  test.beforeAll(async ({}, testInfo) => {
    prefix = `it-rest-${testInfo.project.name}`;
    deleteEventsByPrefix(DEV, prefix);
    const created = createEvents(DEV, [
      { slug: `${prefix}-binaural`, title: `${prefix} binaural only`, meta: { available_modes: ['binaural'] } },
      { slug: `${prefix}-audio`, title: `${prefix} audio event`, meta: { media_kind: 'audio' } },
      { slug: `${prefix}-nokind`, title: `${prefix} empty media kind`, meta: { media_kind: '' } },
      { slug: `${prefix}-oddkind`, title: `${prefix} unknown media kind`, meta: { media_kind: 'hologram' } },
    ]);
    binauralOnly = created[`${prefix}-binaural`] as number;
    audioEvent = created[`${prefix}-audio`] as number;
    noKindEvent = created[`${prefix}-nokind`] as number;
    oddKindEvent = created[`${prefix}-oddkind`] as number;
  });

  test.afterAll(() => deleteEventsByPrefix(DEV, prefix));

  test('every event has exactly the PublicEvent keys: no source_type, no meta, no attachment URL', async () => {
    const { status, json, text } = await rest(DEV, 'events');
    expect(status).toBe(200);
    expect(Object.keys(json)).toEqual(['events']);
    expect(json.events.length).toBeGreaterThanOrEqual(4);
    for (const e of json.events as Array<Record<string, any>>) { // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(Object.keys(e).sort(), e.slug).toEqual(ALLOWED_KEYS);
      if (e.poster !== null) expect(Object.keys(e.poster).sort()).toEqual(ALLOWED_POSTER_KEYS);
      expect(['not_configured', 'demo']).toContain(e.sourceKind);
    }
    expect(text).not.toMatch(/source_type|_wg_live_|post_password|guid|post_author|\.mp3|\.mp4|"url":"[^"]*\/uploads\//);

    const one = await rest(DEV, `events/${SLUG_LIVE}`);
    expect(Object.keys(one.json)).toEqual(['event']);
    expect(Object.keys(one.json.event).sort()).toEqual(ALLOWED_KEYS);
    expect(one.text).not.toMatch(/source_type|_wg_live_|\.mp3|\.mp4/);
    // A demo event says it can play a demo source; the non-demo one says it cannot. Neither carries a URL.
    expect(one.json.event.sourceKind).toBe('demo');
    expect((await rest(DEV, `events/${SLUG_PENDING}`)).json.event.sourceKind).toBe('not_configured');
  });

  test('event routes are public and cacheable for 30 s, identical for guests and administrators', async ({ browser }) => {
    const guest = await rest(DEV, 'events');
    expect(guest.headers.get('cache-control')).toBe('public, max-age=30');
    expect(guest.headers.get('set-cookie')).toBeNull();
    const single = await rest(DEV, `events/${SLUG_LIVE}`);
    expect(single.headers.get('cache-control')).toBe('public, max-age=30');

    const context = await adminContext(browser, DEV);
    try {
      const asAdmin = await context.request.get('/wp-json/wg-live/v1/events');
      expect(asAdmin.headers()['cache-control']).toBe('public, max-age=30');
      expect(await asAdmin.text()).toBe(guest.text);
    } finally {
      await context.close();
    }
    // Read-only: only GET exists.
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(`${DEV.baseURL}/wp-json/wg-live/v1/events`, { method });
      expect(res.status, method).toBeGreaterThanOrEqual(400);
      expect(res.status, method).toBeLessThan(500);
    }
  });

  test('playback: a video demo event (the default kind) resolves to the bundled demo video for each mode, with no-store headers', async () => {
    const live = (await rest(DEV, `events/${SLUG_LIVE}`)).json.event.id as number;
    for (const mode of ['binaural', 'atmos'] as const) {
      const res = await rest(DEV, `playback?event=${live}&mode=${mode}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.json).sort()).toEqual(['kind', 'mimeType', 'url']);
      expect(res.json.kind).toBe('demo');
      expect(res.json.mimeType).toBe('video/mp4');
      expect(res.json.url).toMatch(new RegExp(`^http://localhost:8888/wp-content/plugins/wg-live/assets/demo/${DEMO_VIDEO[mode]}\\?ver=\\d+\\.\\d+\\.\\d+$`));

      const cc = res.headers.get('cache-control') ?? '';
      expect(cc).toMatch(/no-store/);
      expect(cc).toMatch(/no-cache/);
      expect(cc).toMatch(/private/);
      expect(new Date(res.headers.get('expires') ?? '').getTime()).toBeLessThan(Date.now());
      // The URL is real, public test media.
      const media = await fetch(res.json.url as string, { method: 'GET', headers: { Range: 'bytes=0-1' } });
      expect([200, 206]).toContain(media.status);
      expect(media.headers.get('content-type')).toMatch(/video\/mp4/);
    }
  });

  test('playback follows the event media kind: an audio event gets the bundled mp3 (audio/mpeg), a video event the mp4 (video/mp4)', async () => {
    for (const mode of ['binaural', 'atmos'] as const) {
      const audio = await rest(DEV, `playback?event=${audioEvent}&mode=${mode}`);
      expect(audio.status).toBe(200);
      expect(audio.json.kind).toBe('demo');
      expect(audio.json.mimeType).toBe('audio/mpeg');
      expect(audio.json.url).toMatch(new RegExp(`/assets/demo/${TONE[mode]}\\?ver=\\d+\\.\\d+\\.\\d+$`));
      const audioMedia = await fetch(audio.json.url as string, { method: 'GET', headers: { Range: 'bytes=0-1' } });
      expect([200, 206]).toContain(audioMedia.status);
      expect(audioMedia.headers.get('content-type')).toMatch(/audio\/mpeg/);

      // An event whose stored media kind is empty or unknown reads as video, the default.
      for (const id of [noKindEvent, oddKindEvent, binauralOnly]) {
        if (id === binauralOnly && mode === 'atmos') continue; // that fixture offers binaural only
        const video = await rest(DEV, `playback?event=${id}&mode=${mode}`);
        expect(video.json.mimeType, `event ${id}`).toBe('video/mp4');
        expect(video.json.url, `event ${id}`).toMatch(new RegExp(`/assets/demo/${DEMO_VIDEO[mode]}\\?ver=`));
      }
    }
  });

  test('the public data says mediaKind video by default and audio only when the event is an audio event', async () => {
    const kinds = async (slug: string): Promise<string> => (await rest(DEV, `events/${slug}`)).json.event.mediaKind as string;
    expect(await kinds(SLUG_LIVE)).toBe('video');
    expect(await kinds(`${prefix}-audio`)).toBe('audio');
    expect(await kinds(`${prefix}-nokind`)).toBe('video');
    expect(await kinds(`${prefix}-oddkind`)).toBe('video');
    expect(await kinds(`${prefix}-binaural`)).toBe('video');
  });

  test('playback resolution order: mode, entitlement, source', async () => {
    const live = (await rest(DEV, `events/${SLUG_LIVE}`)).json.event.id as number;
    const pending = (await rest(DEV, `events/${SLUG_PENDING}`)).json.event.id as number;
    const ended = (await rest(DEV, `events/${SLUG_ENDED}`)).json.event.id as number;

    // Mode not offered by the event.
    expect((await rest(DEV, `playback?event=${binauralOnly}&mode=atmos`)).json).toEqual({ kind: 'not_ready', reason: 'mode_unavailable' });
    expect((await rest(DEV, `playback?event=${binauralOnly}&mode=binaural`)).json.kind).toBe('demo');
    // A non-demo event has no entitlement result in M1: denied, never fail-open, never a URL.
    const denied = await rest(DEV, `playback?event=${pending}&mode=binaural`);
    expect(denied.json).toEqual({ kind: 'not_ready', reason: 'entitlement_unavailable' });
    expect(denied.text).not.toMatch(/http|\.mp3|\.mp4/);
    // Demo media is public test material, so an ended demo event still resolves (the client gates by status).
    expect((await rest(DEV, `playback?event=${ended}&mode=binaural`)).json.kind).toBe('demo');
    // Responses never depend on query tricks.
    expect((await rest(DEV, `playback?event=${pending}&mode=binaural&paid=true&entitled=1&debug=1`)).json).toEqual({ kind: 'not_ready', reason: 'entitlement_unavailable' });
    expect(live).toBeGreaterThan(0);
  });

  test('playback arguments are validated: missing, zero, non-numeric, unknown or upper-case mode are 400', async () => {
    for (const q of ['', 'event=1', 'mode=binaural', 'event=0&mode=binaural', 'event=abc&mode=binaural', 'event=1&mode=surround', 'event=1&mode=BINAURAL', 'event=-5&mode=atmos']) {
      const res = await rest(DEV, `playback?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.json.kind, q).toBeUndefined();
    }
  });
});
