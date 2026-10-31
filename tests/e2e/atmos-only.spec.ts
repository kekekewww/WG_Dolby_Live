/**
 * Decision 2026-11-01 (DECISION-2026-11-01-atmos-only.md): one Dolby Atmos stream per concert, no 聆聽方式 choice; a
 * ticket holder whose browser cannot play it gets a personal stream link for VLC or Safari. Dev harness event
 * atmos-only-live (?harness=hls, entitled, audio layout).
 */
import { test } from '@playwright/test';
import { expect, gotoPlayer } from './helpers';

test('no listening-mode choice; the event thumbnail stage; the VLC link only after a click', async ({ page }) => {
  const p = await gotoPlayer(page, { event: 'atmos-only-live', harness: 'hls' });
  await expect(p.root.getByRole('radio')).toHaveCount(0);
  await expect(p.root.locator('.wg-live__stage--audio')).toHaveCount(1);
  await expect(p.root.locator('video')).toHaveCount(0);

  const ec3 = await page.evaluate(() => {
    const ms = (window as unknown as { MediaSource?: { isTypeSupported(t: string): boolean } }).MediaSource;
    return ms ? ms.isTypeSupported('audio/mp4; codecs="ec-3"') : false;
  });
  const panel = p.root.locator('.wg-live__external');
  test.skip(ec3, 'this browser decodes E-AC-3: the link panel shows only after a playback error');

  await expect(panel).toBeVisible();
  await expect(panel).toContainText('VLC');
  await expect(panel.locator('input')).toHaveCount(0);
  const playback = page.waitForRequest(/wg-live\/v1\/playback/);
  await panel.getByRole('button', { name: '取得我的播放連結' }).click();
  await playback;
  await expect(panel.locator('input')).toHaveValue(/\/hls\/atmos\/index\.m3u8$/);
  await expect(panel.getByRole('button', { name: '複製連結' })).toBeVisible();
});
