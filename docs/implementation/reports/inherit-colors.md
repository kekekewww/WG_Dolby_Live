# inherit-colors report

Problem: plugin text on the host background was hard-coded to the live site's light colours and vanished on a light section (Astra default theme on the dev WordPress).

## What changed
- `src/styles/theme-bridge.css`: `--wg-text`, `--wg-link`, focus ring = `currentColor`; `--wg-text-muted` (85%), `--wg-danger-text`, `--wg-accent-text`, veils, hairline and slider track derive from the host colour in an `@supports (color-mix)` block, with full-strength / neutral-grey fallbacks for Safari 15.4 (no color-mix, plan D15). Mist raised to `#ccd3da` (5.1:1 on a 72% Night bar over white).
- `base.css`, `events.css`, `help.css`, `player.css`, `featured.css`, `accessibility.css`: host text, links, quiet buttons, badges, mode panels, programme, featured card now inherit. Own surfaces keep explicit colours (stage, dark bar with `color: Paper` when engaged, dialog, date tile, poster placeholder, yellow buttons with a two-tone focus ring, dev panel). Link / quiet-button hover thickens the underline (no yellow text on host); the 已選取 marker is plain text colour.
- Harness: `dev/site-mock.js` + `dev/site-mock.css` `?host=light` (white section, `#3a3a3a`), documented in `docs/design/site-mock.md`; `docs/design/HYBRID.md` section added.
- Tests: `tests/e2e/helpers.ts` (`HOSTS`, `scanContrast`, `applyHostBackground`), `host-contrast.spec.ts` (events, help, player states; chromium) and `host-contrast.dist.spec.ts` (home card + the views on shipped CSS). Hosts: dark, dark-solid (flat #4c4c4c worst-case photo, so axe can judge it), light. Zero `color-contrast` violations.
- `scripts/seed-demo.php`: `wg_live_seed_astra_palette()` in setup mode (inside the env guard): Astra palette/customizer set to #111111 background, #f0f5fa text, #f0d62b links; idempotent, skipped when Astra is not active.

## Verified
- `npm run check`: typecheck, lint, 1151 unit, build, package, check:artifact pass (bundle 31.7 KiB JS, 8.6 KiB CSS gzip). One unrelated unit test (`load-test` redirect) failed once under load and passes alone and on re-run.
- `npx playwright test` (all projects): 668 passed, 44 skipped (existing skips).
- `npm run lint:php`: ok.
- Screenshots of events, player and home on `?host=light` and dark reviewed.

## Not run / open
- wp-env integration specs and the seed palette on a real Astra install were not run (Docker/WSL stack not started); the Astra option keys follow Astra's documented palette slots and should be checked once on the dev site.
- Decisions taken: hover is an underline change, not yellow; error tint is host-adaptive via color-mix (plain text colour in Safari < 16.2).
