#!/usr/bin/env node
// Zero-dependency static server for the BUILT plugin assets (M1-PLAN D11, the `harness-dist`
// Playwright project).
//
// It serves dev/dist/*.html, which load plugin/wg-live/assets/dist/{wg-live.css, wg-live.js,
// wg-live-featured.css} exactly the way WordPress enqueues them: <link rel="stylesheet"> and
// <script defer>, versioned with the content hash (?ver=) from build-info.json. The file names come
// from build-info.json; nothing is bundled or transformed here. The mock REST and the /demo/* files
// are the same as in the Vite dev harness (dev/core.mjs).
//
//   npm run build && node dev/serve-dist.mjs [--port 5175]
//
// Exit codes: 0 = stopped, 1 = no build output / bad usage.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { harnessEvents, harnessLinks, injectConfig, injectSiteMock, matchRestUrl, MIME, parseHarnessOptions, ROOT, sendFile, sendRest, serveDemoFile } from './core.mjs';
import { renderFeaturedCard } from './featured-card.mjs';

export const DEFAULT_PORT = 5175;
const DIST_DIR = join(ROOT, 'plugin', 'wg-live', 'assets', 'dist');
const PAGES_DIR = join(ROOT, 'dev', 'dist');

const PAGE_ALIASES = /** @type {Record<string, string>} */ ({
  '/': '/dev/dist/index.html',
  '/index.html': '/dev/dist/index.html',
  '/listen.html': '/dev/dist/listen.html',
  '/help.html': '/dev/dist/help.html',
  '/home.html': '/dev/dist/home.html',
  '/stress.html': '/dev/dist/stress.html',
});

/** Files outside dev/dist the pages need. */
const STATIC_DEV_FILES = /** @type {Record<string, string>} */ ({
  '/dev/site-mock.css': join(ROOT, 'dev', 'site-mock.css'),
  '/dev/site-mock.js': join(ROOT, 'dev', 'site-mock.js'),
  '/dev/stress.css': join(ROOT, 'dev', 'stress.css'),
  '/dev/stub.html': join(ROOT, 'dev', 'stub.html'),
});

/**
 * Read build-info.json (the single source of the dist file names).
 * @returns {{ files: Record<string, { sha256: string }> }}
 * @throws {Error} when the build output is missing
 */
export function readBuildInfo() {
  const file = join(DIST_DIR, 'build-info.json');
  if (!existsSync(file)) {
    throw new Error(`${file} not found: run "npm run build" first`);
  }
  const info = JSON.parse(readFileSync(file, 'utf8'));
  if (!info || typeof info !== 'object' || typeof info.files !== 'object') {
    throw new Error('build-info.json has no "files" map: run "npm run build" again');
  }
  return info;
}

/**
 * The tags WordPress prints for the app (wg-live.css + wg-live.js) and for the homepage
 * (wg-live-featured.css). Names and versions come from build-info.json.
 * @param {{ files: Record<string, { sha256: string }> }} info
 */
export function distTags(info) {
  const names = Object.keys(info.files);
  const ver = (/** @type {string} */ n) => String(info.files[n]?.sha256 ?? '').slice(0, 12);
  const href = (/** @type {string} */ n) => `/dist/${encodeURIComponent(n)}?ver=${ver(n)}`;
  const css = names.filter((n) => n.endsWith('.css') && !n.includes('featured'));
  const featured = names.filter((n) => n.endsWith('.css') && n.includes('featured'));
  const js = names.filter((n) => n.endsWith('.js'));
  const link = (/** @type {string} */ n) => `<link rel="stylesheet" id="${n.replace(/\.css$/, '')}-css" href="${href(n)}" media="all" />`;
  const script = (/** @type {string} */ n) => `<script defer src="${href(n)}" id="${n.replace(/\.js$/, '')}-js"></script>`;
  return {
    css: css.map(link).join('\n    '),
    featuredCss: featured.map(link).join('\n    '),
    js: js.map(script).join('\n    '),
  };
}

/** The homepage card shown when ?featured= is absent: the live demo event (the one a real homepage would feature). */
export const DEFAULT_FEATURED_SLUG = 'demo-live-binaural-atmos';

