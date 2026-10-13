/**
 * Shared helpers for the harness e2e specs (M1-PLAN 7.4).
 *
 * Two page bases exist: the Vite dev harness (`/dev/*.html`, projects harness-dev-*) and the built
 * bundle (`/dev/dist/*.html`, project harness-dist). Specs for the dev harness use the `dev` base;
 * the *.dist.spec.ts files use the `dist` base.
 *
 * Harness events (dev/core.mjs), all test data:
 *   demo-live-binaural-atmos  live, demo, both modes, VIDEO  (featured, the one that plays)
 *   demo-scheduled            scheduled (+3 days), demo
 *   demo-ended                ended, demo, binaural only
 *   pending-source-live       live, NOT demo, source not configured, has productUrl
 *
 * Every harness event is a video event (the default media kind): the demo plays demo-video-N.mp4 in ONE <video>.
 * `asAudioEvent()` turns one of them into an audio event (boot config + playback descriptor) for the audio-only specs.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, type Locator, type Page, type Request, type Route } from '@playwright/test';

/**
 * `expect` with a 15 s default timeout: the three browsers run in parallel on one machine and a cold
 * Vite dev server, so the 5 s default is too tight for media-heavy specs. Specs import this one.
 */
export const expect = baseExpect.configure({ timeout: 15_000 });

export const SLUG_LIVE = 'demo-live-binaural-atmos';
export const SLUG_SCHEDULED = 'demo-scheduled';
export const SLUG_ENDED = 'demo-ended';
export const SLUG_PENDING = 'pending-source-live';

export type Mode = 'binaural' | 'atmos';

/** The demo media of a video event (the default kind), per mode. */
export const DEMO_MEDIA: Record<Mode, string> = { binaural: 'demo-video-1.mp4', atmos: 'demo-video-2.mp4' };
/** The demo media of an audio event, per mode. */
export const TONE: Record<Mode, string> = { binaural: 'demo-tone-1.mp3', atmos: 'demo-tone-2.mp3' };
export const MODE_NAME: Record<Mode, string> = { binaural: 'Binaural', atmos: 'Dolby Atmos 音軌' };

export type Base = 'dev' | 'dist';
export const BASE_PATH: Record<Base, string> = { dev: '/dev/', dist: '/dev/dist/' };

export interface PageOptions {
  base?: Base;
  /** ?wg_event= */
  event?: string;
  /** ?wg_mode= (raw, so tests can send invalid values) */
  mode?: string;
  /** ?harness= flags (comma separated): disabled | plain | nodev */
  harness?: string;
  /** Other query parameters, e.g. featured, heading, fixed */
  query?: Record<string, string>;
  /**
   * Use the stress page (dev/stress.html: deliberately hostile global theme CSS, no realistic site chrome)
   * instead of the realistic page. For the CSS isolation specs only.
   */
  stress?: boolean;
}

