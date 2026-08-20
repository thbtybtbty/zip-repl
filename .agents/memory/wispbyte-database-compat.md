---
name: WispByte database compatibility
description: Database runtime constraint for WispByte hosting
---

WispByte's older Linux image cannot safely run native SQLite Node addons built on the Replit image. Use sql.js/WebAssembly against the existing SQLite file format instead.

**Why:** Native better-sqlite3 binaries can require newer GLIBC symbols than WispByte provides.

**How to apply:** Keep the bot's SQLite schema and database path, but use a WASM SQLite engine with explicit persistence after writes. Production WispByte packages should install only JavaScript/WASM dependencies. WispByte can report free panel storage while its npm cache, inode quota, or container overlay is full; avoid startup steps that create duplicate multi-megabyte bundles.