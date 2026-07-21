# Discord Gambling Bot

A Discord gambling bot built with discord.js, Express (health endpoint), SQLite (via Drizzle ORM), and TypeScript.

## Stack

- **Runtime**: Node.js (ESM)
- **Bot framework**: discord.js v14
- **HTTP**: Express v5 (health-check endpoint at `/health`)
- **Database**: SQLite via `better-sqlite3` + Drizzle ORM
- **Build**: esbuild (bundles to `artifacts/api-server/dist/`)
- **Monorepo**: pnpm workspaces

## Slash Commands

balance, tip, mines, towers, rps, coinflip, blackjack, setup, deposit, withdraw, addbalance, removebalance, wheel, roulette, crash, scratchcard

## Running the Bot

The **API Server** workflow runs the bot:

```
pnpm --filter @workspace/api-server run dev
```

This builds the TypeScript source and starts the bot + HTTP server.

## Required Secrets

| Secret | Where to get it |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → your app → General Information → Application ID |

`SESSION_SECRET` is also set (used to sign HTTP sessions).

## Database

SQLite file lives at `artifacts/api-server/bot.db`. On a persistent host (VPS/WispByte), set `DATABASE_PATH` to a path on a persistent volume so data survives restarts.

## Project Structure

```
artifacts/api-server/     # Bot + Express server
  src/
    bot/                  # Discord client, commands, utils
    routes/               # Express routes (health)
    lib/                  # Logger, etc.
lib/
  db/                     # Drizzle schema + migrations
  api-zod/                # Zod schemas generated from OpenAPI spec
  api-client-react/       # React query hooks (for a future dashboard)
  api-spec/               # OpenAPI spec (orval codegen)
```
