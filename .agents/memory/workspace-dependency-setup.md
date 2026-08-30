---
name: Workspace dependency setup
description: Dependency installation constraint for this imported pnpm monorepo
---

The imported pnpm lockfile can be older than the workspace package manifests, so a frozen install may fail before any package is available. Reconcile dependencies with pnpm's non-frozen install, and do not retain temporary package-manager dependencies added only to bootstrap the environment. If the package installer first uses npm, restore any direct manifest versions it opportunistically upgrades before pnpm install, because the workspace enforces a minimum package release age.

**Why:** The Replit workspace needed the current monorepo dependency graph to build the Discord bot, while the WispByte runtime only needs its intentionally minimal npm metadata. npm can select a just-published version that pnpm correctly rejects under the repository's supply-chain safeguard.

Imported bot repositories may also ship only source code while their launcher expects a compiled bundle, so workspace linking and the package build are part of setup—not optional post-install steps.

**How to apply:** When setting up this repo, install the workspace with pnpm, build `@workspace/api-server`, and keep WispByte archives limited to the launcher, npm metadata, and compiled `dist/` output. Rewrite archive lockfile URLs from Replit's internal package mirror to `registry.npmjs.org`; if an unrelated workspace dev package is blocked by the package firewall, use a production-only filtered install for the bot graph rather than bypassing the firewall.

For nested Node launchers on Replit, use the current process's `process.execPath`; the first Node wrapper found on `PATH` can be a stale Nix path that starts the parent process but fails when spawned.

Large generated WispByte bundles can overflow the patch engine; source-driven temporary transforms are safer than trying to apply a large inline diff, followed by syntax and route-count validation.