function search(opts: PageOptions): string {
  const params = new URLSearchParams();
  if (opts.event !== undefined) params.set('wg_event', opts.event);
  if (opts.mode !== undefined) params.set('wg_mode', opts.mode);
  if (opts.harness !== undefined) params.set('harness', opts.harness);
  for (const [k, v] of Object.entries(opts.query ?? {})) params.set(k, v);
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

const STRESS_VIEW = { index: 'events', listen: 'player', help: 'help' } as const;

export function viewUrl(view: 'index' | 'listen' | 'help', opts: PageOptions = {}): string {
  if (opts.stress) return `${BASE_PATH[opts.base ?? 'dev']}stress.html${search({ ...opts, query: { view: STRESS_VIEW[view], ...opts.query } })}`;
  return `${BASE_PATH[opts.base ?? 'dev']}${view}.html${search(opts)}`;
}

/** Wait until the view has mounted (skeleton replaced, aria-busy=false). */
export async function waitMounted(page: Page): Promise<void> {
  await expect(page.locator('.wg-live[data-wg-live-mounted="1"]').first()).toBeAttached();
  await expect(page.locator('.wg-live__mount').first()).toHaveAttribute('aria-busy', 'false');
}

export async function gotoView(page: Page, view: 'index' | 'listen' | 'help', opts: PageOptions = {}): Promise<void> {
  await page.goto(viewUrl(view, opts));
  await waitMounted(page);
}

export async function gotoPlayer(page: Page, opts: PageOptions = {}): Promise<Player> {
  await gotoView(page, 'listen', { event: SLUG_LIVE, ...opts });
  return player(page);
}

/* ------------------------------------------------------------------ */
/* Player locators                                                     */
/* ------------------------------------------------------------------ */

export interface Player {
  page: Page;
  root: Locator;
  view: Locator;
  region: Locator;
  title: Locator;
  statusTitle: Locator;
  statusDetail: Locator;
  statusBadge: Locator;
  modeLabel: Locator;
  demoNotice: Locator;
  errorCode: Locator;
  primary: Locator;
  startReason: Locator;
  switchButton: Locator;
  dialog: Locator;
  srStatus: Locator;
  /** The one media element: <video> for video events (the default), <audio> for audio events. */
  media: Locator;
  entitlement: Locator;
  devPanel: Locator;
  radio(mode: Mode): Locator;
  action(name: string | RegExp): Locator;
  /** Choose a mode and wait until Start is enabled (descriptor prefetched, entitlement known). */
  choose(mode: Mode): Promise<void>;
  /** choose() + click 開始聆聽. */
  start(mode: Mode): Promise<void>;
  /** Wait for progress: currentTime above `min` seconds and increasing. */
  expectAdvancing(min?: number): Promise<void>;
  /** The dev panel: open the <details> and return its selects. */
  openDevPanel(): Promise<{ status: Locator; entitlement: Locator; fault: Locator; reset: Locator }>;
}

/**
 * Make the harness event `slug` an AUDIO event for this page: the boot config says mediaKind 'audio' and the
 * playback descriptor answers with the bundled mp3 (what the PHP provider does for an audio event). The harness
 * events are all video events, so the audio-only layout and element specs go through here.
 */
export async function asAudioEvent(page: Page, urlPattern: string | RegExp = /\/dev\/(?:dist\/)?listen\.html/, slug: string = SLUG_LIVE): Promise<void> {
  await rewriteBootConfig(page, urlPattern, (config) => {
    for (const e of config.events) if (e.slug === slug) e.mediaKind = 'audio';
  });
  await page.route(/wg-live\/v1\/playback/, async (route) => {
    const mode = new URL(route.request().url()).searchParams.get('mode');
    if (mode !== 'binaural' && mode !== 'atmos') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ kind: 'demo', url: `/demo/${TONE[mode]}`, mimeType: 'audio/mpeg' }),
    });
  });
}

export function player(page: Page): Player {
  const root = page.locator('.wg-live').first();
  const p: Player = {
    page,
    root,
    view: root.locator('.wg-live__player-view'),
    region: root.locator('.wg-live__player'),
    title: root.locator('.wg-live__player-title'),
    statusTitle: root.locator('.wg-live__status-title'),
    statusDetail: root.locator('.wg-live__status-detail'),
    statusBadge: root.locator('.wg-live__player-status-badge'),
    modeLabel: root.locator('.wg-live__mode-label'),
    demoNotice: root.locator('.wg-live__demo-notice'),
    errorCode: root.locator('.wg-live__error-code'),
    primary: root.locator('.wg-live__play'),
    startReason: root.locator('.wg-live__start-reason'),
    switchButton: root.locator('.wg-live__modebar .wg-live__switch'),
    dialog: root.locator('dialog.wg-live__dialog'),
    srStatus: root.locator('.wg-live__sr-status'),
    media: root.locator('audio, video'),
    entitlement: root.locator('.wg-live__entitlement'),
    devPanel: root.locator('details.wg-live__dev'),
    radio(mode) {
      return root.getByRole('radio', { name: mode === 'binaural' ? /選擇耳機模式/ : /選擇家庭劇院模式/ });
    },
    action(name) {
      return root.getByRole('button', { name });
    },
    async choose(mode) {
      await p.radio(mode).check();
      await expect(p.primary).toBeVisible();
      await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
    },
    async start(mode) {
      await p.choose(mode);
      await p.primary.click();
    },
    async expectAdvancing(min = 0.3) {
      await expect.poll(() => p.media.evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 15_000 }).toBeGreaterThan(min);
      const t1 = await p.media.evaluate((a: HTMLMediaElement) => a.currentTime);
      await expect.poll(() => p.media.evaluate((a: HTMLMediaElement) => a.currentTime), { timeout: 10_000 }).toBeGreaterThan(t1);
    },
    async openDevPanel() {
      await expect(p.devPanel).toBeVisible();
      if ((await p.devPanel.getAttribute('open')) === null) await p.devPanel.locator('summary').click();
      await expect(p.devPanel).toHaveAttribute('open', '');
      return {
        status: p.devPanel.getByLabel('活動狀態'),
        entitlement: p.devPanel.getByLabel(/觀看資格/),
        fault: p.devPanel.getByLabel(/故障注入/),
        reset: p.devPanel.getByRole('button', { name: '重設全部' }),
      };
    },
  };
  return p;
}

