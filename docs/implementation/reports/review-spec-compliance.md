# Review: spec compliance for M1 (independent, read-only)

Scope: the whole repository at commit `bc1e150`. I checked the M1 requirements of the spec (§4–§6, §10, §14–§19), the plan rev 2 decisions D1–D19, any faked M2 functionality, and whether `docs/deploy/*` matches the admin labels and behaviour in the PHP code.

Method: I read the spec, `M1-PLAN.md` (rev 2), `src/types.ts` and `CLAUDE.md`. I also read every PHP file, template and `uninstall.php` in `plugin/wg-live/`, the TS front end (`main`, `boot`, `dom`, `views/*`, `state/*`, `adapters/*`, `components/*`, `i18n/*`, `util/*`), `admin.js`, all seven `docs/deploy/*` files, the agent reports, the release scripts (`package`, `check-artifact`, `build-info`, `wp-env-setup`, `seed-demo` (skimmed)), `.wp-env.json`, `package.json`, `vite.config.ts` and the shipped `artifacts/wg-live-0.1.0.zip`. I extracted that ZIP with fflate and compared it entry by entry with the working tree: all 28 entries are identical. I did not run any test suite, and I did not read the tests, the dev harness or most CSS in full.

I left out anything the plan or the reports record as an accepted decision. Examples: the featured card does not auto-pick an event, the events page renders from the bootstrap and does not poll, the dev-panel fault is one-shot, a published event with an invalid 代稱 is forced back to draft, and the client drops events whose start time is invalid.

## Result

I found no defects with critical or high severity. The privacy and security rules hold:

- `PublicEvent` and the bootstrap carry no source URLs.
- Entitlement is checked on the server before a source is resolved, and an unknown result never allows playback.
- `disabled` hides everything as D16 requires.
- Dev tools are off on `production`.
- The REST arguments are validated.
- The ZIP passes all 10 checks of plan 7.3.

I found no faked M2 functionality:

- hls and iframe are inert stubs.
- No Dolby badges, fake device labels, spectrum displays or fake viewer counts appear.
- The compatibility table defaults to 「尚待測試」.
- The demo audio label appears in both modes.

I found 12 defects: 3 medium and 9 low. They are listed below with the most severe first.

| # | Sev | Area | Finding |
|---|---|---|---|
| 1 | medium | docs/deploy vs §5.5, §6, D16 | No runbook step sets the 聯絡連結 (contact URL), which has no automatic value. The Help Contact entry and the cancelled, disabled and entitlement contact links therefore never render. |
| 2 | medium | §18.3 / §19.4 release traceability | `build-info.json` stamps HEAD and does not detect a dirty tree. The shipped 0.1.0 artifact says commit `e4dfc15`, which contains only the spec. |
| 3 | medium | §10.2 / admin feedback | A published event with no start time is hidden from every public surface. The admin gets only a generic warning. |
| 4 | low | §10.2 | The event title is not required. A blank-title event publishes with empty headings and accessible names. |
| 5 | low | docs/deploy vs code | The runbooks require draft-phase checks that the code cannot support: there are no permalinks or internal links while the pages are drafts. |
| 6 | low | docs/deploy + readme vs admin labels | The docs name admin screens "Settings", "Deployment info" and "Create suggested pages" (a part of the settings page), and the readme names a "WG Live" menu. None of these exists. LINK-CHECKLIST expects a 登入 button on the player page, which M1 never shows. |
| 7 | low | §6.2 entitlement axis | The client entitlement placeholder is frozen at mount. A source change picked up by the poller leaves the 「暫時無法確認觀看資格」 panel stuck. |
| 8 | low | §9.4 / Help copy | The Help page promises a 「尚未確認」 state that the player never shows. |
| 9 | low | §5.6 / STAGING F08 | The dev panel cannot show that retries are bounded. The fault select also keeps showing a fault that has already been used. |
| 10 | low | §4.1 / plan 4.6 | The create-pages conflict check ignores attachments, which share the hierarchical slug namespace, so the page can end up at `/live-2/`. |
| 11 | low | §12 step 6 / §18.2 docs | HANDOVER says the front end polls event status, but only the player does. The docs allow page caching of `/live/` and the homepage and never say to purge after an event edit. |
| 12 | low | §10.4 | The account link prefers the admin override over WooCommerce, the reverse of the spec. The plan does not record this deviation. |

