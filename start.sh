#!/usr/bin/env bash
# PS99 GemSpin Bet — startup script (WispByte / any VPS)
set -e

# Install nvm and switch to Node 20 (has prebuilt better-sqlite3 binaries)
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "[start.sh] Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
nvm install 20 --no-progress 2>/dev/null
nvm use 20
echo "[start.sh] Using Node $(node --version)"

# Install pnpm 9 to a local writable prefix
echo "[start.sh] Installing pnpm..."
npm install -g pnpm@9 --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"

echo "[start.sh] Installing dependencies..."
CI=true pnpm install --no-frozen-lockfile

echo "[start.sh] Building..."
pnpm --filter @workspace/api-server run build

echo "[start.sh] Starting bot..."
cd artifacts/api-server
exec node --enable-source-maps ./dist/index.mjs
