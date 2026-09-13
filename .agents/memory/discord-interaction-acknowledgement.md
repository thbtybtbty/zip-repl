---
name: Discord interaction acknowledgement
description: Discord interaction responses must beat the three-second acknowledgement window even when REST networking is unstable
---

Discord.js REST defaults can retry network failures for longer than Discord allows an interaction to remain unacknowledged. Configure interaction-facing requests to fail fast and use only short, bounded retries; never let an error handler send a second response after an interaction has expired.

**Why:** Temporary WispByte DNS failures (`EAI_AGAIN`) combined with the default REST retry and timeout behavior caused intermittent “The application did not respond” failures and duplicate expired-response logs.

**How to apply:** Keep the Discord REST timeout/retry policy aligned with the three-second interaction window, wrap initial interaction acknowledgement methods with bounded transient-network retries, and treat expired interactions as terminal.