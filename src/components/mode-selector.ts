/**
 * Mode selector (spec 5.2, plan 6.3): a fieldset/legend radio group with the two equal options,
 * side by side on wide screens and stacked on narrow ones (layout is CSS only).
 *
 * Each radio is named by its title plus the action text (「選擇耳機模式」/「選擇家庭劇院模式」) and
 * described by the description and helper text. The chosen option shows a visible text marker, so
 * selection never relies on colour alone. The DOM is built once; update() only toggles state.
 */
import { h, uid } from '../dom';
import { playerCopy } from '../i18n/copy-player';
import type { ListeningMode } from '../types';

const MODES: readonly ListeningMode[] = ['binaural', 'atmos'];

export interface ModeSelectorOptions {
  /** Called from the radio's change event (a user action). */
  onSelect(mode: ListeningMode): void;
  /** Link to the help page for the support conditions; null hides the link. */
  helpHref: string | null;
}

export interface ModeSelectorState {
  selected: ListeningMode | null;
  /** Modes the event offers; the others render disabled with「即將開放」. */
  available: readonly ListeningMode[];
  /** Locks the whole group (for example while loading). */
  disabled?: boolean;
}

export interface ModeSelector {
  el: HTMLFieldSetElement;
  inputs: Record<ListeningMode, HTMLInputElement>;
  update(state: ModeSelectorState): void;
  destroy(): void;
}

interface Option {
  describedBy: string;
  input: HTMLInputElement;
  marker: HTMLElement;
  unavailable: HTMLElement;
  wrapper: HTMLElement;
}

export function createModeSelector(options: ModeSelectorOptions): ModeSelector {
  const groupName = uid('wg-live-mode');
  const parts = {} as Record<ListeningMode, Option>;
  const disposers: Array<() => void> = [];

  const optionEls = MODES.map((mode) => {
    const copy = playerCopy.modeSelector[mode];
    const inputId = uid(`wg-live-mode-${mode}`);
    const titleId = `${inputId}-title`;
    const descId = `${inputId}-desc`;
    const helperId = `${inputId}-helper`;
    const actionId = `${inputId}-action`;
    const unavailableId = `${inputId}-unavailable`;

    const input = h('input', {
      className: 'wg-live__mode-input',
      type: 'radio',
      id: inputId,
      name: groupName,
      value: mode,
      attrs: {
        // Name = title + action text; the longer explanations are the description.
        'aria-labelledby': `${titleId} ${actionId}`,
        'aria-describedby': `${descId} ${helperId}`,
      },
    });
    const marker = h('span', {
      className: 'wg-live__mode-marker',
      attrs: { 'aria-hidden': 'true' },
      text: playerCopy.modeSelector.selectedMarker,
      hidden: true,
    });
    const unavailable = h('span', {
      className: 'wg-live__mode-unavailable',
      id: unavailableId,
      text: playerCopy.modeSelector.unavailable,
      hidden: true,
    });
    const label = h(
      'label',
      { className: 'wg-live__mode-card', attrs: { for: inputId } },
      h('span', { className: 'wg-live__mode-title', id: titleId, text: copy.title }),
      h('span', { className: 'wg-live__mode-desc', id: descId, text: copy.description }),
      h('span', { className: 'wg-live__mode-helper', id: helperId, text: copy.helper }),
      h(
        'span',
        { className: 'wg-live__mode-foot' },
        h('span', { className: 'wg-live__mode-action', id: actionId, text: copy.action }),
        marker,
        unavailable,
      ),
    );
    const wrapper = h('div', { className: 'wg-live__mode', dataset: { mode } }, input, label);

    const onChange = (): void => {
      if (input.checked && !input.disabled) options.onSelect(mode);
    };
    input.addEventListener('change', onChange);
    disposers.push(() => input.removeEventListener('change', onChange));

    parts[mode] = { describedBy: `${descId} ${helperId}`, input, marker, unavailable, wrapper };
    return wrapper;
  });

  const helpLink = options.helpHref
    ? h('a', { className: 'wg-live__mode-help', href: options.helpHref, text: playerCopy.modeSelector.helpLink })
    : null;

  const el = h(
    'fieldset',
    { className: 'wg-live__mode-selector' },
    h('legend', { className: 'wg-live__mode-legend', text: playerCopy.modeSelector.legend }),
    h('div', { className: 'wg-live__mode-options' }, ...optionEls),
    helpLink,
  );

  function update(state: ModeSelectorState): void {
    const available = new Set<ListeningMode>(state.available);
    for (const mode of MODES) {
      const part = parts[mode];
      const isAvailable = available.has(mode);
      const selected = state.selected === mode && isAvailable;
      const disabled = !isAvailable || state.disabled === true;
      if (part.input.checked !== selected) part.input.checked = selected;
      if (part.input.disabled !== disabled) part.input.disabled = disabled;
      part.marker.hidden = !selected;
      part.unavailable.hidden = isAvailable;
      // A hidden element is still read when referenced, so only reference「即將開放」when shown.
      part.input.setAttribute(
        'aria-describedby',
        isAvailable ? part.describedBy : `${part.describedBy} ${part.unavailable.id}`,
      );
      part.wrapper.dataset.selected = selected ? 'true' : 'false';
      part.wrapper.dataset.available = isAvailable ? 'true' : 'false';
    }
  }

  return {
    el,
    inputs: { binaural: parts.binaural.input, atmos: parts.atmos.input },
    update,
    destroy(): void {
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}
