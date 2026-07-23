# PS99 GemSpin Bet — Discord Gambling Bot

A Discord gambling bot with a SQLite economy, slash commands, and an Express health-check endpoint.

## Stack

- **Runtime**: Node.js (ESM)
- **Discord**: discord.js v14
- **Database**: SQLite via better-sqlite3 + Drizzle ORM (`artifacts/api-server/bot.db`)
- **HTTP**: Express v5 (health-check at `/api`)
- **Build**: esbuild (`artifacts/api-server/build.mjs`)
- **Monorepo**: pnpm workspaces

## How to run

The bot starts automatically via the **API Server** workflow:

```
pnpm --filter @workspace/api-server run dev
```

This builds the TypeScript source and starts the bot + HTTP server.

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
