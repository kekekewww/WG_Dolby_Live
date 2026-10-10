/**
 * Dev/demo state panel (spec 5.6, plan D17).
 *
 * Rendered ONLY when the controller exposes DevControls, which the coordinator does only for
 * `boot.devTools === true`. With devTools off this module is never called and nothing dev-related
 * is created or exposed. The panel is a collapsible <details> at the end of the view (in flow,
 * never overlaying the player or a fixed bottom banner) and says plainly that it is dev-only.
 * It changes the display only: nothing here is sent to the server.
 */
import { h, uid } from '../dom';
import { playerCopy } from '../i18n/copy-player';
import { statusCopy } from '../i18n/copy-status';
import type { AppState, DevControls, DevFault, EntitlementResult, EventStatus } from '../types';

const STATUSES: readonly EventStatus[] = ['scheduled', 'doors_open', 'live', 'intermission', 'ended', 'cancelled'];
const ENTITLEMENTS: ReadonlyArray<EntitlementResult['status']> = ['guest', 'not_entitled', 'entitled', 'unavailable'];
const FAULTS: readonly DevFault[] = ['network', 'decode', 'unsupported', 'play_blocked'];

export interface DevPanel {
  el: HTMLDetailsElement;
  update(state: AppState): void;
  destroy(): void;
}

function field(
  legendText: string,
  select: HTMLSelectElement,
): HTMLElement {
  const id = uid('wg-live-dev');
  select.id = id;
  return h(
    'div',
    { className: 'wg-live__dev-field' },
    h('label', { className: 'wg-live__dev-label', attrs: { for: id }, text: legendText }),
    select,
  );
}

function selectOf(options: Array<{ value: string; label: string }>): HTMLSelectElement {
  return h(
    'select',
    { className: 'wg-live__dev-select' },
    ...options.map((o) => h('option', { value: o.value, text: o.label })),
  );
}

export function createDevPanel(dev: DevControls): DevPanel {
  const copy = playerCopy.dev;

  const statusSelect = selectOf([
    { value: '', label: copy.status.useReal },
    ...STATUSES.map((s) => ({ value: s, label: statusCopy.eventStatus[s] })),
  ]);
  const entitlementSelect = selectOf([
    { value: '', label: copy.entitlement.useDefault },
    ...ENTITLEMENTS.map((e) => ({ value: e, label: copy.entitlement[e] })),
  ]);
  const faultSelect = selectOf([
    { value: '', label: copy.fault.none },
    ...FAULTS.map((f) => ({ value: f, label: copy.fault[f] })),
  ]);
  const reset = h('button', {
    className: 'wg-live__btn wg-live__btn--secondary wg-live__dev-reset',
    type: 'button',
    text: copy.reset,
  });
  const simulated = h('p', { className: 'wg-live__dev-simulated wg-live__small', text: copy.simulatedNotice, hidden: true });

  const body = h(
    'div',
    { className: 'wg-live__dev-body' },
    h('p', { className: 'wg-live__dev-intro wg-live__small', text: copy.intro }),
    simulated,
    field(copy.status.legend, statusSelect),
    field(copy.entitlement.legend, entitlementSelect),
    field(copy.fault.legend, faultSelect),
    reset,
  );
  const el = h(
    'details',
    { className: 'wg-live__dev' },
    h('summary', { className: 'wg-live__dev-summary', text: copy.title }),
    body,
  );

  const onStatus = (): void => {
    const value = statusSelect.value;
    dev.setEventStatus(STATUSES.includes(value as EventStatus) ? (value as EventStatus) : null);
  };
  const onEntitlement = (): void => {
    const value = entitlementSelect.value;
    dev.setEntitlement(ENTITLEMENTS.includes(value as EntitlementResult['status']) ? (value as EntitlementResult['status']) : null);
  };
  const onFault = (): void => {
    const value = faultSelect.value;
    dev.injectFault(FAULTS.includes(value as DevFault) ? (value as DevFault) : null);
  };
  const onReset = (): void => {
    statusSelect.value = '';
    entitlementSelect.value = '';
    faultSelect.value = '';
    dev.setEventStatus(null);
    dev.setEntitlement(null);
    dev.injectFault(null);
  };
  statusSelect.addEventListener('change', onStatus);
  entitlementSelect.addEventListener('change', onEntitlement);
  faultSelect.addEventListener('change', onFault);
  reset.addEventListener('click', onReset);

  return {
    el,
    update(state): void {
      simulated.hidden = !state.event.simulated;
    },
    destroy(): void {
      statusSelect.removeEventListener('change', onStatus);
      entitlementSelect.removeEventListener('change', onEntitlement);
      faultSelect.removeEventListener('change', onFault);
      reset.removeEventListener('click', onReset);
    },
  };
}