/** href of a link as path + query (safeUrl() makes hrefs absolute; absolute external URLs stay whole). */
export async function hrefOf(link: Locator): Promise<string> {
  const href = await link.evaluate((a) => (a as HTMLAnchorElement).href);
  const url = new URL(href);
  return url.origin === new URL(link.page().url()).origin ? `${url.pathname}${url.search}${url.hash}` : href;
}

/** Assert a link target, tolerant of the absolute form safeUrl() produces. */
export async function expectHref(link: Locator, expected: string): Promise<void> {
  await expect(link).toBeVisible();
  await expect.poll(() => hrefOf(link)).toBe(expected);
}

/* ------------------------------------------------------------------ */
/* Network helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * WebKit (Playwright) does not report media element requests to page.on('request') or to
 * performance entries, so assertions about media request counts run on Chromium and Firefox only.
 * Everything else (currentSrc, events, element count) is asserted in all three.
 */
export function mediaRequestsObservable(browserName: string): boolean {
  return browserName !== 'webkit';
}

export const isMediaUrl = (url: string): boolean => /\/demo\/(?:demo-tone-[12]\.mp3|demo-video-[12]\.mp4)/.test(url);
export const isRestUrl = (url: string): boolean => /wg-live\/v1\//.test(url);

/** Collect request URLs matching `filter` for the rest of the test. */
export function recordRequests(page: Page, filter: (url: string) => boolean): { urls: string[]; count(name?: string): number } {
  const urls: string[] = [];
  page.on('request', (r: Request) => {
    if (filter(r.url())) urls.push(r.url());
  });
  return {
    urls,
    count: (name) => (name === undefined ? urls.length : urls.filter((u) => u.includes(name)).length),
  };
}

/**
 * Rewrite the BootConfig JSON of the harness page before it reaches the browser. Used for states the
 * harness query flags do not offer (no events, an event with a buy link, no account link).
 */
export async function rewriteBootConfig(
  page: Page,
  urlPattern: string | RegExp,
  mutate: (config: Record<string, any>) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<void> {
  await page.route(urlPattern, async (route: Route) => {
    const response = await route.fetch();
    const html = await response.text();
    const re = /(<script type="application\/json" class="wg-live__config">)([\s\S]*?)(<\/script>)/;
    const match = re.exec(html);
    if (!match) {
      await route.fulfill({ response, body: html });
      return;
    }
    const config = JSON.parse(match[2] as string);
    mutate(config);
    // Same escaping as PHP JSON_HEX_TAG | JSON_HEX_AMP.
    const json = JSON.stringify(config).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    await route.fulfill({ response, body: html.replace(re, (_m, a: string, _b: string, c: string) => `${a}${json}${c}`) });
  });
}

/* ------------------------------------------------------------------ */
/* Init scripts                                                        */
/* ------------------------------------------------------------------ */

/**
 * Track every media element that ever plays (also detached or `new Audio()` ones) in
 * window.__wgPlayed, so F06 can prove there is never a second, overlapping source.
 */
export async function trackMediaElements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wgPlayed: Set<HTMLMediaElement> };
    w.__wgPlayed = new Set();
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__wgPlayed.add(this);
      return origPlay.call(this);
    };
  });
}

export async function mediaStats(page: Page): Promise<{ inDom: number; everPlayed: number; audibleNow: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __wgPlayed?: Set<HTMLMediaElement> };
    const all = Array.from(w.__wgPlayed ?? []);
    return {
      inDom: document.querySelectorAll('audio, video').length,
      everPlayed: all.length,
      audibleNow: all.filter((m) => !m.paused && !m.ended).length,
    };
  });
}

/** Make the first play() reject like a browser that blocks autoplay (F09). */
export async function blockFirstPlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const orig = HTMLMediaElement.prototype.play;
    let blocked = false;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!blocked) {
        blocked = true;
        return Promise.reject(new DOMException('play() blocked by the test', 'NotAllowedError'));
      }
      return orig.call(this);
    };
  });
}

/**
 * Collect uncaught page errors and console errors (the favicon and anything in `ignore` are skipped).
 * Call at the start of a test and `expect(errors).toEqual([])` at the end.
 */
