---
name: Workspace dependency setup
description: Dependency installation constraint for this imported pnpm monorepo
---

The imported pnpm lockfile can be older than the workspace package manifests, so a frozen install may fail before any package is available. Reconcile dependencies with pnpm's non-frozen install, and do not retain temporary package-manager dependencies added only to bootstrap the environment.

**Why:** The Replit workspace needed the current monorepo dependency graph to build the Discord bot, while the WispByte runtime only needs its intentionally minimal npm metadata.

**How to apply:** When setting up this repo, install the workspace with pnpm, build `@workspace/api-server`, and keep WispByte archives limited to the launcher, npm metadata, and compiled `dist/` output. Rewrite archive lockfile URLs from Replit's internal package mirror to `registry.npmjs.org`; if an unrelated workspace dev package is blocked by the package firewall, use a production-only filtered install for the bot graph rather than bypassing the firewall.