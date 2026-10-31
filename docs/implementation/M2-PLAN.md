# M2 Implementation Plan: real streams, tickets and playback authorization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 1, 2026-10-31. All §1 decisions are made (D1: both; D2–D5: the recommendations). Phase A is in progress. Phases B to E wait on the provider deliverables in §2. Once approved, this plan becomes binding the way [M1-PLAN.md](M1-PLAN.md) is: change it together with `src/types.ts`.

**Goal:** A viewer who bought the ticket for an event can watch the studio's real live stream on `/live/listen/`, in Binaural or Dolby Atmos, and nobody else can.

**Architecture:** The server decides everything. `Entitlement::check` answers from the viewer's paid WooCommerce orders for the event's ticket product. `Playback_Provider::resolve` then hands out a short-lived, provider-signed HLS URL for the chosen mode, and only during `live`/`intermission`. The client gets that URL only from `/playback`, never from `PublicEvent`. For an `hls` source it plays the URL through Safari's native HLS or through the plugin's own pinned hls.js. hls.js ships as a separate file, outside the 100 KB core budget. For an `iframe` source it embeds the provider's admin-approved HTTPS player page and hides our own controls.

**Tech Stack:** PHP 7.4+ on WordPress 7.1 with WooCommerce (`wc_get_orders`, HPOS-safe); TypeScript and Vite; hls.js 1.7.3 (light build); Playwright (integration on WSL wp-env, plus e2e); ffmpeg for test fixtures.

**Spec:** [WG_Studio_Live_Design_and_WordPress_Deployment_Spec.md](../../WG_Studio_Live_Design_and_WordPress_Deployment_Spec.md):
- §0.2, M2 = 接入錄音室正式來源、有效票券判斷、播放授權、實機音訊驗收、直播負載與完整彩排;
- §8.5 contracts;
- §9.2–9.4 adapters;
- §10.4 data rules;
- §13.5 load;
- §17 security;
- §19.5 blockers.

Also read [M1-PLAN.md](M1-PLAN.md) §6.9, the recorded M2 contract, and the stream probe [hls-signal-probe-2026-10-30.md](../../evidence/test-results/hls-signal-probe-2026-10-30.md).

---

## 1. Decisions (decided by the deployer, 2026-10-31: D1 both; D2–D5 as recommended)

Each row has a recommendation. The plan below assumes the recommendation; a different answer changes only the tasks named.

