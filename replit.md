# PS99 GemSpin Bet — Discord Gambling Bot

A Discord gambling bot with a SQLite economy, slash commands, and an Express health-check endpoint.

## Stack

- **Runtime**: Node.js (ESM)
- **Discord**: discord.js v14
- **Database**: SQLite via better-sqlite3 + Drizzle ORM (`artifacts/api-server/bot.db`)
- **HTTP**: Express v5 (health-check at `/api`)
- **Build**: esbuild (`artifacts/api-server/build.mjs`)
- **Monorepo**: pnpm workspaces

## Workflow

- **Replit** = development & testing. Edit TypeScript source here, the **API Server** workflow runs the bot automatically.
- **WispByte** = production (24/7). The root `index.js` is the WispByte entry point — it loads `.env`, patches hardcoded Replit paths in the compiled bundle, and starts the bot.

### Running on Replit (dev)

The **API Server** workflow starts automatically:

```
pnpm --filter @workspace/api-server run dev
```

This builds the TypeScript source (via `artifacts/api-server/build.mjs`) and starts the bot + HTTP server.

### Deploying to WispByte (prod)

1. Make and test your changes on Replit.
2. Upload the project files to WispByte (excluding `node_modules`, `.cache`, `.npm`).
3. WispByte runs `node index.js` — which handles `.env` loading, `better-sqlite3` version checks, path patching, and starting the compiled bot.
4. The database persists at `/data/bot.db` on WispByte's persistent volume.

## Required secrets

| Key | Where to get it |
|-----|----------------|
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → your app → Application ID (set as env var) |
| `SESSION_SECRET` | Any long random string |

## Games / commands

mines, towers, rps, coinflip, blackjack, wheel, roulette, crash, scratchcard, chickencrossing, colordice, upgrader, balance, tip, deposit, withdraw, setup, addbalance, removebalance

## Server config

`artifacts/api-server/server-config.json` holds channel IDs for deposit/withdraw/request and the Roblox username used for trade verification.

## User preferences
