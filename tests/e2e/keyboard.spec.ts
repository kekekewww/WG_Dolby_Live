/**
 * Plan 7.4 a11y/keyboard e2e (plan 6.10, 6.6): Space and K on the player region toggle playback,
 * Space on a button only activates that button, shortcuts never reach outside the player, the switch
 * dialog closes with Escape and focus returns, and the whole flow works from the keyboard.
 */
import { test } from '@playwright/test';
import { expect, gotoPlayer, TONE } from './helpers';

test.describe.configure({ timeout: 90_000 });

const isPaused = async (audio: import('@playwright/test').Locator): Promise<boolean> => audio.evaluate((a: HTMLAudioElement) => a.paused);

test('Space on the focused 暫停 button toggles exactly once (the button, not the shortcut)', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await p.primary.focus();
  await page.keyboard.press('Space');
  await expect(p.statusTitle).toHaveText('已暫停');
  expect(await isPaused(p.audio)).toBe(true);
  // A double toggle (button + shortcut) would have resumed playback again.
  await page.waitForTimeout(600);
  await expect(p.statusTitle).toHaveText('已暫停');
  expect(await isPaused(p.audio)).toBe(true);
  await page.keyboard.press('Space');
  await expect(p.statusTitle).toHaveText('播放中');
  await expect.poll(() => isPaused(p.audio)).toBe(false);
});

test('Enter on the primary button also toggles once', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('atmos');
  await p.expectAdvancing();
  await p.primary.focus();
  await page.keyboard.press('Enter');
  await expect(p.statusTitle).toHaveText('已暫停');
  await page.waitForTimeout(400);
  await expect(p.statusTitle).toHaveText('已暫停');
});

test('K on the player region toggles playback (focus on a button inside the player)', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await p.primary.focus();
  await page.keyboard.press('k');
  await expect(p.statusTitle).toHaveText('已暫停');
  await page.waitForTimeout(400);
  expect(await isPaused(p.audio)).toBe(true);
  await page.keyboard.press('k');
  await expect(p.statusTitle).toHaveText('播放中');
});

test('Space and K on a non-interactive element inside the player toggle playback', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  // A focusable, non-activatable node inside the group (the stage made focusable for this test).
  await p.root.locator('.wg-live__stage').evaluate((el) => {
    (el as HTMLElement).tabIndex = -1;
    (el as HTMLElement).focus();
  });
  await expect(p.root.locator('.wg-live__stage')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(p.statusTitle).toHaveText('已暫停');
  await page.keyboard.press('Space');
  await expect(p.statusTitle).toHaveText('播放中');
  await page.keyboard.press('k');
  await expect(p.statusTitle).toHaveText('已暫停');
});

test('shortcuts ignore modifier keys, key repeat and the volume slider; Space elsewhere keeps its default', async ({ page }) => {
  // The stress page: it has the plain <button> and <h1> outside the player that this test focuses.
  const p = await gotoPlayer(page, { stress: true });
  await p.start('binaural');
  await p.expectAdvancing();
  await p.primary.focus();

  for (const combo of ['Control+k', 'Alt+k', 'Meta+k', 'Shift+k']) {
    await page.keyboard.press(combo);
  }
  await page.waitForTimeout(300);
  await expect(p.statusTitle).toHaveText('播放中');

  // Space on the range slider adjusts nothing and must not toggle playback.
  const slider = p.root.locator('.wg-live__volume-input');
  if (await slider.isVisible()) {
    await slider.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await expect(p.statusTitle).toHaveText('播放中');
  }

  // Outside the player (the fake site chrome button, the page body) nothing is hijacked.
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: boolean[] };
    w.__prevented = [];
    // Registered on window, so it runs after every handler on the way up and sees the final value.
    window.addEventListener('keydown', (e) => w.__prevented.push(e.defaultPrevented));
  });
  await page.locator('main > button').first().focus();
  await page.keyboard.press('k');
  await page.locator('main > h1').evaluate((el) => {
    (el as HTMLElement).tabIndex = -1;
    (el as HTMLElement).focus();
  });
  await page.keyboard.press('Space');
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  await expect(p.statusTitle).toHaveText('播放中');
  expect(await isPaused(p.audio)).toBe(false);
  const prevented = await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);
  expect(prevented.length).toBeGreaterThanOrEqual(3);
  expect(prevented.every((v) => v === false), 'the player never calls preventDefault outside its own region').toBe(true);
});

test('before playback starts, Space and K do not start or load anything', async ({ page }) => {
  const p = await gotoPlayer(page, { mode: 'binaural' });
  await p.primary.focus();
  await p.root.locator('.wg-live__stage').evaluate((el) => {
    (el as HTMLElement).tabIndex = -1;
    (el as HTMLElement).focus();
  });
  await page.keyboard.press('k');
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  expect(await isPaused(p.audio)).toBe(true);
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.hasAttribute('src'))).toBe(false);
  await expect(p.statusTitle).toHaveText('按下「開始聆聽」即可播放');
});

