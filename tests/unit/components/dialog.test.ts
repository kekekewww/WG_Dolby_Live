import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSwitchDialog } from '../../../src/components/dialog';
import type { SwitchDialog } from '../../../src/components/dialog';
import type { ListeningMode } from '../../../src/types';
import { attach } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

function setup(options: { trigger?: boolean } = {}) {
  const trigger = document.createElement('button');
  trigger.textContent = '切換模式';
  const heading = document.createElement('h3');
  heading.tabIndex = -1;
  heading.textContent = '狀態';
  attach(trigger);
  attach(heading);

  const calls: string[] = [];
  const onOpen = vi.fn<(mode: ListeningMode) => void>((mode) => calls.push(`open:${mode}`));
  const onConfirm = vi.fn<(mode: ListeningMode) => void>((mode) => {
    calls.push(`confirm:${mode}:open=${String(dialog.isOpen())}`);
  });
  const dialog: SwitchDialog = createSwitchDialog({ onOpen, onConfirm, fallbackFocus: () => heading });
  attach(dialog.el);
  trigger.focus();
  if (options.trigger === false) return { dialog, trigger, heading, onOpen, onConfirm, calls };
  return { dialog, trigger, heading, onOpen, onConfirm, calls };
}

const confirmButton = (d: SwitchDialog): HTMLButtonElement => d.el.querySelector('.wg-live__dialog-confirm') as HTMLButtonElement;
const cancelButton = (d: SwitchDialog): HTMLButtonElement => d.el.querySelector('.wg-live__dialog-cancel') as HTMLButtonElement;

