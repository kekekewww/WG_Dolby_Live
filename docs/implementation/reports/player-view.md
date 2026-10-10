# player-view report

Resumed run: the files from the cut-off attempt were reviewed and found complete; no source changes were needed in this run.

## Files (all owned)
- `src/views/player.ts` - `mountPlayerView`. Resolves the event (`fixedEventSlug ?? readEventParam`), preselect (`readModeParam` ?? remembered mode if available), builds the coordinator deps, registers with `pageRegistry`, renders once and updates in place via `subscribe`. Disabled mode and unknown event render `createUnavailablePanel` without a controller. Heading tag comes from `boot.heading` (`h1|h2`); section and sub headings are derived (HeadingTag typecheck error is resolved). Announcements: `selectAnnouncement`, only on change, `{ immediate: true }` when `isUrgentAnnouncement`. `startEventPoller.onEvent` calls `controller.updateEvent`; `onGone` tears down and shows not-found. `destroy` calls poller.stop, unsubscribe, controller.destroy and unregister. `stop()` calls `controller.stop()`; `refresh()` calls `poller.refreshNow()`.
- `src/components/{player-shell,mode-selector,player-controls,status-panel,entitlement-panel,dialog,dev-panel}.ts`
- `src/i18n/copy-player.ts`
- `src/styles/{player,dialog,dev-panel}.css` - two-class selectors for primitives (`.wg-live .wg-live__...`), no nesting, no `@import`, reduced-motion and forced-colors handled.
- `tests/unit/views/player.test.ts`, `tests/unit/components/*` (helpers, dev-panel, dialog, entitlement-panel, mode-selector, player-controls, player-shell, status-panel).

## Gates
- `npm run test:unit`: 33 files, 1007 tests pass (player-view: 8 files, 223 tests).
- ESLint on all my files: clean. `check-css-scope` (source and `--dist`): ok. `npm run build`: ok.
- `npm run typecheck`: one error, not mine: `tests/unit/slug-pattern-sync.test.ts(14,10)` (possibly undefined). No errors in my files.
- `npm run lint` fails only on `plugin/wg-live/assets/admin/admin.js` (`document`/`window` no-undef): the php-admin agent's file; ESLint needs browser globals for that path.
- Manual check in Chromium via the Vite harness (`/dev/listen.html?wg_event=demo-live-binaural-atmos`): pre-start selector (two cards, Start disabled with reason), select Binaural then Start reaches `playing`; label reads 目前播放：Binaural; demo badge and demo media notice present; controls shown per capabilities; 切換模式 opens the bottom-sheet dialog at 390px, Escape closes it and focus returns to the trigger; no horizontal overflow. Dev panel shows collapsed. The harness page background is cream (hostile fake theme), on which the plugin's light-on-dark text tokens are unreadable by design (the real site is dark; the same applies to every view). I only checked with the body forced dark. Temporary files removed; dev server stopped.

## Requests
- tooling: `build-info` prints "missing build output: wg-live-featured.css" and "removed stray featured.css" after `npm run build` (the featured build emits `featured.css`). Check the output naming in `vite.config.ts` vs `scripts/build-info`.
- php-admin / tooling: fix `eslint` globals for `plugin/wg-live/assets/admin/admin.js`; fix the TS error in `tests/unit/slug-pattern-sync.test.ts` line 14.

## Contract issues
- None new. Radio inputs in the mode selector are visually card-styled; selection is shown by border plus the "已選擇" text, not colour alone.
