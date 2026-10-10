/**
 * Shared helpers for the WordPress integration specs (M1-PLAN 7.2).
 *
 * Two wp-env instances are used:
 *   dev    http://localhost:8888  WP_ENVIRONMENT_TYPE=local       (dev tools allowed)
 *   tests  http://localhost:8889  WP_ENVIRONMENT_TYPE=production  (dev tools must never show)
 *
 * Both are seeded by `scripts/wp-env-setup.mjs` (lifecycle script afterStart). The admin account is the
 * default wp-env development login (user "admin"), a local test credential of this dev environment.
 *
 * State that the browser cannot reach in a reasonable time (fixture events in odd statuses, plugin
 * deactivation, option snapshots) is set up with WP-CLI through `docker exec` on the running wp-env CLI
 * container. That is much faster than `wp-env run` (which starts a new container per call). Every test
 * that changes shared state restores it in a finally block or an afterAll hook.
 */
import { execFileSync } from 'node:child_process';
import { expect as baseExpect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface WpEnv {
  name: 'dev' | 'tests';
  port: number;
  baseURL: string;
  /** Value of WP_ENVIRONMENT_TYPE in this instance. */
  envType: 'local' | 'production';
}

export const DEV: WpEnv = { name: 'dev', port: 8888, baseURL: 'http://localhost:8888', envType: 'local' };
export const TESTS: WpEnv = { name: 'tests', port: 8889, baseURL: 'http://localhost:8889', envType: 'production' };

/** Default wp-env development login (documented by @wordpress/env). Local test credentials only. */
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'password';

export const expect = baseExpect.configure({ timeout: 15_000 });

/* ------------------------------------------------------------------ */
/* Seeded content (scripts/seed-demo.php)                              */
/* ------------------------------------------------------------------ */

export const SLUG_LIVE = 'demo-live';
export const SLUG_UPCOMING = 'demo-upcoming';
export const SLUG_ENDED = 'demo-ended';
export const SLUG_PENDING = 'pending-source';
export const SEEDED_SLUGS = [SLUG_LIVE, SLUG_UPCOMING, SLUG_ENDED, SLUG_PENDING];

export const LIVE_URL = '/live/';
export const LISTEN_URL = '/live/listen/';
export const HELP_URL = '/live/help/';
export const ELEMENTOR_URL = '/live-elementor/';

export const TONE = { binaural: 'demo-tone-1.mp3', atmos: 'demo-tone-2.mp3' } as const;
export const MODE_NAME = { binaural: 'Binaural', atmos: 'Dolby Atmos 音軌' } as const;
export type Mode = keyof typeof TONE;

/* ------------------------------------------------------------------ */
/* WP-CLI through docker exec                                          */
/* ------------------------------------------------------------------ */

const containerCache = new Map<number, string>();

/** The wp-env CLI container that belongs to the WordPress container publishing `env.port`. */
export function cliContainer(env: WpEnv): string {
  const override = process.env[`WG_WP_CLI_CONTAINER_${env.name.toUpperCase()}`];
  if (override) return override;
  const cached = containerCache.get(env.port);
  if (cached) return cached;
  const out = execFileSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { encoding: 'utf8' });
  const line = out.split(/\r?\n/).find((l) => new RegExp(`:${env.port}->80`).test(l) && /wordpress-1\t/.test(l));
  if (!line) throw new Error(`No running wp-env WordPress container publishes port ${env.port}. Run "npm run wp:start" first.`);
  const name = (line.split('\t')[0] as string).replace(/wordpress-1$/, 'cli-1');
  containerCache.set(env.port, name);
  return name;
}