---

## 1. [medium] No runbook step sets the contact URL, so the contact links required by the spec never appear

**Where**
- `plugin/wg-live/includes/class-site-links.php:43` (contact is the override or `null`; there is no automatic value)
- `plugin/wg-live/includes/class-settings.php:992` (the admin text says 「聯絡連結沒有自動值」)
- `src/views/help.ts:185-195`
- `src/components/status-panel.ts:197`
- `src/components/event-card.ts:126-134`
- `src/components/entitlement-panel.ts:314`
- `docs/deploy/STAGING.md:183-188` (§6) and `docs/deploy/PRODUCTION.md:137-151` (steps 6 and 7), which never mention 聯絡連結
- The docs that expect a contact link: `docs/deploy/ROLLBACK.md:26`, `docs/deploy/LINK-CHECKLIST.md:26,37,46,50`

**Failure scenario.** An operator follows STAGING or PRODUCTION exactly. They bind the pages, set `demo`, pick a featured event and never touch 聯絡連結, so `links.contact` is `null`. Then:

- `/live/help/` shows only the fallback sentence 「如需協助，請透過網站的聯絡方式與我們聯繫。」 with no Contact link. This breaks spec §5.5 (「原站 Contact 入口」) and fails LINK-CHECKLIST row 7.
- After a rollback to `disabled`, the events and player pages show only 「回首頁」, not the home and contact links that D16 requires. ROLLBACK §2 A promises both, and LINK-CHECKLIST row 9 fails.
- A cancelled event shows no 聯絡窗口 (spec §6, LINK-CHECKLIST row 13), and the entitlement-unavailable panel offers no contact link either.

**Fix.** Add a required step to STAGING §6 and PRODUCTION step 6: set 站內連結覆寫 → 聯絡連結 to the site's `/contact/` page, and check it in 部署資訊. Alternatively, have the deploy-info screen warn when `contact_url` is empty.

## 2. [medium] build-info records a misleading commit; the shipped artifact points at a commit without the code

**Where:** `scripts/build-info.mjs:20-24,67` (`git rev-parse --short HEAD` with no dirty-tree check) and `plugin/wg-live/assets/dist/build-info.json:3` (`"commit": "e4dfc15"`). `scripts/check-artifact.mjs` does not check the commit at all.

**Failure scenario.** `artifacts/wg-live-0.1.0.zip` matches the working tree byte for byte, and its `build-info.json` says commit `e4dfc15`. That commit holds only the spec, `CLAUDE.md` and the gitignore files. The plugin, the TS source and the scripts arrived in `bc1e150`, 38 s after `builtAt`. 部署資訊 shows 「建置 commit e4dfc15」, and PRODUCTION step 13 and DEPLOY-RECORD §2 tell the operator to copy that value. Anyone who later checks out the recorded commit to rebuild or audit the release finds no code. That breaks spec §18.3 (版本、Git commit…) and §19.4 (開發者能重現建置、部署與回復).

**Fix.** Record the full SHA plus a `dirty` flag (`git status --porcelain`). Make `npm run package` refuse a dirty or "uncommitted" build unless an override flag is passed, and have `check-artifact` report the commit. Rebuild 0.1.0 from `bc1e150`.

## 3. [medium] A published event without a start time disappears from every public surface, and the admin is not told

**Where**
- `plugin/wg-live/includes/class-public-data.php:164-168` (`public_event()` returns `null`)
- `plugin/wg-live/includes/class-events.php:758-764` (only the warning 「這場活動尚未設定開始時間。」)
- `class-events.php:871-882` (the list shows the slug as 「有效」 and the time as 「—」, with no 「不會公開」 flag)
- `class-settings.php:965-988` (the featured selector offers the event without comment)
- `src/util/time.ts:44-45` (the 「時間待公布」 path is unreachable because `src/boot.ts:436` also drops the event)

