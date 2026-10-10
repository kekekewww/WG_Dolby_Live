# Report: php-core (resumed run)

## State found and what I did

A previous attempt had already written every owned file. I read all of them against M1-PLAN, kept what was correct, and checked it against the running wp-env site (throwaway config on http://localhost:8990, plugin mounted live from `plugin/wg-live`). Only these edits were needed:

- `src/featured.ts`: now imports `./styles/theme-bridge.css` then `./styles/featured.css` (tokens bundled into the homepage CSS).
- `vite.config.ts`: build #2 entry is `{ 'wg-live-featured': 'src/featured.ts' }`, so the CSS is still emitted as `wg-live-featured.css` (a plain string entry produced `featured.css`; `cssFileName` is ignored for a TS entry). The drop-featured-JS plugin is unchanged, so dist holds only the 3 CSS/JS files plus `build-info.json`. Featured CSS is 1.7 KiB gzip.
- `src/styles/featured.css`: header comment updated (tokens now bundled; var() fallbacks kept as defence in depth).
- `plugin/wg-live/includes/class-shortcodes.php`: `load_template()` output is `trim()`med (the disabled featured template left trailing whitespace).

## Files owned (all present, LF)

`wg-live.php`, `includes/class-{plugin,public-data,playback-provider,entitlement,site-links,shortcodes,assets}.php`, `templates/{events,player,help,featured}.php`, `templates/partials/container.php`, `readme.txt`, `LICENSE`, `src/styles/featured.css`, `tests/unit/php-copy-sync.test.ts`.

Key decisions:
- Slug checks everywhere go through `Events::is_valid_slug()` (`D` modifier, max 100). REST route regex is the unanchored pattern; the handler arg also re-validates, so `DEMO-LIVE` gets 400 and `demo-live%0A` gets no route (404).
- `Public_Data::encode_config()` adds the plan 3.1 HEX flags and also escapes ordinary and no-break spaces as ` `/` ` (valid JSON) so `convert_smilies()` cannot rewrite text in the bootstrap.
- Shortcode `event` attribute is `trim()`med, then resolved via `find_event_by_slug()` (valid slug + `Events::is_public`); unknown event renders 「找不到這場活動」.
- Duplicate player view renders 「同一個頁面只能放置一個播放器。」 (PHP-only copy).
- `/wg-live/v1/events` is public in demo mode even when the pages are drafts (documented in deploy docs); in `disabled` mode events are empty, `events/{slug}` is 404, playback is `not_ready/disabled`.
- Featured: server-rendered; states `event` / `empty` (「線上音樂會資訊即將公布」 + link to Live) / `disabled` (text only). CTA follows plan 6.1; cancelled/ended/scheduled link to the events page because the card cannot expand details.

## Verification (all run on this machine)

- `npm run lint:php`: ok, 17 files, `php -l` on 7.4 and 8.3, PHPCS + PHPCompatibilityWP 7.4-.
- `npm run typecheck`: clean. `npm run lint`: clean (eslint + CSS scope). `check-css-scope --dist`: ok.
- `npm run test:unit`: 33 files, 1007 tests pass (includes `php-copy-sync`, `slug-pattern-sync`).
- `npm run build`: ok; dist = wg-live.js, wg-live.css, wg-live-featured.css, build-info.json.
- Live site checks (node fetch + `wp eval-file`): events list (4 events, whitelist keys only, no source fields), event route 200/404/400, playback binaural/atmos return `demo-tone-1/2.mp3` `audio/mpeg`, non-demo event gives `entitlement_unavailable`, bad mode 400, unknown/non-public event `event_not_found`; playback sends no-store headers, events send `public, max-age=30`. Homepage loads only `wg-live-featured.css` (no JS). `/live/`, `/live/listen/`, `/live/help/` load `wg-live.js` + `wg-live.css` with the container, `<noscript>` links, empty `.wg-live__sr-status`, skeleton. Shortcode matrix (bad view, duplicate player, bad/uppercase event, heading h1/h2/h3) as expected. Disabled mode: events `[]`, featured text only, event 404, playback `disabled`; setting restored afterwards. Style override: valid hex emitted on both handles, injected value `red;}body{x:y` dropped. Missing `wg-live.js`: no fatal, `/live/` shows 「Live 介面暫時無法載入」.
- Not verified: `Plugin::dev_tools_enabled()` under `production`/`staging` (the available wp-env pair is `local`); the logic is a direct implementation of D17. The admin notice for a missing build was not rendered (no logged-in user in wp-cli).

## Requests

1. core-shared: `src/dom.ts:34` fallback base `'http://localhost/'` ends up in `wg-live.js`, and `npm run check:artifact` fails its "dev strings" check (`wg-live.js:1 contains "localhost"`). Use a non-localhost placeholder base, e.g. `'https://wg-live.invalid/'`. All other check-artifact checks pass.
2. tooling: `npm run package` writes `artifacts/`; I removed it after checking.

## Contract issues

- Vite: with a TS entry, the CSS file name comes from the entry key, not `cssFileName`; the entry must be an object keyed `wg-live-featured`.
- Plan 6.10 lists the 「回放資訊待公布」 text only for `replayAvailable`; implemented on the featured card for `ended` + `replayAvailable` only.
