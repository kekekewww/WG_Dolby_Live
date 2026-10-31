/**
 * Listening Guide block (plan 6.1 section 3): a short explanation of the two modes with a link to
 * the help page. The mode texts are the spec 5.2 strings; nothing here claims a device works.
 */
import { h, uid } from '../dom';
import { eventsCopy } from '../i18n/copy';

export interface ListeningGuideOptions {
  /** Heading level for the block title (one below the view title). */
  headingTag: 'h2' | 'h3';
  /** links.help; the link is omitted when there is none. */
  helpUrl: string | null;
}

export function createListeningGuide(opts: ListeningGuideOptions): HTMLElement {
  const headingId = uid('wg-live-guide-heading');
  const copy = eventsCopy.guide;
  const subTag = opts.headingTag === 'h2' ? 'h3' : 'h4';

  const modeCard = (key: 'apple' | 'windows'): HTMLElement =>
    h(
      'li',
      { className: `wg-live__guide-mode wg-live__guide-mode--${key}` },
      h(subTag, { className: 'wg-live__guide-mode-name', text: copy.modes[key].name }),
      h('p', { className: 'wg-live__guide-mode-text', text: copy.modes[key].description }),
      h('p', { className: 'wg-live__guide-mode-note wg-live__muted wg-live__small', text: copy.modes[key].note }),
    );

  const section = h(
    'section',
    { className: 'wg-live__guide', attrs: { 'aria-labelledby': headingId } },
    h(opts.headingTag, { className: 'wg-live__heading wg-live__heading--h3', attrs: { id: headingId }, text: copy.heading }),
    h('p', { className: 'wg-live__guide-lead wg-live__muted', text: copy.lead }),
    h('ul', { className: 'wg-live__guide-modes', attrs: { role: 'list' } }, modeCard('apple'), modeCard('windows')),
  );

  if (opts.helpUrl) {
    const link = h('a', { className: 'wg-live__guide-link', attrs: { href: opts.helpUrl }, text: copy.helpLink });
    if (link.hasAttribute('href')) section.append(h('p', { className: 'wg-live__guide-help' }, link));
  }
  return section;
}
