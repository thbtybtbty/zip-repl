---
name: sql.js persistence performance
description: Keep sql.js command writes fast without exporting the whole database after every statement
---

With sql.js, SQL mutations are immediately applied in memory but exporting the full database and synchronously replacing the SQLite file after every statement is expensive. Batch the snapshot flushes over a short interval and force a final synchronous flush during checkpoint and shutdown.

**Why:** A single gambling command can update balances, wager totals, bet logs, affiliates, rakeback, and locks; exporting the entire database for each write adds avoidable latency and can push command handling toward Discord's acknowledgement limit.

**How to apply:** Keep in-memory writes synchronous for command correctness, coalesce persistence requests, preserve atomic temporary-file replacement, and never close the engine before a final flush.