**Failure scenario.** An admin publishes an event with the time still to be announced, a normal pre-announcement case, leaving 開始時間 blank. The save succeeds and the post shows as published with a valid 代稱. Every public surface then hides it:

- `/live/` shows 「目前沒有已公布的線上音樂會」 or omits the card.
- The REST list omits it, and `events/{slug}` returns 404.
- `/live/listen/?wg_event=…` shows 「找不到這場活動」.
- If it is the featured event, the homepage falls back to 「線上音樂會資訊即將公布」.

The admin UI, unlike its handling of an invalid 代稱, never says the event is not shown to visitors.

**Fix.** Either treat a missing start time like a missing 代稱 (force draft and name the problem), or publish it with `startsAt: null` and render 「時間待公布」. In both cases, flag the event in the list and in the featured selector.

## 4. [low] The event title is not required (spec §10.2 「活動標題、代稱｜必填」)

**Where:** `plugin/wg-live/includes/class-events.php:556-624` validates only the 代稱. The CPT supports only `title` and `thumbnail`, so `wp_insert_post` does not reject an empty title (its `$maybe_empty` check needs `editor` support).

**Failure scenario.** An admin enters a valid 代稱, leaves the title empty and publishes. The event becomes public with an empty card heading. The `<article aria-labelledby>` name is empty, and CTA names read 「體驗播放介面：」 (`src/components/event-card.ts:164-170,249`). The homepage card renders an empty `<h2>` (`templates/featured.php:42`), and the player shows an empty title.

**Fix.** In `filter_insert_post_data`, treat an empty `post_title` on a publish attempt the same way as an empty 代稱: force draft and show a notice.

## 5. [low] The runbooks require draft-phase checks that the code cannot support

**Where**
- `plugin/wg-live/includes/class-site-links.php:79` (links only to published pages)
- `plugin/wg-live/includes/class-settings.php:1379-1387` (deploy info shows 「—」 for drafts)
- `src/state/model.ts:517-522` (with no player link, the CTA falls back to 「查看活動資訊」)
- `docs/deploy/PRODUCTION.md:134` (step 5.2) and `:155-157` (step 8)
- `docs/deploy/STAGING.md:179,188`

**Failure scenario.** PRODUCTION step 5.2 says to confirm in 部署資訊 that the three IDs resolve to `/live/`, `/live/listen/` and `/live/help/`. At that point the pages are drafts by design, so the screen shows 「—」 with 「未發布，站內連結不會輸出」 and the check can never pass.

In step 8 and STAGING §6.4, the admin previews the draft events page. Demo cards show a 「查看活動資訊」 toggle instead of 「體驗播放介面」, and the 聆聽方式 and FAQ help links are missing. The page under review is therefore not what will be published, and the documented 活動列表 → 播放 flow cannot be clicked through.

**Fix.** Move the permalink check after step 9 (publish). In step 8, tell the reviewer that internal links appear only after publishing. Alternatively, show the draft paths in 部署資訊 and emit links for users who can edit the pages.

## 6. [low] The docs and readme name admin screens and UI that do not exist

**Where**
- `docs/deploy/STAGING.md:13` ("Settings", "Deployment info", and 「建立建議頁面指設定頁的 Create suggested pages」)
- `docs/deploy/ROLLBACK.md:25` (「Live 活動 → Settings」)
- `docs/deploy/PRODUCTION.md:126` (「設定頁的「建立建議頁面」」)
- `plugin/wg-live/readme.txt:31` ("Open the WG Live admin menu, then Settings")
- `docs/deploy/LINK-CHECKLIST.md:34` (「活動頁／播放頁的「登入」」)
- The real labels: `class-events.php:224` (menu 「Live 活動」) and `class-settings.php:500-502` (submenus 「設定」「部署資訊」「建立建議頁面」)

