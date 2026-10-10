/**
 * Tiny DOM toolkit (M1-PLAN D12).
 *
 * Components build their DOM with h() and textContent only. Nothing here ever
 * produces markup from a string, event handler attributes are rejected, and every
 * URL-bearing attribute goes through safeUrl().
 */

export type Child = Node | string | null | undefined | false;

const URL_ATTRS = new Set(['href', 'src', 'poster', 'action', 'formaction', 'cite', 'data', 'xlink:href']);
const BLOCKED_ATTRS = new Set(['srcdoc']);
const ATTR_NAME_RE = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;
const SPECIAL_PROPS = new Set(['className', 'attrs', 'dataset', 'text']);

/**
 * Returns an absolute http(s)/mailto URL, or null. Relative URLs are resolved against
 * location.origin (a pure "#fragment" stays as it is). Everything else (javascript:,
 * data:, vbscript:, blob:, file:, URLs with credentials, control characters) is rejected.
 */
export function safeUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v === '') return null;
  // Browsers silently drop tab/newline inside URLs ("java\nscript:"); refuse anything with control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  if (v.startsWith('#')) return v;
  let base: string;
  try {
    base = window.location.origin;
    if (!base || base === 'null') base = window.location.href;
  } catch {
    base = 'https://wg-live.invalid/';
  }
  let url: URL;
  try {
    url = new URL(v, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}

/** Sanitizes a srcset value: every candidate URL must pass safeUrl(), invalid candidates are dropped. */
function safeSrcset(value: string): string | null {
  // Follows the HTML parsing rule: a candidate URL is a run of non-whitespace characters, so
  // commas inside a URL (data: URIs) don't split it; the descriptor runs up to the next comma.
  const parts: string[] = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(value.charAt(i))) i++;
    if (i >= n) break;
    let start = i;
    while (i < n && !/\s/.test(value.charAt(i))) i++;
    let url = value.slice(start, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      start = i;
      while (i < n && value.charAt(i) !== ',') i++;
      descriptor = value.slice(start, i).trim();
    }
    const safe = safeUrl(url);
    if (safe) parts.push(descriptor ? `${safe} ${descriptor}` : safe);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function setAttr(el: Element, name: string, value: unknown): void {
  if (value === null || value === undefined || value === false) return;
  if (/^on/i.test(name)) {
    throw new TypeError(`h(): event handler attribute "${name}" is not allowed (use addEventListener)`);
  }
  const lower = name.toLowerCase();
  if (BLOCKED_ATTRS.has(lower)) {
    throw new TypeError(`h(): attribute "${name}" is not allowed`);
  }
  if (!ATTR_NAME_RE.test(name)) {
    throw new TypeError(`h(): invalid attribute name "${name}"`);
  }
  const raw = value === true ? '' : String(value);
  if (URL_ATTRS.has(lower)) {
    const safe = safeUrl(raw);
    if (safe !== null) el.setAttribute(name, safe);
    return;
  }
  if (lower === 'srcset') {
    const safe = safeSrcset(raw);
    if (safe !== null) el.setAttribute(name, safe);
    return;
  }
  el.setAttribute(name, raw);
}

/**
 * Create an element.
 *
 * props: `className`, `text` (textContent), `attrs` and `dataset` objects. Any other
 * key is treated as an attribute (`{ type: 'button', id: 'x' }`). `true` makes a boolean
 * attribute, `false`/null/undefined omit it. `on*` props throw.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'className') {
        if (typeof value === 'string' && value !== '') el.className = value;
      } else if (key === 'text') {
        if (value !== null && value !== undefined && value !== false) el.textContent = String(value);
      } else if (key === 'attrs') {
        if (value && typeof value === 'object') {
          for (const [name, v] of Object.entries(value as Record<string, unknown>)) setAttr(el, name, v);
        }
      } else if (key === 'dataset') {
        if (value && typeof value === 'object') {
          for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
            if (v !== null && v !== undefined && v !== false) el.dataset[name] = v === true ? '' : String(v);
          }
        }
      } else if (!SPECIAL_PROPS.has(key)) {
        setAttr(el, key, value);
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

let uidCounter = 0;

/** Page-unique id for aria-labelledby / aria-describedby wiring. */
export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

/** Programmatically focusable: enabled, not hidden/inert, and (where the browser can tell) rendered. */
export function isFocusable(el: Element | null): boolean {
  if (!el || !el.isConnected) return false;
  if (!el.matches(FOCUSABLE_SELECTOR)) return false;
  if (el.matches(':disabled')) return false;
  if (el.closest('[hidden], [inert]')) return false;
  const maybe = el as Element & { checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean };
  if (typeof maybe.checkVisibility === 'function') {
    try {
      return maybe.checkVisibility({ checkVisibilityCSS: true });
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * Focus the first focusable descendant of `el`, or `el` itself when it has none and is
 * focusable (for example a heading with tabindex="-1"). Returns true when focus moved.
 */
export function focusFirst(el: Element | null): boolean {
  if (!el) return false;
  const candidates = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const target = candidates.find((c) => isFocusable(c)) ?? (isFocusable(el) ? (el as HTMLElement) : null);
  if (!target) return false;
  target.focus();
  return document.activeElement === target;
}
