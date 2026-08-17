---
name: WispByte animation assets
description: Deployment requirements for the bot's image-based game animations
---

WispByte packages that use Color Dice or Coinflip must include the external `@napi-rs/canvas` runtime, the `sql.js` WASM runtime, and the Coinflip GIF asset directory alongside the compiled bundle.

**Why:** The esbuild bundle intentionally externalizes native/canvas and WASM modules, and Coinflip animations are filesystem assets; omitting any of them lets the archive install successfully but breaks those games at runtime.

**How to apply:** When producing a WispByte update, include the minimal runtime manifest/lockfile, `artifacts/api-server/dist/`, and `coinflip_animation_pack/`, while still excluding secrets, databases, production config, admin files, and `node_modules/`.