| # | Decision | Recommendation | Changes if different |
|---|---|---|---|
| D1 | Playback path | **Decided 2026-10-31: both.** Each event chooses its source type:<br>• `hls`: our player (B, C), with the full Binaural/Atmos switch, status and controls;<br>• `iframe`: the provider's own player page (Phase D). It uses the provider's controls only; spec §9.3 forbids overlaid controls without a vendor API.<br>Both go through the same entitlement and signing. | — |
| D2 | What counts as a ticket | **A paid order (`wc_get_is_paid_statuses()`, i.e. processing/completed) by the logged-in account, containing the event's `product_id` (or a variation of it), not fully refunded.** One ticket product per event. | Bundles, passes or multi-event tickets need a product→event map (A1). |
| D2b | Guest checkout for ticket products | **Off.** An order without an account cannot be matched without guessing from e-mail, which the spec forbids. Shop setting, done by the admin. | If guest orders must count: the viewer links the order to an account first (WooCommerce does this by e-mail on account creation; that is WooCommerce's doing, not ours). |
| D3 | Staff and comp access | **Zero-price WooCommerce orders** created by a shop manager for staff and press. No role-based bypass (CLAUDE.md: never infer ownership from roles). | A per-event user allowlist (new task after A2). |
| D4 | Unsigned stream URLs in production | **Never.** Production resolves `not_ready` until a signer is configured. Escape hatch: the constant `WG_LIVE_ALLOW_UNSIGNED_STREAMS` (default false), documented as a risk. | Allowing unsigned: anyone with a leaked URL watches for free. |
| D5 | Where to rehearse | **A staging copy of the site** (host-provided staging or a subdomain), with the provider's staging stream. | Production with a hidden test event, as done on 2026-10-29: possible, but every rehearsal step is a public change. |

## 2. Provider deliverables (blocks B3b, C4 real-stream checks, E2, E3)

From the 2026-10-30 probe. Ask in writing, with dates:
1. HTTPS on a domain name with a valid certificate.
2. HLS in **fMP4/CMAF** segments (MPEG-TS with E-AC-3 plays in no Windows browser).
3. **Two playlists per event:**
   - Atmos: video plus E-AC-3 JOC only;
   - Binaural: video plus an AAC stereo binaural mix.
4. **Signed URLs**, e.g. Wowza SecureToken:
   - the documented algorithm;
   - a shared secret delivered out of band;
   - **one test vector** (input URL, times, secret, expected output);
   - the token lifetime they support.
5. Written capacity for 300 concurrent viewers per playlist:
   - egress or CDN;
   - an ABR ladder (lower bitrates);
   - monitoring during the show.
6. A staging stream that runs on demand, plus the rehearsal schedule.
7. The boss's Apple-device results from the test sheet, entered by a person into `evidence/test-results/manual-devices.md`.

## Global Constraints

Every task's requirements include these.

**Sources and access**
- `PublicEvent`, bootstrap JSON, HTML data attributes, JSON-LD and `VITE_*` never contain a source URL, token or secret (spec §10.4, §17).
- No entitlement result means no playback. Errors fail closed with `not_ready` and never fail open (spec §8.5).
- Entitlement and playback responses: `Cache-Control: no-store, private` and `DONOTCACHEPAGE`. Never page-cached (spec §17).
- Ownership comes only from orders linked to the user ID. Never from roles, e-mail strings or a front-end flag (spec §10.4, CLAUDE.md).
- WordPress never proxies media segments. No Service Worker (spec §17).
- Secrets live only in `wp-config.php` constants, never in options, post meta or admin screens. The deploy-info screen shows "configured: yes/no" only.

**Playback behaviour**
- One active adapter or media source per page. On a switch:
  1. stop the old media;
  2. `hls.destroy()`;
  3. load the new one.
  
  Update 「目前播放」 only after the new source succeeds, and don't carry `currentTime` across (CLAUDE.md, spec §9.2).
- Never autoplay; play only inside a user gesture; handle a rejected `play()`. The `<video>` element is never rebuilt.
- Choose the path by feature detection, never by browser name. When unclear, show 尚未確認 (spec §9.4).
- Binaural is never blocked for non-Safari browsers (spec §9.4).
- No fake capabilities: no Dolby badge, no "Atmos certified". 「目前播放：Dolby Atmos 音軌」 names the track, not the device output (M1-PLAN §6.10).
- Real (non-demo) sources never show the demo label 「操作示範音訊，非 Binaural／Atmos 驗證素材」. Demo events keep it.

**Budgets, copy and scope**
- Budgets: core JS ≤ 100 KB gzip and CSS ≤ 30 KB gzip, **excluding** the HLS library file (CLAUDE.md).
- UI copy is Taiwan Traditional Chinese. Reuse the existing strings for guest, not entitled, unavailable and unsupported (`src/i18n/copy-status.ts`): 「請先登入」, 「尚未取得觀看資格」, 「暫時無法確認觀看資格」, 「目前環境無法播放這個音訊版本」.
- Load testing: only stepped tests of pages and `wg-live/v1/*`, in an approved environment. Never 300 streams against production from our side; stream capacity is the provider's to prove (spec §13.5).
- Reports keep 已實作 / 已測試 / 已部署 / 尚待外部條件 apart. Do not call it "paid live streaming is securely online" before E3 is accepted.

## Review Focus

Most likely to bite a real viewer first; each line has its test in the named task.

1. **Login nonce expires.** A viewer keeps the page open for hours (doors open long before the show), the REST nonce expires, and `/entitlement` or `/playback` returns 403 `rest_cookie_invalid_nonce`. Expected: 「暫時無法確認觀看資格」 with 重試, and 重試 fetches a fresh nonce. Never 「尚未取得觀看資格」. Tested in A3.
2. **Bought without logging in.** The viewer bought with guest checkout (D2b not yet applied) or with a different account. Expected: 「尚未取得觀看資格」 with 購票, never playback, and the Help page explains "log in with the account you bought with". Tested in A1 (guest order is not owned) and A2.
3. **Refund after purchase.** A fully refunded line item stops granting access at the next `/playback` call. A partial refund of a 2-ticket order still grants access. Tested in A1.
4. **Atmos on a browser without E-AC-3** (Chrome, Brave, Firefox). Expected: Atmos shows 「目前環境無法播放這個音訊版本」 before any download starts, Binaural still plays, and nothing claims Atmos. Tested in C2 and C4.
5. **Token expires mid-show** (the show runs longer than the token lifetime), so segments return 403. Expected: the coordinator's bounded retry asks `/playback` again for a fresh signed URL and resumes, with no infinite loop and no 「目前播放」 change during the retry. Tested in C2 (fake 403) and B3 (lifetime ≥ event length + margin).

---

## File structure

| Path | Responsibility |
|---|---|
| `plugin/wg-live/includes/class-tickets.php` (new) | `Tickets::owns_product()`: the WooCommerce order query, nothing else. |
| `plugin/wg-live/includes/class-entitlement.php` | M2 branches of `check()`. |
| `plugin/wg-live/includes/class-stream-signer.php` (new) | Signer interface, `Unsigned_Signer`, and the factory from constants and environment. |
| `plugin/wg-live/includes/class-stream-signer-wowza.php` (new, B3b) | The provider algorithm, once documented. |
| `plugin/wg-live/includes/class-playback-provider.php` | HLS branch of `resolve()`. |
| `plugin/wg-live/includes/class-public-data.php` | `/entitlement` route, `rest.nonce` and `assets.hls` in the boot config. |
| `plugin/wg-live/includes/class-settings.php` | Mode `live`, stream host allowlist, deploy-info lines. |
| `plugin/wg-live/includes/class-events.php` | HLS source fields, validation, admin UI. |
| `src/types.ts` | `DeploymentMode`, `BootConfig.rest.nonce`, `BootConfig.assets`. |
| `src/adapters/providers.ts` | Nonce header, `createRestEntitlementProvider`. |
| `src/adapters/hls-path.ts` (new) | `chooseHlsPath`, `canPlayMode`: pure feature detection. |
| `src/adapters/hls.ts` | The HLS adapter, replacing the inert stub. |
| `src/adapters/iframe.ts` | The provider-player adapter, replacing the inert stub (D2). |
| `dev/fake-player/` (new) | A fake provider player on a second local origin, for the D3 and D4 tests. |
| `src/vendor/hls-entry.ts` (new) | Exposes hls.js light as the global `WGLiveHls` in its own IIFE file. |
| `src/state/model.ts`, `src/state/coordinator.ts` | Accept `hls`, refresh on token expiry, live labels. |
| `scripts/make-hls-fixture.mjs` (new) | Local fMP4 HLS fixture: AAC stereo plus E-AC-3 5.1, not Atmos. |
| `scripts/check-artifact.mjs`, `scripts/package.mjs`, `vite.config.ts` | Third build, allowlist, license notice. |
| `tests/integration/tickets.spec.ts`, `tests/integration/playback-hls.state.spec.ts` (new) | Server behaviour on wp-env with WooCommerce. |
| `tests/unit/adapters/hls.test.ts`, `tests/unit/adapters/hls-path.test.ts` (new) | Client behaviour with a fake Hls. |

---

## Phase A: ticket entitlement (can start now)

### Task A1: `Tickets::owns_product`

**Files:**
- Create: `plugin/wg-live/includes/class-tickets.php`; load it in `wg-live.php` beside the other includes.
- Test: `tests/integration/tickets.spec.ts` (non-state project; it creates its own users, products and orders, and deletes them).

**Interfaces:**
- Produces: `WG_Live\Tickets::owns_product( int $user_id, int $product_id ): bool`.

- [ ] **Step 1: Write the failing tests** (each builds its fixtures with `wpPhp`: `wc_create_order( array( 'customer_id' => $u ) )`, `add_product`, `set_status`, `save`; refunds via `wc_create_refund`):

```ts
test('a completed order for the product grants it', () => expect(owns(user, product)).toBe(true));
test('processing counts; pending, on-hold, cancelled, failed and refunded orders do not', ...);   // one assertion per status
test('a variation of the product counts as the product', ...);
test('another product, another user, user 0 and product 0 are false', ...);
test('a guest-checkout order (customer_id 0) with the same e-mail is false', ...);   // Review Focus 2
test('a fully refunded line item is false; 1 of 2 refunded is still true', ...);       // Review Focus 3
test('WooCommerce inactive -> false, no fatal error', ...);   // wpPhp with function_exists guard simulated via filter
```

- [ ] **Step 2: Run them to see them fail.** Run `npm run test:integration:wsl -- tests/integration/tickets.spec.ts --project=chromium`. Expected: FAIL, "Class WG_Live\Tickets not found".
- [ ] **Step 3: Implement `owns_product`.**
  - Return false when `$user_id < 1`, `$product_id < 1` or `! function_exists( 'wc_get_orders' )`.
  - Query `wc_get_orders( array( 'customer_id' => $user_id, 'status' => wc_get_is_paid_statuses(), 'limit' => -1 ) )`.
  - For each line item, compare `get_product_id()` or `get_variation_id()` with `$product_id`. Net quantity = `get_quantity() + $order->get_qty_refunded_for_item( $item_id )`; it must be > 0.
  - No caching.
- [ ] **Step 4: Run the tests again.** Expected: PASS. Then run `npm run lint:php`; expected: ok.
- [ ] **Step 5: Commit.** `feat(m2): ticket ownership from paid WooCommerce orders`

### Task A2: `Entitlement::check` in live mode, `/entitlement` route, nonce in the bootstrap

**Files:**
- Modify: `class-entitlement.php`, `class-public-data.php`, `class-settings.php` (only the `live` value accepted by `normalize`/`sanitize`, the radio button and the deploy-info line), `src/types.ts`.
- Test: `tests/integration/entitlement.state.spec.ts` (changes the deployment mode; add `'entitlement'` to `STATE_ORDER` in `playwright.integration.config.ts`).

**Interfaces:**
- Consumes: `Tickets::owns_product`.
- Produces:
  - `DeploymentMode = 'disabled' | 'demo' | 'live'`. `Public_Data::is_enabled()` is true for `demo` and `live`.
  - `GET wg-live/v1/entitlement?event=<id>` returns `{ status: 'guest'|'not_entitled'|'entitled'|'unavailable', reason?: string }` with no-store headers.
  - `GET wg-live/v1/nonce` returns `{ nonce: string | null }` for the current cookie, with no-store headers. A3 uses it to retry after a nonce expires.
  - `BootConfig.rest.nonce: string | null`: `wp_create_nonce( 'wp_rest' )` when logged in, else null.
  - `Entitlement::check` order:
    1. disabled → unavailable/`disabled`;
    2. event not public → unavailable/`event_not_found`;
    3. demo event with demo source → entitled/`demo` (unchanged);
    4. mode ≠ `live` → unavailable/`not_live_mode`;
    5. user 0 → guest;
    6. `product_id` not a published product → unavailable/`no_ticket_product`;
    7. otherwise entitled if `owns_product`, else not_entitled.

- [ ] **Step 1: Write the failing tests:**
  - Demo mode keeps M1 behaviour: a real event → unavailable/`not_live_mode`.
  - In live mode:
    - guest → `guest`;
    - a buyer → `entitled`;
    - a logged-in non-buyer → `not_entitled`;
    - an event without a ticket product → unavailable/`no_ticket_product`.
  - A logged-in request **without** `X-WP-Nonce` is treated as a guest. That's WordPress cookie-auth behaviour; the assertion documents it.
  - The response carries `cache-control` containing `no-store`.
  - A guest's boot JSON has `"nonce":null`; a logged-in user's has a 10-character nonce.
  - The deploy-info screen lists mode 「正式（live）」.
- [ ] **Step 2: Run them to see them fail.** Run `npm run test:integration:wsl -- --no-deps --project=chromium-state-entitlement`. Expected: FAIL.
- [ ] **Step 3: Implement** the order above in `Entitlement::check()`, the route `rest_entitlement( WP_REST_Request $r ): WP_REST_Response` (with the same no-store header block as `rest_playback`), and the `nonce` key in `boot_config()`.
- [ ] **Step 4: Run them again.** Expected: PASS. Then run `npm run check`.
- [ ] **Step 5: Commit.** `feat(m2): live mode entitlement and REST nonce`

### Task A3: client entitlement over REST

**Files:**
- Modify: `src/adapters/providers.ts`, `src/adapters/entitlement-placeholder.ts`, `src/core/` (where providers are wired), `src/types.ts`.
- Test: `tests/unit/adapters/providers.test.ts`, `tests/unit/adapters/factory-entitlement.test.ts`.

**Interfaces:**
- Consumes: `BootConfig.rest.nonce`, `/entitlement`.
- Produces:
  - `createRestEntitlementProvider(restRoot: string, nonce: () => string | null): EntitlementProvider`.
  - `getJson` sends `X-WP-Nonce` when `nonce()` is non-null.
  - Rule: demo events keep the placeholder rule. Non-demo events in `live` mode use REST. Any HTTP or parse failure becomes `{ status: 'unavailable', reason: 'network'|'http'|'session_expired' }`, never `not_entitled`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('sends X-WP-Nonce when logged in and nothing when nonce() is null', ...)
it('403 rest_cookie_invalid_nonce maps to unavailable/session_expired, not not_entitled', ...)   // Review Focus 1
it('unknown status string maps to unavailable', ...)
it('demo events never call the REST entitlement endpoint', ...)
it('retry after session_expired re-reads the nonce from GET wg-live/v1/nonce', ...)
```

  The last test uses the `GET wg-live/v1/nonce` route from A2.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run tests/unit/adapters`. Expected: FAIL.
- [ ] **Step 3: Implement** the provider and the wiring. The player's entitlement panel already renders all four states.
- [ ] **Step 4: Run the checks.** Run `npm run check`. Expected: PASS, with the size budgets unchanged.
- [ ] **Step 5: Commit.** `feat(m2): REST entitlement provider with nonce refresh`

---

## Phase B: sources on the server (needs D1, D4; B3b needs provider item 4)

### Task B1: stream host allowlist and HLS source fields

**Files:**
- Modify: `class-settings.php` (admin-only field `stream_hosts`: hostnames, one per line, validated with `wp_parse_url`; https-only), `class-events.php`.
- Test: `tests/integration/playback-hls.state.spec.ts`; add `'playback-hls'` to `STATE_ORDER`. B2 and B3 add their tests to the same file.

**Interfaces:**
- Produces:
  - Event meta:
    - `source_type` gains `hls`, enabled in the admin. Task D1 enables `iframe`;
    - `source_hls_binaural` and `source_hls_atmos` are strings, saved only when `https:` and the host is on `stream_hosts`;
    - in `local`/`development` environments, `http://localhost` and `http://127.0.0.1` are also accepted, for fixtures.
  - `Settings::stream_hosts(): string[]`.
  - Save-time warnings in Taiwan Chinese:
    - a mode is offered without its URL;
    - a URL is rejected (bad scheme or host).

- [ ] **Step 1: Write the failing tests:**
  - An editor saves an allowlisted https URL and it is stored.
  - An http URL on production and a non-allowlisted host are refused with a notice, and the old value stays.
  - Only an administrator can change `stream_hosts` (an editor gets 403 on the settings screen; covered by existing tests).
  - **No leak:** the source URL string is absent from:
    - `GET events`;
    - `GET events/<slug>`;
    - the `/live/`, `/live/listen/` and home HTML (including boot JSON and data attributes);
    - the featured card.
- [ ] **Step 2: Run them to see them fail.** Run `npm run test:integration:wsl -- --no-deps --project=chromium-state-playback-hls`. Expected: FAIL. B2 and B3 use the same command.
- [ ] **Step 3: Implement.** Use a whitelist in `Events::save_post`. `Public_Data` keeps its explicit field list, so add nothing there.
- [ ] **Step 4: Run them again.** Expected: PASS. Then run `npm run lint:php`.
- [ ] **Step 5: Commit.** `feat(m2): admin-approved HLS source fields`

### Task B2: stream signer and production guard

**Files:**
- Create: `class-stream-signer.php`.
- Test: `tests/integration/playback-hls.state.spec.ts`.

**Interfaces:**
- Produces:

```php
interface Stream_Signer { public function sign( string $url, int $expires_at ): string; } // '' = refuse
final class Unsigned_Signer implements Stream_Signer {}
final class Stream_Signers { public static function current(): ?Stream_Signer; public static function ttl( int $event_id ): int; }
```

`current()`:
- returns the provider signer when its constants are defined (B3b);
- else `Unsigned_Signer` when the environment type is not `production` or `WG_LIVE_ALLOW_UNSIGNED_STREAMS === true`;
- else null.

`ttl()` is the event length (`WG_LIVE_TOKEN_TTL` constant, default 4 h) plus 30 min.

The deploy-info screen shows 「串流簽章：已設定／未設定（正式站將不提供播放）」.

- [ ] **Step 1: Write the failing tests:**
  - Local env → unsigned signer.
  - With `WP_ENVIRONMENT_TYPE` production (the tests site on :8889) and no constants, `current()` is null.
  - With the constant true, it is unsigned.
  - `ttl` is at least 4 h + 30 min (Review Focus 5).
  - No secret value appears in the deploy-info HTML.
- [ ] **Step 2: Run, implement and pass.** Then commit `feat(m2): stream signer selection`.

### Task B3: HLS branch of `Playback_Provider::resolve`

**Files:**
- Modify: `class-playback-provider.php`.
- Test: `tests/integration/playback-hls.state.spec.ts`.

**Interfaces:**
- Consumes: B1 fields, B2 signer, A2 entitlement.
- Produces: `/playback` returns `{ kind: 'hls', url: <signed>, mode }` when all of these hold:
  - mode `live`;
  - entitled;
  - `source_type` hls;
  - URL present for the mode;
  - status `live|intermission`;
  - signer not null and the signed URL non-empty.

  Otherwise it returns the existing `not_ready` reasons (signer null → `source_not_configured`). The resolution order stays as in M1 steps 1–6: entitlement is checked **before** any source meta is read.

- [ ] **Step 1: Write the failing tests:**
  - A guest gets `not_ready/not_entitled`, and the body has no `http`.
  - A buyer gets `hls` with the configured host for the requested mode.
  - Status `doors_open` returns `event_not_playable`.
  - Production without a signer returns `source_not_configured`.
  - Atmos requested on an event offering only binaural returns `mode_unavailable`.
  - The response is no-store.
- [ ] **Step 2: Run, implement and pass.** Then commit `feat(m2): resolve signed HLS sources after entitlement`.

### Task B3b: provider signer (blocked on provider item 4)

**Files:** create `class-stream-signer-wowza.php` (or the provider's name).

**Interfaces:** `final class Wowza_Signer implements Stream_Signer`, reading `WG_LIVE_WOWZA_SECRET` and `WG_LIVE_WOWZA_PREFIX` from `wp-config.php`.

- [ ] **Step 1:** Put the provider's **test vector** into a test as the only expected value (`sign( <their URL>, <their end time> ) === <their output>`). Do not write the algorithm from memory; the vector is the spec.
- [ ] **Step 2:** Implement the algorithm from their documentation until the vector passes. Then commit `feat(m2): provider URL signing`.
- [ ] **Step 3:** On staging, a signed URL plays and the same URL with one character changed returns 403 from the provider. Record both in evidence.

---

## Phase C: HLS in the player (needs D1)

### Task C1: hls.js as its own file

**Files:**
- Create: `src/vendor/hls-entry.ts`, `plugin/wg-live/assets/dist/THIRD-PARTY-NOTICES.txt` (generated from hls.js's Apache-2.0 license by the build).
- Modify:
  - `package.json`: dependency `hls.js@1.7.3`, exact;
  - `vite.config.ts`: third build `--mode hls` → `wg-live-hls.js`, IIFE, global `WGLiveHls`;
  - `scripts/check-artifact.mjs`: allowlist, build-info hash, its own size line with no budget;
  - `scripts/package.mjs`;
  - `plugin/wg-live/readme.txt`: "bundles hls.js (Apache-2.0)";
  - `class-public-data.php` and `src/types.ts`: `BootConfig.assets.hls`, the versioned URL of `wg-live-hls.js`.
- Test: `tests/unit/check-artifact.test.ts`, `tests/unit/build-info.test.ts`.

**Interfaces:** produces `window.WGLiveHls` (the hls.js light default export), defined only by our file. The adapter never reads `window.Hls`.

- [ ] **Step 1: Write the failing tests:**
  - The artifact check rejects a ZIP without `wg-live-hls.js` or without `THIRD-PARTY-NOTICES.txt`.
  - `build-info.json` lists `wg-live-hls.js` with its SHA-256.
  - The core `wg-live.js` gzip size is still ≤ 100 KB and does not contain the string `hls.js`.
- [ ] **Step 2: Run, implement and pass.** Run `npm run check`. Then commit `build(m2): ship hls.js light as a separate file`.

### Task C2: the HLS adapter

**Files:**
- Create: `src/adapters/hls-path.ts`.
- Modify: `src/adapters/hls.ts`, `src/adapters/factory.ts`, `src/types.ts` (`AdapterEnv.hlsScriptUrl: string | null`), and the place in `src/core/` that builds `AdapterEnv`. It sets `hlsScriptUrl` from C1's `BootConfig.assets.hls`.
- Test: `tests/unit/adapters/hls-path.test.ts`, `tests/unit/adapters/hls.test.ts` (fake `WGLiveHls` class, fake media element).

**Interfaces:**

```ts
export type HlsPath = 'native' | 'hlsjs' | 'none';
export function chooseHlsPath(media: HTMLMediaElement, win: Window): HlsPath;
// native when canPlayType('application/vnd.apple.mpegurl') !== '' AND ('ManagedMediaSource' in win OR !('MediaSource' in win));
// hlsjs when MediaSource or ManagedMediaSource exists; else none.
// This refines M1-PLAN §6.9 (iOS < 17.1 has native HLS but no MSE). Update §6.9 in the same commit.
// Probe 2026-10-30: Chrome/Edge 156 answer "maybe" to canPlayType but have no ManagedMediaSource, so they take hls.js.
export function canPlayMode(mode: ListeningMode, path: HlsPath, media: HTMLMediaElement, win: Window): boolean | 'unknown';
// atmos: native → canPlayType('audio/mp4; codecs="ec-3"') !== ''; hlsjs → (Managed)MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"').
// binaural: true unless path === 'none'. 'unknown' only when no API answers; shown as 尚未確認.
export function createHlsAdapter(host: MediaHost, env: AdapterEnv, deps?: { loadHls?: () => Promise<HlsCtor> }): PlaybackAdapter;
```

`load()` behaviour:
- `canPlayMode === false` → reject with `NotSupportedError` before any network request.
- native path → reuse `createNativeMediaAdapter(host, env, { kind: 'hls', loop: false })`.
- hls.js path:
  - inject `env.hlsScriptUrl` once (keep a module-level promise);
  - `new WGLiveHls({ lowLatencyMode: false, enableWorker: true })`;
  - `attachMedia(host.media)`, then `loadSource(url)`.

Errors go out through the existing `on('error', listener)` with an `AdapterErrorDetail`:
- fatal `networkError`, including a 403 from an expired token → `{ code: 'network', fatal: false }`, so the coordinator's reconnect path runs (C3 adds the re-resolve);
- fatal `mediaError` → `recoverMediaError()` once, then `{ code: 'decode', fatal: true }`;
- `manifestIncompatibleCodecsError` and `bufferAddCodecError` → `{ code: 'unsupported', fatal: true }`;
- non-fatal errors are ignored (the coordinator tolerates 15 s, M1-PLAN §6.9).

`destroy()` order: remove own listeners, `hls.destroy()`, then `media.removeAttribute('src')`, then `media.load()`. It must be idempotent.

Capabilities:
- `seekToLive: true` (go to `hls.liveSyncPosition`; native: seekable end);
- `volume` from `env`;
- `remotePlayback` as M1.

- [ ] **Step 1: Write the failing tests:**
  - `chooseHlsPath` table: iOS-17-like (native + MMS) → native; old iOS (native, no MSE) → native; Chrome-like ("maybe", MSE, no MMS) → hlsjs; nothing → none.
  - `canPlayMode('atmos', 'hlsjs')` is false when `isTypeSupported` says no **and no network request was made** (Review Focus 4).
  - `binaural` is never blocked by browser name.
  - Two `load()` calls never create two Hls instances; the first is destroyed first.
  - `destroy()` twice is safe.
  - Calling `load()` alone does not start playback.
  - A fatal 403 `networkError` emits `error` with `{ code: 'network', fatal: false }`, not a fatal error (Review Focus 5; the coordinator re-resolves in C3).
  - `window.Hls` set by "another plugin" is ignored.
- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run tests/unit/adapters/hls`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4: Run them again.** Expected: PASS. Then run `npm run check`.
- [ ] **Step 5: Commit.** `feat(m2): HLS adapter (native or pinned hls.js)`

### Task C3: coordinator and labels for real sources

**Files:**
- Modify: `src/state/model.ts` (`sourceKindFromServer` accepts `hls`), `src/state/coordinator.ts`, `src/components/` (status panel, player head).
- Test: `tests/unit/state/*.test.ts`, `tests/unit/components/*.test.ts`.

**Interfaces:** produces a re-resolve on an adapter `error` with `code: 'network'` and `fatal: false` from an `hls` source. The coordinator calls `/playback` again (bounded by the existing retry policy, at most 3 tries, then 「暫時無法播放」 with 重試) and loads the newly signed URL. 「目前播放」 is unchanged until the new load succeeds.

- [ ] **Step 1: Write the failing tests:**
  - An `hls` source loads through the factory.
  - A real source never renders 「操作示範音訊，非 Binaural／Atmos 驗證素材」 or the 「介面示範」 badge.
  - A reconnect after a token expiry re-resolves exactly once per attempt, and the attempts stop at the limit.
  - The `unsupported` copy is 「目前環境無法播放這個音訊版本」 and the Binaural button stays enabled.
  - 返回直播 shows only when `seekToLive` is true.
- [ ] **Step 2: Run, implement and pass.** Run `npm run check`. Then commit `feat(m2): coordinator support for live HLS sources`.

### Task C4: end to end with a local HLS fixture

**Files:**
- Create: `scripts/make-hls-fixture.mjs` (`npm run demo:hls`). From `demo-video-1.mp4` it writes `tests/.fixtures/hls/{binaural,atmos}/index.m3u8`:
  - fMP4, 4 s segments;
  - binaural: AAC stereo;
  - atmos: E-AC-3 5.1 (`-c:a eac3`; **not** Atmos, and labeled so);
  - `tests/.fixtures/` is gitignored.
- Modify: the dev harness, so it serves the fixture and a fake `/playback` that returns it; `playwright.config.ts`.
- Test: `tests/e2e/hls.spec.ts`.

- [ ] **Step 1: Write the failing tests:**
  - Chromium:
    - Binaural plays (`currentTime` advances, audio decoded bytes > 0);
    - Atmos shows 「目前環境無法播放這個音訊版本」, with no request for the atmos playlist;
    - switching Binaural → Atmos → Binaural leaves exactly one `<video>` and one Hls instance (`window.__wgLiveHlsCount`, dev only).
  - Edge (`channel: 'msedge'`, a project marked optional): Atmos plays with E-AC-3 decoded.
  - WebKit: the path is recorded, not asserted as Safari behaviour; Playwright WebKit is not Safari.
- [ ] **Step 2: Run, implement and pass.** Run `npm run demo:hls && npm run test:e2e:dev -- tests/e2e/hls.spec.ts`. Then commit `test(m2): end-to-end HLS with local fixture`.

---

## Phase D: provider player in an iframe (required, decision D1)

The contract comes from spec §9.3 and M1-PLAN §6.9:
- only admin-approved HTTPS player pages;
- a `title` on the iframe;
- `allow` and `sandbox` values tested and recorded per vendor, never generic strings;
- no overlaid play, volume or 「播放中」 unless the vendor has a control API;
- postMessage checks `origin`, `source` and schema, and sends with an explicit target origin;
- an iframe `load` event never proves playback.

### Task D1: iframe sources on the server

**Files:**
- Modify: `class-settings.php` (admin-only field `player_origins`: https origins, one per line), `class-events.php`, `class-playback-provider.php`.
- Test: `tests/integration/playback-hls.state.spec.ts` (same project as B1).

**Interfaces:**
- Consumes: B2 signer, A2 entitlement.
- Produces:
  - Event meta:
    - `source_type` gains `iframe`;
    - `source_iframe_binaural` and `source_iframe_atmos` are https URLs whose origin is on `player_origins`;
    - one event uses either `hls` or `iframe`, never both.
  - `/playback` returns `{ kind: 'iframe', url: <signed>, allowedOrigin: new URL(url).origin }`, under exactly the same conditions as B3.
  - Save-time check: `wp_remote_head( $url, array( 'timeout' => 5 ) )`. If `X-Frame-Options` is DENY or SAMEORIGIN, or CSP `frame-ancestors` excludes `home_url()`'s origin, show the warning 「此播放器頁面不允許被嵌入本站，請聯絡串流服務商」. It is a warning only: the URL is still saved, because the header can differ per request.

- [ ] **Step 1: Write the failing tests:**
  - A buyer gets `iframe` with `allowedOrigin` equal to the URL's origin.
  - A guest gets `not_entitled`, and the body has no `http`.
  - Origins not on `player_origins` and `http:` URLs are refused at save.
  - Choosing `iframe` clears the active HLS fields from resolution (`hls` URLs are ignored).
  - A fixture page that sends `X-Frame-Options: DENY` triggers the warning.
  - The no-leak test from B1 also covers the iframe URLs.
- [ ] **Step 2: Run, implement and pass.** Run `npm run test:integration:wsl -- --no-deps --project=chromium-state-playback-hls`. Then commit `feat(m2): provider player (iframe) sources`.

### Task D2: iframe adapter and the "provider controls" player state

**Files:**
- Modify:
  - `src/adapters/iframe.ts`, replacing the inert stub;
  - `src/adapters/factory.ts`;
  - `src/state/model.ts` and `src/components/`: when `capabilities.reliablePlaybackEvents` is false, hide our controls and 「目前播放」;
  - `src/i18n/copy-player.ts`, with proposed copy for approval: 「播放控制在下方的串流服務播放器中」 and 「已選擇：Dolby Atmos 音軌（由串流服務播放器播放）」.
- Test: `tests/unit/adapters/iframe.test.ts`, `tests/unit/components/*.test.ts`.

**Interfaces:**

```ts
export function createIframeAdapter(host: MediaHost, env: AdapterEnv): PlaybackAdapter;
// kind 'iframe'; capabilities all false (playPause, mute, volume, seekToLive, fullscreen, remotePlayback, reliablePlaybackEvents).
// load(source): throw NotSupportedError unless new URL(source.url).protocol === 'https:' && origin === source.allowedOrigin;
//   create ONE <iframe title="<event title>・串流服務播放器" src=url allow=<vendor value>> in host.frameSlot; hide host.media;
//   resolve on the frame's load event (frame loaded, NOT playing); reject after 20 s without load.
// play()/pause()/setMuted()/setVolume()/seekToLive(): no-ops (the controls that would call them are hidden).
// destroy(): set src 'about:blank', remove the iframe, show host.media again; idempotent. No audio may continue.
```

Mode switch:
1. `destroy()` the old frame;
2. load the other mode's URL;
3. show 「已選擇：…」 (never 「目前播放」, since the frame cannot confirm playback).

- [ ] **Step 1: Write the failing tests:**
  - An http URL or an origin mismatch rejects, and no iframe is created.
  - Exactly one iframe exists after Binaural → Atmos → Binaural.
  - `destroy()` removes it and is safe twice.
  - With `reliablePlaybackEvents` false:
    - the player renders no play, pause, mute or volume button and no 「目前播放」;
    - it renders the event info, the mode switch and the provider-controls copy.
  - The iframe has a non-empty `title`.
  - Leaving the page removes the frame.
- [ ] **Step 2: Run, implement and pass.** Run `npx vitest run tests/unit/adapters/iframe.test.ts tests/unit/components`, then `npm run check`. Then commit `feat(m2): iframe adapter without fake controls`.

### Task D3: vendor control API (blocked on the vendor's postMessage documentation)

Only if the provider documents a player API. Then:
- add a message bridge that accepts messages only when `event.origin === allowedOrigin`, `event.source === frame.contentWindow` and the message matches a schema;
- send with `postMessage(msg, allowedOrigin)`, never `*`;
- turn on only the capabilities the API really confirms (for example `reliablePlaybackEvents` after it reports `playing`);
- test with a fake vendor page on a second local origin, including a spoofed message from a third origin that must be ignored.

### Task D4: end to end with a fake provider player

**Files:** create `dev/fake-player/` (a page served by the dev harness on a second port, e.g. 5185, playing the C4 fixture with its own `<video controls>`), and `tests/e2e/iframe.spec.ts`.

- [ ] **Step 1: Write the failing tests:**
  - A buyer's listen page shows the fake player frame from the second origin, and our controls are hidden.
  - A switch replaces the frame.
  - A `/playback` answer whose `allowedOrigin` differs from the URL origin shows the failed state, and no frame is created.
- [ ] **Step 2: Run, implement and pass.** Run `npm run test:e2e:dev -- tests/e2e/iframe.spec.ts`. Then commit `test(m2): end-to-end iframe with a fake provider player`.

---

## Phase E: release and acceptance

### Task E1: release 0.3.0 with nothing switched on

- [ ] Bump to 0.3.0 (`wg-live.php` header and constant, `readme.txt` stable tag and changelog, `package.json`, the version assertion in `settings.state.spec.ts`).
- [ ] Run the full gates:
  - `npm run check`;
  - `npm run lint:php`;
  - `npm run test:integration:wsl`, all projects;
  - `npm run test:e2e`;
  - `npm run test:zip-install`.
- [ ] Build the ZIP from a clean tree.
- [ ] On production: take a backup, upload with replace, keep mode `demo`, and verify nothing changed (same checks as the 0.2.0 record). Rollback ZIP: 0.2.0, SHA `0b76b4b3…`.

### Task E2: rehearsal (needs §2 items 1–6, D5)

- [ ] Configure on staging:
  - `stream_hosts`;
  - the signer constants in `wp-config.php`;
  - a ticket product;
  - a buyer account and a non-buyer account;
  - an event with both playlist URLs.
- [ ] Run a full-length rehearsal (the real show length) with the provider streaming. Record:
  - start-up time;
  - stalls;
  - token renewals;
  - latency (clap test);
  - errors per browser.
- [ ] People fill the device matrix in `manual-devices.md`: iPhone, iPad, Mac Safari, Apple TV over AirPlay, Edge, Chrome/Brave (Binaural only).
- [ ] Load: stepped test of `GET events`, `/entitlement` and `/playback` with logged-in test users, in the approved environment only (spec §13.5), up to 300 sessions spread over the doors-open window. Get the provider's capacity statement and monitoring for the stream itself.
- [ ] Write a deploy record and get the boss's written sign-off.

### Task E3: go live

- [ ] On production:
  1. turn guest checkout off for ticket products (D2b);
  2. link each event's `product_id`;
  3. set the playlist URLs;
  4. switch the mode to `live`.
- [ ] Smoke test with a bought ticket and with a non-buyer. Check:
  - a logged-out visitor sees 「請先登入」;
  - a non-buyer sees 「尚未取得觀看資格」;
  - a buyer plays.
- [ ] Rollback (no reinstall): switch the mode back to `demo`. Every real event then answers `not_ready` at once and the pages stay up.
- [ ] Only now may reports say "paid live streaming online", and only for the paths the device matrix proved.

---

## Self-review notes (2026-10-31)

**Spec coverage.** The four M2 integration points in spec §17 are each covered:

| Integration point | Covered by |
|---|---|
| Studio playback provider | B1, B3, C1–C4, D1–D4 |
| Ticket entitlement provider | A1–A3 |
| Playback session / authorization | B2, B3, B3b, C3 |
| Real-device verification records | E2 |

Spec §19.5 blockers are in §2. Spec §13.5 is in E2. Spec §9.3 is in Phase D.

**Provider asks for the iframe path**, in addition to §2:
- the player page's URL pattern and how it takes a token;
- its `frame-ancestors` / `X-Frame-Options` allowing `https://sounds.wgstudiomusic.com`;
- the `allow` permissions it needs (for example `autoplay; fullscreen; encrypted-media`), tested, not guessed;
- its control API documentation, if any (D3).

E2's rehearsal covers one event of each source type.

**Contract changes, made together with `src/types.ts`:**
- `DeploymentMode` gains `live`;
- `BootConfig.rest.nonce`;
- `BootConfig.assets.hls`;
- `AdapterEnv.hlsScriptUrl`;
- refined path selection in M1-PLAN §6.9.

**Not in this plan:** DRM (spec §0.2: not pre-specified), replay/VOD, ticket transfer, and concurrent-session limits per ticket. Add them only if asked.
