/**
 * Computed-style probes for the CSS isolation specs (dev harness and built bundle).
 * The stress pages wear the hostile global rules of dev/stress.css; every probe asserts that
 * none of them reaches an element inside `.wg-live`.
 */
import type { Page } from '@playwright/test';

interface Offender {
  where: string;
  what: string;
}

/** Computed-style probes run inside the page for one `.wg-live` subtree. */
export async function inspectPlugin(page: Page): Promise<Offender[]> {
  return page.evaluate(() => {
    const out: Array<{ where: string; what: string }> = [];
    const root = document.querySelector('.wg-live');
    if (!root) throw new Error('no .wg-live');
    const label = (el: Element): string => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 2).join('.')}`;
    const fontPx = (el: Element): number => parseFloat(getComputedStyle(el).fontSize);

    for (const el of Array.from(root.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const w = label(el);

      // `* { box-sizing: content-box }`
      if (cs.boxSizing !== 'border-box') out.push({ where: w, what: `box-sizing ${cs.boxSizing}` });

      // Headings: colour #8c9eff, uppercase, 0.18em tracking, monospace, weight 900, margin 1.4em.
      if (/^h[1-6]$/.test(tag)) {
        if (cs.textTransform !== 'none') out.push({ where: w, what: `heading text-transform ${cs.textTransform}` });
        if (cs.letterSpacing !== 'normal' && parseFloat(cs.letterSpacing) !== 0) out.push({ where: w, what: `heading letter-spacing ${cs.letterSpacing}` });
        if (/courier|monospace/i.test(cs.fontFamily)) out.push({ where: w, what: `heading font ${cs.fontFamily}` });
        if (cs.color === 'rgb(140, 158, 255)') out.push({ where: w, what: 'heading colour from the theme' });
        if (parseFloat(cs.marginTop) >= fontPx(el) * 1.3) out.push({ where: w, what: `heading margin-top ${cs.marginTop}` });
        if (cs.fontWeight === '900') out.push({ where: w, what: 'heading weight 900 from the theme' });
      }

      // p: justified, margin-bottom 1.6em.
      if (tag === 'p') {
        if (cs.textAlign === 'justify') out.push({ where: w, what: 'p text-align justify' });
        if (parseFloat(cs.marginBottom) >= fontPx(el) * 1.5) out.push({ where: w, what: `p margin-bottom ${cs.marginBottom}` });
      }

      // a: colour #c2185b, wavy underline.
      if (tag === 'a') {
        if (cs.textDecorationStyle === 'wavy') out.push({ where: w, what: 'link wavy underline' });
        if (cs.color === 'rgb(194, 24, 91)') out.push({ where: w, what: 'link colour from the theme' });
      }

      // ul/ol padding-left 3em, li margin .6em.
      if (tag === 'ul' || tag === 'ol') {
        if (parseFloat(cs.paddingLeft) >= fontPx(el) * 2.5) out.push({ where: w, what: `list padding-left ${cs.paddingLeft}` });
      }
      if (tag === 'li' && parseFloat(cs.marginTop) >= fontPx(el) * 0.5) out.push({ where: w, what: `li margin-top ${cs.marginTop}` });

      // img/svg: 4px dashed magenta border.
      if (tag === 'img' || tag === 'svg') {
        if (parseFloat(cs.borderTopWidth) > 0) out.push({ where: w, what: `${tag} border ${cs.borderTopWidth} ${cs.borderTopStyle}` });
      }

      // audio/video: 6px green border.
      if (tag === 'audio' || tag === 'video') {
        if (parseFloat(cs.borderTopWidth) > 0) out.push({ where: w, what: `${tag} border ${cs.borderTopWidth}` });
      }

      // th/td: 18px padding and dotted borders; table: separate borders with 8px spacing.
      if (tag === 'th' || tag === 'td') {
        if (cs.borderTopStyle === 'dotted' || parseFloat(cs.paddingTop) === 18) out.push({ where: w, what: `${tag} theme padding/border` });
      }
      if (tag === 'table' && cs.borderSpacing === '8px 8px') out.push({ where: w, what: 'table border-spacing 8px' });

      // buttons: red, Impact, 22px, uppercase, crosshair, 4px black border, 20px 44px padding.
      if (tag === 'button' || el.classList.contains('wg-live__btn')) {
        if (cs.backgroundColor === 'rgb(224, 0, 0)') out.push({ where: w, what: 'button red background from the theme' });
        if (/impact/i.test(cs.fontFamily)) out.push({ where: w, what: `button font ${cs.fontFamily}` });
        if (cs.fontSize === '22px') out.push({ where: w, what: 'button font-size 22px from the theme' });
        if (cs.textTransform === 'uppercase') out.push({ where: w, what: 'button uppercase' });
        if (cs.cursor === 'crosshair') out.push({ where: w, what: 'button crosshair cursor' });
        if (cs.borderTopWidth === '4px' && cs.borderTopColor === 'rgb(0, 0, 0)') out.push({ where: w, what: 'button 4px black border' });
        if (cs.paddingTop === '20px' && cs.paddingLeft === '44px') out.push({ where: w, what: 'button 20px 44px padding' });
      }
    }

    // The root itself: body typography does not leak in.
    const rs = getComputedStyle(root);
    if (/georgia|times/i.test(rs.fontFamily)) out.push({ where: 'root', what: `font ${rs.fontFamily}` });
    if (rs.textAlign === 'justify') out.push({ where: 'root', what: 'justified' });
    if (parseFloat(rs.lineHeight) >= parseFloat(rs.fontSize) * 1.85) out.push({ where: 'root', what: `line-height ${rs.lineHeight}` });
    // --wg-font-size-body is a measured px value (17px), so the page's 18px html size must not scale it.
    if (rs.fontSize !== '17px') out.push({ where: 'root', what: `font-size ${rs.fontSize} (html is 18px on this page)` });
    return out;
  });
}


export interface ScopeReport {
  unscoped: string[];
  badNames: string[];
  ruleCount: number;
  sheets: number;
}

/**
 * Walk the plugin's loaded stylesheets (Vite dev <style data-vite-dev-id=".../src/styles/..."> or the
 * built wg-live*.css links) and report every selector whose first compound is not scoped to
 * `.wg-live` / `.wg-live-featured`, plus unprefixed @keyframes names and any @font-face.
 */
export async function scanScopedRules(page: Page, kind: 'dev' | 'dist'): Promise<ScopeReport> {
  return page.evaluate((kind) => {
    const unscoped: string[] = [];
    const badNames: string[] = [];
    let ruleCount = 0;
    const isOurs = (sheet: CSSStyleSheet): boolean => {
      const owner = sheet.ownerNode as HTMLElement | null;
      if (kind === 'dist') return /\/dist\/wg-live(-featured)?\.css/.test(sheet.href ?? '');
      const id = owner?.getAttribute?.('data-vite-dev-id') ?? '';
      return id.includes('/src/styles/');
    };
    /** Split a selector list on top-level commas (not inside :where(...) / :is(...) / [attr]). */
    const splitTop = (text: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const ch of text) {
        if (ch === '(' || ch === '[') depth += 1;
        if (ch === ')' || ch === ']') depth -= 1;
        if (ch === ',' && depth === 0) {
          parts.push(current.trim());
          current = '';
        } else current += ch;
      }
      if (current.trim() !== '') parts.push(current.trim());
      return parts;
    };
    /** First compound selector: everything up to the first top-level whitespace or combinator. */
    const firstCompound = (selector: string): string => {
      let depth = 0;
      let out = '';
      for (const ch of selector) {
        if (ch === '(' || ch === '[') depth += 1;
        if (ch === ')' || ch === ']') depth -= 1;
        if (depth === 0 && /[\s>+~]/.test(ch)) break;
        out += ch;
      }
      return out;
    };
    const walk = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        ruleCount += 1;
        if (rule instanceof CSSStyleRule) {
          for (const part of splitTop(rule.selectorText)) {
            if (!/\.wg-live(-featured)?(__[a-z0-9_-]+|--[a-z0-9_-]+)?(?![a-z0-9_-])/.test(firstCompound(part))) unscoped.push(part);
          }
        } else if (rule instanceof CSSKeyframesRule) {
          if (!rule.name.startsWith('wg-live-')) badNames.push(`@keyframes ${rule.name}`);
        } else if (rule instanceof CSSFontFaceRule) {
          badNames.push('@font-face');
        } else if ('cssRules' in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    let sheets = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      if (!isOurs(sheet)) continue;
      sheets += 1;
      walk(sheet.cssRules);
    }
    return { unscoped, badNames, ruleCount, sheets };
  }, kind);
}