**Failure scenario.** During an incident, ROLLBACK step A tells the operator to open 「Live 活動 → Settings」. No such item exists; the item is 「設定」. 「建立建議頁面」 is its own submenu, not part of the settings page. The readme's "WG Live admin menu" does not exist either. The php-admin report says the labels were renamed to 設定 / 部署資訊 / 建立建議頁面, but the docs were never updated.

LINK-CHECKLIST row 4 also expects a 登入 button on the player page. In M1 the entitlement is never `guest`, so the player never renders one and the row cannot pass.

**Fix.** Use the real Chinese labels everywhere. Describe 建立建議頁面 as a submenu. Limit LINK-CHECKLIST row 4 to the events page.

## 7. [low] The client entitlement placeholder is frozen at mount and can get stuck on 「暫時無法確認觀看資格」

**Where:** `src/views/player.ts:108` (`createEntitlementPlaceholder(boot.events)`), `src/adapters/entitlement-placeholder.ts:27-28,54-55`, and `src/state/coordinator.ts:784` (`fetchEntitlement()` after a polled change).

**Failure scenario.** A viewer has `/live/listen/?wg_event=x` open. Event x is the 「來源尚未設定」 event that STAGING §6.2 creates, so the view shows 「播放來源尚未開放」. The admin then ticks 示範活動 and sets 來源類型 to 示範. Within 60 s the poller delivers `sourceKind: 'demo'`, the gate opens and the coordinator asks the placeholder for entitlement. The placeholder still holds the mount-time copy (`isDemo: false` or `sourceKind: 'not_configured'`), so it answers `unavailable`.

The viewer sees 「暫時無法確認觀看資格」 with a 重試 button that always gives the same answer, while the server would say `entitled`. Only a reload fixes it.

**Fix.** Let the placeholder read the coordinator's current `state.event.data`, or recreate it inside `updateEvent`.

## 8. [low] The Help page promises a 「尚未確認」 state that the player never shows

**Where:** `src/i18n/copy-help.ts:39`. A grep of `src/` finds 「尚未確認」 only in this sentence; no component renders it.

**Failure scenario.** The Help page tells viewers 「無法確認時，畫面會顯示「尚未確認」，而不是假設可以播放。」 In practice, `canPlayType` returning `maybe` plays, and `''` shows 「目前環境無法播放這個音訊版本」 (`native-media.ts:257-261`). A viewer or tester who looks for the promised state never finds it. Spec §9.4 asks for the state itself, not for a description of it.

**Fix.** Remove the sentence for M1, or render 「尚未確認」 where support is actually unknown, for example in the compatibility table or for `canPlayType === 'maybe'`.

## 9. [low] The dev panel cannot show the retry limit, and the fault select goes stale

**Where:** `src/components/dev-panel.ts:94-97` (it injects only on `change`; `update()` never resets the select), `src/state/coordinator.ts:538-542,614` (`takeFault()` is one-shot by design) and `docs/deploy/STAGING.md:216` (F08/F09).

**Failure scenario.** STAGING F08 tells the tester to use the dev panel to show 「有上限重試與手動重試，不無限轉圈」. The tester picks 「網路中斷」. One attempt fails, the first automatic retry 2 s later succeeds, and the tester never sees 「無法播放，請重試」 or the retry limit. The select still reads 「網路中斷」 although nothing is pending, and picking the same option again fires no `change`. Testing the limit means toggling the select inside each 2 s, 5 s and 10 s window.

The one-shot behaviour is a recorded decision. The defect is that the documented check cannot be done this way.

**Fix.** Reset the select to 「不注入」 once the fault has been used, and add a "fail every attempt" option. Otherwise, change F08 to verify the limit with offline mode in devtools.

## 10. [low] The create-pages conflict check ignores attachments in the page slug namespace

**Where:** `plugin/wg-live/includes/class-settings.php:1488-1498,1505-1518` (the query is `post_type = 'page'` only).

