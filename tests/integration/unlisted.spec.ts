/**
 * 0.5.4 (user decision 2026-11-03): an event can be published but 不公開列出 (unlisted). Nobody finds it on the
 * site before the studio announces it, yet everyone with the event link (the ticket buyers) can open it and watch.
 *
 *  - Left out of: the /live/ list, the homepage card (even when it is the featured event), REST `events`, and the
 *    bootstrap of every page except the player page for that very event.
 *  - Still works: REST `events/<slug>` (the player polls it), /playback, the shortcode `event` attribute, and the
 *    player page `?wg_event=<slug>`.
 *  - The event screen has the checkbox and shows the link to send to buyers.
 *
 * Fixtures are unique per browser project and deleted afterwards; settings are never written (the featured check
 * filters the option inside one PHP request), so the spec runs in parallel with the other read-only specs.
 */
import { test } from '@playwright/test';
import { adminContext, bootConfigs, clickPublish, createEvents, deleteEventsByPrefix, deletePosts, DEV, expect, fetchText, LISTEN_URL, LIVE_URL, rest, waitMounted, wpPhp } from './wp';

test.describe('不公開列出 (unlisted events)', () => {
  test.describe.configure({ mode: 'serial' });
  let prefix = '';
  let listed = '';
  let hidden = '';
  let ids: Record<string, number> = {};
  let pageId = 0;

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern for the fixtures argument.
  test.beforeAll(async ({}, testInfo) => {
    prefix = `it-unl-${testInfo.project.name}`;
    deleteEventsByPrefix(DEV, prefix);
    listed = `${prefix}-listed`;
    hidden = `${prefix}-hidden`;
    ids = createEvents(DEV, [
      { slug: listed, title: `${prefix} listed` },
      { slug: hidden, title: `${prefix} hidden`, meta: { unlisted: '1' } },
    ]);
    pageId = wpPhp<number>(
      DEV,
      `return wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => '${prefix} fixed', 'post_name' => '${prefix}-fixed', 'post_content' => '[wg_live view="player" event="${hidden}"]' ) );`,
    );
  });

  test.afterAll(() => {
    deleteEventsByPrefix(DEV, prefix);
    deletePosts(DEV, [pageId]);
  });

  test('REST: the list leaves the unlisted event out, the single route still answers it', async () => {
    const list = await rest(DEV, 'events');
    const slugs = (list.json.events as Array<{ slug: string }>).map((e) => e.slug);
    expect(slugs).toContain(listed);
    expect(slugs).not.toContain(hidden);
    expect(list.text).not.toContain(`${prefix} hidden`);

    const one = await rest(DEV, `events/${hidden}`);
    expect(one.status).toBe(200);
    expect(one.json.event).toMatchObject({ id: ids[hidden], slug: hidden, title: `${prefix} hidden` });
  });

  test('page bootstraps: only the player page for that event carries it', async () => {
    for (const path of [LIVE_URL, LISTEN_URL, `${LISTEN_URL}?wg_event=${listed}`, '/']) {
      const { text } = await fetchText(DEV, path);
      for (const boot of bootConfigs(text)) {
        const slugs = (boot.events as Array<{ slug: string }>).map((e) => e.slug);
        expect(slugs, path).not.toContain(hidden);
      }
      expect(text, path).not.toContain(`${prefix} hidden`);
      expect(text, path).not.toContain(hidden);
    }

    const { text } = await fetchText(DEV, `${LISTEN_URL}?wg_event=${hidden}`);
    const boots = bootConfigs(text);
    expect(boots).toHaveLength(1);
    const slugs = (boots[0]?.events as Array<{ slug: string }>).map((e) => e.slug);
    expect(slugs).toContain(hidden);
    expect(slugs).toContain(listed);
    expect(boots[0]?.featuredEventSlug).not.toBe(hidden);
  });

  test('the shortcode event attribute resolves an unlisted event', async () => {
    const { text } = await fetchText(DEV, `/${prefix}-fixed/`);
    const boot = bootConfigs(text)[0];
    expect(boot?.fixedEventSlug).toBe(hidden);
    expect((boot?.events as Array<{ slug: string }>).map((e) => e.slug)).toContain(hidden);
  });

  test('playback answers for the unlisted event exactly as for a listed one', async () => {
    const a = await rest(DEV, `playback?event=${ids[listed]}&mode=atmos`);
    const b = await rest(DEV, `playback?event=${ids[hidden]}&mode=atmos`);
    expect(b.status).toBe(200);
    expect(b.json.kind).toBe(a.json.kind);
    expect(b.json.kind).toBe('demo');
  });

  test('the player page opens the unlisted event', async ({ page }) => {
    await page.goto(`${LISTEN_URL}?wg_event=${hidden}`);
    await waitMounted(page);
    await expect(page.locator('.wg-live__player-view')).toBeVisible();
    await expect(page.locator('[data-gate="not_found"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${prefix} hidden` })).toBeVisible();
  });

  test('the homepage card never shows an unlisted event, even when it is the featured one', () => {
    const result = wpPhp<Record<string, unknown>>(
      DEV,
      `$out = array();
       foreach ( array( 'hidden' => ${ids[hidden]}, 'listed' => ${ids[listed]} ) as $key => $id ) {
         $filter = static function ( $value ) use ( $id ) { $value = is_array( $value ) ? $value : array(); $value['featured_event'] = $id; return $value; };
         add_filter( 'option_wg_live_settings', $filter );
         \\WG_Live\\Settings::flush_cache_for( 'wg_live_settings' );
         $model = \\WG_Live\\Shortcodes::featured_model();
         $boot  = \\WG_Live\\Public_Data::boot_config( 'events', null, 'h2' );
         $out[ $key ] = array( 'state' => $model['state'], 'title' => isset( $model['title'] ) ? $model['title'] : null, 'featuredSlug' => $boot['featuredEventSlug'] );
         remove_filter( 'option_wg_live_settings', $filter );
         \\WG_Live\\Settings::flush_cache_for( 'wg_live_settings' );
       }
       return $out;`,
    );
    expect(result.hidden).toEqual({ state: 'empty', title: null, featuredSlug: null });
    expect(result.listed).toEqual({ state: 'event', title: `${prefix} listed`, featuredSlug: listed });
  });

  test('the event screen: the checkbox saves both ways, the buyer link is shown, the list flags it', async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await adminContext(browser, DEV);
    const p = await context.newPage();
    const meta = (): string => wpPhp<string>(DEV, `return (string) get_post_meta( ${ids[hidden]}, '_wg_live_unlisted', true );`);
    try {
      await p.goto(`/wp-admin/post.php?post=${ids[hidden]}&action=edit`);
      const box = p.locator('input[name="wg_live[unlisted]"]');
      await expect(box).toBeChecked();
      await expect(p.locator('#wg-live-buyer-link')).toContainText(`wg_event=${hidden}`);

      await box.uncheck();
      await Promise.all([p.waitForURL(/post\.php\?post=\d+&action=edit&message=\d+/, { timeout: 120_000 }), clickPublish(p)]);
      expect(meta()).toBe('0');
      expect(((await rest(DEV, 'events')).json.events as Array<{ slug: string }>).map((e) => e.slug)).toContain(hidden);

      await p.locator('input[name="wg_live[unlisted]"]').check();
      await Promise.all([p.waitForURL(/post\.php\?post=\d+&action=edit&message=\d+/, { timeout: 120_000 }), clickPublish(p)]);
      expect(meta()).toBe('1');
      expect(((await rest(DEV, 'events')).json.events as Array<{ slug: string }>).map((e) => e.slug)).not.toContain(hidden);

      // A form without the box (a screen opened before 0.5.4) leaves the stored value alone.
      await p.evaluate(() => {
        for (const el of document.querySelectorAll('[name="wg_live[unlisted]"], [name="wg_live[unlisted_shown]"]')) el.remove();
      });
      await Promise.all([p.waitForURL(/post\.php\?post=\d+&action=edit&message=\d+/, { timeout: 120_000 }), clickPublish(p)]);
      expect(meta()).toBe('1');

      await p.goto(`/wp-admin/edit.php?post_type=wg_live_event&s=${encodeURIComponent(prefix)}`);
      await expect(p.locator(`#post-${ids[hidden]} .column-wg_live_listed`)).toContainText('不公開列出');
      await expect(p.locator(`#post-${ids[listed]} .column-wg_live_listed`)).toContainText('公開');
      await expect(p.locator(`#post-${ids[listed]} .column-wg_live_listed`)).not.toContainText('不公開列出');
    } finally {
      await context.close();
    }
  });
});
