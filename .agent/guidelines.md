---
alwaysApply: true
---

# Package Manager

ALWAYS use Bun. NEVER npm. Commands: `bun install`, `bun add`, `bun remove`, `bun run`, `bun test`.

# Bun APIs

MUST use Bun-native APIs over Node.js equivalents:
- `Bun.file()`, `Bun.write()` instead of `node:fs`
- `Bun.spawn()` instead of `node:child_process`

Use `node:*` imports only when no Bun equivalent exists.

# Release Workflow

Use `/release` command - it handles everything automatically.

Key points:
- Version bump is auto-determined from conventional commits
- Release notes are auto-generated via `gh release create --generate-notes`
- NEVER ask user for release notes content
- Publish to npm is automated via CI on tag push

## Recovery: Tag Pushed While CI Failing

MUST delete tag immediately:
```
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
```

# Style Guide

**AVOID:**
- `else` statements unless truly necessary
- `try`/`catch` where possible
- `any` type
- `let` statements (prefer `const`)
- Unnecessary destructuring

**PREFER:**
- Single-word variable names where possible
- Keep logic in one function unless reusable/composable
- Bun APIs (see above)
