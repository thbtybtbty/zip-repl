# PS99 GemSpin Bet — Discord Gambling Bot

A Discord gambling bot with an Express health-check API, SQLite database, and 15 slash commands.

## Stack

- **Runtime**: Node.js (ESM)
- **Bot**: discord.js v14
- **Server**: Express v5
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **Monorepo**: pnpm workspaces

## How to run

The bot is managed by the **"artifacts/api-server: API Server"** workflow, which:
1. Builds the TypeScript source with esbuild (`build.mjs`)
2. Starts the server (`node dist/index.mjs`)

The bot connects to Discord automatically on startup and registers slash commands to every guild it's in.

## Required secrets

| Secret | Where to find it |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → Your App → Bot → Token |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → Your App → General Information → Application ID |
| `SESSION_SECRET` | Any long random string |

## Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port for the Express health-check server |
| `DATABASE_PATH` | `artifacts/api-server/bot.db` | Path to the SQLite database file |

## Server config

`artifacts/api-server/server-config.json` holds Discord channel IDs and other config:
- `depositChannelId` — channel where deposit requests are posted
- `withdrawChannelId` — channel where withdrawal requests are posted
- `requestChannelId` — channel for general requests
- `robloxUser` — Roblox username associated with the bot

## Games supported

Coinflip, RPS, Mines, Towers, Blackjack, Wheel, Roulette, Crash

## Project structure

```
artifacts/api-server/   — main bot + API server
  src/
    index.ts            — entry point (DB init, Express, Discord login)
    app.ts              — Express app setup
    bot/                — Discord bot logic & slash command handlers
    routes/             — Express routes (health check)
lib/db/                 — Drizzle schema & DB init
lib/api-zod/            — shared Zod schemas
lib/api-spec/           — OpenAPI spec
```
