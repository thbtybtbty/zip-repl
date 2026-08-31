---
name: Invite state compatibility
description: Invite display queries must remain exclusive when older runtime versions created duplicate rejoin rows.
---

The invite runtime can encounter historical rows where a rejoin was stored as a new row while the earlier left row remained. Invite displays should select only the latest record per invited member, and rejoin records must be excluded from verified, unverified, left, and active invited lists.

**Why:** A member who rejoins must count only as a rejoin; otherwise legacy left or verified rows can remain visible and inflate multiple sections.

**How to apply:** When changing invite tracking or adding invite reports, preserve latest-record filtering and keep rejoin transitions non-verifiable.