# PS99 GemSpin Bet — Discord Gambling Bot

A Discord gambling bot with an Express HTTP API backend, built with TypeScript and Discord.js.

## Stack

- **Runtime**: Node.js (ESM)
- **Bot**: Discord.js v14
- **API**: Express v5
- **DB**: Drizzle ORM + PostgreSQL
- **Build**: esbuild (via `build.mjs`)
- **Monorepo**: pnpm workspaces

## Workspace layout

```
artifacts/api-server/   — Express API + Discord bot (main runnable)
lib/api-spec/           — OpenAPI spec + Orval codegen config
lib/api-client-react/   — Generated React query hooks
lib/api-zod/            — Generated Zod schemas
lib/db/                 — Drizzle schema + DB client
```

## Slash commands

`/balance`, `/tip`, `/mines`, `/towers`, `/rps`, `/coinflip`, `/blackjack`, `/setup`, `/deposit`, `/withdraw`

## How to run

The **API Server** workflow runs the bot:

```
pnpm --filter @workspace/api-server run dev
```

This builds with esbuild then starts `dist/index.mjs`. The HTTP server binds to `$PORT` and the Discord bot starts alongside it.

## Required secrets

| Secret | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application/client ID |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret for session signing |

## Config file

`artifacts/api-server/server-config.json` holds channel IDs for deposit/withdraw/request notifications and the Roblox username.
