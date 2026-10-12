# hybrid-integrate: gate report

## Gate table (final)

| Gate | Result |
|---|---|
| npm run check (typecheck, lint + CSS scope, unit 1142, build, package --allow-dirty, check:artifact --allow-dirty) | pass. JS 31.7/100 KiB, CSS 8.1/30 KiB, featured CSS 2.5/30 KiB (gzip) |
| npm run lint:php (php -l 7.4 + 8.3, PHPCS + PHPCompatibilityWP 7.4-) | pass |
| npx playwright test (harness-dev chromium/firefox/webkit + harness-dist) | pass: 622 passed, 2 skipped (run after the CSS and spec fixes; no front-end change since) |
| WordPress integration in WSL (npm run test:integration:wsl) | pass: 174 passed (final full run) |
| wp:stop:wsl | stopped |

## Token requests between the two reports
- Badge dot for the player: already present (`.wg-live__player-status-badge::before` in player.css). Nothing to add.
- Light veils `--pl-veil*`: kept local to player.css (no shared token needed).
- Allowlist/licence edits for the 1:1 poster: kept.

## Fixes made
1. `src/styles/help.css`: compat table cell padding 18px -> 20px. The CSS isolation probe flags `padding-top: 18px` as the hostile theme's td padding.
2. `src/styles/player.css`: the mode radio input is again stretched over the whole card (`inset:0; z-index:1; opacity:0`). The 1px version left the fieldset as the pointer target in Firefox (check()/click timed out; real pointer clicks were fine only via the label).
3. `tests/e2e/gating.spec.ts`: demo badge is asserted in `.wg-live__meta-row`, plus the heading's accessible name still includes it.
4. `tests/e2e/keyboard.spec.ts`: class-name normaliser accepts a `wg-live__btn` without a modifier class (dialog cancel).
5. `plugin/wg-live/templates/featured.php`: 17 calls used `WG_LiveShortcodes::defuse_brackets` (missing namespace separators) -> fatal on render, caught by the integration featured specs. Now `\WG_Live\Shortcodes::`.
6. `plugin/wg-live/includes/class-shortcodes.php`: `tile_parts()` used `new DateTimeZone` inside the namespace -> `\DateTimeZone`.
7. `tests/unit/php-review-fixes.test.ts`: two regression guards for 5 and 6 (PHPCS/php -l do not catch them).

## Notes
- One intermediate integration run had a single webkit failure in `public-data.spec.ts` ("identical for guests and administrators"): another project's worker created fixture events between the guest and admin fetch. Unrelated to this change; it passed in the final full run.
- I accidentally ran `git stash` once and popped it immediately; the working tree was restored (verified key edits). Index state of the dev/site-chrome.css -> dev/stress.css rename changed to D + A, content identical.
- Working-copy files edited with Edit keep CRLF on disk (Windows autocrlf); git normalises to LF.
- Not committed.
