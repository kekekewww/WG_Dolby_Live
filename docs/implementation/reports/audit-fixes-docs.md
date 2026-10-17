# Audit fixes: documentation (2026-10-17)

Scope: docs only. No code, tests, builds, Playwright or wp-env were touched. No commit. `evidence/test-results/e2e-summary.md`, `integration-summary.md` and `docs/deploy/records/*` were not edited (the orchestrator updates them).

Every claim was checked against the current files before editing. The audit's line numbers were off by 0-2 lines in places; the substance held.

| Item | Status | Files and what changed |
|---|---|---|
| #3 video checks | done | STAGING.md: new §7 row (inline playback on a phone, no forced native player; iPhone native player only through 全螢幕); §8 F03/F04 (picture AND sound, UI notice 操作示範音訊… stays, burned-in caption `操作示範影片，非 Binaural／Atmos 驗證素材`), F05/F06 (clip changes 示範影片 1 <-> 2), F07 (fullscreen enter/exit with the control bar, pause reachable; iPhone native player). PRODUCTION.md: smoke rows 3, 4, 14, row 9 (no mp3/mp4 request, matches NAV-HOMEPAGE.md:74), the step-8 checklist, the §15.4 reminder (the picture must really play), plus the Range curl (206, Content-Range bytes 0-1/<size>, video/mp4). No optimizer/CDN-rewrite row. |
| #4 upload size | done | STAGING §1 new row; PRODUCTION §1 rows 15 (and 14 for CWV), a paragraph at the end of §2, step-2 text. All point to the SFTP route (PRODUCTION §5 step 2 / §8). The ZIP size is stated as about 1.75 MiB (the budget the parallel agent adds); no SHA is written. |
| #5 F08 | done | STAGING §8 F08/F09: the dev-panel fault is one-shot; to see bounded retries and 無法播放，請重試, block the demo media URL in devtools or go Offline before 開始聆聽. The dev panel stays for F09 and decode/unsupported faults. |
| #7 manual-devices.md | done | Template structure only, every result cell is 尚待測試, the header rule (human-filled only) is intact. Rule 6 now names the self-made test video + tone. The 選模式並播放 criterion requires picture AND sound. New table A2 (video: inline, fullscreen enter/exit, pause reachable, clip change, caption) with criteria that separate the iPhone native player from iPad/Mac element fullscreen. Table B gained two video columns (landscape incl. fullscreen, lock screen). |
| #8b CWV | done | PRODUCTION §3 (baseline BEFORE step 2, plus a post-deploy repeat) and §1 row 14; STAGING §8 plugin-off vs plugin-on row; DEPLOY-RECORD §3 performance row; HANDOVER §2 split into baseline and increment rows. All wording says lab data only. |
| #10 HYBRID | done | The Phone bullet and the 768/390/360 rows: at 360x800 the 190 px banner (top 610) covers the whole first panel (628-871); at 390x844 the banner top is 654, so about 9 px shows. 190 px is a screenshot estimate to confirm on staging. 768x1024 was checked against dev/site-mock.css: the banner is 80 px there (top 944), so "top inside" still holds and I added that. The note says the phone layout gates check the viewport rectangle, not the banner. |
| #13 STAGING wording | done | Intro of §4: 建立建議頁面 is a separate submenu; option A auto-binds the three pages when none are bound (existing bindings are kept unless replacement is ticked; verified in class-settings.php render_pages_page/handle_create_pages); confirm the binding under 部署資訊. PowerShell SHA check now compares only `.Split(' ')[0]`. I did not add Live to the regression row (optional). |
| #14 menu placement | done | NAV-HOMEPAGE §2 step 3 defaults to near Video and Blog (spec §4.3), with a fallback reason; §3.2 step 1 marks Music/Portfolio as a proposal to confirm against site screenshots. DEPLOY-RECORD §4 fields record the actual placement for the homepage block and the menu item. |
| #15 audio-only wording | done | STAGING §9 known-limits row: 示範影音. HANDOVER row 34: 示範影音 (consistent with row ~179). PRODUCTION.md:7 also changed to 示範影音 (optional item). DEPLOY-RECORD:106, ROLLBACK:108 and the UI-label quotes were left as they are. |
| #16 HYBRID:8 | done | The link hover text now says the underline thickens and the colour stays `currentColor`, pointing to "Host colours: inherit-first". The admin label in class-settings.php is code and was not touched. |

Left open: the ZIP size/SHA is deliberately not written in the runbooks (the 'records/' pointer is used). The 1.75 MiB figure depends on the parallel agent's check:artifact budget landing.

Not done: nothing from the spec.
