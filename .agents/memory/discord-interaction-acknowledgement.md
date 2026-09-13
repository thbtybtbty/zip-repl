---
name: Discord interaction acknowledgement
description: Discord interaction responses must beat the three-second acknowledgement window even when REST networking is unstable
---

Discord.js REST defaults can retry network failures for longer than Discord allows an interaction to remain unacknowledged. Use one bounded request window that leaves margin inside three seconds, retry only immediate DNS/connection failures and fast Discord 5xx responses, and never let an error handler send a second response after an interaction has expired or Discord is unavailable.

**Why:** Temporary WispByte DNS failures (`EAI_AGAIN`) and intermittent Discord HTTP 503 responses combined with the default REST retry and timeout behavior caused intermittent “The application did not respond” failures and duplicate fallback-response logs; an overly short custom timeout also caused avoidable `AbortError` failures.

**How to apply:** Keep the Discord REST timeout/retry policy aligned with the three-second interaction window, leave margin for the interaction callback, retry at most one fast network/5xx failure, and treat timeouts, expired interactions, and final service-unavailable responses as terminal without a duplicate fallback reply.