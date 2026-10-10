# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

The repository contains no code yet. The single source of truth is `WG_Studio_Live_Design_and_WordPress_Deployment_Spec.md` (written in Traditional Chinese). Section numbers below (§N) refer to it. Read the relevant section before you implement anything; section 20 holds the spec's direct instructions to the coding agent.

The project is **`wg-live`**, a WordPress plugin. It adds a "Live / 線上音樂會" area to https://sounds.wgstudiomusic.com/ (Astra theme + Elementor/Elementor Pro + WooCommerce, timezone Asia/Taipei). Viewers choose **Binaural (headphones)** or **Dolby Atmos (home theater)** playback. The studio supplies the streams; this project builds the UI and the platform integration.

## Milestones: what you may claim

- **M1 (current scope):** the full UI flow, the admin event management, the installable ZIP, Elementor integration, playback through a real **DemoAdapter** with test media, staging and production deployment steps, and rollback.
- **M2 (out of scope, don't build):** real ticket checks, playback authorization, stream protection/DRM, end-to-end Atmos validation on real devices, and load testing with 300 concurrent viewers.

Keep working on M1 while M2 is undecided. Never report M1 as "paid live streaming is securely online". Final reports keep four groups separate: 已實作 (implemented), 已測試 (tested), 已部署 (deployed), and 尚待外部條件 (waiting on external conditions) (§20).

## Commands (planned, per §11.1)

The project has no `package.json` yet. Create these scripts before you claim they work:

```bash
npm ci
npm run wp:start        # project-local @wordpress/env (Docker); plugin mounted from ./plugin/wg-live, port 8888
npm run dev             # Vite dev server
npm run typecheck
npm run lint
npm run test:unit
npm run build           # Vite library mode → IIFE JS + CSS into plugin/wg-live/assets/dist
npm run test:e2e        # Playwright: Chromium/Firefox/WebKit
npm run package         # scripts/package.mjs → artifacts/wg-live-<version>.zip + SHA-256
npm run check:artifact  # scripts/check-artifact.mjs validates ZIP contents
```

Start `.wp-env.json` from the minimal config in §11.1 (`WP_DEBUG: true`, `WP_DEBUG_DISPLAY: false`). Pin WordPress and PHP versions to match production before integration testing. Check that all PHP passes a syntax check.

## Architecture (§8)

Two halves live in one repo. Only the PHP plugin and the built static assets ship; production runs no Node service.

- **`src/` (TypeScript + Vite, vanilla DOM, scoped CSS).** It uses no React, no global UI framework, and no Tailwind preflight.
  - `state/`: three **separate** state axes: event (`scheduled|doors_open|live|intermission|ended|cancelled`), player (`idle|selecting|loading|playing|paused|switching|reconnecting|failed`), and entitlement (`unknown|guest|not_entitled|entitled|unavailable`). The source kinds are `not_configured|demo|hls|iframe`. Don't merge these axes into one flag.
  - `adapters/`: the three required provider boundaries (`EventProvider`, `PlaybackSourceProvider`, `EntitlementProvider`) plus the playback adapters (demo, native-media, hls, iframe). The TypeScript contracts are in §8.5; copy them as written.
  - `components/`: event list, mode selector, player shell and controls, status panel, listening guide, and dialog.
  - `styles/theme-bridge.css`: maps measured site styles to `--wg-*` variables (§3.5).
- **`plugin/wg-live/` (PHP).** It provides the shortcodes, the asset loading, the `wg_live_event` CPT, the settings, the public data endpoint, the site links, and the playback-provider stub.
  - Shortcodes: `[wg_live view="events|player|help"]`, with an optional validated `event` attribute, and `[wg_live_featured]` for the homepage. These are lightweight: they don't load hls.js or start a player.
  - Pages: `/live/`, `/live/listen/` (`?wg_event=<slug>&wg_mode=binaural|atmos`), and `/live/help/`. These are ordinary WP parent/child pages, not SPA routes and not a CPT archive.
  - Links come from **stored Page IDs + `get_permalink()`**. Page IDs differ between environments, so never hardcode them (the production homepage is currently ID 8; check this in the admin).
  - Settings deployment modes in M1: only `disabled` and `demo`. The plugin activates in `disabled` mode.

## Hard rules that are easy to violate

**Data and security**
- `PublicEvent` never contains source URLs or credentials. A real playback source comes from the backend only after the entitlement check. Never expose private sources through REST, data attributes, JSON-LD, or `VITE_*` env vars.
- When no entitlement result is found, deny playback; never fail open. When no provider exists, return `{ kind: 'not_ready' }`.
- The dev/demo state panel only appears in a server-confirmed dev environment or an authorized preview. No public `?paid=true`, `?debug=1`, or similar parameter may change playback conditions.
- Don't use WordPress as a PHP proxy for media segments. Don't add a Service Worker. Don't cache personalized or entitlement responses.

**Scope**
- Don't rebuild accounts, checkout, or payments. Login CTAs link to the existing WooCommerce Account page. Never infer ticket ownership from roles or emails.

**CSS and Elementor**
- Scope all CSS under `.wg-live` / `.wg-live-featured`. Never style the global `body`, `h1`, `button`, or `a`, and never change Elementor Site Settings.
- Reuse the site's header, footer, and logo; never duplicate them. Use the Elementor Full Width page layout, never Canvas.
- Don't rely only on `has_shortcode()` to decide whether to enqueue assets, because Elementor content isn't in `post_content`. Enqueue by the bound Page IDs and check the Elementor editor and preview.
- Mounting must be **idempotent**: an Elementor re-render must not create duplicate listeners or media elements.

**Playback (§5.3–5.4, §9)**
- At most one active adapter or media source per page. When the source switches: stop the old media, destroy the HLS instance, then load the new one. Update "目前播放" (now playing) only after the new source succeeds. Don't copy `currentTime` across sources.
- Never autoplay; start playback only after a user gesture, and handle a rejected `play()`. Never rebuild the `<audio>`/`<video>` element when the UI re-renders. Stop playback when the viewer leaves the page.
- One coordinator owns bounded retries, with no parallel infinite timers.
- Never fake capabilities: no fake spectrum, no fake viewer counts, no fake track sync, no "Atmos certified" or "7.1.4 connected" labels, and no Dolby badges. Keep demo audio labeled 操作示範音訊，非 Binaural／Atmos 驗證素材 ("demo audio, not Binaural/Atmos validation material") in both modes. Hide controls the adapter can't perform.
- iframe adapter: only HTTPS player URLs approved by an admin. Don't overlay controls that can't actually control the iframe. `postMessage` checks `origin`, `source`, and schema, and never uses `*`.
- Use feature detection to pick the playback path, not the browser name. Don't block Binaural for non-Safari browsers. When support is unclear, show 尚未確認 ("not yet confirmed").

**UI language and quality**
- UI copy is Taiwan Traditional Chinese, with English section names (`Live`, `Listening Guide`). The exact copy for states and errors is in §5 and §6.
- Accessibility target is WCAG 2.2 AA. Don't let Space hijack keys outside the player. Screen readers must not announce the countdown every second. Respect `prefers-reduced-motion`.
- Budgets: core JS ≤100 KB and CSS ≤30 KB compressed, excluding HLS.

**PHP**
- Prefix names with `wg_live_` or use a namespace, and check `ABSPATH`. Every admin write checks capability and nonce and validates input; escape all output.
- A missing build asset must not cause a fatal error.
- Activation must not change the theme, add menus, publish content, or flush rewrites on each request.

## Packaging and deployment (§15)

- The ZIP has a single `wg-live/` root with `wg-live.php` directly inside it. It contains only PHP, templates, the built assets, licensed demo media, and third-party license notices.
- Exclude `node_modules`, `.git`, `.env`, test reports, screenshots, fonts, and DB dumps. Asset URLs carry a version or content hash.
- Never overwrite the production database with staging. Deploy only the plugin, pages, and settings.
- Writing to production, overwriting existing pages, publishing, or touching commerce flows requires explicit authorization.
- Playwright WebKit is not Safari. Real-device Safari results go in the test records, and the Atmos device compatibility table stays 尚待測試 ("pending testing") until actually tested.
