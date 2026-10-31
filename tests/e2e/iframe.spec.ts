/**
 * M2-PLAN D4: a real event whose source is the provider's own player page (iframe), end to end on the dev harness
 * (?harness=hls adds the event iframe-fixture-live). The provider page is dev/fake-player/index.html, served on a
 * second https origin (https://player.fake.test) through Playwright routing, with its own <video controls>.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page } from '@playwright/test';
import { expect, gotoPlayer, type Player } from './helpers';

const SLUG = 'iframe-fixture-live';
const ORIGIN = 'https://player.fake.test';
const ROOT = resolve(import.meta.dirname, '..', '..');
const FAKE_PAGE = readFileSync(resolve(ROOT, 'dev', 'fake-player', 'index.html'), 'utf8');

/** Serve the fake provider origin: its player page and its demo media. */
async function fakeProvider(page: Page): Promise<string[]> {
  const loaded: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/embed')) {
      loaded.push(url.href);
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FAKE_PAGE });
      return;
    }
    const m = /^\/media\/(binaural|atmos)\.mp4$/.exec(url.pathname);
    if (m) {
      await route.fulfill({ status: 200, contentType: 'video/mp4', path: resolve(ROOT, 'plugin', 'wg-live', 'assets', 'demo', m[1] === 'atmos' ? 'demo-video-2.mp4' : 'demo-video-1.mp4') });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });
  return loaded;
}

async function open(page: Page): Promise<Player> {
  return gotoPlayer(page, { event: SLUG, harness: 'hls' });
}

test('a buyer sees the provider player from its own origin; our own controls are not shown', async ({ page }) => {
  const loaded = await fakeProvider(page);
  const p = await open(page);
  await p.start('binaural');
  const frame = p.root.locator('iframe.wg-live__provider-frame');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('src', `${ORIGIN}/embed?track=binaural`);
  await expect(frame).toHaveAttribute('title', /・串流服務播放器$/);
  await expect(page.frameLocator('iframe.wg-live__provider-frame').locator('#fake-track')).toHaveText('Fake provider player: binaural');
  await expect(p.view).toHaveAttribute('data-status', 'playing');
  await expect(p.modeLabel).toHaveText('已選擇：Binaural（由串流服務播放器播放）');
  await expect(p.root).not.toContainText('目前播放');
  await expect(p.primary).toBeHidden();
  await expect(p.root.locator('.wg-live__transport')).toBeHidden();
  await expect(p.root.locator('.wg-live__provider-note')).toHaveText('播放控制在下方的串流服務播放器中');
  await expect(p.media).toBeHidden();
  expect(loaded).toEqual([`${ORIGIN}/embed?track=binaural`]);
});

test('a mode switch replaces the frame: exactly one provider frame, now the Atmos page', async ({ page }) => {
  await fakeProvider(page);
  const p = await open(page);
  await p.start('binaural');
  await expect(p.view).toHaveAttribute('data-status', 'playing');
  await p.switchButton.click();
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  const frame = p.root.locator('iframe.wg-live__provider-frame');
  await expect(frame).toHaveAttribute('src', `${ORIGIN}/embed?track=atmos`);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(p.modeLabel).toHaveText('已選擇：Dolby Atmos 音軌（由串流服務播放器播放）');
});

test('a /playback answer whose allowedOrigin is not the URL origin fails closed: no frame at all', async ({ page }) => {
  const loaded = await fakeProvider(page);
  await page.route(/wg-live\/v1\/playback/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ kind: 'iframe', url: `${ORIGIN}/embed?track=binaural`, allowedOrigin: 'https://evil.example.test' }),
    });
  });
  const p = await open(page);
  await p.radio('binaural').check();
  await expect(p.view).toHaveAttribute('data-status', /^(failed|selecting)$/);
  if ((await p.view.getAttribute('data-status')) === 'selecting' && (await p.primary.isVisible())) {
    await expect(p.primary).toHaveAttribute('aria-disabled', 'true');
  }
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(loaded).toEqual([]);
});

test('leaving the page removes the frame', async ({ page }) => {
  await fakeProvider(page);
  const p = await open(page);
  await p.start('binaural');
  await expect(p.root.locator('iframe.wg-live__provider-frame')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('.wg-live')?.remove());
  await page.evaluate(() => (window as unknown as { WGLive?: { mountAll?: () => void } }).WGLive?.mountAll?.());
  await expect(page.locator('iframe')).toHaveCount(0);
});
