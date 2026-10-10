# Report: deploy-docs

## Files

- `docs/deploy/STAGING.md` (spec 14.1-14.5; `WP_ENVIRONMENT_TYPE='staging'`, access restriction, clone safety, Full Width not Canvas, widget Cache Default/Inactive, F01-F15 staging checks, pass record template)
- `docs/deploy/PRODUCTION.md` (15.2 checklist, ZIP sha256 verification, 13-step table with done/evidence columns plus per-step notes, page ID and media re-binding, smoke test list, 15.4 table)
- `docs/deploy/NAV-HOMEPAGE.md` (16.1-16.4; identify Astra vs Theme Builder, add menu item without rebuilding header, block between Music and Portfolio, back up homepage first, optimizer exclusions for `wg-live*.js`, keep `?ver`)
- `docs/deploy/LINK-CHECKLIST.md` (16.5 table with desktop/mobile result columns, plus 7 extra error-path rows)
- `docs/deploy/ROLLBACK.md` (18.1 order A-E; disabled first, homepage block + menu item removed BEFORE deactivation, restore previous ZIP, no full DB restore without sign-off, uninstall keeps content unless opt-in, emergency folder rename)
- `docs/deploy/DEPLOY-RECORD.md` (18.3 fields; no credentials or private URLs)
- `docs/deploy/HANDOVER.md` (20 four groups + 19 checklists + 19.5 blockers + 18.2 daily ops)
- `evidence/test-results/manual-devices.md` (7.4 / 13.2 template: devices, mobile behaviours, 13.3 regression, M2 home-theatre table left 尚待測試)
- `scripts/load-test.mjs`, `tests/unit/load-test.test.ts`

## load-test.mjs decisions

- Refuses (exit 2, no request) without `--target` and `--approved`, also for `--dry-run`. `--approved=false` is rejected. Target must be an origin (http/https, no credentials/path/query).
- Steps default 5,25,50,100 (strictly ascending, max 300); think time min 200 ms with jitter; global `--max-rps` (default 100); `--max-requests` cap.
- `isAllowedRequest()` gates every URL including redirect targets: allows pages (limited query keys `wg_event`, `wg_mode`, `page_id`, `p`), static assets under wp-content/wp-includes with `ver` only, and `wg-live/v1/events[/slug]` (pretty or `rest_route`). Refuses anything containing `playback`, media extensions, `/assets/demo/`, wp-admin/login/ajax/cron, cart/checkout/account paths, other REST routes, other origins. A user-supplied `--page/--asset` that is refused is a usage error (not silently dropped).
- Safety stops: error rate (network/timeout/5xx) >= 20% or 429/503 >= 5% within a step (min 20 samples), any media Content-Type response, `--max-requests`. A stopped run still writes the JSON and exits 1.
- Output `evidence/test-results/load-<UTC timestamp>.json` (config, plan paths, per-step and total status codes, p50/p90/p95/p99, per-kind stats, abort reason, scope note that this does not prove 300 streams).
- Asset URLs are discovered from page HTML (wg-live files first, `--no-discover` to disable, `--asset` to pin).

## Gates

- `npx vitest run tests/unit/load-test.test.ts`: 101 tests pass (argument guard, URL filtering, discovery, percentiles, abort rules, rate limiter, full runs against a fake fetch incl. redirect refusal and media stop).
- Full `npm run test:unit` at last run: 539 tests pass (one run showed 1 failing file from other agents' in-flux sources, absent on re-run).
- `npx eslint` on my two code files: clean. `npm run typecheck`: my files clean; the one error seen (`src/components/event-card.ts` cannot find `../state/model`) belongs to another agent and was transient.
- `npm run lint` fails only in `src/state/model.ts` (irregular whitespace line 319, unused `_nowMs` line 555): not my file.
- Real run against a throwaway local HTTP server (2 and 4 VUs, 2 s steps): requests were only pages, `wg-live.js?ver=`, and `events` routes; JSON written; exit 0. Dry-run and guard exits verified by CLI.
- Docs are not machine-checked. No `npm run package`/`check:artifact` impact (`docs/` and `evidence/` are outside the ZIP).

## Requests (files I do not own)

1. PHP admin owner: docs assume these admin labels, change the docs or the labels to match: menu "Live 活動" with "Settings", "Deployment info", "Create suggested pages"; settings field "部署模式" (`disabled`/`demo`); event checkbox "示範活動" and source type "示範"; opt-in "解除安裝時刪除資料". Docs tell operators to record any label differences.
2. PHP owner: PRODUCTION step 7 relies on this behaviour: once the mode is `demo` and a demo event is published, `/wp-json/wg-live/v1/events` is public even while the three pages are drafts. Documented for the operator; no code change needed unless a "preview only" mode is wanted.
3. `.gitignore`: nothing needed (`evidence/test-results/` is kept on purpose). Load-test JSON files from real environments may deserve review before committing.

## Contract issues

- None blocking. Plan 7.4 says load-test covers "pages, static assets and `events*`"; I also allow `events/<slug>` and `?rest_route=` forms. `docs/deploy/records/` (suggested location in DEPLOY-RECORD) is not created; the template says "or the team's chosen place".
- Menu placement for the `Live` item is not specified by the spec; the doc says the studio decides and the operator records it.
