/**
 * F13 (plan 4.2 / 7.2): saving events in the real WordPress admin (classic editor, the CPT has no REST support).
 *
 *  - A Chinese-titled event with an empty 代稱 stays a draft and shows a notice; the browser also blocks the click.
 *  - A valid 代稱 publishes, the event is public and plays in both modes on the real page.
 *  - An invalid start time keeps the old value; source_type "demo" on a non-demo event is rejected.
 *  - Duplicate or malformed 代稱 are never stored, never auto-suffixed with -2.
 *  - Bad product URLs are rejected, a forged form without the plugin nonce changes nothing,
 *    and a user without the manage capability cannot reach the screens.
 *
 * The admin account is the default wp-env administrator of this local dev site. The specs create their own
 * events (unique per browser project), run in one worker, and delete them afterwards.
 */
import { randomUUID } from 'node:crypto';
import { test, type BrowserContext, type Page } from '@playwright/test';
import { bootConfigs, deleteEventsByPrefix, deletePosts, DEV, expect, fetchText, fillLoginForm, LISTEN_URL, MODE_NAME, rest, TONE, waitMounted, wpPhp, type Mode } from './wp';

test.describe.configure({ mode: 'serial' });

interface EventForm {
  title: string;
  slug?: string;
  startsLocal?: string;
  status?: string;
  modes?: Array<'binaural' | 'atmos'>;
  demo?: boolean;
  source?: 'not_configured' | 'demo';
  productUrl?: string;
}

const NEW_EVENT = '/wp-admin/post-new.php?post_type=wg_live_event';

let context: BrowserContext;
let page: Page;
let prefix = '';
let adminUserId = 0;
const created: number[] = [];

async function postId(p: Page): Promise<number> {
  return Number(await p.locator('#post_ID').inputValue());
}

/** Fill the meta box of the open editor screen. Only the given fields are touched. */
async function fill(p: Page, f: Partial<EventForm>): Promise<void> {
  if (f.title !== undefined) await p.locator('#title').fill(f.title);
  if (f.slug !== undefined) await p.locator('#wg-live-slug').fill(f.slug);
  if (f.startsLocal !== undefined) await p.locator('#wg-live-starts-local').fill(f.startsLocal);
  if (f.status !== undefined) await p.locator('#wg-live-status').selectOption(f.status);
  if (f.modes !== undefined) {
    for (const mode of ['binaural', 'atmos'] as const) {
      await p.locator(`input[name="wg_live[available_modes][]"][value="${mode}"]`).setChecked(f.modes.includes(mode));
    }
  }
  if (f.demo !== undefined) await p.locator('input[name="wg_live[is_demo]"]').setChecked(f.demo);
  if (f.source !== undefined) await p.locator('#wg-live-source-type').selectOption(f.source);
  if (f.productUrl !== undefined) await p.locator('#wg-live-product-url').fill(f.productUrl);
}

/** WordPress redirects every save to post.php?post=ID&action=edit&message=N. */
const SAVED_URL = /post\.php\?post=\d+&action=edit&message=\d+/;

/** Click Publish / Update the way a person does. The slug script may stop the click. */
async function publish(p: Page): Promise<void> {
  await Promise.all([p.waitForURL(SAVED_URL, { timeout: 120_000 }), p.locator('#publish').click()]);
}

/**
 * Submit the editor form as publish WITHOUT the page's click handler (what a browser with the script off or a
 * hand-made request does): proves the server enforces the rules by itself.
 */
async function publishWithoutScript(p: Page): Promise<void> {
  await Promise.all([
    p.waitForURL(SAVED_URL, { timeout: 120_000 }),
    p.evaluate(() => {
      const form = document.getElementById('post') as HTMLFormElement;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'publish';
      input.value = 'Publish';
      form.append(input);
      HTMLFormElement.prototype.submit.call(form);
    }),
  ]);
}

async function openNew(p: Page): Promise<void> {
  await p.goto(NEW_EVENT);
  await expect(p.locator('#wg-live-slug')).toBeVisible();
  created.push(await postId(p));
}

async function openEdit(p: Page, id: number): Promise<void> {
  await p.goto(`/wp-admin/post.php?post=${id}&action=edit`);
  await expect(p.locator('#wg-live-slug')).toBeVisible();
}

