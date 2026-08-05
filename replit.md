# Discord Gambling Bot

## ⚠️ AGENT STANDING RULE — READ FIRST

After **every** code change — no matter how small — you MUST automatically:

1. Build: `pnpm --filter @workspace/api-server run build` (run from project root)
2. Package the updated `dist/` into a `.tar.gz` archive (include only changed files; always include `dist/`)
3. Deliver it to the user via `presentAsset` with a clear label

Do this **without waiting to be asked**. Never skip this step after making any edit to the bot.
Do **not** include: `.env`, `bot.db`, `bot.db-shm`, `bot.db-wal`, `server-config.json`, `admins.json`, `node_modules/`


A TypeScript Discord gambling/games bot with an Express HTTP API and SQLite database, organized as a pnpm monorepo.

## Stack

- **Runtime:** Node.js (ESM)
- **Bot library:** discord.js v14
- **HTTP server:** Express v5
- **Database:** SQLite via sql.js/WebAssembly + drizzle-orm (no native addon)
- **Build:** esbuild

## How to run

The bot starts via the **"API Server"** workflow, which:
1. Builds TypeScript → `dist/` with esbuild (`pnpm run build`)
2. Starts the server (`node ./dist/index.mjs`)

The Discord bot and HTTP server both start from the same entry point (`artifacts/api-server/src/index.ts`).

## Required secrets

| Secret | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application/client ID from Discord Developer Portal |

## Config file

`artifacts/api-server/server-config.json` — holds Discord channel IDs for deposit/withdraw/request channels and the Roblox username used for trades.

## Workspace layout

```
lib/
  db/          — Drizzle schema + SQLite init
  api-zod/     — Zod schemas for the HTTP API
  api-client-react/ — Generated React API client

artifacts/
  api-server/  — Bot + Express server (main runnable)
    src/
      bot/     — Discord client, commands, event handlers
      routes/  — Express route handlers
      lib/     — Logger, utilities
```

## Games / commands

Mines, Towers, Rock-Paper-Scissors, Coinflip, Blackjack, Wheel, Slots, Hi-Lo, Roulette, Crash, Scratchcard, Chicken Crossing, Color Dice, Upgrader, Keno, Flip, Balance, Tip, Deposit, Withdraw, Add/Remove Balance (admin).

## User preferences

- Replit is the development/testing environment for this Discord bot, using the test Discord token.
- Wispbyte is the 24/7 production environment. Treat the uploaded Wispbyte archive as the production deployment reference.
- After each bot update is tested successfully in Replit, provide a Wispbyte-ready package containing the updated runtime files. Never include or expose `.env`, tokens, or other secrets.
- Do not replace Wispbyte production data/configuration with Replit test data. Preserve production `bot.db`, `server-config.json`, and admin configuration unless the user explicitly requests a migration.

## Wispbyte deployment workflow

After each update is tested on Replit:
1. Build: `cd artifacts/api-server && pnpm run build`
2. Package: include the WispByte runtime and npm metadata:
   - `index.js` — WispByte main entrypoint
   - `package.json` and `package-lock.json` — allow `npm install`
   - `start.sh` — optional WispByte startup script
   - `artifacts/api-server/dist/` — always include (rebuilt every time)
3. Deliver the archive to the user via `presentAsset`
4. **Never include:** `.env`, `bot.db`, `bot.db-shm`, `bot.db-wal`, `server-config.json`, `admins.json`, `node_modules/`

### Wispbyte file layout (production)
```
/                          ← Wispbyte root
├── index.js               ← WispByte main entrypoint; starts the included compiled bot
├── package.json           ← npm install/start metadata
├── package-lock.json      ← reproducible npm dependency lockfile
├── .env                   ← secrets (DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID) — never touch
├── node_modules/          ← managed by bootloader
└── artifacts/
    ├── admins.json        ← production admin IDs — never overwrite
    └── api-server/
        ├── bot.db         ← production SQLite DB (lives on /data/ at runtime)
        ├── server-config.json  ← production channel IDs — never overwrite
        └── dist/          ← compiled bot (index.mjs + pino workers) ← UPDATE THIS
```

### How Wispbyte runs the bot
- `index.js` loads `.env`, sets `DATABASE_PATH=/data/bot.db`, patches hardcoded Replit paths in `index.mjs` → `index.patched.mjs`, and spawns it. The database uses sql.js/WebAssembly, so WispByte does not need a native SQLite module.
