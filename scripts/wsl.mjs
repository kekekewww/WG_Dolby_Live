#!/usr/bin/env node
// Run wp-env inside WSL2 (Linux filesystem) instead of on the Windows filesystem.
//
// Why: Docker Desktop bind-mounts Windows paths into its Linux VM over a slow file-sharing layer;
// WordPress requests on wp-env took 5-25 s each. With the project and ~/.wp-env inside WSL2 they
// are served from the native Linux filesystem.
//
// Model: the Windows checkout stays the place you edit and run Vite/Playwright. This script
// rsyncs it into the WSL home (default ~/wg-live) and runs wp-env there. Containers run on the
// same Docker Desktop engine, publish :8888/:8889 on Windows localhost, and the integration
// helpers (tests/integration/wp.ts) keep using `docker exec` from Windows unchanged.
//
// Usage (from Windows):
//   node scripts/wsl.mjs sync                 copy the working tree into WSL (incremental)
//   node scripts/wsl.mjs start                sync, npm ci when the lockfile changed, wp-env start
//   node scripts/wsl.mjs stop | destroy       wp-env stop / destroy inside WSL
//   node scripts/wsl.mjs wp-env <args...>     any wp-env command inside WSL, e.g. `wp-env run cli wp plugin list`
//   node scripts/wsl.mjs doctor               check WSL, Node 22, Docker socket
// Env: WG_WSL_DISTRO (default Ubuntu), WG_WSL_DIR (default wg-live, relative to the WSL home).
//
// Requirements (one-time, see docs/implementation/WSL.md): Docker Desktop WSL integration enabled
// for the distro; Node >= 22 in WSL (nvm). Never run the Windows wp-env and the WSL one at the
// same time (both want ports 8888/8889).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DISTRO = process.env.WG_WSL_DISTRO || 'Ubuntu';
const DIR = process.env.WG_WSL_DIR || 'wg-live';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Windows path -> /mnt/<drive>/... */
export function toWslPath(winPath) {
  const p = path.resolve(winPath).replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(p);
  if (!m) throw new Error(`not a drive path: ${winPath}`);
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`.replace(/\/$/, '');
}

// Never copied into WSL: dependencies are installed there, outputs stay on Windows.
export const SYNC_EXCLUDES = [
  '.git/', 'node_modules/', '.cache/', 'artifacts/', 'evidence/', 'test-results/',
  'playwright-report/', 'playwright-report-integration/', 'blob-report/', 'coverage/', '.claude/',
];

// Prelude for every WSL command: load nvm's Node 22 (non-interactive shells skip ~/.bashrc)
// and make sure the Windows npm on PATH (/mnt/c/...) can never win.
const PRELUDE = [
  'set -eo pipefail',
  'export NVM_DIR="$HOME/.nvm"',
  '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use && nvm use --silent 22 >/dev/null 2>&1 || true',
  'export PATH="$(printf "%s" "$PATH" | tr ":" "\\n" | grep -v "^/mnt/" | paste -sd:)"',
  `APP="$HOME/${DIR}"`,
].join('\n');

/** Run a bash script inside WSL. Arguments are passed as argv ($1..), never re-parsed. */
function wsl(script, args = [], { capture = false } = {}) {
  const r = spawnSync('wsl.exe', ['-d', DISTRO, '--exec', 'bash', '-c', `${PRELUDE}\n${script}`, 'wsl.mjs', ...args], {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return r;
}

function sync() {
  const src = toWslPath(root);
  const excludes = SYNC_EXCLUDES.map((e) => `--exclude=${e}`);
  // rsync over /mnt is incremental (mtime + size); --delete keeps WSL an exact mirror.
  const r = wsl('SRC="$1"; shift; mkdir -p "$APP" && rsync -a --delete "$@" "$SRC/" "$APP/" && echo "wsl: synced $SRC -> $APP"', [src, ...excludes]);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function ensureDeps() {
  // npm ci only when package-lock.json changed since the last install in WSL.
  const r = wsl(
    'cd "$APP"; H=$(sha256sum package-lock.json | cut -d" " -f1); ' +
      'if [ ! -d node_modules ] || [ "$(cat node_modules/.wg-lock-hash 2>/dev/null)" != "$H" ]; then ' +
      'echo "wsl: npm ci (lockfile changed)"; npm ci --no-audit --no-fund && echo "$H" > node_modules/.wg-lock-hash; ' +
      'else echo "wsl: node_modules up to date"; fi',
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function wpEnv(args) {
  const r = wsl('cd "$APP" && npx wp-env "$@"', args);
  process.exit(r.status ?? 1);
}

function doctor() {
  const r = wsl(
    'echo "distro: ' + DISTRO + '"; echo "node: $(node -v 2>/dev/null || echo missing) ($(command -v node))"; ' +
      'echo "npm: $(npm -v 2>/dev/null || echo missing) ($(command -v npm))"; ' +
      'if [ -S /var/run/docker.sock ] && docker info >/dev/null 2>&1; then echo "docker: ok ($(docker version --format "{{.Server.Version}}"))"; else echo "docker: NOT reachable - enable Docker Desktop > Settings > Resources > WSL integration for this distro"; fi; ' +
      'command -v rsync >/dev/null && echo "rsync: ok" || echo "rsync: missing"; echo "app dir: $APP"',
  );
  process.exit(r.status ?? 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'sync': sync(); break;
    case 'start': sync(); ensureDeps(); wpEnv(['start', ...rest]); break;
    case 'stop': wpEnv(['stop', ...rest]); break;
    case 'destroy': wpEnv(['destroy', ...rest]); break;
    case 'wp-env': wpEnv(rest); break;
    case 'doctor': doctor(); break;
    default:
      console.error('usage: node scripts/wsl.mjs <sync|start|stop|destroy|doctor|wp-env ...>');
      process.exit(64);
  }
}
