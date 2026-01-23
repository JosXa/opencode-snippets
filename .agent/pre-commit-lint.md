---
alwaysApply: true
---

# Pre-Commit Lint Check

MUST run `bun run format:check` (or `biome check .`) before any git commit.

**Behavior:**
1. Warnings in files YOU modified this session → MUST fix before committing
2. Warnings ONLY in files you did NOT touch (pre-existing issues) → ask user: "Found biome warnings in unmodified files: [list files]. Fix these too, or proceed with just my changes?"
3. Commit only after all warnings in your modified files are resolved

Compare biome output against `git diff --name-only` to determine which files you touched.
