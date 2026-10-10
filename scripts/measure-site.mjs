// Read-only design baseline measurement of the LIVE site (spec §3.2-§3.5).
//
// - Only GETs public pages while logged out; submits nothing; the only click is on the mobile menu toggle.
// - Reads computed styles (spec §3.4 snippet, extended), custom properties, @font-face rules, media-query
//   breakpoints and logo pixel colours. Nothing is written back to the page DOM.
// - Sequential, with small delays. One pass per page / viewport / browser.
//
// Usage:
//   node scripts/measure-site.mjs                      full run (chromium: all viewports, webkit: 1440x1000 + 390x844)
//   node scripts/measure-site.mjs --pages home,store --viewports 1440x1000 --browsers chromium
//   node scripts/measure-site.mjs --contrast "#111111" "#ffffff"   WCAG contrast ratio of two colours
//
// Output: evidence/design-baseline/<page>-<w>x<h>-<browser>.json plus -first/-mid/-footer/-menu .png

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';

/* global document, getComputedStyle, window, location, innerWidth, innerHeight, devicePixelRatio, createImageBitmap, OffscreenCanvas */

const BASE = 'https://sounds.wgstudiomusic.com';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'evidence', 'design-baseline');

const PAGES = [
  { key: 'home', path: '/' },
  { key: 'biography', path: '/biography/' },
  { key: 'store', path: '/store/' },
  { key: 'my-account', path: '/my-account/' },
  { key: 'contact', path: '/contact/' },
];
const VIEWPORTS = [
  { w: 1440, h: 1000, mobile: false },
  { w: 1280, h: 900, mobile: false },
  { w: 390, h: 844, mobile: true },
  { w: 360, h: 800, mobile: true },
];
const WEBKIT_VIEWPORTS = ['1440x1000', '390x844'];

