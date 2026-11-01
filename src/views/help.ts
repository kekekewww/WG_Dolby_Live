/**
 * Help view, `/live/help/` (plan 6.11, spec 5.5).
 *
 * Fixed sections come from helpCopy in this order: how to listen, no sound, reconnecting, VLC,
 * keyboard, contact. Admin FAQ items follow and may be empty. 0.5.0: the Safari-first acceptance note
 * and the device compatibility table are not shown to visitors (maintainer document). The page has no
 * dependency on the deployment mode: it stays available when the feature is disabled (plan D16).
 *
 * Static content only: no timers, no listeners, nothing to release on destroy.
 */
import { h, uid } from '../dom';
import { helpCopy } from '../i18n/copy';
import type { BootConfig } from '../types';
import type { ViewInstance } from './types';

type SectionTag = 'h2' | 'h3';
type SubTag = 'h3' | 'h4';

interface Levels {
  section: SectionTag;
  sub: SubTag;
}

function paragraphs(text: string, className = 'wg-live__help-text'): HTMLElement[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => h('p', { className, text: line }));
}

function section(levels: Levels, key: string, heading: string, ...children: Array<Node | null>): HTMLElement {
  const id = uid(`wg-live-help-${key}`);
  return h(
    'section',
    { className: `wg-live__help-section wg-live__help-section--${key}`, attrs: { 'aria-labelledby': id } },
    h(levels.section, { className: 'wg-live__heading wg-live__heading--h3', attrs: { id }, text: heading }),
    ...children,
  );
}

function safeLink(href: string | null, label: string, className: string): HTMLElement | null {
  if (!href) return null;
  const a = h('a', { className, attrs: { href }, text: label });
  return a.hasAttribute('href') ? a : null;
}

/* ---- 1. modes ---- */
function buildModes(levels: Levels): HTMLElement {
  const copy = helpCopy.modes;
  const mode = (key: 'apple' | 'windows'): HTMLElement =>
    h(
      'li',
      { className: `wg-live__help-mode wg-live__help-mode--${key}` },
      h(levels.sub, { className: 'wg-live__help-mode-name', text: copy[key].name }),
      h('p', { className: 'wg-live__help-text', text: copy[key].description }),
    );
  return section(
    levels,
    'modes',
    copy.heading,
    h('p', { className: 'wg-live__help-text wg-live__muted', text: copy.lead }),
    h('ul', { className: 'wg-live__help-modes', attrs: { role: 'list' } }, mode('apple'), mode('windows')),
  );
}

/* ---- 7. keyboard ---- */
function buildKeyboard(levels: Levels): HTMLElement {
  const copy = helpCopy.keyboard;
  const items = copy.items.map((item) =>
    h(
      'div',
      { className: 'wg-live__keys-row' },
      h(
        'dt',
        { className: 'wg-live__keys-keys' },
        ...item.keys.flatMap((key, i) => (i === 0 ? [h('kbd', { className: 'wg-live__kbd', text: key })] : [' ', h('kbd', { className: 'wg-live__kbd', text: key })])),
      ),
      h('dd', { className: 'wg-live__keys-action', text: item.action }),
    ),
  );
  return section(
    levels,
    'keyboard',
    copy.heading,
    h('p', { className: 'wg-live__help-text wg-live__muted', text: copy.lead }),
    h('dl', { className: 'wg-live__keys' }, ...items),
  );
}

/* ---- 8. contact ---- */
function buildContact(levels: Levels, boot: BootConfig): HTMLElement {
  const copy = helpCopy.contact;
  const note = paragraphs(boot.help.supportNote);
  const contact = safeLink(boot.links.contact, copy.link, 'wg-live__btn wg-live__btn--primary');
  const children: Array<Node | null> = [...note];
  if (contact) children.push(h('div', { className: 'wg-live__actions wg-live__actions--stack' }, contact));
  if (note.length === 0 && !contact) {
    children.push(h('p', { className: 'wg-live__help-text', text: copy.fallback }));
  }
  return section(levels, 'contact', copy.heading, ...children);
}

/* ---- admin FAQ ---- */
function buildFaq(levels: Levels, boot: BootConfig): HTMLElement | null {
  const items = boot.help.faq.filter((item) => item.question.trim() !== '');
  if (items.length === 0) return null;
  return section(
    levels,
    'faq',
    helpCopy.faq.heading,
    h(
      'div',
      { className: 'wg-live__faq-list' },
      ...items.map((item) =>
        h(
          'details',
          { className: 'wg-live__faq-item' },
          h('summary', { className: 'wg-live__faq-question', text: item.question }),
          h('div', { className: 'wg-live__faq-answer' }, ...paragraphs(item.answer, 'wg-live__faq-text')),
        ),
      ),
    ),
  );
}

export function mountHelpView(mount: HTMLElement, boot: BootConfig): ViewInstance {
  const levels: Levels = boot.heading === 'h1' ? { section: 'h2', sub: 'h3' } : { section: 'h3', sub: 'h4' };
  const back = safeLink(boot.links.events, helpCopy.backToEvents, 'wg-live__help-back wg-live__link');

  const root = h(
    'div',
    { className: 'wg-live__help' },
    h(
      'header',
      { className: 'wg-live__help-header' },
      h(boot.heading, { className: 'wg-live__heading wg-live__view-title', text: helpCopy.title }),
      h('p', { className: 'wg-live__view-subtitle', text: helpCopy.subtitle }),
      h('p', { className: 'wg-live__view-intro wg-live__muted', text: helpCopy.intro }),
      back ? h('p', { className: 'wg-live__help-back-row' }, back) : null,
    ),
    buildModes(levels),
    section(
      levels,
      'no-sound',
      helpCopy.noSound.heading,
      h('p', { className: 'wg-live__help-text wg-live__muted', text: helpCopy.noSound.lead }),
      h('ol', { className: 'wg-live__help-steps', attrs: { role: 'list' } }, ...helpCopy.noSound.steps.map((text) => h('li', { className: 'wg-live__help-step', text }))),
    ),
    section(
      levels,
      'reconnect',
      helpCopy.reconnect.heading,
      ...helpCopy.reconnect.paragraphs.map((text) => h('p', { className: 'wg-live__help-text', text })),
    ),
    section(
      levels,
      'external',
      helpCopy.external.heading,
      ...helpCopy.external.paragraphs.map((text) => h('p', { className: 'wg-live__help-text', text })),
    ),
    buildKeyboard(levels),
    buildContact(levels, boot),
    buildFaq(levels, boot),
  );

  mount.replaceChildren(root);

  return {
    destroy(): void {
      root.remove();
    },
  };
}
