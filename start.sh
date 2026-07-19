#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PS99 GemSpin Bet — WispByte / VPS startup script
#
# Usage:
#   1. Copy this repo to your server / WispByte project.
#   2. Set the env vars listed in .env.example (via WispByte dashboard or a
#      .env file — never commit your real .env).
#   3. Set your startup command to:   bash start.sh
#
# The script installs dependencies, builds the TypeScript, then starts the bot.
# Re-running after a restart is safe — build is always fresh and the SQLite
# database (bot.db) is kept on disk between runs.
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "[start.sh] Installing dependencies…"
pnpm install --frozen-lockfile

echo "[start.sh] Building…"
pnpm --filter @workspace/api-server run build

echo "[start.sh] Starting bot…"
cd artifacts/api-server
exec node --enable-source-maps ./dist/index.mjs
