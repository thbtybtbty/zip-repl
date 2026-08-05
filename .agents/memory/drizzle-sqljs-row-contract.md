---
name: Drizzle sql.js row contract
description: Required result shape when using Drizzle sqlite-proxy with sql.js
---

The sql.js adapter used by Drizzle's `sqlite-proxy` must return positional arrays for `all` and `get` results, not `getAsObject()` records. Drizzle maps those positions through the selected schema fields, including snake_case column names, camelCase properties, and timestamp decoders. Keep raw object rows only in the separate direct SQLite facade used by raw SQL callers.

**Why:** Returning objects made persisted fields such as balances and bet deltas become undefined on WispByte, while raw SQL paths continued to work and hid the problem.

**How to apply:** Any future replacement or refactor of the sql.js adapter must preserve the positional-row contract for Drizzle callbacks and include a smoke test for a camelCase numeric field and a timestamp.