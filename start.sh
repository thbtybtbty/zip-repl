#!/usr/bin/env bash
# PS99 GemSpin Bet — startup script (WispByte / any VPS)
set -e

# Install pnpm 9 to a local writable prefix (avoids permission errors + Node 19 compat)
echo "[start.sh] Installing pnpm via npm…"
npm install -g pnpm@9 --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"

echo "[start.sh] Installing dependencies…"
pnpm install --frozen-lockfile

echo "[start.sh] Building…"
pnpm --filter @workspace/api-server run build

echo "[start.sh] Starting bot…"
cd artifacts/api-server
exec node --enable-source-maps ./dist/index.mjs