describe('switch dialog content', () => {
  it('uses a native <dialog> labelled by its title and described by its body', () => {
    const { dialog } = setup();
    expect(dialog.native).toBe(true);
    expect(dialog.el.tagName).toBe('DIALOG');
    const title = document.getElementById(dialog.el.getAttribute('aria-labelledby') ?? '');
    const body = document.getElementById(dialog.el.getAttribute('aria-describedby') ?? '');
    expect(title?.textContent).toBe('切換聆聽模式');
    expect(body).not.toBeNull();
  });

  it('names the current and the other mode and warns that playback may be interrupted', () => {
    const { dialog, trigger } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    const body = document.getElementById(dialog.el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
    expect(body).toContain('目前模式為「Binaural」');
    expect(body).toContain('「Dolby Atmos 音軌」');
    expect(body).toContain('切換時播放可能會短暫中斷');
  });

  it('opens modally and prefetches the other mode', () => {
    const { dialog, trigger, onOpen } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    expect(dialog.isOpen()).toBe(true);
    expect(dialog.el.hasAttribute('open')).toBe(true);
    expect(onOpen).toHaveBeenCalledWith('atmos');
  });

  it('has confirm and cancel buttons of at least the secondary size class', () => {
    const { dialog } = setup();
    expect(confirmButton(dialog).textContent).toBe('確認切換');
    expect(confirmButton(dialog).className).toContain('wg-live__btn--primary');
    expect(cancelButton(dialog).textContent).toBe('取消');
  });
});

describe('switch dialog flow', () => {
  it('confirm calls switchMode synchronously for the other mode, then closes', () => {
    const { dialog, trigger, onConfirm, calls } = setup();
    dialog.open(trigger, 'atmos', 'binaural');
    confirmButton(dialog).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('binaural');
    // switchMode ran inside the click, before the dialog closed.
    expect(calls).toEqual(['open:binaural', 'confirm:binaural:open=true']);
    expect(dialog.isOpen()).toBe(false);
    expect(dialog.el.hasAttribute('open')).toBe(false);
  });

  it('cancel only closes (no switch) and does not use returnValue', () => {
    const { dialog, trigger, onConfirm } = setup();
    const before = (dialog.el as HTMLDialogElement).returnValue;
    dialog.open(trigger, 'binaural', 'atmos');
    cancelButton(dialog).click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog.isOpen()).toBe(false);
    expect((dialog.el as HTMLDialogElement).returnValue).toBe(before);
  });

  it('Escape (the dialog cancel event, then close) only closes', () => {
    const { dialog, trigger, onConfirm } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    const cancel = new Event('cancel', { cancelable: true });
    dialog.el.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(false); // the browser default closes it
    (dialog.el as HTMLDialogElement).close();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog.isOpen()).toBe(false);
  });

  it('a click on the backdrop (the dialog element itself) closes; a click inside does not', () => {
    const { dialog, trigger, onConfirm } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    dialog.el.querySelector<HTMLElement>('.wg-live__dialog-body')?.click();
    expect(dialog.isOpen()).toBe(true);
    dialog.el.click();
    expect(dialog.isOpen()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores a second open() while open and a confirm click after closing', () => {
    const { dialog, trigger, onOpen, onConfirm } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    dialog.open(trigger, 'binaural', 'atmos');
    expect(onOpen).toHaveBeenCalledTimes(1);
    dialog.close();
    confirmButton(dialog).click();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('focus return (plan 6.6)', () => {
  it('returns focus to the trigger after cancel, confirm and Escape', () => {
    for (const close of [
      (d: SwitchDialog) => cancelButton(d).click(),
      (d: SwitchDialog) => confirmButton(d).click(),
      (d: SwitchDialog) => (d.el as HTMLDialogElement).close(),
    ]) {
      document.body.replaceChildren();
      const { dialog, trigger } = setup();
      dialog.open(trigger, 'binaural', 'atmos');
      document.body.focus();
      close(dialog);
      expect(document.activeElement).toBe(trigger);
    }
  });

  it('falls back to the status heading when the trigger was removed from the DOM', () => {
    const { dialog, trigger, heading } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    trigger.remove();
    cancelButton(dialog).click();
    expect(document.activeElement).toBe(heading);
  });

  it('falls back to the status heading when the trigger is hidden or unfocusable', () => {
    const { dialog, trigger, heading } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    trigger.hidden = true;
    cancelButton(dialog).click();
    expect(document.activeElement).toBe(heading);

    document.body.replaceChildren();
    const second = setup();
    second.dialog.open(second.trigger, 'binaural', 'atmos');
    second.trigger.disabled = true;
    cancelButton(second.dialog).click();
    expect(document.activeElement).toBe(second.heading);
  });

  it('falls back to the heading when the dialog was opened without a trigger', () => {
    const { dialog, heading } = setup();
    dialog.open(null, 'binaural', 'atmos');
    dialog.close();
    expect(document.activeElement).toBe(heading);
  });

  it('keeps aria-disabled triggers focusable (the trigger is never `disabled` while switching)', () => {
    const { dialog, trigger } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    trigger.setAttribute('aria-disabled', 'true');
    document.body.focus();
    confirmButton(dialog).click();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus again once the switch settles if the render dropped it', () => {
    const { dialog, trigger } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    confirmButton(dialog).click();
    dialog.notifyStatus('switching');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    dialog.notifyStatus('playing');
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus after the switch settles when the user moved on', () => {
    const { dialog, trigger, heading } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    confirmButton(dialog).click();
    dialog.notifyStatus('switching');
    heading.focus();
    dialog.notifyStatus('playing');
    expect(document.activeElement).toBe(heading);
  });

  it('only restores after a switch actually happened', () => {
    const { dialog, trigger } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    cancelButton(dialog).click();
    document.body.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    dialog.notifyStatus('playing');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('inline fallback without <dialog>', () => {
  function withoutShowModal<T>(run: () => T): T {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    const original = proto.showModal;
    Object.defineProperty(proto, 'showModal', { value: undefined, configurable: true, writable: true });
    try {
      return run();
    } finally {
      Object.defineProperty(proto, 'showModal', { value: original, configurable: true, writable: true });
    }
  }

  it('renders an inline panel that opens and closes by confirm, cancel and Escape', () => {
    withoutShowModal(() => {
      const { dialog, trigger, onConfirm } = setup();
      expect(dialog.native).toBe(false);
      expect(dialog.el.tagName).toBe('DIV');
      expect(dialog.el.hidden).toBe(true);

      dialog.open(trigger, 'binaural', 'atmos');
      expect(dialog.el.hidden).toBe(false);
      expect(dialog.el.contains(document.activeElement)).toBe(true);

      dialog.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(dialog.el.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
      expect(onConfirm).not.toHaveBeenCalled();

      dialog.open(trigger, 'binaural', 'atmos');
      confirmButton(dialog).click();
      expect(onConfirm).toHaveBeenCalledWith('atmos');
      expect(dialog.el.hidden).toBe(true);
    });
  });
});

describe('destroy', () => {
  it('closes, removes the element and ignores later calls', () => {
    const { dialog, trigger, onOpen } = setup();
    dialog.open(trigger, 'binaural', 'atmos');
    dialog.destroy();
    expect(dialog.el.isConnected).toBe(false);
    expect(dialog.isOpen()).toBe(false);
    dialog.open(trigger, 'binaural', 'atmos');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(() => dialog.destroy()).not.toThrow();
  });
});