function row(id: number): { status: string; name: string; title: string; meta: Record<string, unknown> } {
  return wpPhp(
    DEV,
    `$p = get_post( ${id} ); $m = array(); foreach ( array( 'starts_at_utc', 'source_type', 'is_demo', 'product_url', 'performers', 'available_modes', 'status' ) as $k ) { $m[ $k ] = get_post_meta( ${id}, '_wg_live_' . $k, true ); } return array( 'status' => $p->post_status, 'name' => $p->post_name, 'title' => $p->post_title, 'meta' => $m );`,
  );
}

const noticeText = async (p: Page): Promise<string> => (await p.locator('#wpbody-content .notice').allTextContents()).join(' | ');

test.beforeAll(async ({ browser }, testInfo) => {
  prefix = `it-f13-${testInfo.project.name}`;
  deleteEventsByPrefix(DEV, prefix);
  // A private administrator for this file: WordPress queues admin notices per user, so another test that
  // loads an admin page as the shared "admin" account at the same time could consume this file's notices.
  const login = `it-admin-${testInfo.project.name}-${randomUUID().slice(0, 6)}`;
  const password = randomUUID();
  adminUserId = wpPhp<number>(DEV, `return wp_insert_user( array( 'user_login' => '${login}', 'user_pass' => '${password}', 'user_email' => '${login}@example.invalid', 'role' => 'administrator' ) );`);
  context = await browser.newContext({ baseURL: DEV.baseURL });
  page = await context.newPage();
  page.on('dialog', (d) => void d.accept());
  await page.goto('/wp-login.php');
  await fillLoginForm(page, login, password);
  await page.locator('#wp-submit').click();
  await page.waitForURL(/wp-admin/);
});

test.afterAll(async () => {
  await context?.close();
  deleteEventsByPrefix(DEV, prefix);
  deletePosts(DEV, created);
  if (adminUserId > 0) wpPhp(DEV, `require_once ABSPATH . 'wp-admin/includes/user.php'; return wp_delete_user( ${adminUserId}, 1 );`);
});

let eventId = 0;
const slug = (): string => `${prefix}-concert`;
const TITLE = (): string => `【${prefix}】春季音樂會`;

