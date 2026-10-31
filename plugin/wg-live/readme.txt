=== WG Studio Live ===
Requires at least: 6.3
Requires PHP: 7.4
Stable tag: 0.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html
Tags: live, concert, audio, binaural, dolby atmos

Live / 線上音樂會: event pages and a Binaural / Dolby Atmos listening-mode player interface for the WG Studio website.

== Description ==

WG Studio Live adds a Live area to the site: an events page, a player page and a listening guide, plus a small featured-event card for the homepage.

This is milestone M1. It delivers the interface, the admin event management and a demo player that plays short test video (events of kind audio play short test audio). It does not check tickets, does not authorize playback and does not protect streams. No real concert stream is connected in this version, and the compatibility table in the listening guide stays "pending" until devices are actually tested.

Features in this version:

* Custom event type with an explicit, validated event slug, start time and time zone, status, supported listening modes, programme, poster and optional product link.
* Shortcodes: `[wg_live view="events|player|help"]` (optional `event="slug"` and `heading="h1|h2"`) and `[wg_live_featured]`.
* Page assets load only on the bound Live pages, the homepage card and the Elementor preview. The homepage card is rendered in PHP and loads no script.
* Deployment mode "disabled" (default) hides every public part of the plugin. Mode "demo" shows the interface with the bundled demo video and audio.
* A public read-only REST API under `wg-live/v1` (events, event, playback) that never returns source files for real events and never varies by user.

The plugin does not create accounts, checkout or payment flows and does not change the theme, menus or the homepage.

== Installation ==

1. Upload the `wg-live` folder to `/wp-content/plugins/` or install the ZIP from Plugins > Add New > Upload Plugin.
2. Activate the plugin. It starts in deployment mode "disabled".
3. Open Live 活動 > 設定 (Settings), then Live 活動 > 建立建議頁面 (Create suggested pages), to create or bind the Live, Listen and Listening Guide pages. Set the contact link under the site-link overrides, then switch the deployment mode to "demo" when ready.
4. Add the shortcodes to the bound pages (or to an Elementor Shortcode widget) and `[wg_live_featured]` to the homepage.

Requirements: WordPress 6.3 or newer and PHP 7.4 or newer.

== Browser support ==

The interface targets these minimum browsers: Safari and iOS Safari 15.4, Chrome and Edge 100, Firefox 100. Playback paths are chosen by feature detection, not by browser name. Real-device results are recorded separately and are not claimed here.

== Demo assets and third-party notices ==

The two demo video files (`assets/demo/demo-video-1.mp4`, `assets/demo/demo-video-2.mp4`), the two demo audio files (`assets/demo/demo-tone-1.mp3`, `assets/demo/demo-tone-2.mp3`) and the demo poster (`assets/demo/poster-demo.svg`) were created for this project. They contain no recordings, samples or artwork from any other party and no font files (the video captions are rendered with Noto Sans TC, SIL Open Font License 1.1), and ship under the same license as the plugin. See `assets/demo/LICENSE-demo.txt`. The demo video and audio are a way to try the interface only: it is not Binaural or Dolby Atmos validation material.

The plugin bundles hls.js (Apache-2.0), unmodified, as `assets/dist/wg-live-hls.js`; it is loaded only when a real event plays an HLS stream. Its license and copyright notices are in `assets/dist/THIRD-PARTY-NOTICES.txt`. The other built scripts and stylesheets in `assets/dist` are compiled from this project's own source.

== Changelog ==

= 0.3.0 =
* M2 groundwork, all of it inactive until the deployment mode is set to 「正式」 (live); demo and disabled behave as in 0.2.0.
* Tickets: a logged-in viewer is entitled when one of their paid WooCommerce orders contains the event's ticket product (not fully refunded). Never inferred from roles or e-mail addresses.
* Sources: per event either HLS playlists (on hosts listed under 設定 → 串流主機) played by the plugin's own player, or the streaming provider's player page (on origins listed under 設定 → 播放器網域). URLs reach a viewer only through /playback, after the ticket check, while the event is live or in intermission.
* Production hands out no stream URL until a provider URL signer is configured (escape hatch: WG_LIVE_ALLOW_UNSIGNED_STREAMS, a documented risk). The deployment-information screen shows the signer state.
* Bundles hls.js 1.7.3 (Apache-2.0) as a separate file, loaded only for HLS sources.

= 0.2.0 =
* Event managers: users with `publish_pages` (Editors, WooCommerce Shop Managers) can create, edit, publish and delete Live events. Filter: `wg_live_events_capability`. Settings, deployment information and page creation still need `manage_options` (filter `wg_live_manage_capability`).
* The event screen has a 「設為首頁精選」 checkbox that sets or clears the homepage featured event, and the event list shows which event is featured.

= 0.1.0 =
* First M1 release: interface, event management, demo player, shortcodes and public REST endpoints.
