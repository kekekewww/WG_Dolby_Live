/**
 * Plan D16: the deployment mode "disabled" hides every event everywhere at once, and the homepage card
 * falls back to its text without a call to action. Switching the mode back brings everything back.
 *
 * Changes shared site state (the mode), so it runs in the *-state projects, one at a time. The mode is
 * switched through the real settings form and always restored.
 */
import { test } from '@playwright/test';
import { saveDeploymentMode, DEPLOY_URL } from './settings-ui';
import { adminContext, bootConfigs, DEV, ELEMENTOR_URL, expect, fetchText, HELP_URL, LISTEN_URL, LIVE_URL, rest, setSettingsKeys, SLUG_LIVE, waitMounted, wpPhp } from './wp';

test.describe.configure({ mode: 'serial' });

const DISABLED_TITLE = '線上音樂會尚未開放';
const DISABLED_DETAIL = '請稍後再回來查看，或前往首頁。';
const FEATURED_FALLBACK = '線上音樂會資訊即將公布';

interface Surface {
  restList: number;
  restSingleStatus: number;
  restSingleCode: string | undefined;
  playback: unknown;
  modes: Record<string, string>;
  bootEvents: Record<string, number>;
}

/** What every public surface says right now. */
async function surface(): Promise<Surface> {
  const list = await rest(DEV, 'events');
  const single = await rest(DEV, `events/${SLUG_LIVE}`);
  const liveId = wpPhp<number>(DEV, `$p = get_posts( array( 'post_type' => 'wg_live_event', 'name' => '${SLUG_LIVE}', 'post_status' => 'publish', 'numberposts' => 1 ) ); return $p[0]->ID;`);
  const playback = await rest(DEV, `playback?event=${liveId}&mode=atmos`);
  const modes: Record<string, string> = {};
  const bootEvents: Record<string, number> = {};
  for (const [name, path] of Object.entries({ live: LIVE_URL, listen: `${LISTEN_URL}?wg_event=${SLUG_LIVE}`, help: HELP_URL, elementor: `${ELEMENTOR_URL}?wg_event=${SLUG_LIVE}` })) {
    const config = bootConfigs((await fetchText(DEV, path)).text)[0];
    modes[name] = config?.deploymentMode;
    bootEvents[name] = (config?.events as unknown[]).length;
  }
  return { restList: list.json.events.length, restSingleStatus: single.status, restSingleCode: single.json.code, playback: playback.json, modes, bootEvents };
}

function settingsMeta(): { version: number; updated_by: number } {
  return wpPhp(DEV, `$m = get_option( 'wg_live_settings_meta', array() ); return array( 'version' => (int) $m['version'], 'updated_by' => (int) $m['updated_by'] );`);
}

test('disabled hides events on every surface at once; demo brings them back', async ({ browser }) => {
  test.setTimeout(900_000);
  const context = await adminContext(browser, DEV);
  const page = await context.newPage();
  const adminId = wpPhp<number>(DEV, `return get_user_by( 'login', 'admin' )->ID;`);
  const before = await surface();
  expect(before.modes).toEqual({ live: 'demo', listen: 'demo', help: 'demo', elementor: 'demo' });
  expect(before.restList).toBeGreaterThanOrEqual(4);
  expect(before.restSingleStatus).toBe(200);
  expect((before.playback as { kind: string }).kind).toBe('demo');
  const metaBefore = settingsMeta();

  try {
    await saveDeploymentMode(page, 'disabled');

    // Every save is recorded: a new version and the administrator who made it.
    const metaAfter = settingsMeta();
    expect(metaAfter.version).toBe(metaBefore.version + 1);
    expect(metaAfter.updated_by).toBe(adminId);

    // Data surfaces.
    const off = await surface();
    expect(off.restList).toBe(0);
    expect(off.restSingleStatus).toBe(404);
    expect(off.restSingleCode).toBe('wg_live_not_found');
    expect(off.playback).toEqual({ kind: 'not_ready', reason: 'disabled' });
    expect(off.modes).toEqual({ live: 'disabled', listen: 'disabled', help: 'disabled', elementor: 'disabled' });
    expect(off.bootEvents).toEqual({ live: 0, listen: 0, help: 0, elementor: 0 });
    // The seeded event data is still in the database, only hidden.
    expect(wpPhp<number>(DEV, `return (int) wp_count_posts( 'wg_live_event' )->publish;`)).toBeGreaterThanOrEqual(4);

    // Rendered pages (anonymous visitors).
    const visitor = await browser.newContext({ baseURL: DEV.baseURL });
    try {
      const v = await visitor.newPage();

      await v.goto(LIVE_URL);
      await waitMounted(v);
      await expect(v.locator('.wg-live__panel--disabled').getByRole('heading', { name: DISABLED_TITLE })).toBeVisible();
      await expect(v.locator('.wg-live__panel--disabled')).toContainText(DISABLED_DETAIL);
      await expect(v.locator('article.wg-live__event-card')).toHaveCount(0);

      await v.goto(`${LISTEN_URL}?wg_event=${SLUG_LIVE}`);
      await waitMounted(v);
      await expect(v.getByRole('heading', { name: DISABLED_TITLE })).toBeVisible();
      await expect(v.locator('audio, video')).toHaveCount(0);
      await expect(v.locator('.wg-live__play')).toHaveCount(0);

      await v.goto(`${ELEMENTOR_URL}?wg_event=${SLUG_LIVE}`);
      await waitMounted(v);
      await expect(v.getByRole('heading', { name: DISABLED_TITLE })).toBeVisible();
      await expect(v.locator('audio, video')).toHaveCount(0);

      // The listening guide stays available.
      await v.goto(HELP_URL);
      await waitMounted(v);
      await expect(v.locator('.wg-live--help')).toBeVisible();
      await expect(v.locator('.wg-live--help').getByText('Binaural').first()).toBeVisible();

      // Homepage card: the fallback text only, no link, no event data.
      await v.goto('/');
      const card = v.locator('section.wg-live-featured');
      await expect(card).toHaveCount(1);
      await expect(card).toHaveClass(/wg-live-featured--empty/);
      await expect(card).toHaveText(FEATURED_FALLBACK);
      await expect(card.locator('a')).toHaveCount(0);
      await expect(v.locator('.wg-live-featured--event')).toHaveCount(0);
      expect(await v.content()).not.toContain('【介面示範】');
    } finally {
      await visitor.close();
    }

    // The deployment screen says so.
    await page.goto(DEPLOY_URL);
    await expect(page.locator('#wpbody-content')).toContainText('disabled');
  } finally {
    await saveDeploymentMode(page, 'demo').catch(() => setSettingsKeys(DEV, { deployment_mode: 'demo' }));
    await context.close();
  }

  const after = await surface();
  expect(after.modes).toEqual(before.modes);
  expect(after.restList).toBe(before.restList);
  expect(after.restSingleStatus).toBe(200);
  expect((after.playback as { kind: string }).kind).toBe('demo');
  expect(after.bootEvents.live).toBe(before.bootEvents.live);

  const homepage = await fetchText(DEV, '/');
  expect(homepage.text).toContain('wg-live-featured--event');
  expect(homepage.text).not.toContain(`>${FEATURED_FALLBACK}<`);
});
