# Report: core-shared

## Files

Created or replaced (all LF):

- `src/main.ts`: plan 3.2 boot. Exports `{ mountAll, mountWithin, version }` only. `version` is the named `version` import from `package.json` (tree-shaken, 0 `devDependencies` in the bundle). Registry = `WeakMap` + `Set`; `sweepDetached()` at the start of `mountAll`/`mountWithin`; entries are registered synchronously so a pending player cannot be mounted twice, and a root removed while the probe is pending is never mounted. Elementor `wire()` (hooks check, `wired` flag, try/catch) is called at boot, on `elementor/frontend/init` (native event and a jQuery listener, because Elementor triggers it through jQuery) and on `DOMContentLoaded`. `pagehide` calls `stop()`; `pageshow` with `persisted` calls `refresh()`; no `unload`/`beforeunload`. Players await `probeVolumeControl()`; the other views mount immediately. Mount failure or an unreadable config shows 「Live 介面暫時無法載入」 (`role="alert"`) and logs nothing. `announce()` writes to the root's own `.wg-live__sr-status` (created if missing), 750 ms window with the latest message winning, identical consecutive messages dropped, `immediate` bypasses and cancels the queue. A root already carrying `data-wg-live-mounted="1"` that this copy does not own is skipped (double-loaded bundle).
- `src/boot.ts`: `readBootConfig(root)`; also exports `parsePublicEvent(raw)` and `parsePublicEvents(raw)`. Re-use these in the REST providers for untrusted JSON.
- `src/dom.ts`: `h`, `safeUrl`, `uid`, `focusFirst`, `isFocusable`.
- `src/views/types.ts`: `ViewContext`, `ViewInstance`.
- `src/views/{events,player,help}.ts`: heading-only stubs. Overwrite them.
- `src/util/{url,time,storage,capabilities}.ts`.
- `src/i18n/copy.ts`, `copy-status.ts`; stubs `copy-events.ts`, `copy-player.ts`, `copy-help.ts` (`export const xCopy = {} as const;`).
- `src/styles/{theme-bridge,base,responsive,accessibility}.css`, `src/styles/index.ts`; placeholders `events.css`, `player.css`, `help.css`, `dialog.css`, `dev-panel.css`.
- `tests/unit/core/{dom,url,time,storage,capabilities,boot,copy,main}.test.ts` (150 tests).

## Decisions

