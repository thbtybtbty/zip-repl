---
name: Discord animation reliability
description: Reliability constraints for animated Discord game messages
---

Animated game panels should use a small number of deliberately spaced message edits with retry/backoff. Treat intermediate animation edits as best-effort and retry the final result separately, because rapid Discord edits can fail transiently and should never interrupt a completed wager.

**Why:** Rapid successive Discord message edits caused intermittent slot animation crashes.

**How to apply:** Use this pattern for future animated game commands, especially when a bet has already been charged.