/** Run `wp <args>` in the CLI container. Returns stdout; throws (with stderr) on a non-zero exit. */
export function wp(env: WpEnv, args: string[]): string {
  try {
    return execFileSync('docker', ['exec', cliContainer(env), 'wp', ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`wp ${args.join(' ')} failed: ${err.stderr ?? ''}${err.stdout ?? ''}${err.message}`, { cause: e });
  }
}

/** Run `wp <args>` and return stdout + stderr, never throwing on a non-zero exit (used for notice checks). */
export function wpAll(env: WpEnv, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('docker', ['exec', cliContainer(env), 'sh', '-c', 'wp "$@" 2>&1', 'wp', ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; message: string };
    return { code: err.status ?? 1, out: err.stdout ?? err.message };
  }
}

const JSON_MARK = '<<WGJSON>>';

/** A PHP expression that decodes this JSON-able value into an array (safe for any characters). */
export function phpJson(value: unknown): string {
  return `json_decode( '${phpSingleQuoted(JSON.stringify(value))}', true )`;
}

/** Escape text for use inside a single-quoted PHP string literal. */
export function phpSingleQuoted(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Run a PHP snippet inside WordPress and return its JSON result. The snippet is a function body that
 * returns a value (it is wrapped as `json_encode( ( function () { ... } )() )`).
 */
export function wpPhp<T = unknown>(env: WpEnv, body: string): T {
  const code = `echo '${JSON_MARK}', wp_json_encode( ( function () { ${body} } )() ), '${JSON_MARK}';`;
  const out = wp(env, ['eval', code]);
  const start = out.indexOf(JSON_MARK);
  const end = out.lastIndexOf(JSON_MARK);
  if (start < 0 || end <= start) throw new Error(`No JSON marker in WP-CLI output:\n${out}`);
  return JSON.parse(out.slice(start + JSON_MARK.length, end)) as T;
}

/** wg_live_settings as stored (for snapshot and restore). */
export function getSettings(env: WpEnv): Record<string, unknown> {
  return wpPhp<Record<string, unknown>>(env, 'return get_option( "wg_live_settings", array() );');
}

export function setSettingsKeys(env: WpEnv, changes: Record<string, unknown>): void {
  const json = JSON.stringify(changes).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  wpPhp(env, `$c = json_decode( '${json}', true ); $s = get_option( "wg_live_settings", array() ); update_option( "wg_live_settings", array_merge( $s, $c ) ); return true;`);
}

export interface FixtureEvent {
  slug: string;
  title: string;
  /** post_status to store. */
  status?: 'publish' | 'draft' | 'private' | 'pending' | 'trash';
  password?: string;
  /** Explicit post_name for wp_insert_post (defaults to slug). */
  postName?: string;
  /**
   * Write this post_name straight into the database after the insert, bypassing every filter. The plugin
   * refuses to publish an event without a valid 代稱, so this is how legacy or imported rows are simulated.
   */
  rawPostName?: string;
  postType?: string;
  /** Event meta overrides, keys without the _wg_live_ prefix. */
  meta?: Record<string, unknown>;
}

/**
 * Create fixture events (demo, live, both modes by default) directly in the database.
 * Returns the created post IDs keyed by slug (or by title when the slug is empty).
 */
export function createEvents(env: WpEnv, events: FixtureEvent[]): Record<string, number> {
  const json = JSON.stringify(events).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return wpPhp<Record<string, number>>(
    env,
    `
    $events = json_decode( '${json}', true );
    $ids    = array();
    foreach ( $events as $e ) {
      $status = isset( $e['status'] ) ? $e['status'] : 'publish';
      $arr = array(
        'post_type'     => isset( $e['postType'] ) ? $e['postType'] : 'wg_live_event',
        'post_status'   => $status === 'trash' ? 'publish' : $status,
        'post_title'    => $e['title'],
        'post_password' => isset( $e['password'] ) ? $e['password'] : '',
      );
      $name = array_key_exists( 'postName', $e ) ? $e['postName'] : $e['slug'];
      if ( '' !== $name ) { $arr['post_name'] = $name; }
      $id = wp_insert_post( $arr, true );
      if ( is_wp_error( $id ) ) { throw new Exception( $id->get_error_message() ); }
      $meta = array_merge( array(
        'performers'       => array( 'Fixture' ),
        'description'      => 'fixture',
        'starts_at_utc'    => gmdate( 'Y-m-d\\\\TH:i:s\\\\Z', time() - 600 ),
        'display_timezone' => 'Asia/Taipei',
        'status'           => 'live',
        'media_kind'       => 'audio',
        'available_modes'  => array( 'binaural', 'atmos' ),
        'programme'        => array(),
        'product_id'       => 0,
        'product_url'      => '',
        'replay_available' => '0',
        'is_demo'          => '1',
        'source_type'      => 'demo',
      ), isset( $e['meta'] ) ? $e['meta'] : array() );
      foreach ( $meta as $k => $v ) { update_post_meta( $id, '_wg_live_' . $k, $v ); }
      if ( isset( $e['rawPostName'] ) ) {
        global $wpdb;
        $wpdb->update( $wpdb->posts, array( 'post_name' => $e['rawPostName'], 'post_status' => 'publish' ), array( 'ID' => $id ) );
        clean_post_cache( $id );
      }
      if ( 'trash' === $status ) { wp_trash_post( $id ); }
      $ids[ '' !== $e['slug'] ? $e['slug'] : $e['title'] ] = $id;
    }
    return $ids;
    `,
  );
}

/** Force-delete posts (any type) by ID. Missing IDs are ignored. */
export function deletePosts(env: WpEnv, ids: number[]): void {
  if (ids.length === 0) return;
  wpPhp(env, `foreach ( ${JSON.stringify(ids)} as $id ) { wp_delete_post( (int) $id, true ); } return true;`);
}

/** Delete every wg_live_event whose post_name or title starts with the prefix (cleanup after a crashed run). */
export function deleteEventsByPrefix(env: WpEnv, prefix: string): void {
  const p = prefix.replace(/'/g, '');
  wpPhp(
    env,
    `$ids = get_posts( array( 'post_type' => 'wg_live_event', 'post_status' => 'any', 'posts_per_page' => -1, 'fields' => 'ids', 'suppress_filters' => true ) );
     foreach ( $ids as $id ) { $p = get_post( $id ); if ( 0 === strpos( $p->post_name, '${p}' ) || 0 === strpos( $p->post_title, '${p}' ) ) { wp_delete_post( $id, true ); } }
     return true;`,
  );
}

/* ------------------------------------------------------------------ */
/* Browser helpers                                                     */
/* ------------------------------------------------------------------ */

const loginStates = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** Log in to wp-login.php once per browser type and environment and return the storage state. */
export async function adminState(browser: Browser, env: WpEnv): Promise<Awaited<ReturnType<BrowserContext['storageState']>>> {
  const key = `${browser.browserType().name()}:${env.port}`;
  const cached = loginStates.get(key);
  if (cached) return cached;
  const context = await browser.newContext({ baseURL: env.baseURL });
  const page = await context.newPage();
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(ADMIN_USER);
  await page.locator('#user_pass').fill(ADMIN_PASS);
  await page.locator('#wp-submit').click();
  await page.waitForURL(/\/wp-admin\/?/);
  const state = await context.storageState();
  await context.close();
  loginStates.set(key, state);
  return state;
}

/** A new context, logged in as the admin of `env`. The caller closes it. */
export async function adminContext(browser: Browser, env: WpEnv): Promise<BrowserContext> {
  return browser.newContext({ baseURL: env.baseURL, storageState: await adminState(browser, env) });
}

/** Wait until the first view on the page has mounted (skeleton replaced, aria-busy=false). */
export async function waitMounted(page: Page): Promise<void> {
  await expect(page.locator('.wg-live[data-wg-live-mounted="1"]').first()).toBeAttached();
  await expect(page.locator('.wg-live__mount').first()).toHaveAttribute('aria-busy', 'false');
}

/** The parsed bootstrap of every container in an HTML document. */
export function bootConfigs(html: string): Array<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const re = /<script type="application\/json" class="wg-live__config">([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) out.push(JSON.parse(m[1] as string));
  return out;
}

/**
 * GET a URL path on `env` without a browser and return status, headers and text. Network errors are retried:
 * Apache closes idle keep-alive connections and Node's fetch can pick one up just before (ECONNRESET).
 */
export async function fetchText(env: WpEnv, path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; text: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${env.baseURL}${path}`, { redirect: 'manual', ...init });
      return { status: res.status, headers: res.headers, text: await res.text() };
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** GET a wg-live/v1 REST route as JSON. `restPath` is e.g. "events" or "playback?event=1&mode=atmos". */
export async function rest(env: WpEnv, restPath: string): Promise<{ status: number; headers: Headers; json: any; text: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetchText(env, `/wp-json/wg-live/v1/${restPath}`);
  let json: unknown = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    /* not JSON */
  }
  return { ...res, json };
}

/** Count of requests (any resource type) whose URL contains `needle`, collected for the rest of the test. */
export function recordUrls(page: Page, needle: RegExp): { urls: string[] } {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (needle.test(r.url())) urls.push(r.url());
  });
  return { urls };
}

/**
 * Compare two PNG buffers in the browser (canvas). Returns the number of differing pixels, ignoring
 * channel differences of at most `tolerance` (0-255), and a PNG of the differing pixels in red.
 */
export async function diffPng(page: Page, a: Buffer, b: Buffer, tolerance = 0): Promise<{ width: number; height: number; sizeMatch: boolean; differing: number; diffPng: Buffer }> {
  const res = await page.evaluate(
    async ({ a64, b64, tol }) => {
      const load = (b64s: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image load failed'));
          img.src = `data:image/png;base64,${b64s}`;
        });
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const pixels = (img: HTMLImageElement): Uint8ClampedArray => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const octx = out.getContext('2d') as CanvasRenderingContext2D;
      const od = octx.createImageData(w, h);
      let differing = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs((pa[i] as number) - (pb[i] as number)), Math.abs((pa[i + 1] as number) - (pb[i + 1] as number)), Math.abs((pa[i + 2] as number) - (pb[i + 2] as number)), Math.abs((pa[i + 3] as number) - (pb[i + 3] as number)));
        if (d > tol) {
          differing++;
          od.data[i] = 255;
          od.data[i + 3] = 255;
        } else {
          od.data[i] = pa[i] as number;
          od.data[i + 1] = pa[i + 1] as number;
          od.data[i + 2] = pa[i + 2] as number;
          od.data[i + 3] = 60;
        }
      }
      octx.putImageData(od, 0, 0);
      return { width: w, height: h, sizeMatch: ia.width === ib.width && ia.height === ib.height, differing, png: out.toDataURL('image/png').split(',')[1] as string };
    },
    { a64: a.toString('base64'), b64: b.toString('base64'), tol: tolerance },
  );
  return { width: res.width, height: res.height, sizeMatch: res.sizeMatch, differing: res.differing, diffPng: Buffer.from(res.png, 'base64') };
}

/* ------------------------------------------------------------------ */
/* Elementor fixture                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create a published page built as an Elementor document (Full Width template, one Shortcode widget),
 * the same structure scripts/seed-demo.php uses. Returns the page ID.
 */
export function createElementorPage(env: WpEnv, slug: string, title: string, shortcode: string): number {
  const sc = phpSingleQuoted(shortcode);
  return wpPhp<number>(
    env,
    `
    $shortcode = '${sc}';
    $data = array( array(
      'id' => 'itc' . substr( md5( '${slug}' ), 0, 5 ), 'elType' => 'container', 'settings' => array(), 'isInner' => false,
      'elements' => array( array( 'id' => 'its' . substr( md5( '${slug}' ), 0, 5 ), 'elType' => 'widget', 'widgetType' => 'shortcode', 'settings' => array( 'shortcode' => $shortcode ), 'elements' => array() ) ),
    ) );
    $id = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => '${title}', 'post_name' => '${slug}', 'post_content' => '' ), true );
    if ( is_wp_error( $id ) ) { throw new Exception( $id->get_error_message() ); }
    update_post_meta( $id, '_elementor_edit_mode', 'builder' );
    update_post_meta( $id, '_elementor_template_type', 'wp-page' );
    update_post_meta( $id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '3.0.0' );
    update_post_meta( $id, '_wp_page_template', 'elementor_header_footer' );
    update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
    return $id;
    `,
  );
}
