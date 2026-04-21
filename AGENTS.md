# Package Manager

ALWAYS use Bun. NEVER npm. Commands: `bun install`, `bun add`, `bun remove`, `bun run`, `bun test`.

# Bun APIs

MUST use Bun-native APIs over Node.js equivalents:
- `Bun.file()`, `Bun.write()` instead of `node:fs`
- `Bun.spawn()` instead of `node:child_process`

Use `node:*` imports only when no Bun equivalent exists.

# Release Workflow

For the full release workflow, see [Release Process](.pi/prompts/release.md).

- Version bump auto-determined from conventional commits
- Publish to npm automated via CI on tag push

NEVER ask user for release notes content.

After release, MUST update user's global config schema URL:
`C:\Users\josch\.config\opencode\snippet\config.jsonc`

## CI Pipeline Quirks

**CI auto-generates release notes from conventional commits** (categorized: features, fixes, docs, chores). Tag push triggers `release.yml` which builds notes and creates/updates a GitHub release. Do NOT write manual release notes unless adding extra context. If you do need to edit, use `gh release edit vX.Y.Z` (not `create`, which 422s because the release already exists).

**Schema URL CI workflow has broken push permissions** (403 on push-back). MUST update schema URLs manually before tagging. Three files contain `raw.githubusercontent.com/JosXa/opencode-snippets/vX.Y.Z/schema/config.schema.json`:
- `README.md`
- `src/config.ts`
- `skill/snippets/SKILL.md`

**Pre-commit hook resource contention.** Hook runs `tsc`, then `bun test`. The ESM compat test (`src/esm-compat.test.ts`) spawns `bun run build` (which also calls `tsc`). Two concurrent `tsc` processes can cause timeouts. Retry usually works. Not a real failure.

**Commit authorship.** Pre-commit hook sets author to repo owner (JosXa), not the AI agent. Amend safety check ("verify HEAD was created by you") will always fail. Create new commits instead.

**Dirty worktrees on explicit git/release requests.** If user explicitly asks to commit, push, or release, proceed with relevant changes. Do NOT refuse only because the worktree is dirty. Leave unrelated dirty files from other authors/sessions untouched unless user explicitly asks. For explicit release requests, create needed commit(s) first, then continue the release flow.

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

# Pre-Commit Lint Check

MUST run `bun run format:check` (or `biome check .`) before any git commit.

**Behavior:**
1. Warnings in files YOU modified this session → MUST fix before committing
2. Warnings ONLY in files you did NOT touch (pre-existing issues) → ask user: "Found biome warnings in unmodified files: [list files]. Fix these too, or proceed with just my changes?"
3. Commit only after all warnings in your modified files are resolved

Compare biome output against `git diff --name-only` to determine which files you touched.
