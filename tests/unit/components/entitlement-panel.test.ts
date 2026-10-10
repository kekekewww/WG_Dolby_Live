import { afterEach, describe, expect, it } from 'vitest';
import { createEntitlementPanel } from '../../../src/components/entitlement-panel';
import type { AppState, PublicEvent, SiteLinks } from '../../../src/types';
import { LINKS, attach, createFakeController, makeEvent, makeState, readyState } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

function build(state: AppState, links: SiteLinks = LINKS, event: PublicEvent = makeEvent({ productUrl: 'https://example.test/product/ticket/' })) {
  const controller = createFakeController(state);
  const panel = createEntitlementPanel({ controller, links, event });
  attach(panel.el);
  panel.update(state);
  return { controller, panel };
}

const visibleActions = (el: HTMLElement): HTMLElement[] =>
  Array.from(el.querySelectorAll<HTMLElement>('a, button')).filter((x) => !x.hidden);

describe('entitlement panel (plan 6.2 table)', () => {
  it('renders nothing for unknown and entitled', () => {
    expect(build(makeState({ entitlement: 'unknown' })).panel.el.hidden).toBe(true);
    expect(build(readyState()).panel.el.hidden).toBe(true);
  });

  it('guest: 請先登入 with the account link', () => {
    const { panel } = build(makeState({ entitlement: 'guest' }));
    expect(panel.el.hidden).toBe(false);
    expect(panel.el.querySelector('.wg-live__entitlement-message')?.textContent).toBe('請先登入');
    const actions = visibleActions(panel.el);
    expect(actions.map((a) => a.textContent)).toEqual(['登入']);
    expect(actions[0]?.getAttribute('href')).toBe(LINKS.account);
    // No return path in M1 (plan D18).
    expect(actions[0]?.getAttribute('href')).not.toContain('redirect');
  });

  it('guest: no login link when the account page is not configured', () => {
    const { panel } = build(makeState({ entitlement: 'guest' }), { ...LINKS, account: null });
    expect(panel.el.hidden).toBe(false);
    expect(visibleActions(panel.el)).toHaveLength(0);
  });

  it('not entitled: 尚未取得觀看資格 with 購票 pointing at the product URL', () => {
    const { panel } = build(makeState({ entitlement: 'not_entitled' }));
    expect(panel.el.querySelector('.wg-live__entitlement-message')?.textContent).toBe('尚未取得觀看資格');
    const actions = visibleActions(panel.el);
    expect(actions.map((a) => a.textContent)).toEqual(['購票']);
    expect(actions[0]?.getAttribute('href')).toBe('https://example.test/product/ticket/');
  });

  it('not entitled: no buy link without a product URL', () => {
    const { panel } = build(makeState({ entitlement: 'not_entitled' }), LINKS, makeEvent({ productUrl: null }));
    expect(visibleActions(panel.el)).toHaveLength(0);
  });

  it('unavailable: 暫時無法確認觀看資格 with 重試 and a contact link', () => {
    const { controller, panel } = build(makeState({ entitlement: 'unavailable' }));
    expect(panel.el.querySelector('.wg-live__entitlement-message')?.textContent).toBe('暫時無法確認觀看資格');
    const actions = visibleActions(panel.el);
    expect(actions.map((a) => a.textContent)).toEqual(['重試', '聯絡我們']);
    actions[0]?.click();
    expect(controller.calls.retryEntitlement).toHaveBeenCalledTimes(1);
    expect(actions[1]?.getAttribute('href')).toBe(LINKS.contact);
  });

  it('is never shown for a blocking gate (ended, cancelled, unconfigured)', () => {
    expect(build(makeState({ entitlement: 'guest', event: { status: 'ended' } })).panel.el.hidden).toBe(true);
    expect(build(makeState({ entitlement: 'guest', event: { status: 'cancelled' } })).panel.el.hidden).toBe(true);
    expect(build(makeState({ entitlement: 'guest', source: 'not_configured' })).panel.el.hidden).toBe(true);
  });

  it('is a labelled region and says the display is not a grant of access', () => {
    const { panel } = build(makeState({ entitlement: 'guest' }));
    expect(panel.el.getAttribute('aria-label')).toBe('觀看資格');
    expect(panel.el.textContent).toContain('觀看資格由伺服器端確認');
  });

  it('refuses unsafe link targets', () => {
    const { panel } = build(makeState({ entitlement: 'guest' }), { ...LINKS, account: 'javascript:alert(1)' });
    const hrefs = Array.from(panel.el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => href?.startsWith('javascript:'))).toBe(false);
    expect(Array.from(panel.el.querySelectorAll('a')).map((a) => a.textContent)).not.toContain('登入');
  });

  it('swaps content in place when the state changes', () => {
    const { controller, panel } = build(makeState({ entitlement: 'guest' }));
    const message = panel.el.querySelector('.wg-live__entitlement-message');
    controller.set(makeState({ entitlement: 'unavailable' }));
    panel.update(controller.getState());
    expect(panel.el.querySelector('.wg-live__entitlement-message')).toBe(message);
    expect(message?.textContent).toBe('暫時無法確認觀看資格');
    controller.set(readyState());
    panel.update(controller.getState());
    expect(panel.el.hidden).toBe(true);
  });
});
