---
alwaysApply: true
---

# Package Manager

ALWAYS use Bun. NEVER npm. Commands: `bun install`, `bun add`, `bun remove`, `bun run`, `bun test`.

# Release Workflow

1. Commit all changes
2. Bump version in `package.json`
3. Commit version bump
4. Push to remote
5. Verify CI passes: `gh run list --limit 3`
6. Create git tag: `git tag vX.Y.Z`
7. Push tag: `git push origin vX.Y.Z`
8. Write release notes to `release-notes-X.Y.Z.md`
9. Create GitHub release: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file release-notes-X.Y.Z.md`
10. Monitor Actions: `gh run list --limit 3` or `gh run watch`

Publish to npm is automated via CI on tag push.

## Post-Release Verification

1. Verify publish workflow success: `gh run list --limit 5`
2. Open release page: `start https://github.com/JosXa/opencode-snippets/releases/tag/vX.Y.Z`

## Recovery: Tag Pushed While CI Failing

MUST delete tag immediately:
```
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
```
