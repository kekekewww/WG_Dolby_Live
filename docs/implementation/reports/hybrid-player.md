# hybrid-player report

Implements docs/design/HYBRID.md for the player view. Behaviour, copy, a11y rules, CSS scoping unchanged.

## Changed files
- src/styles/player.css (rewritten), dialog.css, dev-panel.css
- src/views/player.ts: title area (`.wg-live__player-head`) is now the first child of `.wg-live__player` (DOM order = spec 5.3: head, stage, controls; CSS `order` puts the stage first from 768px); meta row (status + demo badge) before the title, heading uses aria-labelledby (title + demo badge); performers/date are two `.wg-live__player-meta-item` spans (no " · "); `.wg-live__info-main` wrapper; programme is an `<ol role="list">`; help link has `wg-live__link`.
- src/components/status-panel.ts: `createModeLabel()` returns `{ el, note, update }` (note is separate, placed inside the status block via new `note` option); quiet buttons (no --secondary/--ghost); first recovery action gets `--primary` only in `failed` (Start hidden), ended gate `backToEvents` and unavailable panel first link are primary.
- entitlement-panel.ts (CTA = `--primary`, contact quiet), dialog.ts (cancel quiet, confirm primary), dev-panel.ts, mode-selector.ts (help link `wg-live__link`), player-controls.ts (mute/live/fullscreen quiet).
- tests: views/player.test.ts, components/status-panel.test.ts, components/entitlement-panel.test.ts updated/extended.

## Verification
typecheck ok, lint ok (css scope ok), unit: 1126 pass; 1 fail = tests/unit/php-review-fixes.test.ts (featured.php `esc_attr` outside defuse_brackets, owned by the featured/PHP agent, not this task).
Screenshots (Playwright, ?chrome=live, banner hidden) at 1440 and 390: pre-start, playing, switch dialog (centred + bottom sheet), reconnecting, guest (login primary, Start muted), cancelled, dev panel open. Mobile order = title/status, stage, controls, info. No horizontal overflow seen.
e2e (harness-dev-chromium, gating/keyboard/layout/mount/player): 102 pass, 2 fail due to old DOM (not my files, see below).

## Token fallbacks (player.css aliases `--pl-*` = var(--wg-x, fallback))
Used with fallbacks: --wg-paper, --wg-mist, --wg-night, --wg-accent(-hover), --wg-on-accent, --wg-success, --wg-danger, --wg-panel, --wg-font-ui, --wg-font-body.
Local only (no contract token): --pl-veil / --pl-veil-hover / --pl-veil-selected (light veils rgba(240,245,250,.08/.12/.14) behind mode panels; the contract's --wg-panel is the dark bar veil). If the events agent wants shared light veils, name them and I will switch.
Disabled Start (`[aria-disabled][data-action=start]`) renders as a muted veil so a login/buy/retry primary is the only yellow button.

## Needs follow-up (outside my ownership)
1. tests/e2e/gating.spec.ts:27 expects `.wg-live__badge--demo` inside the title; it is now in `.wg-live__meta-row` (heading name still includes it via aria-labelledby).
2. tests/e2e/keyboard.spec.ts:~155 strips `wg-live__btn\s+wg-live__btn--\w+`; the cancel button is now `wg-live__btn wg-live__dialog-cancel`, so adjust the regex (e.g. strip `wg-live__btn\s+(wg-live__btn--\w+\s+)?`).
3. Dist dev pages (dev/dist/*.html) and the plugin build not regenerated here.
4. Other pages use `.wg-live__btn--secondary/--ghost`? None remain in player components; base.css owner may delete those rules.