- **No `src/styles/index.css`.** `scripts/check-css-scope.mjs` (and plan 3.3) ban `@import`, so a CSS index would fail `npm run lint`. `src/styles/index.ts` imports the nine files in the required order and `main.ts` imports `./styles/index`; Vite emits one `wg-live.css` in that order.
- `h()`: any prop other than `className`, `text`, `attrs`, `dataset` is treated as an attribute (`{ type: 'button', id: 'x' }` works). `true` gives a boolean attribute, `false`/null/undefined skip it. `on*` (any case) and `srcdoc` throw `TypeError`. `href/src/poster/action/formaction/cite/data` go through `safeUrl` (an unsafe value drops the attribute). `srcset` is parsed per the HTML rule and sanitized candidate by candidate. `style` is allowed.
- `safeUrl`: returns the resolved absolute URL (relative resolved on `location.origin`); a pure `#fragment` is returned as is; rejects control characters, credentials in the URL, and every scheme except http/https/mailto.
- `readEventParam`/`readModeParam` reject repeated parameters. `playerHref` keeps existing query/hash and relative links relative.
- `restUrl` handles pretty roots, plain `?rest_route=/wg-live/v1/` roots (also the percent-encoded form), relative roots, and encodes params and path segments.
- `formatEventDateTime`: Intl `en-US` + `hourCycle: 'h23'` for the numbers, weekday computed from the calendar date (locale independent), 「台北時間」 for Asia/Taipei, otherwise the zh-TW `timeZoneName: 'short'` part. Unknown zone falls back to Asia/Taipei; invalid ISO gives `full: '時間待公布'`, `machine: ''`. `countdownText` returns only the quantity (`3 天 4 小時 12 分鐘`, zero units skipped, rounded up to the minute, null when past); callers add their own sentence.
- `probeVolumeControl`: detached `<audio>`, write 0.5, read back after `setTimeout(0)`, 50 ms hard timeout, memoized. Extra export `volumeProbeResult()`.
- `readBootConfig` fails closed: unknown `deploymentMode` becomes `disabled`; `devTools` only for literal `true`; events with an invalid id/slug/status/start time are dropped; URLs go through `safeUrl`; `verified`/`not_working` compatibility rows without a `YYYY-MM-DD` date become `pending`; the view comes from `data-wg-live-view` (config view is the fallback). Missing `featuredEventSlug`/`heading` default to `null`/`'h2'`.
- **`statusCopy` shape** (state, player and events agents import it): `gate.{disabled,eventNotFound,cancelled,ended,sourceNotConfigured,scheduled,doorsOpen,intermission,live}` each `{ title, detail }`; `startsAt(full)`; `player.{idle,selecting,loading,playing,paused,switching,reconnecting,playBlocked,unsupported,failed,checkingSource}`; `modeName.{binaural,atmos}`; `selectedMode(name)`, `currentMode(name)`; `eventStatus[status]`; `entitlement.{guest,notEntitled,unavailable,checking,note}`; `action.*` (start, pause, resume, retry, switchMode, fallbackBinaural, `reloadLastGood(modeName)`, viewEvent, backToEvents, backHome, help, contact, login, buy, close, confirmSwitch, cancel); `cta.{viewDetails,demo,enter,viewEvent,replayPending}`; `switchDialog.{title,body(cur,other)}`; `announce.*`; `time.*`; `demo.{badge,mediaNotice}`; `bootError`. Wording the spec does not pin (the `detail` strings, idle/selecting) is working copy with no capability claims. Mode-selector strings from spec 5.2 are not in `statusCopy`; they belong in `playerCopy`.
- CSS: tokens use measured values (text `#f0f5fa`, accent/link `#f0d62b`, hover `#c2a903`, on-accent `#000`, radius 3px, container 1140px, gutter 20px, h2 38px/28px at 767) and mark `NEW` where proposed. Element resets use `:where()` so component classes win. Primitives use two-class selectors (`.wg-live .wg-live__btn`) to beat theme/Elementor kit rules; `.wg-live__btn` uses `all: unset` before setting its own properties. **Component stylesheets that restyle a primitive should use the same two-class form.** Exposed classes: `__btn` (`--primary` 48px, `--secondary`, `--ghost`, `--block`), `__badge` (`--demo`, `--live`, `--info`, `--success`, `--warning`, `--error`, `--muted`), `__heading` (`--h3`, `--h4`), `__muted`, `__small`, `__actions` (`--stack`), `__visually-hidden`, `__skeleton--{events,player,help}`, `__boot-error`.
- Visual check: rendered the combined CSS in Chromium on top of `dev/site-chrome.css` at 1000 and 390 wide. None of the global rules (red uppercase buttons, justified text, monospace headings, dashed img border, content-box) leaked into `.wg-live`; targets are 48px/44px; no horizontal scroll.

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | one error, in a file I do not own: `dev/harness.ts(40)` lacks `featuredEventSlug` and `heading` (see Requests) |
| `npm run lint` (eslint + css scope) | pass |
| `npm run test:unit` | pass: 12 files, 200 tests (150 mine in `tests/unit/core`) |
| `vite build` into a scratch dir | pass: wg-live.js 13.8 kB (5.8 kB gzip), wg-live.css 9.9 kB (2.4 kB gzip); built CSS passes `checkCss` |

## Requests

- **foundation / dev harness:** `dev/harness.ts` `buildBootConfig` must add `featuredEventSlug` (e.g. `'demo-live-binaural-atmos'`) and `heading: 'h2'`. This is the only typecheck error.
- **featured.css owner:** the featured build imports only `featured.css`, so `--wg-*` tokens are not defined there. Either duplicate the tokens it uses, or import `./theme-bridge.css` from `src/featured.ts` (a JS import, not `@import`).
- **vite/build owner:** build target is `safari15` and plan D15 says `safari15.4` and a `chrome100/firefox100` floor; not mine, noting only.
- **events/player/dialog/dev-panel/help owners:** fill the placeholder CSS files and copy stubs; delete the `.wg-live__*-placeholder` rule.
- **player-view:** call `ctx.announce(msg, { immediate: true })` for `play_blocked` and failures; everything else is coalesced.

## Contract issues

- Task said `src/styles/index.css` imports the other files; the checker and plan 3.3 forbid `@import`. Resolved with `index.ts` (above).
- PHP `Events::SLUG_PATTERN` is used with `preg_match`; PCRE's `$` also matches before a trailing newline, so `"abc\n"` passes in PHP but fails here (JS `$` does not). The PHP side should use `\z`, the `D` modifier, or an explicit length/newline check. The TS side is strict.
- `main.ts` `version` comes from `package.json`; the plugin header, readme and `build-info.json` must stay equal to it (plan 7.3 step 9).
