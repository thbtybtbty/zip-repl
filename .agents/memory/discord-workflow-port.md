---
name: Discord workflow port
description: Shared port behavior between the Discord wrapper and the API artifact workflow
---

The Discord Bot workflow starts the same API server as the artifact API workflow, so both cannot run simultaneously on port 8080.

**Why:** Restarting the wrapper while the artifact API is running produces `EADDRINUSE`, even though the compiled bot itself is healthy.

**How to apply:** For wrapper verification, stop `artifacts/api-server: API Server` first; then restart `Discord Bot` and inspect its logs.