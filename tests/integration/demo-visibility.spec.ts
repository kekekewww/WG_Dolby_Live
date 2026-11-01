/**
 * 0.5.0: visitors never see test content on the live site. On a production environment a demo event
 * (「示範活動」) is shown only to a logged-in user who can manage Live events; everyone else gets it
 * nowhere: not in the bootstrap, not in REST, not through /playback, not on the player page.
 *
 *   dev   :8888  WP_ENVIRONMENT_TYPE=local       demo events stay public (testing)
 *   tests :8889  WP_ENVIRONMENT_TYPE=production  demo events for event managers only
 *
 * Read-only against the seeded events, so it runs with the other read-only specs.
 */
import { test } from '@playwright/test';
import { adminContext, bootConfigs, DEV, expect, fetchText, LISTEN_URL, LIVE_URL, rest, SLUG_LIVE, SLUG_PENDING, TESTS, waitMounted, wpPhp } from './wp';

const DEMO_PLAYER = `${LISTEN_URL}?wg_event=${SLUG_LIVE}`;

function demoId(env: typeof TESTS): number {
  return wpPhp<number>(env, `$p = get_page_by_path( '${SLUG_LIVE}', OBJECT, 'wg_live_event' ); return $p ? (int) $p->ID : 0;`);
}

test.describe('production (:8889): visitors never see demo events', () => {
  test('the seeded demo event really is a demo event and is published', () => {
    const flags = wpPhp<{ demo: boolean; status: string }>(
      TESTS,
      `$p = get_page_by_path( '${SLUG_LIVE}', OBJECT, 'wg_live_event' ); $d = \\WG_Live\\Events::get_event_data( $p ); return array( 'demo' => ! empty( $d['is_demo'] ), 'status' => $p->post_status );`,
    );
    expect(flags).toEqual({ demo: true, status: 'publish' });
  });

  test('REST: no demo event in the list, 404 for its slug, public cache headers', async () => {
    const list = await rest(TESTS, 'events');
    expect(list.status).toBe(200);
    const events = list.json.events as Array<{ slug: string; isDemo: boolean }>;
    expect(events.filter((e) => e.isDemo)).toEqual([]);
    expect(events.map((e) => e.slug)).toContain(SLUG_PENDING);
    expect(list.headers.get('cache-control')).toBe('public, max-age=30');

    const one = await rest(TESTS, `events/${SLUG_LIVE}`);
    expect(one.status).toBe(404);
  });

  test('/playback refuses the demo event as not found', async () => {
    const res = await rest(TESTS, `playback?event=${demoId(TESTS)}&mode=atmos`);
    expect(res.json).toEqual({ kind: 'not_ready', reason: 'event_not_found' });
  });

  test('pages: no demo event in any bootstrap; the player link says 找不到這場活動', async ({ page }) => {
    for (const path of [LIVE_URL, DEMO_PLAYER, '/']) {
      for (const boot of bootConfigs((await fetchText(TESTS, path)).text)) {
        expect((boot.events as Array<{ isDemo: boolean }>).filter((e) => e.isDemo)).toEqual([]);
      }
    }
    await page.goto(`${TESTS.baseURL}${DEMO_PLAYER}`);
    await waitMounted(page);
    await expect(page.locator('.wg-live').getByText('找不到這場活動')).toBeVisible();
    await expect(page.locator('.wg-live__badge--demo')).toHaveCount(0);
  });

  test('an event manager logged in still previews the demo event, and REST answers them with no-store', async ({ browser }) => {
    const context = await adminContext(browser, TESTS);
    try {
      const page = await context.newPage();
      await page.goto(DEMO_PLAYER);
      await waitMounted(page);
      await expect(page.locator('#wpadminbar')).toBeAttached();
      await expect(page.locator('.wg-live__badge--demo').first()).toBeVisible();
      await expect(page.locator('.wg-live').getByText('找不到這場活動')).toHaveCount(0);

      // The page's own REST session sees the demo event; that answer is never stored by a shared cache.
      const answer = await page.evaluate(async () => {
        const raw = document.querySelector('script.wg-live__config')?.textContent ?? '{}';
        const boot = JSON.parse(raw) as { rest: { root: string; nonce: string | null } };
        const res = await fetch(`${boot.rest.root}events/${'demo-live'}`, {
          credentials: 'same-origin',
          headers: boot.rest.nonce ? { 'X-WP-Nonce': boot.rest.nonce } : {},
        });
        return { status: res.status, cache: res.headers.get('cache-control') ?? '' };
      });
      expect(answer.status).toBe(200);
      expect(answer.cache).toMatch(/no-store/);
      expect(answer.cache).not.toMatch(/public/);
    } finally {
      await context.close();
    }
  });
});

test.describe('local (:8888): demo events stay public for testing', () => {
  test('REST lists the demo event for a visitor, with public cache headers', async () => {
    const list = await rest(DEV, 'events');
    const events = list.json.events as Array<{ slug: string; isDemo: boolean }>;
    expect(events.find((e) => e.slug === SLUG_LIVE)?.isDemo).toBe(true);
    expect(list.headers.get('cache-control')).toBe('public, max-age=30');
  });
});
