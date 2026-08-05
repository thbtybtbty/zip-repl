---
name: Wispbyte binary compatibility
description: How to ship a better-sqlite3 native binary that works on Wispbyte's glibc 2.31 (Debian Bullseye) container from a glibc 2.40 build environment.
---

## Problem
Wispbyte runs Node 19.9.0 on Debian Bullseye (glibc 2.31). Building better-sqlite3 on Replit (glibc 2.40) produces a binary with hard requirements on GLIBC_2.33, GLIBC_2.34, and GLIBC_2.38, which don't exist on 2.31.

## Solution
Three-step ELF patch on the compiled `.node` file:

1. **Weak-flag GLIBC_2.33 and GLIBC_2.34** in the `.gnu.version_r` section (set `vna_flags = 0x2 = VER_FLG_WEAK`). This makes those version requirements optional — the linker falls back to whatever version of the symbol is available.

2. **Add `libdl.so.2` and `libpthread.so.0` to NEEDED** using `patchelf --add-needed`. On glibc < 2.34, dlopen/pthread live in those separate .so files, not in libc.so.6. The binary compiled against glibc 2.34+ only lists libc.so.6, so adding the old libs lets it find the symbols.

3. The Python ELF patcher walks the VERNEED section, finds matching version strings, sets their `vna_flags` field to 0x2.

**Why:** glibc 2.33 versioned fstat64/stat64/lstat64 under a new tag. glibc 2.34 merged libdl and libpthread into libc.so.6 with new version tags. Binaries compiled on 2.34+ don't list the old .so files in NEEDED and use the new version tags — both of which break on 2.31.

**How to apply:**
- Use the Python script from the chat that walks `.gnu.version_r` and patches `vna_flags`
- Run `nix-shell -p patchelf --run "patchelf --add-needed libdl.so.2 --add-needed libpthread.so.0 binary.node"`
- Also use the Wispbyte-native binary if available (from the user's uploaded archive) as it was compiled closer to their system, then patch it

**Also:** `GLIBC_2.38` only has `fmod` — same weak-flag fix works for that one too.
