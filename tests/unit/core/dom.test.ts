import { afterEach, describe, expect, it } from 'vitest';
import { focusFirst, h, isFocusable, safeUrl, uid } from '../../../src/dom';

afterEach(() => {
  document.body.replaceChildren();
});

describe('safeUrl', () => {
  it('allows http, https and mailto', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
    expect(safeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
  });

  it('resolves relative URLs on location.origin', () => {
    expect(safeUrl('/live/help/')).toBe(`${window.location.origin}/live/help/`);
    expect(safeUrl('?wg_event=a')).toBe(`${window.location.origin}/?wg_event=a`);
  });

  it('keeps a pure fragment as it is', () => {
    expect(safeUrl('#section')).toBe('#section');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/abc',
    'file:///etc/passwd',
    'https://user:pass@example.com/',
    '',
    '   ',
  ])('rejects %j', (value) => {
    expect(safeUrl(value)).toBeNull();
  });

  it('rejects null, undefined and non-strings', () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl(42 as unknown as string)).toBeNull();
  });
});

describe('h()', () => {
  it('creates elements with className, text, attrs, dataset and children', () => {
    const el = h(
      'div',
      { className: 'a b', text: 'hi', attrs: { 'aria-label': 'x', hidden: true, title: null }, dataset: { fooBar: 1 } },
      h('span', { text: 'child' }),
      'tail',
      null,
      undefined,
      false,
    );
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('a b');
    expect(el.getAttribute('aria-label')).toBe('x');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.dataset.fooBar).toBe('1');
    expect(el.textContent).toBe('hichildtail');
  });

  it('treats unknown top-level props as attributes', () => {
    const btn = h('button', { type: 'button', id: 'go', disabled: true, 'aria-disabled': false });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.id).toBe('go');
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
  });

  it('never turns text into markup', () => {
    const el = h('p', { text: '<img src=x onerror=alert(1)>' }, '<b>bold</b>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror=alert(1)><b>bold</b>');
  });

  it('rejects on* props, top level and in attrs, in any case', () => {
    expect(() => h('button', { onclick: 'alert(1)' })).toThrow(/event handler/);
    expect(() => h('button', { onClick: () => undefined })).toThrow(/event handler/);
    expect(() => h('button', { attrs: { onmouseover: 'x' } })).toThrow(/event handler/);
    expect(() => h('img', { attrs: { ONERROR: 'x' } })).toThrow(/event handler/);
  });

  it('rejects srcdoc and invalid attribute names', () => {
    expect(() => h('iframe', { srcdoc: '<p>x</p>' })).toThrow();
    expect(() => h('div', { attrs: { 'a b': 'x' } })).toThrow(/invalid attribute name/);
    expect(() => h('div', { attrs: { '"><script>': 'x' } })).toThrow();
  });

  it('filters href, src, poster and action through safeUrl', () => {
    const a = h('a', { href: 'javascript:alert(1)' });
    expect(a.hasAttribute('href')).toBe(false);
    const ok = h('a', { attrs: { href: 'https://example.com/x' } });
    expect(ok.getAttribute('href')).toBe('https://example.com/x');
    const rel = h('a', { href: '/live/' });
    expect(rel.getAttribute('href')).toBe(`${window.location.origin}/live/`);
    expect(h('img', { src: 'data:image/svg+xml,<svg onload=alert(1)>' }).hasAttribute('src')).toBe(false);
    expect(h('video', { poster: 'javascript:1' }).hasAttribute('poster')).toBe(false);
    expect(h('form', { action: 'javascript:1' }).hasAttribute('action')).toBe(false);
  });

  it('sanitizes srcset candidate by candidate', () => {
    const img = h('img', { srcset: 'javascript:x 1x, https://example.com/a.jpg 2x, data:image/png;base64,AAA 3x' });
    expect(img.getAttribute('srcset')).toBe('https://example.com/a.jpg 2x');
    expect(h('img', { srcset: 'javascript:x 1x' }).hasAttribute('srcset')).toBe(false);
  });
});

describe('uid', () => {
  it('returns unique prefixed ids', () => {
    const a = uid('wg');
    const b = uid('wg');
    expect(a).toMatch(/^wg-\d+$/);
    expect(a).not.toBe(b);
  });
});

describe('focus helpers', () => {
  it('isFocusable accepts enabled controls and tabindex=-1, rejects disabled, hidden and detached', () => {
    const wrap = h(
      'div',
      null,
      h('button', { id: 'ok' }),
      h('button', { id: 'off', disabled: true }),
      h('h2', { id: 'h', tabindex: -1 }),
      h('div', { id: 'plain' }),
    );
    const hiddenWrap = h('div', { hidden: true }, h('button', { id: 'inHidden' }));
    document.body.append(wrap, hiddenWrap);
    expect(isFocusable(wrap.querySelector('#ok'))).toBe(true);
    expect(isFocusable(wrap.querySelector('#off'))).toBe(false);
    expect(isFocusable(wrap.querySelector('#h'))).toBe(true);
    expect(isFocusable(wrap.querySelector('#plain'))).toBe(false);
    expect(isFocusable(hiddenWrap.querySelector('#inHidden'))).toBe(false);
    expect(isFocusable(h('button'))).toBe(false); // detached
    expect(isFocusable(null)).toBe(false);
  });

  it('focusFirst focuses the first focusable descendant, or the element itself', () => {
    const box = h(
      'div',
      null,
      h('span', { text: 'x' }),
      h('button', { id: 'a', disabled: true }),
      h('button', { id: 'b' }),
      h('button', { id: 'c' }),
    );
    const heading = h('h2', { tabindex: -1, text: 'title' });
    const empty = h('div');
    document.body.append(box, heading, empty);
    expect(focusFirst(box)).toBe(true);
    expect(document.activeElement?.id).toBe('b');
    expect(focusFirst(heading)).toBe(true);
    expect(document.activeElement).toBe(heading);
    expect(focusFirst(empty)).toBe(false);
    expect(focusFirst(null)).toBe(false);
  });
});
