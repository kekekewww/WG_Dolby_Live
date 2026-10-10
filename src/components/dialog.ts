/**
 * Switch-mode confirmation (spec 5.4, plan D10 / 6.6).
 *
 * - Native <dialog> with showModal(); when it is unavailable an inline confirm panel is used.
 * - Names the current and the other mode and warns that playback may be interrupted briefly.
 * - Opening calls onOpen(other) (the view calls controller.prepareSwitch). Confirm calls
 *   onConfirm(other) SYNCHRONOUSLY (the view calls controller.switchMode) and then closes.
 * - Escape / cancel / backdrop only close. `returnValue` is never used.
 * - Focus returns to the trigger when it is still connected and focusable, otherwise to the
 *   fallback element (the status heading), after closing and again once the switch settles.
 */
import { focusFirst, h, isFocusable, uid } from '../dom';
import { statusCopy } from '../i18n/copy';
import type { ListeningMode, PlayerStatus } from '../types';

export interface SwitchDialogOptions {
  /** The other mode's descriptor should be prefetched (controller.prepareSwitch). */
  onOpen(target: ListeningMode): void;
  /** Called synchronously from the confirm click (controller.switchMode). */
  onConfirm(target: ListeningMode): void;
  /** Where focus goes when the trigger is gone: the status heading (tabindex="-1"). */
  fallbackFocus(): HTMLElement | null;
}

export interface SwitchDialog {
  /** The <dialog> (or the inline panel when <dialog> is unsupported). Place it outside `.wg-live__player`. */
  el: HTMLElement;
  /** True when the native <dialog>/showModal path is in use. */
  native: boolean;
  open(trigger: HTMLElement | null, current: ListeningMode, other: ListeningMode): void;
  close(): void;
  isOpen(): boolean;
  /** Feed every player status so focus can be restored once a switch settles. */
  notifyStatus(status: PlayerStatus): void;
  /** Focus the trigger, or the fallback when the trigger is disconnected/unfocusable. */
  restoreFocus(): boolean;
  destroy(): void;
}

function supportsNativeDialog(): boolean {
  if (typeof HTMLDialogElement === 'undefined') return false;
  return typeof HTMLDialogElement.prototype.showModal === 'function';
}

export function createSwitchDialog(options: SwitchDialogOptions): SwitchDialog {
  const native = supportsNativeDialog();
  const titleId = uid('wg-live-dialog-title');
  const bodyId = uid('wg-live-dialog-body');

  const title = h('h2', { className: 'wg-live__dialog-title wg-live__heading wg-live__heading--h3', id: titleId, text: statusCopy.switchDialog.title });
  const body = h('p', { className: 'wg-live__dialog-body', id: bodyId });
  const confirm = h('button', {
    className: 'wg-live__btn wg-live__btn--primary wg-live__dialog-confirm',
    type: 'button',
    text: statusCopy.action.confirmSwitch,
  });
  const cancel = h('button', {
    className: 'wg-live__btn wg-live__btn--secondary wg-live__dialog-cancel',
    type: 'button',
    text: statusCopy.action.cancel,
  });
  const panel = h(
    'div',
    { className: 'wg-live__dialog-panel' },
    title,
    body,
    h('div', { className: 'wg-live__actions wg-live__actions--stack wg-live__dialog-actions' }, confirm, cancel),
  );

  const el: HTMLElement = native
    ? h('dialog', { className: 'wg-live__dialog', attrs: { 'aria-labelledby': titleId, 'aria-describedby': bodyId } }, panel)
    : h(
        'div',
        {
          className: 'wg-live__dialog wg-live__dialog--inline',
          hidden: true,
          attrs: { role: 'group', 'aria-labelledby': titleId, 'aria-describedby': bodyId },
        },
        panel,
      );

  let opened = false;
  let trigger: HTMLElement | null = null;
  let target: ListeningMode | null = null;
  let awaitSettle = false;
  let sawSwitching = false;
  let destroyed = false;

  function restoreFocus(): boolean {
    if (trigger && isFocusable(trigger)) {
      trigger.focus();
      if (document.activeElement === trigger) return true;
    }
    const fallback = options.fallbackFocus();
    if (fallback && isFocusable(fallback)) {
      fallback.focus();
      return document.activeElement === fallback;
    }
    return false;
  }

  /** Runs for every way of closing: Escape, cancel, backdrop, confirm, programmatic close(). */
  function handleClosed(): void {
    if (!opened) return;
    opened = false;
    if (!native) (el as HTMLElement).hidden = true;
    restoreFocus();
  }

  function close(): void {
    if (!opened) return;
    if (native) {
      const dialog = el as HTMLDialogElement;
      if (dialog.open) {
        dialog.close(); // fires 'close' -> handleClosed()
        return;
      }
    }
    handleClosed();
  }

  function open(from: HTMLElement | null, current: ListeningMode, other: ListeningMode): void {
    if (destroyed || opened) return;
    trigger = from;
    target = other;
    awaitSettle = false;
    sawSwitching = false;
    body.textContent = statusCopy.switchDialog.body(statusCopy.modeName[current], statusCopy.modeName[other]);
    confirm.setAttribute('aria-label', `${statusCopy.action.confirmSwitch}：${statusCopy.modeName[other]}`);
    opened = true;
    if (native) {
      const dialog = el as HTMLDialogElement;
      try {
        dialog.showModal();
      } catch {
        opened = false; // not connected, or already open: nothing to show
        return;
      }
    } else {
      (el as HTMLElement).hidden = false;
      focusFirst(el);
    }
    options.onOpen(other);
  }

  const onConfirm = (): void => {
    if (!opened || target === null) return;
    const mode = target;
    awaitSettle = true;
    sawSwitching = false;
    options.onConfirm(mode); // synchronous: switchMode() runs inside this click (plan 6.3)
    close();
  };
  const onCancel = (): void => close();
  // Native <dialog> also fires 'cancel' for Escape; the default action closes it. Nothing else to do.
  const onDialogClose = (): void => handleClosed();
  const onBackdropClick = (event: MouseEvent): void => {
    if (event.target === el) close();
  };
  const onInlineKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  };

  confirm.addEventListener('click', onConfirm);
  cancel.addEventListener('click', onCancel);
  if (native) {
    el.addEventListener('close', onDialogClose);
    el.addEventListener('click', onBackdropClick);
  } else {
    el.addEventListener('keydown', onInlineKeydown);
  }

  return {
    el,
    native,
    open,
    close,
    isOpen: () => opened,
    notifyStatus(status): void {
      if (!awaitSettle) return;
      if (status === 'switching') {
        sawSwitching = true;
        return;
      }
      if (!sawSwitching) return;
      awaitSettle = false;
      sawSwitching = false;
      // The switching render may have dropped focus; only step in when focus is lost.
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) restoreFocus();
    },
    restoreFocus,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      el.removeEventListener('close', onDialogClose);
      el.removeEventListener('click', onBackdropClick);
      el.removeEventListener('keydown', onInlineKeydown);
      if (native && (el as HTMLDialogElement).open) (el as HTMLDialogElement).close();
      opened = false;
      el.remove();
    },
  };
}
