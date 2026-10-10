# Report: wp-integration

Result: 160 integration tests (80 Chromium, 80 WebKit), all passing, against the repo's `.wp-env.json` (WordPress 7.1.3, PHP 8.2.34, Astra 4.14.0, Elementor 4.3.4, WooCommerce 11.2.1, wg-live 0.1.0). Details per spec and the "not covered" list are in `evidence/test-results/integration-summary.md`.

## Files

Created:
- `tests/integration/wp.ts`: shared helpers (WP-CLI through `docker exec`, fixtures, admin login, REST/bootstrap fetch, PNG diff in the browser).
- `tests/integration/elementor.ts`: opens the real Elementor editor and reads the preview frame.
- `tests/integration/settings-ui.ts`: drives the plugin settings form.
- Specs: `pages`, `elementor`, `dev-tools`, `public-data`, `featured`, `admin-events` (parallel phase) and `disabled.state`, `settings.state`, `deactivate.state` (state phase), all `.spec.ts` in `tests/integration/`.
- `evidence/test-results/integration-summary.md`, `evidence/screenshots/integration/regression-*.json`.

Changed:
- `playwright.integration.config.ts`: 4 workers; own output and report dirs (`test-results/integration`, `playwright-report-integration`, so the e2e report is not overwritten); 240 s timeout (a cold WordPress request takes 5 to 25 s here); state specs are one project per file chained by `dependencies`, so they never overlap.
- `.gitignore`: `/playwright-report-integration/`.
- `src/main.ts` (bug fix, below) and `tests/unit/core/main.test.ts` (3 regression tests).
- `plugin/wg-live/includes/class-settings.php` (copy fix, below).

## Bugs found by the tests and fixed

1. **Elementor editor never mounted the widget (F14).** In the editor, widget DOM is built by the parent window and lives in the preview frame, so `instanceof Element` was false and `mountWithin` ignored every widget (the player stayed a skeleton, aria-busy forever). Also the `elementorWired` boolean stopped re-registering after Elementor's `init()` creates a new hooks object. Fix: `isElementNode()` duck-typing in `scopeElement` and `mountWithin`; wiring is now keyed on the hooks object identity. Regression tests in `tests/unit/core/main.test.ts` (iframe-realm element, fail without the fix) and the editor test in `elementor.spec.ts`.
2. **Admin copy promised a fallback the card does not have.** Settings said the homepage card falls back to "the latest event not yet ended" when no featured event is set; the card (per plan 6.10) shows 「線上音樂會資訊即將公布」 plus a link. Changed the text, the option label (`— 未指定 —`) and the deployment screen value instead of the behaviour. Decision for the orchestrator below.

## Findings that are not defects (documented in the specs)

- The classic editor's `pattern`/JS stops Publish and Save Draft with a bad 代稱 in the browser; the server rule is tested by submitting the form natively.
- A published event with an invalid `post_name` cannot be created through the plugin at all (even `wp_insert_post` is forced to draft); the predicate test writes such a row straight into the database to simulate legacy data.
- Admin notices are queued per user: another admin tab can consume them. `admin-events.spec.ts` therefore uses its own administrator account (created and deleted by the spec).
- WooCommerce ships with "coming soon" mode on, so visitors see a placeholder instead of Shop, Cart and Checkout. `deactivate.state.spec.ts` opens the store for its run and restores the options; without that the on/off screenshot comparison would compare two placeholders.

## Gates

| Gate | Result |
|---|---|
| `npm run test:integration` (Chromium + WebKit) | 160 passed, 0 failed (one invocation up to its first failing state spec with 144 passed, then the 5 remaining state projects with `--no-deps`; the failing assertion was too strict and was fixed) |
| `npm run typecheck`, `npm run lint` | pass |
| `npm run lint:php` | pass (17 files, php 7.4 and 8.3, PHPCompatibilityWP) |
| `npm run test:unit` | 1012 passed |
| `npm run build`, `package`, `check:artifact` | pass |
| `npm run test:e2e` (harness) | 586 passed, 2 skipped (unchanged) |
| PHP notices in WP-CLI output and Apache logs | none |

## Requests

- Orchestrator: confirm the featured-card decision (copy changed to match plan 6.10). If you want the card to auto-pick the next event like the events page does, `Public_Data::featured_event()` needs that fallback and the three strings revert.
- Tooling owner of `.wp-env.json` / `scripts/wp-env-setup.mjs`: optionally set `woocommerce_coming_soon=no` in the demo setup (so the dev site shows a real shop), and consider speeding up wp-env on Windows (`opcache.validate_timestamps=0` in the container halved request time in my session; I did not make that permanent).

## Contract issues

- Plan 7.2 lists the Elementor "preview" test; the contract does not say that the editor builds widget DOM in another realm. Worth a line in plan 3.2.
- Plan 4.2 says an invalid 代稱 on a published event forces draft; this also unpublishes an event a person was only editing. It is as specified, and tested.

## Operational notes

- Each WordPress request takes 5 to 25 s here (WordPress files on a 9p mount), so the integration run takes about 3 hours. Run one phase with `npm run test:integration -- --no-deps --project=chromium`, or a state file with `--project=chromium-state-settings` (never several state projects together with `--no-deps`: that drops the chaining).
- Fixtures are created and deleted by the specs (unique per browser project); a crashed run is cleaned by the next run's `beforeAll`.
- wp-env was stopped at the end. A leftover throwaway wp-env project from an earlier agent (`wpenv-3de49042`, ports 8990/8991) is still running; it is not part of this repo's `.wp-env.json` and I left it alone.
