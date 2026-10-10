import { EVENT_SLUG_MAX_LENGTH, EVENT_SLUG_PATTERN } from '../types';
import type { ListeningMode } from '../types';
import { safeUrl } from '../dom';

/** The one event 代稱 pattern (plan D14), identical to WG_Live\Events::SLUG_PATTERN. */
export const EVENT_SLUG_RE = new RegExp(EVENT_SLUG_PATTERN);

/** Strict slug check: a string, 1-100 characters, matching the shared pattern. */
export function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 1 && s.length <= EVENT_SLUG_MAX_LENGTH && EVENT_SLUG_RE.test(s);
}

function singleParam(search: string, name: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const all = params.getAll(name);
  // Repeated parameters are ambiguous: refuse them instead of picking one.
  return all.length === 1 ? (all[0] ?? null) : null;
}

/** `?wg_event=<slug>` -> the slug, or null when absent, repeated, Chinese, percent-encoded junk, etc. */
export function readEventParam(search: string): string | null {
  const value = singleParam(search, 'wg_event');
  return isValidSlug(value) ? value : null;
}

/** `?wg_mode=binaural|atmos` -> the mode when it is one of `allowed`, else null (plan F12). */
export function readModeParam(search: string, allowed: readonly ListeningMode[]): ListeningMode | null {
  const value = singleParam(search, 'wg_mode');
  if (value === null) return null;
  return (allowed as readonly string[]).includes(value) ? (value as ListeningMode) : null;
}

function encodeQuery(params: Record<string, string | number>): string[] {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
}

/**
 * Build a REST request URL from BootConfig.rest.root. Handles both forms WordPress emits:
 *   pretty: https://x/wp-json/wg-live/v1/        + events -> https://x/wp-json/wg-live/v1/events
 *   plain:  https://x/index.php?rest_route=/wg-live/v1/ + events
 *           -> https://x/index.php?rest_route=/wg-live/v1/events
 * Extra params are appended with the right separator ("?" or "&"). Never concatenate by hand.
 */
export function restUrl(root: string, path: string, params: Record<string, string | number> = {}): string {
  const cleanPath = path
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const hashAt = root.indexOf('#');
  const noHash = hashAt >= 0 ? root.slice(0, hashAt) : root;
  const queryAt = noHash.indexOf('?');
  const base = queryAt >= 0 ? noHash.slice(0, queryAt) : noHash;
  const pairs = (queryAt >= 0 ? noHash.slice(queryAt + 1) : '').split('&').filter(Boolean);

  const routeIndex = pairs.findIndex((p) => p.startsWith('rest_route='));
  let urlBase: string;
  if (routeIndex >= 0) {
    const raw = (pairs[routeIndex] ?? '').slice('rest_route='.length);
    const encodedSlashes = /%2f/i.test(raw);
    const sep = encodedSlashes ? '%2F' : '/';
    const withSlash = /(\/|%2f)$/i.test(raw) ? raw : raw + sep;
    pairs[routeIndex] = `rest_route=${withSlash}${encodedSlashes ? cleanPath.replace(/\//g, '%2F') : cleanPath}`;
    urlBase = base;
  } else {
    urlBase = (base.endsWith('/') ? base : `${base}/`) + cleanPath;
  }

  const query = [...pairs, ...encodeQuery(params)];
  return query.length > 0 ? `${urlBase}?${query.join('&')}` : urlBase;
}

/**
 * Player link for an event: `<playerLink>?wg_event=<slug>[&wg_mode=<mode>]`. Existing query
 * parameters of the link (for example `page_id` on plain permalinks) are preserved.
 * Returns null when the page link is missing/unsafe or the slug is invalid.
 */
export function playerHref(playerLink: string | null, slug: string, mode?: ListeningMode | null): string | null {
  if (!playerLink || !isValidSlug(slug)) return null;
  if (safeUrl(playerLink) === null) return null;

  const hashAt = playerLink.indexOf('#');
  const hash = hashAt >= 0 ? playerLink.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? playerLink.slice(0, hashAt) : playerLink;
  const queryAt = noHash.indexOf('?');
  const base = queryAt >= 0 ? noHash.slice(0, queryAt) : noHash;
  const params = new URLSearchParams(queryAt >= 0 ? noHash.slice(queryAt + 1) : '');
  params.set('wg_event', slug);
  if (mode === 'binaural' || mode === 'atmos') params.set('wg_mode', mode);
  else params.delete('wg_mode');
  return `${base}?${params.toString()}${hash}`;
}
