# Fix report: docs group

Findings assigned: spec-compliance F1, F5, F6, F11. All are docs-only fixes; no code or tests changed. Gates (typecheck, lint, test:unit, lint:php) are not affected by Markdown and readme edits, so they were not rerun.

Note: the edits were first delegated to Codex (`codex-lane --tier sol`, gpt-6.1-sol, write mode). Its Windows sandbox failed (`setup refresh had errors`) and it made no changes, so the edits were made directly and reviewed with `git diff`.

| Finding | Result | Files |
|---|---|---|
| F1 contact URL never set | Fixed. New step in STAGING section 6 (step 3) and PRODUCTION step 6 (item 4) to set the contact link and confirm the domain-warning count is zero; PRODUCTION step 9.4 re-tests LINK-CHECKLIST rows 7, 9, 13; DEPLOY-RECORD contact row says it can't be "自動". The optional admin notice was not added (code change, out of scope). | STAGING.md, PRODUCTION.md, DEPLOY-RECORD.md |
| F5 draft-phase checks | Fixed. PRODUCTION 5.2 only checks Page IDs bound and "未發布"; permalink check moved to new 9.4; draft-preview caveat added to PRODUCTION step 8 (item 5) and STAGING 6.5, including the `?wg_event=<代稱>` player preview. | PRODUCTION.md, STAGING.md |
| F6 wrong admin labels | Fixed. ROLLBACK A, STAGING intro, PRODUCTION 4.1, readme.txt step 3 now use Live 活動 > 設定 / 部署資訊 / 建立建議頁面 (separate submenus). LINK-CHECKLIST row 4 and detail limited to the events page; the player shows login only for guest (not reached in M1). | ROLLBACK.md, STAGING.md, PRODUCTION.md, plugin/wg-live/readme.txt, LINK-CHECKLIST.md |
| F11 polling/cache | Fixed. HANDOVER now says only the player polls and /live/ plus the featured card are snapshots, with a purge step after status/time/cancel edits; NAV-HOMEPAGE cache row gives a short-TTL recommendation and manual purge. | HANDOVER.md, NAV-HOMEPAGE.md |

Also (orchestrator decisions):
- M1-PLAN.md: new "Rev 2.1 changes" section recording decisions a to e plus the runbook changes; the site-links row (line ~152) now says WooCommerce first, then the override.
- NAV-HOMEPAGE.md: account-link wording now WooCommerce first (it claimed the override wins).
- HANDOVER.md: one line added that publishing needs a title and a start time.
- DEPLOY-RECORD.md: Git commit row requires the full 40-char SHA with dirty=false.

Not changed: STAGING.md F08 dev-panel wording (spec-compliance F9, not assigned).
