#!/usr/bin/env bash
# PS99 GemSpin Bet — startup script (WispByte / any VPS)
set -e

# Use the host's Node.js runtime. The bot uses sql.js/WebAssembly and does not
# require a native SQLite addon or a specific glibc version.
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "[start.sh] Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
echo "[start.sh] Using Node $(node --version)"

echo "[start.sh] Installing dependencies..."
npm install --omit=dev

echo "[start.sh] Starting bot..."
exec npm start
