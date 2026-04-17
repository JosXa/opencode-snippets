# Release Command

Guide through complete release workflow for opencode-snippets.

## Usage

`/release` - Analyze commits and automatically bump version (patch/minor/major based on conventional commits)

## Instructions

You are guiding the user through the complete release workflow. Follow these steps EXACTLY:

### Pre-Release Checklist

1. **Verify working directory is clean:**
   - Run `git status` to check for uncommitted changes
   - If there are uncommitted changes, STOP and ask user to commit them first

2. **Verify CI is passing:**
   - Run `gh run list --limit 3`
   - If latest run is not successful, STOP and ask user to fix CI first

### Release Steps

Execute these steps IN ORDER:

**Step 1: Determine Version Bump**
- Read current version from `package.json`
- Get commits since last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
- Analyze commit messages using conventional commits:
  - **MAJOR** (X.0.0): Any commit with `BREAKING CHANGE:` in body OR `!` after type (e.g., `feat!:`, `fix!:`)
  - **MINOR** (X.Y.0): Any commit starting with `feat:` or `feat(scope):`
  - **PATCH** (X.Y.Z): Everything else (`fix:`, `chore:`, `docs:`, `refactor:`, etc.)
- Use the HIGHEST bump level found (major > minor > patch)
- **If MAJOR version bump detected:** STOP and ask user for confirmation before proceeding. Explain which commit(s) triggered the major bump.
- Calculate new version and inform user: "Bumping version: 1.4.1 → 1.5.0 (minor - new features detected)"
- Use Edit tool to update package.json with new version
- Commit: `git add package.json && git commit -m "chore: bump version to vX.Y.Z"`

**Note:** The "Update Schema URLs" CI workflow is broken (403 on push-back). MUST update schema URLs manually before tagging. Update the version in `raw.githubusercontent.com/.../vX.Y.Z/schema/config.schema.json` in: `README.md`, `src/config.ts`, `skill/snippets/SKILL.md`.

**Step 2: Push Version Bump**
- Push to remote: `git push`
- Wait for CI to pass: `gh run list --limit 3`
- If CI fails, STOP and inform user (see Recovery section)

**Step 3: Create and Push Tag**
- Create git tag: `git tag vX.Y.Z`
- Push tag: `git push origin vX.Y.Z`
- Inform user that CI will now run publish workflow

**Step 4: Monitor Release Notes**
- CI auto-generates release notes from conventional commits (categorized: features, fixes, docs, chores)
- The "Release and Publish" workflow creates/updates the GitHub release automatically
- Release notes should omit installation instructions. For OpenCode, plugin usage is configured via the `plugin` array rather than a release-note install command
- Do NOT write manual release notes unless user wants to add extra context
- If editing is needed: `gh release edit vX.Y.Z --notes-file <file>` (not `create`, which 422s)

**Step 5: Monitor and Verify**
- Check publish workflow: `gh run list --limit 5`
- Wait for publish workflow to complete
- Open release page: `start https://github.com/JosXa/opencode-snippets/releases/tag/vX.Y.Z`
- Inform user release is complete

### Recovery: Tag Pushed While CI Failing

If CI was failing when tag was pushed, MUST delete tag immediately:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

Then:
1. Fix CI issues
2. Restart release process from Step 2

### Important Notes

- Publishing to npm is AUTOMATED via CI on tag push
- DO NOT manually publish to npm
- Leave installation instructions out of release notes
- Version format: X.Y.Z (no 'v' prefix in package.json, but 'v' prefix in git tags)
- Repository: https://github.com/JosXa/opencode-snippets

### Error Handling

If ANY step fails:
1. STOP the workflow
2. Inform user of the failure
3. Provide recovery instructions
4. DO NOT proceed to next steps

CRITICAL: If tag is pushed but CI fails, recovery steps are MANDATORY.
