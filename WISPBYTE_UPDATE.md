# WispByte Deployment

This bot uses `sql.js`, SQLite compiled to WebAssembly. It does not install or
load `better-sqlite3` or any other native SQLite addon, so it does not require
newer GLIBC symbols than WispByte provides.

## Install

Upload the contents of the WispByte archive to the bot root, preserving:

```text
index.js
package.json
package-lock.json
start.sh
artifacts/api-server/dist/
```

Then run:

```bash
npm install
npm start
```

`package.json` declares `index.js` as the main file. The included entrypoint
loads `.env`, uses `/data/bot.db` when WispByte provides that volume, and starts
the prebuilt bot bundle without running a TypeScript build.

## Keep production files

Do not overwrite these files with Replit test data:

- `.env` or Discord credentials
- `/data/bot.db` (or the existing `bot.db`)
- `artifacts/api-server/server-config.json`
- `artifacts/admins.json` or `artifacts/api-server/admins.json`

## Included runtime

- Rebuilt Discord bot bundle in `artifacts/api-server/dist/`
- `index.js` main entrypoint
- npm install/start metadata and lockfile
- No `node_modules`, credentials, production database, or server configuration