**Failure scenario.** The media library holds an unattached file whose slug is `live`, for example an upload named 「Live.jpg」. WordPress's `wp_unique_post_slug()` checks hierarchical slugs against `post_type IN (page, 'attachment')` for the same parent. The preview says 「可建立」 and the draft keeps `post_name = live`. When the admin publishes it (PRODUCTION step 9), WordPress renames it to `live-2`, so the area moves to `/live-2/` and `/live-2/listen/`. That contradicts spec §4.1 (「建立前先檢查相同 slug 是否已被使用」) and the paths the runbooks check.

**Fix.** Also check `attachment` (and any other hierarchical type that shares the namespace) at parent 0, and report it as a conflict.

## 11. [low] HANDOVER says the front end polls event status, but `/live/` and the homepage card are page-cacheable snapshots

**Where:** `docs/deploy/HANDOVER.md:334` (「前端以合理間隔輪詢公開活動狀態」), `docs/deploy/NAV-HOMEPAGE.md:96` (「活動公開介紹可以快取」), `src/views/events.ts:7-8` (bootstrap only) and `templates/featured.php` (PHP only).

**Failure scenario.** The site runs a page cache, which NAV-HOMEPAGE allows for the public pages. At showtime the admin changes an event to 直播中, or cancels it. The player page polls REST and updates. `/live/` and the homepage card keep the cached status badge, CTA and cancellation notice until the cache expires or is purged. HANDOVER's daily-operations section never says to purge, and it claims polling that these two pages do not do. That contradicts spec §12 step 6 (管理者修改內容後，前端能更新).

**Fix.** In HANDOVER §6 and NAV-HOMEPAGE §5, say that only the player polls, and add "purge `/live/` and the homepage after publishing or changing an event". Optionally, exclude these pages from long-lived caching.

## 12. [low] The account link prefers the admin override over WooCommerce, the reverse of spec §10.4, and the plan does not record the deviation

**Where:** `plugin/wg-live/includes/class-site-links.php:41,95-107` and the spec at line 647 (「登入連結優先使用既有 WooCommerce Account URL；WooCommerce 不可用時使用管理者設定的有效帳號頁」). Plan 4.1 states the reverse order, but `M1-PLAN.md` says spec deviations must be recorded, and this one is not.

**Failure scenario.** With WooCommerce active, an admin who has filled in 帳號頁連結, for example a leftover value or an absolute URL that differs from `/my-account/`, sends every 登入 CTA to that URL instead of the WooCommerce Account page, which is what spec §10.4 and §16.4 require. If the host differs, the only guard is the 部署資訊 host warning.

**Fix.** Use the WooCommerce page first and the override only when WooCommerce is unavailable. Alternatively, record the deviation in `M1-PLAN.md` and say in the settings help text that the override wins.

---

## Checked and found compliant (not defects)

- **D1–D3.** The JSON bootstrap and container match plan 3.1, including the HEX flags and the live region outside `aria-busy`. The featured card is PHP-only. Two builds produce exactly the fixed dist set plus `build-info.json`.
- **D4–D6.** `PublicEvent` and the REST whitelist carry no source fields. The server order is disabled → public → mode → entitlement → source → status. Entitlement fails closed on server and client.
- **D7.** The two bundled MP3s are delivered with `?ver`. The adapter sets `loop`, and the demo label appears in both modes.
- **D9–D10.** One stable media element is created per player, and `destroy()` removes listeners before resetting. The `<dialog>` and inline fallback work, with a bottom sheet at ≤768 px.
- **D12–D14.** `h()`/`safeUrl` are used everywhere, all CPT caps map to `Plugin::cap()`, and the slug pattern is shared with a sync test.
- **D16–D19.** Covered as described in the result above.
- **Packaging (§15).** There is a single `wg-live/` root and the allowlist, hashes, versions and `.sha256` all check out. Installing the ZIP through Plugins → Upload in a clean WordPress was not exercised by any automated test: wp-env mounts the folder. This is a verification gap, not a defect.
- **Rollback (§18.1).** The order is disabled → withdraw pages → remove homepage block and menu item → deactivate, the uninstall opt-in is documented, and there is no full DB restore without sign-off.