test.describe('F13 admin save validation', () => {
  test('a Chinese title does not become a 代稱: the field stays empty and the browser blocks Publish with a hint', async () => {
    await openNew(page);
    await page.locator('#title').fill(TITLE());
    await expect(page.locator('#wg-live-slug')).toHaveValue('');
    await page.locator('#publish').click();
    await expect(page.locator('#wg-live-slug-status')).toHaveText('代稱是必填欄位。');
    await expect(page.locator('#wg-live-slug')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#wg-live-slug')).toBeFocused();
    expect(page.url(), 'the click did not submit').toMatch(/post-new\.php/);
  });

  test('an ASCII title pre-fills the field, and typing in it stops the pre-fill', async () => {
    await openNew(page);
    await page.locator('#title').fill('Spring Concert 2030');
    await expect(page.locator('#wg-live-slug')).toHaveValue('spring-concert-2030');
    await page.locator('#wg-live-slug').fill('my-own-slug');
    await page.locator('#title').fill('Spring Concert 2031');
    await expect(page.locator('#wg-live-slug')).toHaveValue('my-own-slug');
  });

  test('an empty 代稱 on the server: the event stays a draft, a notice says why, nothing is derived from the title', async () => {
    await openNew(page);
    eventId = await postId(page);
    await fill(page, { title: TITLE(), startsLocal: '2030-01-01T20:00', status: 'live', modes: ['binaural', 'atmos'], demo: true, source: 'demo' });
    await publishWithoutScript(page);

    expect(await noticeText(page)).toContain('代稱是必填欄位');
    await expect(page.locator('#post-status-display')).toHaveText(/Draft/);
    const saved = row(eventId);
    expect(saved).toMatchObject({ status: 'draft', name: '', title: TITLE() });
    expect((await rest(DEV, 'events')).text).not.toContain(prefix);
    // The meta box repeats the problem for the person editing.
    await expect(page.locator('#wg-live-slug')).toHaveValue('');
  });

  test('a valid 代稱 publishes the same event and it becomes public with the right UTC start time', async () => {
    await openEdit(page, eventId);
    await fill(page, { slug: slug() });
    await publish(page);

    await expect(page.locator('#post-status-display')).toHaveText(/Published/);
    expect(await noticeText(page)).not.toMatch(/代稱|格式不正確|已被另一場/);
    expect(row(eventId)).toMatchObject({ status: 'publish', name: slug(), title: TITLE() });

    const { status, json } = await rest(DEV, `events/${slug()}`);
    expect(status).toBe(200);
    expect(json.event).toMatchObject({
      slug: slug(),
      title: TITLE(),
      startsAt: '2030-01-01T12:00:00Z', // 20:00 Asia/Taipei (UTC+8)
      displayTimezone: 'Asia/Taipei',
      status: 'live',
      availableModes: ['binaural', 'atmos'],
      isDemo: true,
      sourceKind: 'demo',
    });
    const list = (await rest(DEV, 'events')).json.events as Array<{ slug: string }>;
    expect(list.map((e) => e.slug)).toContain(slug());
  });

  for (const mode of ['binaural', 'atmos'] as const satisfies readonly Mode[]) {
    test(`the Chinese-titled event plays in ${mode} on the real page`, async ({ page: viewer }) => {
      await viewer.goto(`${LISTEN_URL}?wg_event=${slug()}`);
      await waitMounted(viewer);
      await expect(viewer.locator('.wg-live__player-title')).toContainText(`【${prefix}】春季音樂會`);
      await viewer.getByRole('radio', { name: mode === 'binaural' ? /選擇耳機模式/ : /選擇家庭劇院模式/ }).check();
      await viewer.locator('.wg-live__play').click();
      await expect.poll(() => viewer.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);
      expect(await viewer.locator('audio').evaluate((a: HTMLAudioElement) => a.currentSrc)).toContain(TONE[mode]);
      await expect(viewer.locator('.wg-live__mode-label')).toHaveText(`目前播放：${MODE_NAME[mode]}`);
      await expect(viewer.locator('audio')).toHaveCount(1);
    });
  }

  test('an invalid start time keeps the old value and shows a notice', async () => {
    test.setTimeout(900_000); // five admin round trips on a slow WordPress
    await openEdit(page, eventId);
    // A datetime-local input cannot hold text; a hand-made request or an old browser can send it.
    await page.locator('#wg-live-starts-local').evaluate((el: HTMLInputElement) => {
      el.type = 'text';
      el.value = 'garbage-time';
    });
    await publish(page);
    expect(await noticeText(page)).toContain('開始時間「garbage-time」格式不正確，已保留原本的時間');
    expect(row(eventId).meta.starts_at_utc).toBe('2030-01-01T12:00:00Z');
    expect((await rest(DEV, `events/${slug()}`)).json.event.startsAt).toBe('2030-01-01T12:00:00Z');

    // A date that does not exist (30 February) and a year outside 2000-2100 are invalid too.
    for (const bad of ['2030-02-30T10:00', '1999-01-01T10:00', '2101-01-01T10:00']) {
      await openEdit(page, eventId);
      await page.locator('#wg-live-starts-local').evaluate((el: HTMLInputElement, value: string) => {
        el.type = 'text';
        el.value = value;
      }, bad);
      await publish(page);
      expect(await noticeText(page), bad).toContain('格式不正確，已保留原本的時間');
      expect(row(eventId).meta.starts_at_utc, bad).toBe('2030-01-01T12:00:00Z');
    }
    // A valid change is stored (and converted from the display zone).
    await openEdit(page, eventId);
    await fill(page, { startsLocal: '2030-03-05T09:30' });
    await publish(page);
    expect(row(eventId).meta.starts_at_utc).toBe('2030-03-05T01:30:00Z');
  });

  test('source_type "demo" on a non-demo event is rejected: stored as not_configured, nothing plays', async () => {
    await openEdit(page, eventId);
    await fill(page, { demo: false, source: 'demo' });
    await publish(page);
    expect(await noticeText(page)).toContain('來源類型「示範」需要同時勾選「示範活動」，已改存為「尚未設定」');
    expect(row(eventId).meta).toMatchObject({ source_type: 'not_configured', is_demo: '0' });
    await openEdit(page, eventId);
    await expect(page.locator('#wg-live-source-type')).toHaveValue('not_configured');

    const { json } = await rest(DEV, `events/${slug()}`);
    expect(json.event).toMatchObject({ isDemo: false, sourceKind: 'not_configured' });
    const playback = await rest(DEV, `playback?event=${eventId}&mode=binaural`);
    expect(playback.json.kind).toBe('not_ready');
    expect(playback.text).not.toMatch(/http|\.mp3/);

    // The M2 source types are shown disabled and refused as well.
    await openEdit(page, eventId);
    await page.locator('#wg-live-source-type').evaluate((el: HTMLSelectElement) => {
      // The option exists but is disabled (and a disabled option is not submitted): enable it like a hand-made request would.
      const option = el.querySelector('option[value="hls"]') as HTMLOptionElement;
      option.disabled = false;
      el.value = 'hls';
    });
    await publish(page);
    expect(await noticeText(page)).toContain('HLS 與 iframe 來源屬於 M2');
    expect(row(eventId).meta.source_type).toBe('not_configured');
  });

  test('a duplicate 代稱 is refused: draft, notice, the other event untouched, no -2 suffix', async () => {
    await openNew(page);
    const second = await postId(page);
    await fill(page, { title: `${TITLE()} 第二場`, slug: slug(), startsLocal: '2030-04-01T20:00' });
    await publishWithoutScript(page);

    expect(await noticeText(page)).toContain(`代稱「${slug()}」已被另一場活動使用`);
    expect(row(second)).toMatchObject({ status: 'draft', name: '' });
    expect(row(eventId)).toMatchObject({ status: 'publish', name: slug() });
    const names = wpPhp<string[]>(DEV, `global $wpdb; return $wpdb->get_col( "SELECT post_name FROM {$wpdb->posts} WHERE post_type = 'wg_live_event' AND post_name LIKE '${prefix}%'" );`);
    expect(names).toEqual([slug()]);
  });

  for (const bad of ['Bad Slug', 'UPPER', 'a_b', '-leading', 'trailing-', 'double--dash', '中文', 'x'.repeat(101)]) {
    test(`malformed 代稱 "${bad.slice(0, 20)}${bad.length > 20 ? '…' : ''}" is never stored: a published event goes back to draft and keeps its old name`, async () => {
      await openEdit(page, eventId);
      // Set the value directly: the input has maxlength=100, which a hand-made request does not respect.
      await page.locator('#wg-live-slug').evaluate((el: HTMLInputElement, value: string) => {
        el.value = value;
      }, bad);
      await publishWithoutScript(page);
      expect(await noticeText(page)).toContain('格式不正確');
      expect(row(eventId)).toMatchObject({ status: 'draft', name: slug() });
      expect((await rest(DEV, `events/${slug()}`)).status, 'a draft is not public').toBe(404);
    });
  }

  test('Save Draft with a bad 代稱 does not store it; fixing the value and publishing makes the event public again', async () => {
    await openEdit(page, eventId);
    // In the browser the input's own pattern already blocks this click ("Please match the requested format");
    // submit the form natively, like a request that skips the browser's checks.
    await expect(page.locator('#wg-live-slug')).toHaveAttribute('pattern', /.+/);
    await page.locator('#wg-live-slug').fill('Bad Draft');
    await Promise.all([
      page.waitForURL(SAVED_URL, { timeout: 120_000 }),
      page.evaluate(() => {
        const form = document.getElementById('post') as HTMLFormElement;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'save';
        input.value = 'Save Draft';
        form.append(input);
        HTMLFormElement.prototype.submit.call(form);
      }),
    ]);
    expect(await noticeText(page)).toContain('代稱沒有被儲存');
    expect(row(eventId).name).toBe(slug());

    await openEdit(page, eventId);
    await fill(page, { slug: slug() });
    await publish(page);
    expect(row(eventId)).toMatchObject({ status: 'publish', name: slug() });
    expect((await rest(DEV, `events/${slug()}`)).status).toBe(200);
  });

  test('product URLs: http(s) only; a bad value is refused and the previous one stays', async () => {
    test.setTimeout(900_000); // six admin round trips on a slow WordPress
    await openEdit(page, eventId);
    await fill(page, { productUrl: 'https://example.com/tickets?show=1' });
    await publish(page);
    expect(row(eventId).meta.product_url).toBe('https://example.com/tickets?show=1');
    expect((await rest(DEV, `events/${slug()}`)).json.event.productUrl).toBe('https://example.com/tickets?show=1');

    for (const bad of ['javascript:alert(1)', 'ftp://example.com/x', 'data:text/html,hi', '//example.com/x']) {
      await openEdit(page, eventId);
      // The field is type=url, so the browser would refuse some values: send them as text.
      await page.locator('#wg-live-product-url').evaluate((el: HTMLInputElement, value: string) => {
        el.type = 'text';
        el.value = value;
      }, bad);
      await publish(page);
      expect(await noticeText(page), bad).toContain('購票連結必須是 http 或 https 網址');
      expect(row(eventId).meta.product_url, bad).toBe('https://example.com/tickets?show=1');
    }
    // The stored value reaches the pages escaped.
    const { text } = await fetchText(DEV, '/live/');
    expect(bootConfigs(text)[0]?.events.find((e: { slug: string }) => e.slug === slug())?.productUrl).toBe('https://example.com/tickets?show=1');
    expect(text).not.toContain('javascript:alert');
  });

  test('a form post without the plugin nonce changes nothing (the field data is ignored)', async () => {
    await openEdit(page, eventId);
    const before = row(eventId);
    const status = await page.evaluate(async () => {
      const form = document.getElementById('post') as HTMLFormElement;
      const data = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
      data.delete('wg_live_event_nonce');
      data.set('wg_live[performers]', 'HACKED');
      data.set('wg_live[status]', 'cancelled');
      data.set('save', 'Save');
      // form.action is shadowed by the hidden input named "action": read the attribute.
      const res = await fetch(new URL(form.getAttribute('action') ?? 'post.php', location.href), { method: 'POST', body: data, credentials: 'same-origin' });
      return res.status;
    });
    expect(status).toBe(200);
    const after = row(eventId);
    expect(after.meta).toEqual(before.meta);
    expect(JSON.stringify(after.meta)).not.toContain('HACKED');
  });

  test('programmatic saves (no form, no nonce) cannot publish an event without a valid 代稱 either', async () => {
    const result = wpPhp<{ status: string; name: string }>(
      DEV,
      `$id = wp_insert_post( array( 'post_type' => 'wg_live_event', 'post_status' => 'publish', 'post_title' => '${prefix} programmatic 中文' ) );
       $p = get_post( $id ); return array( 'status' => $p->post_status, 'name' => $p->post_name );`,
    );
    expect(result).toEqual({ status: 'draft', name: '' });
  });
});

test.describe('spec F3/F4: publishing needs a title and a valid start time', () => {
  test('an empty title is not published: draft, a notice says why, nothing is public', async () => {
    await openNew(page);
    const id = await postId(page);
    await fill(page, { slug: `${prefix}-no-title`, startsLocal: '2030-06-01T20:00', status: 'live', modes: ['binaural', 'atmos'], demo: true, source: 'demo' });
    await publishWithoutScript(page);

    expect(await noticeText(page)).toContain('活動標題是必填欄位');
    expect(row(id)).toMatchObject({ status: 'draft', title: '' });
    expect((await rest(DEV, `events/${prefix}-no-title`)).status, 'a draft is not public').toBe(404);

    // Adding the title makes the same event publishable.
    await openEdit(page, id);
    await fill(page, { title: `${TITLE()} 有標題` });
    await publish(page);
    expect(row(id)).toMatchObject({ status: 'publish', name: `${prefix}-no-title` });
    expect((await rest(DEV, `events/${prefix}-no-title`)).status).toBe(200);
  });

  test('a missing start time is not published: draft and a notice; clearing the time of a published event pulls it back to draft', async () => {
    await openNew(page);
    const id = await postId(page);
    await fill(page, { title: `${TITLE()} 無時間`, slug: `${prefix}-no-start`, status: 'live', modes: ['binaural', 'atmos'], demo: true, source: 'demo' });
    await publishWithoutScript(page);

    expect(await noticeText(page)).toContain('開始時間是必填欄位');
    expect(row(id)).toMatchObject({ status: 'draft', name: `${prefix}-no-start` });
    expect(row(id).meta.starts_at_utc).toBe('');
    expect((await rest(DEV, `events/${prefix}-no-start`)).status).toBe(404);

    await openEdit(page, id);
    await fill(page, { startsLocal: '2030-06-02T20:00' });
    await publish(page);
    expect(row(id)).toMatchObject({ status: 'publish' });
    expect(row(id).meta.starts_at_utc).toBe('2030-06-02T12:00:00Z');
    expect((await rest(DEV, `events/${prefix}-no-start`)).status).toBe(200);

    // Clearing the time while keeping the event published: the server refuses to keep it published.
    await openEdit(page, id);
    await page.locator('#wg-live-starts-local').fill('');
    await publishWithoutScript(page);
    expect(await noticeText(page)).toContain('開始時間是必填欄位');
    expect(row(id).status).toBe('draft');
    expect((await rest(DEV, `events/${prefix}-no-start`)).status).toBe(404);
  });

  test('a draft without title or start time is saved as before (drafts are never blocked)', async () => {
    await openNew(page);
    const id = await postId(page);
    await fill(page, { slug: `${prefix}-draft-only` });
    await Promise.all([
      page.waitForURL(SAVED_URL, { timeout: 120_000 }),
      page.evaluate(() => {
        const form = document.getElementById('post') as HTMLFormElement;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'save';
        input.value = 'Save Draft';
        form.append(input);
        HTMLFormElement.prototype.submit.call(form);
      }),
    ]);
    expect(await noticeText(page)).not.toContain('是必填欄位');
    expect(row(id)).toMatchObject({ status: 'draft', name: `${prefix}-draft-only` });
  });

  test('programmatic inserts (fixtures, seed-demo) are not blocked: their meta is written after the insert', async () => {
    const result = wpPhp<{ status: string }>(
      DEV,
      `$id = wp_insert_post( array( 'post_type' => 'wg_live_event', 'post_status' => 'publish', 'post_title' => '${prefix} programmatic ok', 'post_name' => '${prefix}-programmatic-ok' ) );
       $p = get_post( $id ); return array( 'status' => $p->post_status );`,
    );
    expect(result.status).toBe('publish');
  });
});

test.describe('capabilities', () => {
  test('a user without the manage capability cannot open the event, settings, deployment or pages screens', async ({ browser }) => {
    const login = `it-editor-${randomUUID().slice(0, 8)}`;
    const password = randomUUID();
    const userId = wpPhp<number>(DEV, `return wp_insert_user( array( 'user_login' => '${login}', 'user_pass' => '${password}', 'user_email' => '${login}@example.invalid', 'role' => 'editor' ) );`);
    const editor = await browser.newContext({ baseURL: DEV.baseURL });
    try {
      const p = await editor.newPage();
      await p.goto('/wp-login.php');
      await fillLoginForm(p, login, password);
      await p.locator('#wp-submit').click();
      await p.waitForURL(/wp-admin/);

      for (const path of [
        '/wp-admin/edit.php?post_type=wg_live_event',
        NEW_EVENT,
        `/wp-admin/post.php?post=${eventId}&action=edit`,
        '/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-settings',
        '/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-deploy',
        '/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-pages',
      ]) {
        const res = await p.goto(path);
        expect(res?.status(), path).toBe(403);
        await expect(p.locator('body')).toContainText(/not allowed|沒有權限/);
      }
      // The create-pages handler refuses too.
      const post = await p.request.post('/wp-admin/admin-post.php', { form: { action: 'wg_live_create_pages' }, maxRedirects: 0 });
      expect(post.status()).toBe(403);
      expect(wpPhp<number>(DEV, `return count( get_posts( array( 'post_type' => 'page', 'post_status' => 'draft', 'posts_per_page' => -1, 'name' => 'listen' ) ) );`)).toBe(0);
    } finally {
      await editor.close();
      wpPhp(DEV, `require_once ABSPATH . 'wp-admin/includes/user.php'; return wp_delete_user( ${userId} );`);
    }
  });
});
