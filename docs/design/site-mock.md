# Realistic site mock (dev only)

Purpose: design and test the plugin inside something that looks like https://sounds.wgstudiomusic.com/ (Astra + Elementor) instead of the old fake chrome. Never packaged, never shipped.

Sources: `docs/implementation/design-baseline.md` (measured 2026-10-10) and `evidence/design-baseline/*.webp`. Anything not measured is marked "assumed" in `dev/site-mock.css`.

## Files

| File | Role |
|---|---|
| `dev/site-mock.css` | Theme-like global CSS plus `.wgm-*` chrome: dark photo under a 75% `#111111` overlay, transparent header (83px desktop, 80px at 921px and below, bar `rgba(0,0,0,.39)`), 1140px Elementor container, footer, fixed Backer Plan banner (80px, 190px at 767px and below), Astra-like global rules (`button`, `a`, `p`, `ul`, headings). |
| `dev/site-mock.html` | The three chrome snippets (`head`, `header`, `footer`), source of truth for markup. |
| `dev/site-mock.js` | Asset switch, banner dismiss, mobile menu toggle, scrolled class. Classic script in `<head>`. |
| `dev/stress.css` | The old deliberately hostile global CSS (renamed from `site-chrome.css`). |
| `dev/stress.html`, `dev/dist/stress.html`, `dev/dist/stress-home.html` | Stress pages: hostile CSS, no realistic chrome. `?view=events\|player\|help` picks the hosted view. |
| `dev/mockups/` | `index.html` (links), `_template.html` (copy this). Served by `npm run dev`. |

Harness pages (`dev/index.html`, `listen.html`, `help.html`, `stub.html`, `dev/dist/{index,listen,help,home}.html`) now use the realistic chrome.

## Using it in a page

Both servers (Vite plugin in `dev/mock-rest.ts`, dist server `dev/serve-dist.mjs`) expand these comment tokens through `injectSiteMock` in `dev/core.mjs`:

```html
<head> ... <!--WG_SITE_MOCK:head assets=live--> </head>   <!-- assets=live is optional -->
<body class="wgm">
  <!--WG_SITE_MOCK:header current=live-->     <!-- current= home|biography|portfolio|video|live|blog|contact|store -->
  <main class="wgm-main" id="content">
    <div class="wgm-container"><div class="wgm-container__inner">
      <div class="wgm-widget wgm-widget--shortcode"> ...plugin root or mockup... </div>
    </div></div>
  </main>
  <!--WG_SITE_MOCK:footer-->
</body>
```

`{{base}}` in snippets is `/dev/` (Vite) or `/dev/dist/` (dist server). Pages must be served by one of these servers; a `file://` open shows no chrome. Use `wgm-widget--text` for a text-editor widget (Noto Sans TC 200); the shortcode widget inherits the Astra body font (Karla 17px/400, assumed).

## Real assets, offline fallback

The background photo (`NicolasMic_01-scaled.webp`), logos (`Logo_H.png`, `Logo_WG.png`, recolored white with `filter: brightness(0) invert(1)`) are hotlinked from the studio's public uploads, and Karla / Noto Sans TC / Poppins come from Google Fonts. They load only when `html.wgm-assets` is set:

- people in a normal browser: on;
- automation (`navigator.webdriver`): OFF, so e2e runs do not hit the studio site and `bundle.dist.spec.ts` can still assert "no foreign host". Fallback: neutral dark photographic gradient, "WG STUDIO" text logo, system fonts;
- `?chrome=live` forces on, `?chrome=offline` forces off; `assets=live` on the head token (used by `dev/mockups`) forces on.

Other query flags: `?banner=off` hides the banner (closing it also remembers for the tab).

### Host variants: dark (default) and `?host=light`

The plugin takes its text colour from the host (inherit-first, spec 3.5), so the harness can show both:

- default: the dark live site (photo under a 75% `#111111` overlay, text `#f0f5fa`);
- `?host=light` (`html.wgm-host-light`, set by `dev/site-mock.js` before first paint): the content section (`.wgm-container`) becomes a white band with Astra's default text colour `#3a3a3a`; header, footer and banner are unchanged. Works on every page that uses the mock: events (`index.html`), player (`listen.html`), help (`help.html`) and the dist home page (`dist/home.html`), e.g. `/dev/listen.html?wg_event=demo-live-binaural-atmos&host=light`.

Both variants are covered by `tests/e2e/host-contrast.spec.ts` and `host-contrast.dist.spec.ts` (axe `color-contrast`, zero violations; the dark variant also runs against a solid worst-case photo colour, because axe cannot judge text over a gradient).

## Fidelity and known deviations

Matched from screenshots: header height, logo size, nav spacing (17px padding, Karla 17px), yellow current item, mobile white menu panel (including the live site's low-contrast current item), footer text and hairline, banner colours and proportions.

Assumed or approximate: Astra's global `button` rule (filled `#f0d62b`, 4px radius, `padding: 10px 40px`), `p { margin-bottom: 1.75em }`, `ul { margin-left: 3em }`, the 921px and 767px breakpoints, banner font sizes, scroll (not fixed) photo at 921px and below. `.wgm-main` has `min-height: 100vh` (tall Elementor pages; keeps the footer below the fold so the dev harness's late-arriving CSS cannot register a visible footer shift). The footer is not hidden under the banner: `body` gets padding for the banner height. The "Live" menu item does not exist on the real site yet.

Real layout fact the plugin must respect: the banner is `position: fixed` at the bottom, `z-index: 999`, 80px (desktop) or 190px (mobile) tall; do not stack a fixed bottom control bar on top of it.

## Tests

CSS isolation specs (`tests/e2e/css-isolation.spec.ts`, the hostile-chrome tests of `bundle.dist.spec.ts`, the Space/K test in `keyboard.spec.ts`) use `{ stress: true }` in `tests/e2e/helpers.ts`, which routes to `stress.html?view=...`. Everything else runs on the realistic pages.

## "Before" screenshots

`<scratchpad>/directions/current/`: events, player, player-binaural-chosen, help; 1440x1000 and 390x844; `-fold` (viewport, banner visible) and `-full` (full page, banner hidden because fixed elements land mid-page in full-page captures). Taken with `?chrome=live` on the dist server (`node dev/serve-dist.mjs --port 5176`, built bundle).
