/**
 * Entitlement panel (plan 6.2 table). A separate panel next to the status message, never instead
 * of it. M1 only displays what the server-backed placeholder decided; it never grants access.
 *
 *   guest         請先登入 + 登入 (links.account, only when set; no return path, plan D18)
 *   not_entitled  尚未取得觀看資格 + 購票 (event.productUrl, only when set)
 *   unavailable   暫時無法確認觀看資格 + 重試 (retryEntitlement) + 聯絡我們 (links.contact, when set)
 *   unknown / entitled  nothing
 */
import { h, safeUrl } from '../dom';
import { playerCopy, statusCopy } from '../i18n/copy';
import { selectEntitlementPanel } from '../state/model';
import type { AppState, PlayerController, PublicEvent, SiteLinks } from '../types';

export interface EntitlementPanelOptions {
  controller: PlayerController;
  links: SiteLinks;
  event: PublicEvent;
}

export interface EntitlementPanel {
  el: HTMLElement;
  update(state: AppState): void;
  destroy(): void;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createEntitlementPanel(options: EntitlementPanelOptions): EntitlementPanel {
  const { controller, links, event } = options;

  const message = h('p', { className: 'wg-live__entitlement-message' });
  const note = h('p', { className: 'wg-live__entitlement-note wg-live__small wg-live__muted', text: statusCopy.entitlement.note });

  const accountHref = safeUrl(links.account);
  const buyHref = safeUrl(event.productUrl);
  const contactHref = safeUrl(links.contact);

  const login = accountHref
    ? h('a', { className: 'wg-live__btn wg-live__btn--secondary', href: accountHref, text: statusCopy.entitlement.guest.action, hidden: true })
    : null;
  const buy = buyHref
    ? h('a', { className: 'wg-live__btn wg-live__btn--secondary', href: buyHref, text: statusCopy.entitlement.notEntitled.action, hidden: true })
    : null;
  const retry = h('button', {
    className: 'wg-live__btn wg-live__btn--secondary',
    type: 'button',
    text: statusCopy.entitlement.unavailable.retry,
    hidden: true,
  });
  const contact = contactHref
    ? h('a', { className: 'wg-live__btn wg-live__btn--ghost', href: contactHref, text: statusCopy.entitlement.unavailable.contact, hidden: true })
    : null;

  const actions = h('div', { className: 'wg-live__actions wg-live__actions--stack' }, login, buy, retry, contact);
  const el = h(
    'section',
    { className: 'wg-live__entitlement', hidden: true, attrs: { 'aria-label': playerCopy.entitlementLabel } },
    message,
    actions,
    note,
  );

  const onRetry = (): void => {
    controller.retryEntitlement().catch(() => undefined);
  };
  retry.addEventListener('click', onRetry);

  function update(state: AppState): void {
    const panel = selectEntitlementPanel(state);
    el.hidden = panel === null;
    if (panel === null) return;
    el.dataset.kind = panel.kind;
    setText(message, panel.message);
    if (login) login.hidden = panel.kind !== 'guest';
    if (buy) buy.hidden = panel.kind !== 'not_entitled';
    retry.hidden = panel.kind !== 'unavailable';
    if (contact) contact.hidden = panel.kind !== 'unavailable';
    actions.hidden = Array.from(actions.children).every((child) => (child as HTMLElement).hidden);
  }

  return {
    el,
    update,
    destroy(): void {
      retry.removeEventListener('click', onRetry);
    },
  };
}
