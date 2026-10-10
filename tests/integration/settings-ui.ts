/**
 * The plugin's settings screens, driven like an administrator would (real form posts to options.php).
 */
import type { Page } from '@playwright/test';
import { expect } from './wp';

export const SETTINGS_URL = '/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-settings';
export const DEPLOY_URL = '/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-deploy';
export const PAGES_URL = '/wp-admin/edit.php?post_type=wg_live_event&page=wg-live-pages';

const field = (key: string): string => `[name="wg_live_settings[${key}]"]`;

export type DeploymentMode = 'disabled' | 'demo';

/** Open the settings screen and wait for the form. */
export async function openSettings(page: Page): Promise<void> {
  await page.goto(SETTINGS_URL);
  await expect(page.getByRole('heading', { name: 'WG Live 設定' })).toBeVisible();
}

/** Submit the open settings form and wait for WordPress to redirect back with settings-updated. */
export async function submitSettings(page: Page): Promise<void> {
  await Promise.all([page.waitForURL(/settings-updated=true/, { timeout: 120_000 }), page.getByRole('button', { name: '儲存設定' }).click()]);
}

/** Choose the deployment mode through the radio buttons and save. */
export async function saveDeploymentMode(page: Page, mode: DeploymentMode): Promise<void> {
  await openSettings(page);
  await page.locator(`${field('deployment_mode')}[value="${mode}"]`).check();
  await submitSettings(page);
  await expect(page.locator(`${field('deployment_mode')}[value="${mode}"]`)).toBeChecked();
}

/** Set one of the link overrides (a URL, or '' for automatic) and save. Returns the notices shown after the save. */
export async function saveLink(page: Page, key: 'account_url' | 'store_url' | 'contact_url', value: string): Promise<string> {
  await openSettings(page);
  // The inputs are type=url: a hand-made request can send anything, so write it as text.
  await page.locator(field(key)).evaluate((el: HTMLInputElement, v: string) => {
    el.type = 'text';
    el.value = v;
  }, value);
  await submitSettings(page);
  return (await page.locator('#wpbody-content .notice').allTextContents()).join(' | ');
}
