// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCss, isScopedSelector } from '../../scripts/check-css-scope.mjs';

const messages = (css: string) => checkCss(css, 't.css').map((v) => `${v.line}: ${v.message}`);

describe('check-css-scope: selectors', () => {
  it('accepts scoped selectors, BEM names and selector lists', () => {
    const css = `
      .wg-live { color: inherit; }
      .wg-live__card:hover, .wg-live--dark .wg-live__card { color: red; }
      .wg-live-featured .title { margin: 0; }
      .wg-live-featured__title { margin: 0; }
      .wg-live--player .wg-live__stage > audio { display: block; }
      .wg-live *, .wg-live *::before { box-sizing: border-box; }
      .wg-live__a + .wg-live__b, .wg-live__a ~ .wg-live__b { margin: 0; }
      .wg-live__x::after { content: "} body { x: 1 } /* not a comment"; }
      .wg-live__y { background: url(data:image/svg+xml;utf8,<svg>{}</svg>); }
      /* body { color: red; } */
    `;
    expect(checkCss(css, 'a.css')).toEqual([]);
  });

  it('rejects :root, html, body, * and bare elements with file:line', () => {
    const css = [':root { --a: 1; }', 'html { x: 1; }', 'body { x: 1; }', '* { x: 1; }', 'button { x: 1; }'].join('\n');
    const v = checkCss(css, 'bad.css');
    expect(v.map((x) => x.line)).toEqual([1, 2, 3, 4, 5]);
    expect(v.every((x) => x.file === 'bad.css')).toBe(true);
    expect(v[0]?.message).toContain('":root" is not allowed');
    expect(v[3]?.message).toContain('bare "*"');
  });

  it('rejects one unscoped selector inside a selector list, with its own line', () => {
    const v = checkCss('.wg-live__a,\nh1 { x: 1; }', 'list.css');
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
    expect(v[0]?.message).toContain('"h1"');
  });

  it('matches whole class tokens only (no lookalike prefixes, no attribute tricks)', () => {
    expect(isScopedSelector('.wg-live')).toBe(true);
    expect(isScopedSelector('.wg-live-featured')).toBe(true);
    expect(isScopedSelector('.wg-live__x')).toBe(true);
    expect(isScopedSelector('.wg-live--x .y')).toBe(true);
    expect(isScopedSelector('.wg-livefoo')).toBe(false);
    expect(isScopedSelector('.wg-live-foo')).toBe(false);
    expect(isScopedSelector('.wg-live_x')).toBe(false);
    expect(isScopedSelector('.other .wg-live')).toBe(false);
    expect(isScopedSelector('[class*="wg-live"]')).toBe(false);
    expect(isScopedSelector('div.wg-live')).toBe(true); // the first compound contains the class
    expect(isScopedSelector('#wg-live')).toBe(false);
    expect(isScopedSelector('body .wg-live')).toBe(false);
    expect(isScopedSelector('.wg-live body')).toBe(false);
    expect(isScopedSelector('.wg-live :root')).toBe(false);
  });

  it('only the first compound counts for the scope, even in complex selectors', () => {
    const v = messages('.x .wg-live__a { y: 1 }\n.wg-live__a .x { y: 1 }');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/^1: .*first compound/);
  });

  it('rejects sibling combinators directly after the root scope compound', () => {
    const css = [
      '.wg-live + p { x: 1 }',
      '.wg-live ~ .entry { x: 1 }',
      '.wg-live-featured + div { x: 1 }',
      '.wg-live--player ~ p { x: 1 }',
      '.wg-live:hover + p { x: 1 }',
    ].join('\n');
    const v = messages(css);
    expect(v).toHaveLength(5);
    expect(v.every((m) => m.includes('sibling combinator'))).toBe(true);
    // Child combinators after the root, and siblings between elements, are fine.
    expect(checkCss('.wg-live > .wg-live__a { x: 1 }\n.wg-live .wg-live__a + .wg-live__b { x: 1 }')).toEqual([]);
  });

  it('accepts :is()/:where() as a scope carrier only when every argument is scoped', () => {
    expect(isScopedSelector(':where(.wg-live, .wg-live-featured) a')).toBe(true);
    expect(isScopedSelector(':where(.wg-live, .other) a')).toBe(false);
    expect(isScopedSelector(':where(.wg-live) + p')).toBe(false);
    expect(isScopedSelector(':not(.wg-live) a')).toBe(false);
  });

  it('reports a parse error instead of throwing', () => {
    const v = checkCss('.wg-live { color: red;', 'broken.css');
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('CSS parse error');
  });
});