export function watchErrors(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  const skip = (text: string): boolean => /favicon/i.test(text) || ignore.some((re) => re.test(text));
  page.on('pageerror', (error) => {
    if (!skip(error.message)) errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !skip(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

/** Console messages the browser prints for a resource the test breaks on purpose. */
export const EXPECTED_LOAD_FAILURES = [/Failed to load resource/i, /status of 404/i, /MEDIA_ELEMENT_ERROR/i, /net::ERR_/i, /NS_ERROR/i];

/**
 * Make the media URL of one mode point at a file that does not exist. The playback descriptor is
 * rewritten (a REST response, which every browser lets Playwright intercept) so that the *media*
 * request fails with a real 404 in Chromium, Firefox and WebKit. (WebKit media requests cannot be
 * intercepted with page.route.)
 */
export async function breakModeUrl(page: Page, mode: Mode, missing = '/demo/missing-video.mp4'): Promise<void> {
  await page.route(new RegExp(`wg-live/v1/playback.*mode=${mode}`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ kind: 'demo', url: missing, mimeType: missing.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4' }),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                       */
/* ------------------------------------------------------------------ */

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * axe scan of the plugin's own subtree (.wg-live). The fake site chrome around it is deliberately
 * ugly and is not ours to fix. Fails on serious or critical violations; lesser ones are returned so
 * the test can print them.
 */
export async function scanWgLive(page: Page, label: string): Promise<void> {
  // Colours in the middle of a 200 ms transition or the dialog's slide-in are not what a user ends up
  // seeing (axe blends opacity): let finite animations settle first.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).include('.wg-live').withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = blocking.map((v) => `${label}: [${v.impact}] ${v.id} - ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}  ${n.failureSummary?.replace(/\s+/g, ' ')}`).join('\n')}`);
  // Compare the readable summaries (not the raw axe objects) so a failure prints something useful.
  expect(summary, `axe serious/critical violations in "${label}"`).toEqual([]);
  // Lesser findings do not fail the test but stay visible in the report.
  const minor = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  if (minor.length > 0) {
    console.log(`[axe minor] ${label}: ${minor.map((v) => `${v.id}(${v.impact})`).join(', ')}`);
  }
}

/* ------------------------------------------------------------------ */
/* Host colours (inherit-first, spec 3.5)                              */
/* ------------------------------------------------------------------ */

/**
 * The hosts the plugin must read on. `dark` is the live site (photo under a 75% #111 overlay; automation gets a gradient
 * instead of the photo, which axe cannot judge); `dark-solid` is the same site with the lightest pixel the photo can
 * produce under the overlay (#4c4c4c) as a flat colour, so axe can; `light` is `?host=light` (white section, #3a3a3a).
 */
export type Host = 'dark' | 'dark-solid' | 'light';
export const HOSTS: readonly Host[] = ['dark', 'dark-solid', 'light'];

/** Query parameters for a host variant. */
export function hostQuery(host: Host): Record<string, string> {
  return host === 'light' ? { host: 'light' } : {};
}

/** Flat worst-case background for the dark host. Call after every navigation (the style tag does not survive it). */
export async function applyHostBackground(page: Page, host: Host): Promise<void> {
  if (host === 'dark-solid') await page.addStyleTag({ content: 'body.wgm { background-image: none !important; background-color: #4c4c4c !important; }' });
}

/**
 * axe `color-contrast` scan of a subtree. Zero violations of any impact: this is the inherit-first gate (text on the host
 * background must follow the host's colour, so it is readable on dark and light sections alike).
 */
export async function scanContrast(page: Page, label: string, include = '.wg-live'): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).include(include).withRules(['color-contrast']).analyze();
  const summary = results.violations.map((v) => `${label}: ${v.id} - ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}  ${n.failureSummary?.replace(/\s+/g, ' ')}`).join('\n')}`);
  expect(summary, `colour contrast violations in "${label}"`).toEqual([]);
}

/** True when the page (not just .wg-live) scrolls horizontally. */
export async function horizontalOverflow(page: Page): Promise<{ doc: number; wg: number; offenders: string[] }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const root = document.querySelector('.wg-live');
    const offenders: string[] = [];
    /** sr-only style boxes (1px, clipped) and everything inside them are not "layout". */
    const visuallyHidden = (el: Element): boolean => {
      for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        if (cs.position === 'absolute' && parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1) return true;
      }
      return false;
    };
    root?.querySelectorAll('*').forEach((el) => {
      if (visuallyHidden(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
    });
    return {
      doc: document.documentElement.scrollWidth - vw,
      wg: root ? root.scrollWidth - root.clientWidth : 0,
      offenders: offenders.slice(0, 8),
    };
  });
}
