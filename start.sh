#!/usr/bin/env bash
# PS99 GemSpin Bet — startup script (WispByte / any VPS)
set -e

# Install pnpm if the host doesn't have it
if ! command -v pnpm &>/dev/null; then
  echo "[start.sh] pnpm not found — installing via npm…"
  npm install -g pnpm
fi

echo "[start.sh] Installing dependencies…"
pnpm install --frozen-lockfile

echo "[start.sh] Building…"
pnpm --filter @workspace/api-server run build

echo "[start.sh] Starting bot…"
cd artifacts/api-server
exec node --enable-source-maps ./dist/index.mjs
