# Discord Gambling Bot

A TypeScript Discord gambling/games bot with an Express HTTP API and SQLite database, organized as a pnpm monorepo.

## Stack

- **Runtime:** Node.js (ESM)
- **Bot library:** discord.js v14
- **HTTP server:** Express v5
- **Database:** SQLite via better-sqlite3 + drizzle-orm
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

Mines, Towers, Rock-Paper-Scissors, Coinflip, Blackjack, Wheel, Roulette, Crash, Scratchcard, Chicken Crossing, Color Dice, Upgrader, Keno, Flip, Balance, Tip, Deposit, Withdraw, Add/Remove Balance (admin).

## User preferences

<!-- Record any user preferences here -->
