/**
 * Player shell: the `.wg-live__player` group (role="group", labelled) with the dark media stage
 * and the controls slot below it (spec 5.3).
 *
 * The one media element (plan D9) is created here, once, inside `.wg-live__stage`:
 * preload="none", no autoplay, no controls, no <source> children, `playsinline` for <video>.
 * Nothing in the player view ever recreates it.
 */
import { h } from '../dom';
import { playerCopy } from '../i18n/copy-player';
import type { MediaHost, PublicEvent } from '../types';

export interface PlayerShell {
  /** `.wg-live__player`: keyboard shortcuts attach here. */
  el: HTMLElement;
  host: MediaHost;
  /** `.wg-live__stage`: holds the media element, the frame slot and (for audio) the poster art. */
  stage: HTMLElement;
  /** `.wg-live__controls`: selector, transport controls and the mode bar render here. */
  controlsSlot: HTMLElement;
}

export function createPlayerShell(mediaKind: 'audio' | 'video'): PlayerShell {
  const media: HTMLMediaElement =
    mediaKind === 'video'
      ? h('video', {
          className: 'wg-live__media wg-live__media--video',
          preload: 'none',
          playsinline: true,
        })
      : h('audio', { className: 'wg-live__media wg-live__media--audio', preload: 'none' });
  if (media instanceof HTMLVideoElement) media.playsInline = true;

  // Used by the iframe adapter in M2; stays empty (and hidden) in M1.
  const frameSlot = h('div', { className: 'wg-live__frame-slot', hidden: true });

  const stage = h(
    'div',
    {
      className: `wg-live__stage wg-live__stage--${mediaKind}`,
      dataset: { mediaKind },
    },
    media,
    frameSlot,
  );

  const controlsSlot = h('div', { className: 'wg-live__controls' });

  const el = h(
    'div',
    {
      className: 'wg-live__player',
      attrs: {
        role: 'group',
        'aria-label': playerCopy.group.label,
        'aria-keyshortcuts': playerCopy.controls.keyShortcuts,
      },
    },
    stage,
    controlsSlot,
  );

  return { el, host: { media, frameSlot }, stage, controlsSlot };
}

/**
 * Static cover art for the audio stage (poster + text layout, no forced 16:9 and no visualizer,
 * spec 5.3 / 7.3). Returns null for video (the <video poster> is used instead).
 */
export function createStageArt(event: PublicEvent): HTMLElement {
  const poster = event.poster;
  if (poster) {
    return h(
      'div',
      { className: 'wg-live__stage-art' },
      h('img', {
        className: 'wg-live__stage-img',
        src: poster.url,
        srcset: poster.srcset,
        sizes: poster.sizes,
        width: poster.width,
        height: poster.height,
        alt: poster.alt,
        decoding: 'async',
      }),
    );
  }
  if (event.posterUrl) {
    return h(
      'div',
      { className: 'wg-live__stage-art' },
      h('img', {
        className: 'wg-live__stage-img wg-live__stage-img--unsized',
        src: event.posterUrl,
        alt: playerCopy.stage.posterFallbackAlt,
        decoding: 'async',
      }),
    );
  }
  // No poster: a plain, quiet panel that carries the title as text (not a fake visual).
  return h(
    'div',
    { className: 'wg-live__stage-art wg-live__stage-art--text' },
    h('p', { className: 'wg-live__stage-title', attrs: { 'aria-hidden': 'true' }, text: event.title }),
  );
}
