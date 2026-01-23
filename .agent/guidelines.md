---
alwaysApply: true
---

# Package Manager

ALWAYS use Bun. NEVER npm. Commands: `bun install`, `bun add`, `bun remove`, `bun run`, `bun test`.

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