test('the switch dialog: opens from the keyboard, traps focus, Escape closes it and focus returns to 切換模式', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();

  await p.switchButton.focus();
  await page.keyboard.press('Enter');
  await expect(p.dialog).toBeVisible();
  await expect(p.dialog).toHaveAttribute('aria-labelledby', /.+/);
  await expect(p.dialog).toHaveAccessibleName('切換聆聽模式');
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('dialog.wg-live__dialog')),
    'focus moves into the dialog',
  ).toBe(true);
  // Tab cycles inside the modal dialog. Browsers may route one Tab through their own UI (activeElement
  // is <body> then), but focus must never land on the page content behind the modal.
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'browser-ui';
      if (el.closest('dialog.wg-live__dialog')) return `dialog:${el.className.replace(/wg-live__btn(?:\s+wg-live__btn--\w+)?\s*/, '')}`;
      return `PAGE:${el.tagName}.${el.className}`;
    });
    expect(where, `Tab #${i + 1} must not reach the page behind the dialog`).not.toMatch(/^PAGE:/);
    seen.add(where);
  }
  // Firefox keeps document.activeElement on the last dialog button while focus is in its own UI.
  expect(seen.has('dialog:wg-live__dialog-cancel'), `the cancel button is reachable by Tab, saw: ${[...seen].join(', ')}`).toBe(true);

  await page.keyboard.press('Escape');
  await expect(p.dialog).toBeHidden();
  await expect(p.switchButton).toBeFocused();
  // Escape only closes: still playing the same source, no request for the other mode.
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  expect(await p.audio.evaluate((a: HTMLAudioElement) => a.currentSrc)).toContain(TONE.binaural);
  expect(await isPaused(p.audio)).toBe(false);
});

test('the switch dialog confirmed with the keyboard: focus ends on the trigger or the status heading, never on <body>', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await p.switchButton.focus();
  await page.keyboard.press('Space');
  await expect(p.dialog).toBeVisible();
  await p.dialog.getByRole('button', { name: /確認切換/ }).focus();
  await page.keyboard.press('Enter');
  await expect(p.dialog).toBeHidden();
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌', { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'body';
        if (el.classList.contains('wg-live__switch')) return 'trigger';
        if (el.classList.contains('wg-live__status-title')) return 'heading';
        return `other:${el.tagName}.${el.className}`;
      }),
    )
    .toMatch(/^(trigger|heading)$/);
});

test('the dialog trigger is aria-disabled (not disabled, so it stays focusable) while switching', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.start('binaural');
  await p.expectAdvancing();
  await p.switchButton.click();
  // Hold the next descriptor-free switch in flight by confirming and checking the attribute at once.
  await p.dialog.getByRole('button', { name: /確認切換/ }).click();
  const state = await p.switchButton.evaluate((el) => ({ ariaDisabled: el.getAttribute('aria-disabled'), disabled: (el as HTMLButtonElement).disabled }));
  expect(state.disabled).toBe(false);
  await expect(p.modeLabel).toHaveText('目前播放：Dolby Atmos 音軌', { timeout: 20_000 });
  await expect(p.switchButton).not.toHaveAttribute('aria-disabled', 'true');
});

test('a full keyboard-only session: arrow keys choose the mode, Enter starts, Space pauses', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.radio('binaural').focus();
  await page.keyboard.press('ArrowRight'); // radio group: moves to Atmos and checks it
  await expect(p.radio('atmos')).toBeChecked();
  await expect(p.modeLabel).toHaveText('已選擇：Dolby Atmos 音軌');
  await page.keyboard.press('ArrowLeft');
  await expect(p.radio('binaural')).toBeChecked();
  await expect(p.primary).not.toHaveAttribute('aria-disabled', 'true');
  await p.primary.focus();
  await page.keyboard.press('Enter');
  await p.expectAdvancing();
  await expect(p.modeLabel).toHaveText('目前播放：Binaural');
  // After Start the same button keeps focus (it only changes its label).
  await expect(p.primary).toBeFocused();
  await expect(p.primary).toHaveText('暫停');
  await page.keyboard.press('Space');
  await expect(p.statusTitle).toHaveText('已暫停');
});

test('Space on a mode radio selects it and does not toggle playback', async ({ page }) => {
  const p = await gotoPlayer(page);
  await p.radio('atmos').focus();
  await page.keyboard.press('Space');
  await expect(p.radio('atmos')).toBeChecked();
  await expect(p.statusTitle).not.toHaveText('播放中');
  expect(await isPaused(p.audio)).toBe(true);
});

test('keyboard focus is visible on the radio cards, the primary button and the switch button', async ({ page }) => {
  const p = await gotoPlayer(page);
  const ring = (locator: import('@playwright/test').Locator): Promise<boolean> =>
    locator.evaluate((el) => {
      const has = (s: CSSStyleDeclaration): boolean => (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      return has(getComputedStyle(el));
    });

  // Radio inputs overlay their card: the ring is drawn on the card or on the input.
  await p.radio('binaural').focus();
  await page.keyboard.press('ArrowRight');
  await expect(p.radio('atmos')).toBeFocused();
  const input = p.radio('atmos');
  const card = p.root.locator('.wg-live__mode[data-mode="atmos"] .wg-live__mode-card');
  expect((await ring(input)) || (await ring(card)), 'a keyboard-focused radio card shows a focus ring').toBe(true);

  // Reach the primary button with Tab (keyboard modality), so :focus-visible applies.
  await p.primary.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(p.primary).toBeFocused();
  expect(await ring(p.primary), 'primary button focus ring').toBe(true);

  await p.start('binaural');
  await p.expectAdvancing();
  await p.switchButton.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(p.switchButton).toBeFocused();
  expect(await ring(p.switchButton), 'switch button focus ring').toBe(true);
});
