import { describe, expect, it } from 'vitest';
import { createPlayerShell, createStageArt } from '../../../src/components/player-shell';
import { makeEvent } from './helpers';

describe('createPlayerShell', () => {
  it('builds a labelled group with the stage and the controls slot', () => {
    const shell = createPlayerShell('audio');
    expect(shell.el.className).toBe('wg-live__player');
    expect(shell.el.getAttribute('role')).toBe('group');
    expect(shell.el.getAttribute('aria-label')).toBeTruthy();
    // UI-08: Space never reaches the shortcut handler from inside the group (every focusable node is a control),
    // so the group does not advertise it; the primary button carries the shortcuts.
    expect(shell.el.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(shell.el.firstElementChild).toBe(shell.stage);
    expect(shell.stage.className).toContain('wg-live__stage');
    expect(shell.controlsSlot.className).toBe('wg-live__controls');
    expect(shell.el.lastElementChild).toBe(shell.controlsSlot);
  });

  it('creates ONE stable <audio> in the stage with the plan D9 attributes', () => {
    const shell = createPlayerShell('audio');
    const media = shell.host.media;
    expect(media).toBeInstanceOf(HTMLAudioElement);
    expect(media.parentElement).toBe(shell.stage);
    expect(media.getAttribute('preload')).toBe('none');
    expect(media.hasAttribute('autoplay')).toBe(false);
    expect(media.hasAttribute('controls')).toBe(false);
    expect(media.querySelector('source')).toBeNull();
    expect(shell.stage.querySelectorAll('audio,video')).toHaveLength(1);
  });

  it('creates a playsinline <video> for video events', () => {
    const shell = createPlayerShell('video');
    const media = shell.host.media as HTMLVideoElement;
    expect(media).toBeInstanceOf(HTMLVideoElement);
    expect(media.hasAttribute('playsinline')).toBe(true);
    expect(media.getAttribute('preload')).toBe('none');
    expect(media.hasAttribute('autoplay')).toBe(false);
    expect(media.hasAttribute('controls')).toBe(false);
    expect(shell.stage.dataset.mediaKind).toBe('video');
  });

  it('keeps an empty, hidden frame slot for the M2 iframe adapter', () => {
    const shell = createPlayerShell('audio');
    expect(shell.host.frameSlot.hidden).toBe(true);
    expect(shell.host.frameSlot.childElementCount).toBe(0);
    expect(shell.stage.contains(shell.host.frameSlot)).toBe(true);
  });
});

describe('createStageArt', () => {
  it('renders the poster with width, height and alt (no layout shift)', () => {
    const art = createStageArt(makeEvent());
    const img = art.querySelector('img');
    expect(img?.getAttribute('width')).toBe('1200');
    expect(img?.getAttribute('height')).toBe('675');
    expect(img?.getAttribute('alt')).toContain('介面示範');
  });

  it('falls back to a text panel without a poster (no visualizer, no fake image)', () => {
    const art = createStageArt(makeEvent({ poster: null, posterUrl: null, title: '測試音樂會' }));
    expect(art.querySelector('img')).toBeNull();
    expect(art.querySelector('canvas,svg')).toBeNull();
    expect(art.textContent).toBe('測試音樂會');
  });

  it('uses a plain image when only a poster URL is known', () => {
    const art = createStageArt(makeEvent({ poster: null, posterUrl: '/poster.jpg' }));
    const img = art.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.hasAttribute('width')).toBe(false);
  });
});
