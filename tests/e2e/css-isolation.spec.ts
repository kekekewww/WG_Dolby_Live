/**
 * Plan 3.3 / CLAUDE.md "CSS and Elementor": the plugin's CSS is scoped. The harness page wears
 * deliberately hostile global theme rules (dev/stress.css, served by the stress pages dev/stress.html: red
 * uppercase Impact buttons, wavy magenta links, justified text, content-box, dashed image borders ...). The
 * realistic pages (dev/index.html ... with the site-mock chrome) are NOT used here. Computed styles prove that
 *   - none of it changes what the plugin renders, and
 *   - the plugin changes nothing outside `.wg-live`.
 */
import { test } from '@playwright/test';
import { inspectPlugin, scanScopedRules } from './css-probe';
import { expect, gotoPlayer, gotoView, SLUG_LIVE } from './helpers';

test.describe.configure({ timeout: 90_000 });

for (const view of ['index', 'help'] as const) {
  test(`the ${view} view is untouched by hostile global theme rules`, async ({ page }) => {
    await gotoView(page, view, { stress: true });
    expect(await inspectPlugin(page)).toEqual([]);
  });
}

test('the player view (with the dev panel and the media element) is untouched by hostile global theme rules', async ({ page }) => {
  const p = await gotoPlayer(page, { stress: true });
  await p.openDevPanel();
  expect(await inspectPlugin(page)).toEqual([]);
});

test('the player while playing and with the switch dialog open is untouched', async ({ page }) => {
  const p = await gotoPlayer(page, { stress: true });
  await p.start('binaural');
  await p.expectAdvancing();
  await p.switchButton.click();
  await expect(p.dialog).toBeVisible();
  expect(await inspectPlugin(page)).toEqual([]);
  // The <dialog> itself: yellow background, 8px double border from the theme.
  const dialog = await p.dialog.evaluate((el) => {
    const cs = getComputedStyle(el);
    const panel = getComputedStyle(el.querySelector('.wg-live__dialog-panel') as Element);
    return { bg: cs.backgroundColor, border: cs.borderTopWidth, style: cs.borderTopStyle, panelBg: panel.backgroundColor, boxSizing: cs.boxSizing };
  });
  expect(dialog.bg).not.toBe('rgb(255, 235, 59)');
  expect(dialog.style).not.toBe('double');
  expect(dialog.panelBg).not.toBe('rgb(255, 235, 59)');
  expect(dialog.boxSizing).toBe('border-box');
});

test('a hovered plugin button does not pick up the theme hover colour', async ({ page }) => {
  const p = await gotoPlayer(page, { stress: true });
  await p.radio('binaural').check();
  await p.primary.hover();
  const bg = await p.primary.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(139, 0, 0)');
  expect(bg).not.toBe('rgb(224, 0, 0)');
});

test('the plugin changes nothing outside .wg-live: the site chrome keeps its own (hostile) look', async ({ page }) => {
  await gotoPlayer(page, { stress: true });
  const site = await page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel) as Element);
    const h1 = cs('main > h1');
    const button = cs('main > button');
    const para = cs('main > p:not(.site-note)');
    const link = cs('main > a');
    const img = document.createElement('img');
    return {
      h1: { transform: h1.textTransform, spacing: h1.letterSpacing, color: h1.color, font: h1.fontFamily, weight: h1.fontWeight },
      button: { bg: button.backgroundColor, font: button.fontFamily, size: button.fontSize, transform: button.textTransform, cursor: button.cursor, border: button.borderTopWidth },
      para: { align: para.textAlign },
      link: { color: link.color, decoration: link.textDecorationStyle },
      body: { font: cs('body').fontFamily, bg: cs('body').backgroundColor },
      boxSizing: cs('main').boxSizing,
      img: img.tagName,
    };
  });
  expect(site.h1).toMatchObject({ transform: 'uppercase', color: 'rgb(140, 158, 255)', weight: '900' });
  expect(site.h1.font).toMatch(/Courier/);
  expect(site.button).toMatchObject({ bg: 'rgb(224, 0, 0)', size: '22px', transform: 'uppercase', cursor: 'crosshair', border: '4px' });
  expect(site.button.font).toMatch(/Impact/);
  expect(site.para.align).toBe('justify');
  expect(site.link).toMatchObject({ color: 'rgb(194, 24, 91)', decoration: 'wavy' });
  expect(site.body.font).toMatch(/Georgia/);
  expect(site.boxSizing).toBe('content-box');
});

test('every CSS rule the plugin ships is scoped to .wg-live (live check of the loaded stylesheets)', async ({ page }) => {
  await gotoView(page, 'listen', { event: SLUG_LIVE });
  const report = await scanScopedRules(page, 'dev');
  // The dev server injects the plugin CSS as <style data-vite-dev-id="…/src/styles/…">; Firefox and
  // WebKit expose them the same way. Skip (rather than pass vacuously) if a browser hides them.
  test.skip(report.sheets === 0, 'plugin stylesheets are not exposed as <style data-vite-dev-id> in this browser');
  expect(report.ruleCount).toBeGreaterThan(50);
  expect(report.unscoped, 'selectors outside .wg-live').toEqual([]);
  expect(report.badNames).toEqual([]);
});
