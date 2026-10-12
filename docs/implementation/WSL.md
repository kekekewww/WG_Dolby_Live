# Running wp-env inside WSL2 (fast WordPress)

When wp-env runs from the Windows checkout (`D:\...`), Docker Desktop shares the plugin and WordPress files into its Linux VM over a slow file-sharing layer. Each uncached WordPress request then takes 5–25 s, and a full integration run takes about 3 h.

`scripts/wsl.mjs` fixes this:
- You keep editing on Windows and running Vite, unit tests and Playwright there.
- The script mirrors the working tree into the WSL home (`~/wg-live`) with `rsync`, excluding `.git`, `node_modules`, outputs and evidence. Syncs are incremental and take a few seconds.
- It runs `wp-env` there, so WordPress files live on the native Linux filesystem.

The containers run on the same Docker Desktop engine and publish `:8888`/`:8889` on Windows `localhost`. The integration specs, including `tests/integration/wp.ts` with its `docker exec` helpers, therefore run unchanged from Windows.

## One-time setup (done on 2026-10-11 for user `kevin`, distro `Ubuntu`)

1. Docker Desktop → Settings → Resources → **WSL integration** → enable **Ubuntu** → Apply & restart.
2. Node ≥ 22 inside WSL, installed without sudo: nvm v0.40.3 plus Node 22 in `~/.nvm`. `scripts/wsl.mjs` loads it itself and strips the Windows `npm` (`/mnt/c/...`) from `PATH`.
3. `npm run wsl:doctor` must report node 22, `docker: ok` and `rsync: ok`.

## Daily use

```bash
npm run wp:start:wsl
```

This syncs the tree, runs `npm ci` in WSL when `package-lock.json` changed, then runs `wp-env start`, whose afterStart hook seeds the demo site.

```bash
npm run test:integration:wsl
```

This syncs, then runs the Playwright integration specs from Windows against `localhost:8888`/`:8889`.

```bash
npm run wsl:sync
```

Run this after changing plugin PHP or rebuilding `assets/dist`, when wp-env is already running.

```bash
npm run wp:cli:wsl -- plugin list
```

This runs WP-CLI inside the WSL wp-env.

```bash
npm run wp:stop:wsl
```

This stops the WSL wp-env.

## Rules

- **Ports**: never run the Windows wp-env (`npm run wp:start`) and the WSL one at the same time, because both use ports 8888 and 8889.
- **Sync direction**: the WSL copy is a mirror. Never edit files in `~/wg-live`, because the next sync overwrites them (`--delete`).
- **Building**: build on Windows (`npm run build`), then sync. Rebuilding on Windows no longer empties the dist folder that the running wp-env serves until you sync, so the e2e and integration suites no longer interfere.
- **Overrides**: `WG_WSL_DISTRO` (default `Ubuntu`) and `WG_WSL_DIR` (default `wg-live`, relative to the WSL home).
