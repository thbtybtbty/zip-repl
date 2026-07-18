# Discord Gem Bot

A Discord bot for gem-based casino games with a shared balance system.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env secrets: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL` (auto-provided)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: discord.js v14
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Build: esbuild (ESM bundle)

## Commands

| Command | Description |
|---|---|
| `/balance` | View your gem balance (starts at 10M for new users) |
| `/tip @user amount` | Send gems (min 1M). Supports `m` = million, `b` = billion |
| `/mines amount mines` | Minesweeper — 5×5 grid, reveal gems, avoid bombs, cash out anytime |
| `/towers amount difficulty` | Tower climb — pick safe tiles (easy/medium/hard) to multiply your bet |
| `/rps amount choice` | Rock Paper Scissors — win 2× your bet |

## Where things live

- `artifacts/api-server/src/bot/` — all bot logic
  - `index.ts` — Discord client, command registration, interaction routing
  - `commands/balance.ts` — /balance
  - `commands/tip.ts` — /tip
  - `commands/mines.ts` — /mines game logic + grid/panel builders
  - `commands/towers.ts` — /towers game logic + level builders
  - `commands/rps.ts` — /rps
  - `utils.ts` — shared helpers (parseAmount, formatAmount, DB wrappers)
- `lib/db/src/schema/index.ts` — `users` and `games` tables

## Architecture decisions

- Bot starts in the same process as the Express HTTP server (keeps deployment simple)
- Active game state (mines/towers) held in in-memory Maps keyed by Discord user ID — ephemeral by design, no DB round-trips on every button click
- Mines grid uses all 25 Discord button slots (5×5). Stats + cashout button live in a separate follow-up message sent immediately after to appear joined
- Medium towers difficulty shows Left/Right only (disabled mid spacer) to represent the "1 diamond 1 bomb" distribution cleanly
- Balances stored as bigint in PostgreSQL; new users receive 10M starting gems

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
