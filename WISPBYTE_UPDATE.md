# Wispbyte Hi-Lo Update

This archive contains the rebuilt bot runtime for the Hi-Lo game update.

## Install

1. Upload the contents of `artifacts/api-server/dist/` to the matching production `dist/` directory.
2. Keep Wispbyte's existing launcher and restart the bot.
3. Keep the existing production `.env`, `bot.db`, `server-config.json`, and `admins.json`.

## Included

- `/hilo` command with a standard 52-card deck
- Higher, Lower, and Cashout interaction buttons
- Dynamic probability-based multipliers targeting approximately 90% RTP
- Tie-as-loss behavior
- Cashout and loss settlement/history logging
- Owner-only replay handling
- Admin game disable/list support
- `/simulate` support for Hi-Lo

## Not included intentionally

- `.env` or Discord credentials
- `bot.db` or any production data
- `server-config.json`
- `admins.json`
- `node_modules`
