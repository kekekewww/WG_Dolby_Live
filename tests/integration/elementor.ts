/**
 * Elementor editor helpers for the integration specs.
 *
 * In the editor, the page is shown in an iframe (#elementor-preview-iframe). The widget DOM is built by the
 * editor in the parent window and then lives in that frame (another JavaScript realm), and the editor calls
 * elementorFrontend.init() late. Both facts once broke the mount (see tests/unit/core/main.test.ts).
 */
import type { Frame, Page } from '@playwright/test';
import { expect } from './wp';

export interface EditorPreview {
  /** The preview iframe's frame (evaluate() runs in the page being edited). */
  frame: Frame;
}

/** Open the Elementor editor for a page and wait until its preview frame has loaded. */
export async function openEditor(page: Page, pageId: number): Promise<EditorPreview> {
  await page.goto(`/wp-admin/post.php?post=${pageId}&action=elementor`, { waitUntil: 'domcontentloaded' });
  const iframe = page.locator('#elementor-preview-iframe');
  await iframe.waitFor({ state: 'attached', timeout: 180_000 });
  await expect
    .poll(
      async () => {
        const handle = await iframe.elementHandle();
        const frame = handle ? await handle.contentFrame() : null;
        return frame !== null && /elementor-preview=/.test(frame.url());
      },
      { timeout: 180_000, intervals: [1000] },
    )
    .toBe(true);
  const frame = (await (await iframe.elementHandle())!.contentFrame())!;
  // The Shortcode widget is rendered by the editor after the frame loads.
  await frame.waitForSelector('.elementor-widget-shortcode', { timeout: 180_000 });
  return { frame };
}

export interface PreviewState {
  roots: number;
  mounted: number;
  audio: number;
  video: number;
  devPanels: number;
  scripts: number;
  styles: number;
}

/** What the preview frame shows right now. */
export async function previewState(frame: Frame): Promise<PreviewState> {
  return frame.evaluate(() => ({
    roots: document.querySelectorAll('.wg-live').length,
    mounted: document.querySelectorAll('.wg-live[data-wg-live-mounted="1"]').length,
    audio: document.querySelectorAll('audio').length,
    video: document.querySelectorAll('video').length,
    devPanels: document.querySelectorAll('details.wg-live__dev').length,
    scripts: document.querySelectorAll('script[src*="/wg-live/assets/dist/wg-live.js"]').length,
    styles: document.querySelectorAll('link[rel="stylesheet"][href*="/wg-live/assets/dist/wg-live.css"]').length,
  }));
}