describe('check-css-scope: at-rules', () => {
  it('checks inside @media, @supports, @container, @layer and @starting-style with correct lines', () => {
    const css = [
      '@layer wg-live-base {',
      '  .wg-live a { x: 1; }',
      '  p { x: 1; }',
      '}',
      '@media (min-width: 600px) {',
      '  @supports (display: grid) {',
      '    @container (width > 400px) {',
      '      body { x: 1; }',
      '    }',
      '  }',
      '}',
      '@starting-style { div { x: 1 } }',
    ].join('\n');
    const v = checkCss(css, 'nest.css');
    expect(v.map((x) => x.line)).toEqual([3, 8, 12]);
  });

  it('requires the wg-live- prefix on @keyframes, @property, @counter-style, @layer and @container names', () => {
    const bad = [
      '@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }',
      '@-webkit-keyframes pulse { 0% { opacity: 0 } 100% { opacity: 1 } }',
      '@property --accent { syntax: "<color>"; inherits: true; initial-value: red; }',
      '@counter-style thumbs { system: cyclic; symbols: "x"; suffix: " "; }',
      '@layer base { .wg-live { x: 1 } }',
      '@layer reset, theme;',
      '@container card (min-width: 400px) { .wg-live__a { x: 1 } }',
    ].join('\n');
    const v = checkCss(bad, 'names.css');
    expect(v.map((x) => x.line)).toEqual([1, 2, 3, 4, 5, 6, 6, 7]);
    expect(v.every((x) => x.message.includes('wg-live-'))).toBe(true);
  });

  it('accepts correctly prefixed names and unnamed container queries', () => {
    const good = [
      '@layer wg-live-a, wg-live-b;',
      '@keyframes wg-live-pulse { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }',
      '@-webkit-keyframes wg-live-pulse { 0% { opacity: 0; } 100% { opacity: 1; } }',
      '@property --wg-live-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }',
      '@counter-style wg-live-dots { system: cyclic; symbols: "x"; suffix: " "; }',
      '@container (width > 400px) { .wg-live__a { x: 1 } }',
      '@container not (width > 400px) { .wg-live__a { x: 1 } }',
      '@container wg-live-card (min-width: 400px) { .wg-live__a { x: 1 } }',
      '@container style(--x: 1) { .wg-live__a { x: 1 } }',
      '.wg-live__x { animation: wg-live-pulse 1s; }',
    ].join('\n');
    expect(checkCss(good)).toEqual([]);
  });

  it('bans @font-face, @import, @namespace and @page; other at-rules fail too', () => {
    const v = checkCss(
      [
        '@charset "UTF-8";',
        '@import url(x.css);',
        '@font-face { font-family: X; src: url(x.woff2); }',
        '@namespace svg url(http://www.w3.org/2000/svg);',
        '@page { margin: 0 }',
        '@scope (.wg-live) { a { x: 1 } }',
      ].join('\n'),
      'font.css',
    );
    expect(v.map((x) => x.line)).toEqual([2, 3, 4, 5, 6]);
    expect(v[0]?.message).toContain('@import');
    expect(v[1]?.message).toContain('@font-face');
  });

  it('rejects CSS nesting (the sources are plain CSS)', () => {
    const css = '.wg-live__card {\n  color: red;\n  &:hover { color: blue; }\n  @media (min-width: 600px) { padding: 1px; }\n}';
    const v = checkCss(css, 'n.css');
    expect(v.map((x) => x.line)).toEqual([3, 4]);
    expect(v[0]?.message).toContain('nesting');
  });

  it('flags an unscoped parent and its nested rule', () => {
    const v = checkCss('body {\n  &:hover { color: blue; }\n}', 'n.css');
    expect(v.map((x) => x.line).sort()).toEqual([1, 2]);
  });
});
