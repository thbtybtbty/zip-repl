---
name: Discord interaction acknowledgement
description: Discord interaction responses must beat the three-second acknowledgement window even when REST networking is unstable
---

Discord.js REST defaults can retry network failures for longer than Discord allows an interaction to remain unacknowledged. Use one bounded request window that leaves margin inside three seconds, retry only immediate DNS/connection failures, and never let an error handler send a second response after an interaction has expired.

**Why:** Temporary WispByte DNS failures (`EAI_AGAIN`) combined with the default REST retry and timeout behavior caused intermittent “The application did not respond” failures and duplicate expired-response logs; an overly short custom timeout also caused avoidable `AbortError` failures.

**How to apply:** Keep the Discord REST timeout/retry policy aligned with the three-second interaction window, leave margin for the interaction callback, wrap initial acknowledgement methods with bounded retries only for immediate network errors, and treat timeouts/expired interactions as terminal.