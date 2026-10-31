/**
 * Ticket holders' stream link for VLC or Safari (decision 2026-11-01, DECISION-2026-11-01-atmos-only.md).
 *
 * Shown only to an entitled viewer of an open (live / intermission) HLS event, when this browser cannot play the Atmos
 * stream (feature detection, never the browser name) or after playback failed. The link comes from /playback on a click,
 * a fresh one per click: it is never fetched at page load and never part of the public event data.
 */
import { h, uid } from '../dom';
import { externalCopy } from '../i18n/copy-external';
import { selectGate } from '../state/model';
import type { AppState, ListeningMode, PlaybackSource, PublicEvent } from '../types';

export interface ExternalLinkPanelOptions {
  event: PublicEvent;
  /** /playback for this event: the server checks the ticket before it hands out a URL. */
  resolve: (eventId: number, mode: ListeningMode) => Promise<PlaybackSource>;
  /** Can this browser play the Atmos stream in the page? false = no (feature detection); true / 'unknown' = try. */
  atmosPlayable: boolean | 'unknown';
}

export interface ExternalLinkPanel {
  el: HTMLElement;
  update(state: AppState): void;
  destroy(): void;
}

const MODE: ListeningMode = 'atmos';

export function createExternalLinkPanel(options: ExternalLinkPanelOptions): ExternalLinkPanel {
  const { event, resolve, atmosPlayable } = options;
  const headingId = uid('wg-live-external');
  const inputId = uid('wg-live-external-link');

  const heading = h('h3', { className: 'wg-live__external-heading wg-live__heading', id: headingId, text: externalCopy.heading });
  const reason = h('p', { className: 'wg-live__external-reason' });
  const get = h('button', { className: 'wg-live__btn wg-live__external-get', type: 'button', text: externalCopy.get });
  const result = h('div', { className: 'wg-live__external-result' });
  const steps = h(
    'div',
    { className: 'wg-live__external-steps' },
    h('p', { className: 'wg-live__small', text: externalCopy.stepsHeading }),
    h('ul', {}, h('li', { text: externalCopy.stepVlc }), h('li', { text: externalCopy.stepSafari })),
  );
  const el = h('section', { className: 'wg-live__external', hidden: true, attrs: { 'aria-labelledby': headingId } }, heading, reason, get, result, steps);

  let destroyed = false;
  let request = 0;

  function show(url: string): void {
    const input = h('input', { className: 'wg-live__external-input', id: inputId, type: 'text', attrs: { readonly: '', spellcheck: 'false' } });
    input.value = url;
    const label = h('label', { className: 'wg-live__small', attrs: { for: inputId }, text: externalCopy.linkLabel });
    const copy = h('button', { className: 'wg-live__btn wg-live__btn--secondary wg-live__external-copy', type: 'button', text: externalCopy.copy });
    const open = h('a', { className: 'wg-live__link wg-live__external-open', href: url, text: externalCopy.open, attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    const status = h('p', { className: 'wg-live__small wg-live__muted', text: externalCopy.private });
    copy.addEventListener('click', () => {
      input.select();
      const done = (ok: boolean): void => {
        status.textContent = ok ? externalCopy.copied : externalCopy.copyFailed;
      };
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clip && typeof clip.writeText === 'function') clip.writeText(url).then(() => done(true), () => done(false));
      else done(false);
    });
    result.replaceChildren(label, input, h('div', { className: 'wg-live__actions' }, copy, open), status);
  }

  get.addEventListener('click', () => {
    const mine = ++request;
    get.setAttribute('aria-disabled', 'true');
    result.replaceChildren(h('p', { className: 'wg-live__small', text: externalCopy.loading }));
    resolve(event.id, MODE).then(
      (source) => {
        if (destroyed || mine !== request) return;
        get.removeAttribute('aria-disabled');
        get.textContent = externalCopy.getAgain;
        if (source.kind === 'hls' && typeof source.url === 'string' && source.url !== '') show(source.url);
        else result.replaceChildren(h('p', { className: 'wg-live__small', text: externalCopy.unavailable }));
      },
      () => {
        if (destroyed || mine !== request) return;
        get.removeAttribute('aria-disabled');
        result.replaceChildren(h('p', { className: 'wg-live__small', text: externalCopy.unavailable }));
      },
    );
  });

  function update(state: AppState): void {
    const failed = state.player.status === 'failed';
    const visible =
      state.source === 'hls' &&
      state.entitlement === 'entitled' &&
      selectGate(state).kind === 'open' &&
      (atmosPlayable === false || failed);
    el.hidden = !visible;
    if (!visible) return;
    const text = atmosPlayable === false ? externalCopy.unsupported : externalCopy.failed;
    if (reason.textContent !== text) reason.textContent = text;
  }

  return {
    el,
    update,
    destroy() {
      destroyed = true;
      el.remove();
    },
  };
}
