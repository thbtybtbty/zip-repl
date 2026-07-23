# PS99 GemSpin Bet — Discord Gambling Bot

A Discord gambling bot with an Express API backend.

## Stack
- **Runtime:** Node.js 20, TypeScript, pnpm monorepo
- **Bot:** discord.js v14 with 19 slash commands
- **API:** Express 5 with pino logging
- **Database:** SQLite (better-sqlite3 + drizzle-orm), stored at `artifacts/api-server/bot.db`

## Running the project

The bot is in `artifacts/api-server`. Start it with the **API Server** workflow.

```
pnpm install          # install all workspace deps
pnpm --filter @workspace/api-server run dev   # build + start
```

## Required secrets

| Secret | Description |
|--------|-------------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |

## Environment variables (already set in .replit)

| Variable | Value |
|----------|-------|
| `DISCORD_CLIENT_ID` | `1528108960534630481` |

## Config

`artifacts/api-server/server-config.json` holds Discord channel IDs for deposits, withdrawals, and requests, plus the Roblox username.

## User preferences

- Keep the existing monorepo structure and stack.
