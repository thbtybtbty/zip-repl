---
name: Hi-Lo odds
description: RTP rule for the Hi-Lo card game
---

Hi-Lo should calculate each correct-guess multiplier from the actual favorable-card probability in the remaining deck, applying the 0.90 RTP factor. Ties are excluded from favorable cards and count as losses.

**Why:** This preserves the requested 10% house edge without hardcoded random payouts while allowing the game to become more rewarding as the player advances.

**How to apply:** Recalculate from the current card and undealt cards after every guess; settle only when the player loses, cashes out, or completes the deck.