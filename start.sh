#!/usr/bin/env bash
# PS99 GemSpin Bet — startup script (WispByte / any VPS)
set -e

# Always install pnpm via npm to bypass Corepack download delays
echo "[start.sh] Installing pnpm via npm…"
npm install -g pnpm --prefer-offline 2>/dev/null || npm install -g pnpm

echo "[start.sh] Installing dependencies…"
pnpm install --frozen-lockfile

echo "[start.sh] Building…"
pnpm --filter @workspace/api-server run build

echo "[start.sh] Starting bot…"
cd artifacts/api-server
exec node --enable-source-maps ./dist/index.mjs