// ---------------------------------------------------------------------------------------------
// WCAG contrast helper (also usable from the CLI)
// ---------------------------------------------------------------------------------------------
export function parseColor(input) {
  const s = String(input).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  throw new Error(`cannot parse colour: ${input}`);
}
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = luminance(parseColor(a));
  const lb = luminance(parseColor(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------------------------
// Targets (spec §3.4 selectors first, then extended). Each entry: selectors + options.
// ---------------------------------------------------------------------------------------------
const TARGETS = {
  html: { sel: 'html' },
  body: { sel: 'body' },
  header: { sel: '#masthead, header.site-header, [data-elementor-type="header"], header' },
  headerBar: { sel: '.ast-primary-header-bar, .main-header-bar, .elementor-location-header' },
  h1: { sel: 'h1', exclChrome: true },
  h2: { sel: 'h2', exclChrome: true },
  h3: { sel: 'h3', exclChrome: true },
  entryTitle: { sel: '.entry-title, .page-title, .woocommerce-products-header__title', exclChrome: true },
  heading: { sel: '.entry-content h1, .entry-content h2, main h1, main h2' },
  paragraph: { sel: '.entry-content p, main p', exclChrome: true },
  link: { sel: '.entry-content p a, main p a, .elementor-widget-text-editor a, .woocommerce-info a', exclChrome: true },
  primaryNavLink: { sel: '#site-navigation a, header nav a, .main-header-menu a, .elementor-nav-menu a' },
  primaryNavLink2: { sel: '#site-navigation a, header nav a, .main-header-menu a, .elementor-nav-menu a', skip: 1 },
  menuLink: { sel: '#site-navigation a, header nav a' },
  menuToggle: {
    sel: 'button.menu-toggle, .ast-mobile-menu-trigger-minimal, .ast-button-wrap .menu-toggle, .elementor-menu-toggle, button[aria-label*="menu" i], button[aria-controls*="menu" i]',
  },
  button: { sel: '.elementor-button, .woocommerce a.button, main button' },
  wcProductCard: { sel: 'li.product, .products .product' },
  wcProductTitle: { sel: '.woocommerce-loop-product__title' },
  wcPrice: { sel: 'li.product .price, .products .price' },
  wcAddToCart: { sel: 'a.add_to_cart_button, li.product a.button, .products a.button' },
  formInput: {
    sel: 'input[type=text], input[type=email], input[type=password], input[type=tel], textarea, select',
    exclChrome: true,
  },
  formLabel: { sel: 'form label', exclChrome: true },
  formSubmit: { sel: 'form button[type=submit], form input[type=submit], form .button', exclChrome: true },
  content: { sel: '#primary, main, .site-content .ast-container' },
  siteContent: { sel: '#content' },
  astContainer: { sel: '.ast-container' },
  elementorBoxed: {
    sel: '.elementor-section.elementor-section-boxed > .elementor-container, .e-con-boxed > .e-con-inner',
  },
  footer: { sel: '#colophon, footer.site-footer, [data-elementor-type="footer"]' },
  footerLink: { sel: '#colophon a, footer a' },
  footerText: { sel: '#colophon .site-footer-section, #colophon p, footer p' },
};
const HOVER_TARGETS = ['link', 'button', 'primaryNavLink', 'primaryNavLink2', 'wcAddToCart', 'formSubmit', 'footerLink'];

// ---------------------------------------------------------------------------------------------
// In-page measurement (runs in the browser; must be self-contained; reads only)
// ---------------------------------------------------------------------------------------------
async function inPage(opts) {
  const { targets, mode, sampleLogo } = opts;
  const CHROME =
    'header, footer, nav, #masthead, #colophon, [data-elementor-type="header"], [data-elementor-type="footer"], .site-header, .site-footer';

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0;
  };
  const round = (n) => Math.round(n * 100) / 100;
  const describe = (el) =>
    el
      ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
          typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.')
            : ''
        }`
      : null;
  const isTransparent = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\s*\)$/.test(c);
  const effectiveBg = (el) => {
    // nearest ancestor (incl. self) with a non-transparent colour, and nearest with a background image
    const out = { color: null, colorFrom: null, image: null, imageFrom: null };
    for (let cur = el; cur; cur = cur.parentElement) {
      const s = getComputedStyle(cur);
      if (!out.colorFrom && !isTransparent(s.backgroundColor)) {
        out.color = s.backgroundColor;
        out.colorFrom = describe(cur);
      }
      if (!out.imageFrom && s.backgroundImage && s.backgroundImage !== 'none') {
        out.image = s.backgroundImage.slice(0, 220);
        out.imageFrom = describe(cur);
      }
      if (out.colorFrom && out.imageFrom) break;
    }
    return out;
  };
  const styleOf = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: describe(el),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      textTransform: s.textTransform,
      textDecoration: s.textDecorationLine + ' ' + s.textDecorationStyle,
      textAlign: s.textAlign,
      color: s.color,
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage === 'none' ? 'none' : s.backgroundImage.slice(0, 120),
      effectiveBackground: effectiveBg(el),
      padding: s.padding,
      margin: s.margin,
      borderRadius: s.borderRadius,
      border: s.border,
      borderBottom: s.borderBottom,
      borderTop: s.borderTop,
      boxShadow: s.boxShadow,
      outline: s.outline,
      filter: s.filter,
      transition: s.transition,
      display: s.display,
      position: s.position,
      maxWidth: s.maxWidth,
      minHeight: s.minHeight,
      width: Math.round(r.width),
      height: Math.round(r.height),
      left: Math.round(r.left),
      top: Math.round(r.top + window.scrollY),
    };
  };
  const find = (spec) => {
    const all = [...document.querySelectorAll(spec.sel)];
    let skip = spec.skip || 0;
    let idx = -1;
    for (let i = 0; i < all.length; i++) {
      if (visible(all[i]) && (!spec.exclChrome || !all[i].closest(CHROME))) {
        if (skip-- === 0) {
          idx = i;
          break;
        }
      }
    }
    return idx < 0 ? null : { el: all[idx], idx, count: all.length };
  };

  // ---- header block ----------------------------------------------------------------------
  const headerInfo = () => {
    const f = find(targets.header);
    if (!f) return { missing: true };
    const el = f.el;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const chain = [];
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.position !== 'static') {
        chain.push({ el: describe(cur), position: cs.position, top: cs.top, zIndex: cs.zIndex });
      }
    }
    const bar = find(targets.headerBar);
    const logoCandidates = [
      ...document.querySelectorAll(
        'img.custom-logo, .site-logo-img img, .elementor-widget-theme-site-logo img, [data-elementor-type="header"] img, header img, #masthead img',
      ),
    ];
    const logo = logoCandidates.find(visible);
    let logoInfo = { missing: true };
    if (logo) {
      const lr = logo.getBoundingClientRect();
      const ls = getComputedStyle(logo);
      logoInfo = {
        cls: describe(logo),
        src: logo.currentSrc || logo.src,
        alt: logo.alt,
        naturalWidth: logo.naturalWidth,
        naturalHeight: logo.naturalHeight,
        renderedWidth: round(lr.width),
        renderedHeight: round(lr.height),
        widthAttr: logo.getAttribute('width'),
        heightAttr: logo.getAttribute('height'),
        cssMaxWidth: ls.maxWidth,
        cssFilter: ls.filter,
        mixBlendMode: ls.mixBlendMode,
        opacity: ls.opacity,
        objectFit: ls.objectFit,
        gapAboveLogo: round(lr.top - r.top),
        gapBelowLogo: round(r.bottom - lr.bottom),
        gapLeftOfLogo: round(lr.left - r.left),
      };
    }
    return {
      el: describe(el),
      rect: { top: round(r.top), height: round(r.height), width: round(r.width) },
      position: s.position,
      top: s.top,
      zIndex: s.zIndex,
      backgroundColor: s.backgroundColor,
      effectiveBackground: effectiveBg(el),
      backdropFilter: s.backdropFilter,
      boxShadow: s.boxShadow,
      borderBottom: s.borderBottom,
      opacity: s.opacity,
      positionedChain: chain,
      bar: bar ? { ...styleOf(bar.el), rectHeight: round(bar.el.getBoundingClientRect().height) } : null,
      logo: logoInfo,
      scrollY: Math.round(window.scrollY),
    };
  };

  if (mode === 'header') return headerInfo();

  if (mode === 'menu') {
    const f = find(targets.menuToggle);
    const panels = [...document.querySelectorAll('nav, .ast-mobile-header-content, .elementor-nav-menu--dropdown, .main-navigation')]
      .filter(visible)
      .slice(0, 6)
      .map((p) => ({ ...styleOf(p), links: [...p.querySelectorAll('a')].filter(visible).length }));
    const links = [...document.querySelectorAll(targets.menuLink.sel)].filter(visible).slice(0, 3).map(styleOf);
    return {
      toggle: f
        ? { ...styleOf(f.el), ariaExpanded: f.el.getAttribute('aria-expanded'), ariaLabel: f.el.getAttribute('aria-label') }
        : null,
      panels,
      links,
    };
  }

  if (mode === 'focus') {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    return { ...styleOf(a), href: a.getAttribute('href') };
  }

  // ---- full measurement ----------------------------------------------------------------------
  const values = {};
  const locators = {};
  for (const [name, spec] of Object.entries(targets)) {
    const f = find(spec);
    if (!f) {
      values[name] = { missing: true, selector: spec.sel };
      continue;
    }
    values[name] = { selector: spec.sel, matches: f.count, ...styleOf(f.el) };
    locators[name] = { selector: spec.sel, nth: f.idx };
  }

  // page + backgrounds
  const contentEl = (find(targets.content) || {}).el;
  const paraEl = (find(targets.paragraph) || {}).el;
  const backgrounds = {
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    bodyImage: getComputedStyle(document.body).backgroundImage.slice(0, 120),
    contentEffective: contentEl ? effectiveBg(contentEl) : null,
    paragraphEffective: paraEl ? effectiveBg(paraEl) : null,
  };

  // container probes (width/padding/margins of likely containers)
  const containers = {};
  for (const [label, sel] of Object.entries({
    astContainer: '.ast-container',
    siteContent: '#content',
    primary: '#primary',
    main: 'main',
    entryContent: '.entry-content',
    elementorBoxedInner: '.elementor-section-boxed > .elementor-container',
    elementorEConInner: '.e-con-inner',
    elementorEConRoot: '.e-con',
  })) {
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (!el) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    containers[label] = {
      el: describe(el),
      width: round(r.width),
      left: round(r.left),
      maxWidth: s.maxWidth,
      paddingLeft: s.paddingLeft,
      paddingRight: s.paddingRight,
      marginLeft: s.marginLeft,
      marginRight: s.marginRight,
      columnGap: s.columnGap,
      gap: s.gap,
      display: s.display,
    };
  }

  // top-level sections inside the page content
  let root =
    document.querySelector('[data-elementor-type="wp-page"]') ||
    document.querySelector('[data-elementor-type="product-archive"]') ||
    document.querySelector('.entry-content') ||
    document.querySelector('main');
  // descend through single-child wrappers so the real top-level sections are listed
  for (let i = 0; root && i < 3; i++) {
    const vis = [...root.children].filter(visible);
    if (vis.length === 1 && vis[0].children.length > 0) root = vis[0];
    else break;
  }
  const sections = [];
  if (root) {
    const kids = [...root.children].filter(visible).slice(0, 14);
    for (const k of kids) {
      const s = getComputedStyle(k);
      const r = k.getBoundingClientRect();
      const inner = [...k.querySelectorAll(':scope > .elementor-container > .elementor-column, :scope > .e-con-inner > .e-con, :scope > .e-con')].filter(
        visible,
      );
      sections.push({
        el: describe(k),
        top: Math.round(r.top + window.scrollY),
        height: Math.round(r.height),
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        backgroundColor: s.backgroundColor,
        hasBackgroundImage: s.backgroundImage !== 'none',
        minHeight: s.minHeight,
        columns: inner.length,
        columnLefts: [...new Set(inner.map((c) => Math.round(c.getBoundingClientRect().left)))],
        columnWidths: inner.slice(0, 6).map((c) => Math.round(c.getBoundingClientRect().width)),
      });
    }
  }

  // heading -> following block distance
  let headingGap = null;
  const h2 = (find(targets.h2) || {}).el || (find(targets.h1) || {}).el;
  if (h2) {
    const widget = h2.closest('.elementor-widget') || h2;
    const nxt = widget.nextElementSibling;
    const hr = widget.getBoundingClientRect();
    headingGap = {
      heading: describe(h2),
      headingMarginBottom: getComputedStyle(h2).marginBottom,
      widgetMarginBottom: getComputedStyle(widget).marginBottom,
      next: nxt ? describe(nxt) : null,
      gapToNext: nxt ? round(nxt.getBoundingClientRect().top - hr.bottom) : null,
    };
  }

  // images (aspect / crop)
  const imgs = [...document.querySelectorAll('img')]
    .filter((i) => visible(i) && !i.closest(CHROME))
    .slice(0, 8)
    .map((i) => {
      const r = i.getBoundingClientRect();
      const s = getComputedStyle(i);
      return {
        src: (i.currentSrc || i.src).split('/').slice(-2).join('/'),
        natural: `${i.naturalWidth}x${i.naturalHeight}`,
        rendered: `${Math.round(r.width)}x${Math.round(r.height)}`,
        naturalRatio: i.naturalHeight ? round(i.naturalWidth / i.naturalHeight) : null,
        renderedRatio: r.height ? round(r.width / r.height) : null,
        objectFit: s.objectFit,
        objectPosition: s.objectPosition,
        borderRadius: s.borderRadius,
      };
    });

  // navigation / breakpoint evidence
  const navLinks = [...document.querySelectorAll(targets.primaryNavLink.sel)];
  const toggleEl = [...document.querySelectorAll(targets.menuToggle.sel)].find(visible);
  const navigation = {
    visiblePrimaryNavLinks: navLinks.filter(visible).length,
    totalPrimaryNavLinks: navLinks.length,
    menuToggleVisible: !!toggleEl,
    menuToggleCls: toggleEl ? describe(toggleEl) : null,
    menuToggleSize: toggleEl
      ? `${Math.round(toggleEl.getBoundingClientRect().width)}x${Math.round(toggleEl.getBoundingClientRect().height)}`
      : null,
  };
  const documentMetrics = {
    innerWidth,
    innerHeight,
    dpr: devicePixelRatio,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  };

  // custom properties (Elementor / Astra globals) + declared media-query breakpoints + @font-face rules
  const varNames = new Set();
  const presetNames = new Set();
  const mediaCounts = {};
  const fontFaces = [];
  const inaccessibleSheets = [];
  let accessibleSheets = 0;
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.style && rule.style.length !== undefined && rule.type === 1) {
        for (let i = 0; i < rule.style.length; i++) {
          const n = rule.style[i];
          if (/^--(e-global|ast)/.test(n)) varNames.add(n);
          else if (/^--wp--preset--color--/.test(n)) presetNames.add(n);
        }
      }
      if (rule.type === 5) {
        // @font-face
        fontFaces.push({
          family: rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim(),
          weight: rule.style.getPropertyValue('font-weight').trim(),
          style: rule.style.getPropertyValue('font-style').trim(),
          display: rule.style.getPropertyValue('font-display').trim(),
          src: rule.style.getPropertyValue('src').slice(0, 200),
        });
      }
      if (rule.type === 4 && rule.conditionText) {
        const m = rule.conditionText.match(/(min|max)-width:\s*([\d.]+)px/g);
        if (m) for (const x of m) mediaCounts[x.replace(/\s+/g, '')] = (mediaCounts[x.replace(/\s+/g, '')] || 0) + 1;
      }
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules;
      accessibleSheets++;
      walk(rules);
    } catch (e) {
      inaccessibleSheets.push({ href: sheet.href, error: String(e && e.name) });
    }
  }
  const rootCS = getComputedStyle(document.documentElement);
  const bodyCS = getComputedStyle(document.body);
  const customProperties = {};
  for (const n of [...varNames].sort()) {
    customProperties[n] = { root: rootCS.getPropertyValue(n).trim(), body: bodyCS.getPropertyValue(n).trim() };
  }
  const wpPresetColors = {};
  for (const n of [...presetNames].sort()) wpPresetColors[n] = rootCS.getPropertyValue(n).trim();

  // fonts actually loaded + resource origins
  const loadedFonts = [...document.fonts].map((f) => ({
    family: f.family.replace(/["']/g, ''),
    weight: f.weight,
    style: f.style,
    status: f.status,
  }));
  const fontResources = performance
    .getEntriesByType('resource')
    .filter((e) => /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(e.name) || /fonts\.(gstatic|googleapis)\.com/.test(e.name))
    .map((e) => e.name.slice(0, 200));
  const fontLinks = [...document.querySelectorAll('link[href*="fonts.googleapis"], link[href*="fonts.gstatic"]')].map((l) => l.href);

  // body / html classes (theme + builder evidence)
  const bodyClasses = document.body.className.split(/\s+/).filter(Boolean);
  const htmlClasses = document.documentElement.className.split(/\s+/).filter(Boolean);
  const generator = [...document.querySelectorAll('meta[name="generator"]')].map((m) => m.content);
  const themeColor = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content);

  // logo pixel colours (reads image bytes; draws on an off-screen canvas; no DOM change)
  let logoColors = null;
  if (sampleLogo) {
    try {
      const imgs2 = [...document.querySelectorAll('img')];
      const cand =
        imgs2.find((i) => /logo_h/i.test(i.currentSrc || i.src || '')) ||
        imgs2.find((i) => i.closest('header, #masthead') && visible(i));
      if (!cand) logoColors = { error: 'no logo image found on page' };
      else {
        const url = cand.currentSrc || cand.src;
        const blob = await (await fetch(url, { credentials: 'omit' })).blob();
        const bmp = await createImageBitmap(blob);
        const w = Math.min(160, bmp.width);
        const h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
        const cv = new OffscreenCanvas(w, h);
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const buckets = new Map();
        let opaque = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue;
          opaque++;
          const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
          const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          b.n++;
          b.r += data[i];
          b.g += data[i + 1];
          b.b += data[i + 2];
          buckets.set(key, b);
        }
        const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
        const top = [...buckets.values()]
          .sort((a, b) => b.n - a.n)
          .slice(0, 8)
          .map((b) => ({
            hex: '#' + hex(b.r / b.n) + hex(b.g / b.n) + hex(b.b / b.n),
            sharePercentOfOpaque: round((b.n / opaque) * 100),
          }));
        logoColors = {
          src: url,
          pixels: `${bmp.width}x${bmp.height}`,
          sampledAt: `${w}x${h}`,
          opaquePixels: opaque,
          totalPixels: w * h,
          topColors: top,
        };
      }
    } catch (e) {
      logoColors = { error: String(e && e.message) };
    }
  }

  return {
    title: document.title,
    path: location.pathname,
    header: headerInfo(),
    values,
    locators,
    backgrounds,
    containers,
    sections,
    headingGap,
    images: imgs,
    navigation,
    documentMetrics,
    customProperties,
    wpPresetColors,
    cssSheets: { accessible: accessibleSheets, inaccessible: inaccessibleSheets },
    declaredMediaWidths: Object.fromEntries(Object.entries(mediaCounts).sort((a, b) => b[1] - a[1]).slice(0, 24)),
    fontFaceRules: fontFaces.slice(0, 60),
    loadedFonts,
    fontResources: [...new Set(fontResources)].slice(0, 40),
    fontLinks,
    bodyClasses,
    htmlClasses,
    generator,
    themeColor,
    logoColors,
  };
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { pages: null, viewports: null, browsers: ['chromium', 'webkit'] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pages') a.pages = argv[++i].split(',');
    else if (argv[i] === '--viewports') a.viewports = argv[++i].split(',');
    else if (argv[i] === '--browsers') a.browsers = argv[++i].split(',');
  }
  return a;
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function warmScroll(page) {
  // scroll through once so lazy images and Elementor entrance animations are realised, then return to top
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => innerHeight);
  for (let y = 0, n = 0; y < h && n < 40; y += step, n++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

async function styleSubset(locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      color: s.color,
      backgroundColor: s.backgroundColor,
      borderColor: s.borderColor,
      textDecoration: s.textDecorationLine,
      boxShadow: s.boxShadow,
      opacity: s.opacity,
      transform: s.transform,
      transition: s.transition,
    };
  });
}

async function captureOne({ browser, browserName, pageDef, vp, log }) {
  const base = `${pageDef.key}-${vp.w}x${vp.h}-${browserName}`;
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  const result = { meta: {}, errors: [] };
  try {
    const resp = await page.goto(BASE + pageDef.path, { waitUntil: 'load', timeout: 45000 });
    result.meta = {
      url: BASE + pageDef.path,
      finalUrl: page.url(),
      status: resp ? resp.status() : null,
      browser: browserName,
      browserVersion: browserName + ' ' + (browser.version() ?? ''),
      viewport: { width: vp.w, height: vp.h, mobile: vp.mobile },
      userAgent: await page.evaluate(() => navigator.userAgent),
      capturedAt: new Date().toISOString(),
    };
    await settle(page);
    await warmScroll(page);

    const sampleLogo = browserName === 'chromium' && vp.w === 1440 && pageDef.key === 'home';
    result.top = await page.evaluate(inPage, { targets: TARGETS, mode: 'full', sampleLogo });
    await page.screenshot({ path: join(OUT, `${base}-first.png`) });

    // keyboard focus + hover (desktop chromium only)
    if (!vp.mobile && browserName === 'chromium') {
      result.focus = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(150);
        result.focus.push(await page.evaluate(inPage, { targets: TARGETS, mode: 'focus' }));
      }
      await page.evaluate(() => {
        if (document.activeElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      result.hover = {};
      for (const name of HOVER_TARGETS) {
        const loc = result.top.locators?.[name];
        if (!loc) continue;
        const l = page.locator(loc.selector).nth(loc.nth);
        try {
          const before = await styleSubset(l);
          await l.hover({ timeout: 4000 });
          await page.waitForTimeout(450);
          const after = await styleSubset(l);
          result.hover[name] = { before, after };
        } catch (e) {
          result.hover[name] = { error: String(e.message).split('\n')[0] };
        }
      }
      await page.mouse.move(vp.w - 2, vp.h - 2);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    }

    // mid content
    const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, Math.round(maxY / 2)));
    await page.waitForTimeout(800);
    result.headerAfterScroll = await page.evaluate(inPage, { targets: TARGETS, mode: 'header' });
    await page.screenshot({ path: join(OUT, `${base}-mid.png`) });

    // footer
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${base}-footer.png`) });

    // mobile / collapsed menu: click ONLY the menu toggle
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const tg = result.top.locators?.menuToggle;
    if (tg && result.top.navigation?.menuToggleVisible) {
      const t = page.locator(tg.selector).nth(tg.nth);
      try {
        await t.click({ timeout: 4000 });
        await page.waitForTimeout(900);
        result.menuOpen = await page.evaluate(inPage, { targets: TARGETS, mode: 'menu' });
        await page.screenshot({ path: join(OUT, `${base}-menu.png`) });
      } catch (e) {
        result.errors.push('menu toggle: ' + String(e.message).split('\n')[0]);
      }
    } else {
      result.menuOpen = { note: 'no visible menu toggle at this viewport' };
    }
  } catch (e) {
    result.errors.push(String(e && e.message).split('\n')[0]);
  } finally {
    await writeFile(join(OUT, `${base}.json`), JSON.stringify(result, null, 2) + '\n');
    await ctx.close();
  }
  log(`${base}: status=${result.meta.status ?? 'n/a'} errors=${result.errors.length}`);
  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--contrast') {
    console.log(contrast(argv[1], argv[2]).toFixed(2));
    return;
  }
  const args = parseArgs(argv);
  await mkdir(OUT, { recursive: true });
  const log = (m) => console.log(m);

  // reachability: one GET of the home page; stop gracefully if unreachable
  try {
    const r = await fetch(BASE + '/', { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    log(`reachability: HTTP ${r.status}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    const note = { reachable: false, error: String(e && e.message), at: new Date().toISOString() };
    await writeFile(join(OUT, '_unreachable.json'), JSON.stringify(note, null, 2) + '\n');
    log('site unreachable, recorded evidence/design-baseline/_unreachable.json; stopping.');
    return;
  }

  const pages = PAGES.filter((p) => !args.pages || args.pages.includes(p.key));
  const types = { chromium, webkit };
  const summary = [];
  for (const browserName of args.browsers) {
    const browserType = types[browserName];
    if (!browserType) continue;
    let browser;
    try {
      browser = await browserType.launch();
    } catch (e) {
      log(`cannot launch ${browserName}: ${String(e.message).split('\n')[0]}`);
      summary.push({ browser: browserName, launchError: String(e.message).split('\n')[0] });
      continue;
    }
    for (const vp of VIEWPORTS) {
      const id = `${vp.w}x${vp.h}`;
      if (args.viewports && !args.viewports.includes(id)) continue;
      if (browserName === 'webkit' && !args.viewports && !WEBKIT_VIEWPORTS.includes(id)) continue;
      for (const pageDef of pages) {
        const res = await captureOne({ browser, browserName, pageDef, vp, log });
        summary.push({ page: pageDef.key, viewport: id, browser: browserName, status: res.meta.status ?? null, errors: res.errors });
        await sleep(2000);
      }
    }
    await browser.close();
  }
  // append to the run log (later runs of the same page/viewport/browser supersede the earlier files)
  let runLog = [];
  try {
    runLog = JSON.parse(await readFile(join(OUT, '_run-log.json'), 'utf8'));
  } catch {
    /* first run */
  }
  runLog.push({ at: new Date().toISOString(), args: process.argv.slice(2), results: summary });
  await writeFile(join(OUT, '_run-log.json'), JSON.stringify(runLog, null, 2) + '\n');
  log('done');
}

if (process.argv[1]?.endsWith('measure-site.mjs')) await main();
