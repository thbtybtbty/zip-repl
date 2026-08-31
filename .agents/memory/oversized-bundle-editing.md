---
name: Oversized bundle editing
description: Large generated JavaScript bundles can exceed the patch tool's recursion limits.
---

For very large generated bundles, the patch utility may fail before applying even a tiny change. Make a separately named copy, perform strictly asserted exact-text replacements, run syntax validation, and package the copy.

**Why:** The bundle size can trigger a stack overflow in the patch utility, while broad unverified replacement risks changing unrelated generated code.

**How to apply:** Use this only for requested generated-file deliverables; keep the original untouched and verify every replacement count before writing the updated copy.