/**
 * The card templates/featured.php would print for this request:
 *   ?harness=disabled        text only (the plugin is disabled)
 *   ?featured=none           the empty state: fallback text and a link to Live
 *   ?featured=<slug>         that event's card (default demo-live-binaural-atmos); an unknown slug is the empty state
 * @param {URL} url
 * @param {import('./core.mjs').HarnessOptions} options
 */
export function featuredCardFor(url, options) {
  const links = harnessLinks('/dev/dist/');
  if (options.disabled) return renderFeaturedCard({ state: 'disabled', links });
  const slug = url.searchParams.has('featured') ? options.featured : DEFAULT_FEATURED_SLUG;
  const event = slug === null ? undefined : harnessEvents().find((e) => e.slug === slug);
  return event ? renderFeaturedCard({ state: 'event', event, links }) : renderFeaturedCard({ state: 'empty', links });
}

/**
 * @param {string} html
 * @param {URL} url
 * @param {{ files: Record<string, { sha256: string }> }} info
 */
function renderPage(html, url, info) {
  const tags = distTags(info);
  const options = parseHarnessOptions(url.search, { pageBase: '/dev/dist/' });
  const withTags = html
    .replace('<!--WG_LIVE_DIST:css-->', () => tags.css)
    .replace('<!--WG_LIVE_DIST:featured-css-->', () => tags.featuredCss)
    .replace('<!--WG_LIVE_DIST:featured-card-->', () => featuredCardFor(url, options))
    .replace('<!--WG_LIVE_DIST:js-->', () => tags.js);
  return injectSiteMock(injectConfig(withTags, Date.now(), options), '/dev/dist/');
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
function sendText(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

/**
 * Create the server (not yet listening).
 * @returns {import('node:http').Server}
 */
export function createDistServer() {
  return createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = PAGE_ALIASES[url.pathname] ?? url.pathname;

      const rest = matchRestUrl(url.pathname, url.searchParams);
      if (rest) return sendRest(req, res, rest, url);

      if (url.pathname.startsWith('/demo/')) return serveDemoFile(req, res, url);

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');

      // The built plugin assets: only what build-info.json lists (plus build-info.json itself).
      if (path.startsWith('/dist/')) {
        const info = readBuildInfo();
        const name = decodeURIComponent(path.slice('/dist/'.length));
        if (name !== 'build-info.json' && !Object.hasOwn(info.files, name)) return sendText(res, 404, 'Not found');
        const file = join(DIST_DIR, name);
        if (!existsSync(file)) return sendText(res, 404, 'Not found');
        return sendFile(req, res, file);
      }

      if (Object.hasOwn(STATIC_DEV_FILES, path)) {
        const file = /** @type {string} */ (STATIC_DEV_FILES[path]);
        if (extname(file) === '.html') {
          res.setHeader('Content-Type', MIME['.html'] ?? 'text/html');
          res.setHeader('Cache-Control', 'no-store');
          res.end(injectSiteMock(readFileSync(file, 'utf8'), '/dev/dist/'));
          return;
        }
        return sendFile(req, res, file);
      }

      const page = /^\/dev\/dist\/([a-z-]+)\.html$/.exec(path);
      if (page) {
        const file = join(PAGES_DIR, `${page[1]}.html`);
        if (!existsSync(file) || !statSync(file).isFile()) return sendText(res, 404, 'Not found');
        const body = renderPage(readFileSync(file, 'utf8'), url, readBuildInfo());
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME['.html'] ?? 'text/html');
        res.setHeader('Cache-Control', 'no-store');
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      return sendText(res, 404, 'Not found');
    } catch (err) {
      return sendText(res, 500, err instanceof Error ? err.message : String(err));
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  let port = Number(process.env.PORT) || DEFAULT_PORT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
    else {
      console.error('usage: node dev/serve-dist.mjs [--port <n>]');
      return 1;
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`serve-dist: invalid port ${port}`);
    return 1;
  }
  try {
    const info = readBuildInfo();
    console.log(`serve-dist: serving ${Object.keys(info.files).join(', ')} from ${fileURLToPath(pathToFileURL(DIST_DIR))}`);
  } catch (err) {
    console.error(`serve-dist: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const server = createDistServer();
  server.listen(port, 'localhost', () => {
    console.log(`serve-dist: ready on http://localhost:${port}/dev/dist/index.html`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return -1; // keep running
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const code = main();
  if (code >= 0) process.exitCode = code;
}
