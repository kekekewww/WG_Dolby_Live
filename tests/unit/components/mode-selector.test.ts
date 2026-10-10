import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModeSelector } from '../../../src/components/mode-selector';
import { playerCopy } from '../../../src/i18n/copy';
import type { ListeningMode } from '../../../src/types';
import { attach } from './helpers';

/** Accessible name per the aria-labelledby algorithm (enough for these tests). */
function accessibleName(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}
function accessibleDescription(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

afterEach(() => {
  document.body.replaceChildren();
});

function make(helpHref: string | null = 'https://example.test/live/help/') {
  const onSelect = vi.fn<(mode: ListeningMode) => void>();
  const selector = createModeSelector({ onSelect, helpHref });
  attach(selector.el);
  selector.update({ selected: null, available: ['binaural', 'atmos'] });
  return { selector, onSelect };
}

describe('mode selector semantics', () => {
  it('is a fieldset with a legend and two radios sharing one name', () => {
    const { selector } = make();
    expect(selector.el.tagName).toBe('FIELDSET');
    expect(selector.el.querySelector('legend')?.textContent).toBe(playerCopy.modeSelector.legend);
    const radios = Array.from(selector.el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.map((r) => r.value)).toEqual(['binaural', 'atmos']);
  });

  it('pins the spec 5.2 strings verbatim', () => {
    const { selector } = make();
    const text = selector.el.textContent ?? '';
    for (const s of [
      '耳機聆聽 · Binaural',
      '使用耳機聆聽錄音室製作的雙耳版本。',
      '一般耳機即可播放此版本；音訊效果依錄音室交付內容為準。',
      '選擇耳機模式',
      '家庭劇院 · Dolby Atmos',
      '適用於經確認的播放裝置、連接方式與 Atmos 家庭劇院。',
      '請先閱讀支援條件；選用 Atmos 音軌不等於系統已確認最終設備輸出。',
      '選擇家庭劇院模式',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('names each radio with its title AND its action text, and describes it with the explanations', () => {
    const { selector } = make();
    const binaural = selector.inputs.binaural;
    const atmos = selector.inputs.atmos;
    expect(accessibleName(binaural)).toContain('耳機聆聽 · Binaural');
    expect(accessibleName(binaural)).toContain('選擇耳機模式');
    expect(accessibleName(atmos)).toContain('家庭劇院 · Dolby Atmos');
    expect(accessibleName(atmos)).toContain('選擇家庭劇院模式');
    expect(accessibleDescription(binaural)).toContain('使用耳機聆聽錄音室製作的雙耳版本。');
    expect(accessibleDescription(atmos)).toContain('選用 Atmos 音軌不等於系統已確認最終設備輸出');
  });

  it('wires each radio to a label so clicking the card selects it', () => {
    const { selector } = make();
    for (const input of Object.values(selector.inputs)) {
      expect(selector.el.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
  });

  it('shows the selection as a text marker, not only a colour', () => {
    const { selector } = make();
    selector.update({ selected: 'atmos', available: ['binaural', 'atmos'] });
    expect(selector.inputs.atmos.checked).toBe(true);
    expect(selector.inputs.binaural.checked).toBe(false);
    const markers = Array.from(selector.el.querySelectorAll<HTMLElement>('.wg-live__mode-marker'));
    const visible = markers.filter((m) => !m.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.textContent).toBe(playerCopy.modeSelector.selectedMarker);
    expect(visible[0]?.closest('.wg-live__mode')?.getAttribute('data-mode')).toBe('atmos');
  });

  it('calls onSelect from a user change, with the chosen mode', () => {
    const { selector, onSelect } = make();
    selector.inputs.atmos.checked = true;
    selector.inputs.atmos.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('atmos');
  });

  it('does not call onSelect for programmatic update() calls', () => {
    const { selector, onSelect } = make();
    selector.update({ selected: 'binaural', available: ['binaural', 'atmos'] });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables a mode the event does not offer and says「即將開放」', () => {
    const { selector } = make();
    selector.update({ selected: 'binaural', available: ['binaural'] });
    expect(selector.inputs.atmos.disabled).toBe(true);
    expect(selector.inputs.binaural.disabled).toBe(false);
    expect(accessibleDescription(selector.inputs.atmos)).toContain('即將開放');
    expect(accessibleDescription(selector.inputs.binaural)).not.toContain('即將開放');
    const unavailable = selector.el.querySelector('[data-mode="atmos"] .wg-live__mode-unavailable') as HTMLElement;
    expect(unavailable.hidden).toBe(false);
  });

  it('never shows a mode as selected when the event does not offer it', () => {
    const { selector } = make();
    selector.update({ selected: 'atmos', available: ['binaural'] });
    expect(selector.inputs.atmos.checked).toBe(false);
  });

  it('locks the whole group when disabled', () => {
    const { selector } = make();
    selector.update({ selected: null, available: ['binaural', 'atmos'], disabled: true });
    expect(selector.inputs.binaural.disabled).toBe(true);
    expect(selector.inputs.atmos.disabled).toBe(true);
  });

  it('keeps node identity across updates', () => {
    const { selector } = make();
    const before = Array.from(selector.el.querySelectorAll('*'));
    selector.update({ selected: 'binaural', available: ['binaural', 'atmos'] });
    selector.update({ selected: 'atmos', available: ['binaural'] });
    expect(Array.from(selector.el.querySelectorAll('*'))).toEqual(before);
  });

  it('links to the help page for the support conditions, and omits the link without one', () => {
    const withLink = make();
    expect(withLink.selector.el.querySelector('a')?.getAttribute('href')).toBe('https://example.test/live/help/');
    document.body.replaceChildren();
    const without = make(null);
    expect(without.selector.el.querySelector('a')).toBeNull();
  });

  it('stops listening after destroy()', () => {
    const { selector, onSelect } = make();
    selector.destroy();
    selector.inputs.binaural.checked = true;
    selector.inputs.binaural.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
