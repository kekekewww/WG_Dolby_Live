# Report: events-help

## Files (all LF)

- `src/views/events.ts`: `mountEventsView`. Plan 6.1 sections (title/subtitle/intro, featured, 聆聽方式, other events, FAQ summary); disabled mode, empty state; one 30 s interval for countdown text (only when a scheduled event exists), cleared on destroy and when `ctx.root` is detached; `refresh()` = tick.
- `src/views/help.ts`: `mountHelpView`. The eight fixed sections of plan 6.11, compatibility table, then admin FAQ. No dependency on deployment mode.
- `src/components/event-card.ts`: card (poster, title + 「介面示範」 badge inside the heading that labels the article, performers, `<time>`, status badge, modes, CTAs, details panel, countdown). Also exports `paragraphNodes`.
- `src/components/event-list.ts`: `<ul role="list">` of cards, `tick()`.
- `src/components/listening-guide.ts`: 聆聽方式 block with the spec 5.2 mode strings and a help link.
- `src/i18n/copy-events.ts`, `src/i18n/copy-help.ts`: replace the stubs.
- `src/styles/events.css` (also holds the view header, FAQ, notice and panel styles that help reuses), `src/styles/help.css`.
- `tests/unit/views/events.test.ts` (48 tests), `tests/unit/views/help.test.ts` (21 tests).

## Decisions

- CTA label/target comes from `selectPrimaryCta` (state agent). `details` CTAs render as a `<button aria-expanded aria-controls>` toggling a `hidden` panel. A `link` CTA with no usable href falls back to the details toggle.
- Link CTAs also get a ghost 「活動簡介」 toggle so the description stays reachable (spec 5.1 wants the description on the page).
- 購票 and 登入 are shown only when their link exists, and are hidden on ended/cancelled events (a buy link on a cancelled event would mislead). Easy to change if you want them everywhere.
- Link/button accessible names are `label：title` (starts with the visible label) so cards with the same label are distinguishable.
- Heading levels: view title = `boot.heading`; sections one level below (h3 under h2, h2 under h1); card titles one further.
- Disabled mode shows the title + 「線上音樂會尚未開放」 panel with home/contact links; no intro, no guide, no FAQ, nothing from `boot.events`.
- Featured poster: `loading="eager"`, `fetchpriority="high"`; other posters `loading="lazy"`; all `decoding="async"`, width/height always set. `posterUrl` without a `poster` object reserves a 16:9 box with `alt=""`.
- Compat table: real `<table>` from 1024 px; below that the rows become stacked blocks with visible cell labels (`aria-hidden`), header row visually hidden, and explicit ARIA table roles so Safari/VoiceOver keep the semantics. Result is badge text (尚待測試 / 已驗證 / 實測無法使用).
- Rejected URLs (productUrl, poster, links) go through `h()`'s `safeUrl`; the element is omitted when no `href`/`src` survives.
- Events list is rendered from the bootstrap only (no REST refresh); the plan only gives the poller to the single-event player. `refresh()` just re-ticks the countdown.

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` (whole repo, after the state agent's files landed) | pass: 19 files, 543 tests (69 mine) |
| `eslint` on `src` and `tests` | my files clean; 2 errors in `src/state/model.ts` (not mine: irregular whitespace at 319:86, unused `_nowMs` at 555) |
| `node scripts/check-css-scope.mjs` | ok (10 files) |
| `npm run typecheck` | no errors in my files; remaining errors are in `src/views/player.ts` and others owned by other agents |
| Visual (Chromium, scratch build over `dev/site-chrome.css`) | events and help at 1100/390/360: no horizontal overflow, no theme leakage; long unbroken titles wrap; compat table stacks below 1024 |

## Requests

- state agent: `src/state/model.ts` fails `npm run lint` (irregular whitespace line 319, unused `_nowMs` param line 555).
- player-view agent: `src/views/player.ts` passes `boot.heading` (`'h1'|'h2'`) where a `HeadingTag` without h1 is expected (typecheck errors); not mine.
- PHP side: the `家庭劇院相容表` rows are rendered verbatim, so `Settings` must keep `testedAt` for verified/not_working rows (already in plan 4.3).

## Contract issues

- None blocking. `statusCopy.cta` labels match the plan 6.1 table; `orderEvents` features the settings slug even when that event is ended (plan wording allows it).
