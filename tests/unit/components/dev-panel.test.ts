import { afterEach, describe, expect, it } from 'vitest';
import { createDevPanel } from '../../../src/components/dev-panel';
import { attach, fakeDev, makeState } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

function build() {
  const dev = fakeDev();
  const panel = createDevPanel(dev);
  attach(panel.el);
  panel.update(makeState());
  const selects = Array.from(panel.el.querySelectorAll<HTMLSelectElement>('select'));
  return { dev, panel, selects };
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('dev panel', () => {
  it('is a collapsible block clearly labelled as dev-only', () => {
    const { panel } = build();
    expect(panel.el.tagName).toBe('DETAILS');
    expect(panel.el.open).toBe(false);
    expect(panel.el.querySelector('summary')?.textContent).toBe('開發用示範面板（正式站不顯示）');
  });

  it('says the options only change the display, never the server', () => {
    const { panel } = build();
    expect(panel.el.textContent).toContain('不會改變伺服器');
  });

  it('labels every control', () => {
    const { panel, selects } = build();
    expect(selects).toHaveLength(3);
    for (const select of selects) {
      expect(panel.el.querySelector(`label[for="${select.id}"]`)?.textContent).toBeTruthy();
    }
  });

  it('offers all six event statuses plus the real status', () => {
    const { selects } = build();
    const values = Array.from(selects[0]?.options ?? []).map((o) => o.value);
    expect(values).toEqual(['', 'scheduled', 'doors_open', 'live', 'intermission', 'ended', 'cancelled']);
  });

  it('drives the event status override, and null returns to the real status', () => {
    const { dev, selects } = build();
    choose(selects[0] as HTMLSelectElement, 'ended');
    expect(dev.setEventStatus).toHaveBeenLastCalledWith('ended');
    choose(selects[0] as HTMLSelectElement, '');
    expect(dev.setEventStatus).toHaveBeenLastCalledWith(null);
  });

  it('drives the simulated entitlement', () => {
    const { dev, selects } = build();
    const values = Array.from(selects[1]?.options ?? []).map((o) => o.value);
    expect(values).toEqual(['', 'guest', 'not_entitled', 'entitled', 'unavailable']);
    choose(selects[1] as HTMLSelectElement, 'guest');
    expect(dev.setEntitlement).toHaveBeenLastCalledWith('guest');
    choose(selects[1] as HTMLSelectElement, '');
    expect(dev.setEntitlement).toHaveBeenLastCalledWith(null);
  });

  it('injects the four faults', () => {
    const { dev, selects } = build();
    const values = Array.from(selects[2]?.options ?? []).map((o) => o.value);
    expect(values).toEqual(['', 'network', 'decode', 'unsupported', 'play_blocked']);
    for (const fault of ['network', 'decode', 'unsupported', 'play_blocked'] as const) {
      choose(selects[2] as HTMLSelectElement, fault);
      expect(dev.injectFault).toHaveBeenLastCalledWith(fault);
    }
    choose(selects[2] as HTMLSelectElement, '');
    expect(dev.injectFault).toHaveBeenLastCalledWith(null);
  });

  it('ignores an unknown option value instead of passing it on', () => {
    const { dev, selects } = build();
    const select = selects[0] as HTMLSelectElement;
    select.append(new Option('x', 'bogus'));
    choose(select, 'bogus');
    expect(dev.setEventStatus).toHaveBeenLastCalledWith(null);
  });

  it('resets every override', () => {
    const { dev, panel, selects } = build();
    choose(selects[0] as HTMLSelectElement, 'ended');
    choose(selects[1] as HTMLSelectElement, 'guest');
    choose(selects[2] as HTMLSelectElement, 'network');
    panel.el.querySelector<HTMLButtonElement>('.wg-live__dev-reset')?.click();
    expect(dev.setEventStatus).toHaveBeenLastCalledWith(null);
    expect(dev.setEntitlement).toHaveBeenLastCalledWith(null);
    expect(dev.injectFault).toHaveBeenLastCalledWith(null);
    expect(selects.map((s) => s.value)).toEqual(['', '', '']);
  });

  it('shows a notice while the status is simulated', () => {
    const { panel } = build();
    const notice = panel.el.querySelector<HTMLElement>('.wg-live__dev-simulated');
    expect(notice?.hidden).toBe(true);
    panel.update(makeState({ event: { simulated: true, status: 'ended' } }));
    expect(notice?.hidden).toBe(false);
  });

  it('stops reacting after destroy()', () => {
    const { dev, panel, selects } = build();
    panel.destroy();
    choose(selects[0] as HTMLSelectElement, 'ended');
    expect(dev.setEventStatus).not.toHaveBeenCalled();
  });
});
