# Release Command

Guide through complete release workflow for opencode-snippets.

## Usage

`/release` - Automatically bump patch version and publish a new release

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

**Step 1: Version Bump**
- Read current version from `package.json` (e.g., "1.4.1")
- Parse as semver and increment patch version: X.Y.Z → X.Y.(Z+1)
- Example: 1.4.1 → 1.4.2
- Use Edit tool to update package.json with new version
- Commit: `git add package.json && git commit -m "chore: bump version to vX.Y.Z"`

**Step 2: Push Version Bump**
- Push to remote: `git push`
- Wait for CI to pass: `gh run list --limit 3`
- If CI fails, STOP and inform user (see Recovery section)

**Step 3: Create and Push Tag**
- Create git tag: `git tag vX.Y.Z`
- Push tag: `git push origin vX.Y.Z`
- Inform user that CI will now run publish workflow

**Step 4: Write Release Notes**
- Ask user to provide release notes content
- Write release notes to `release-notes-X.Y.Z.md`
- Format should include:
  - Version header (## vX.Y.Z)
  - Release highlights/changes
  - Any breaking changes
  - Bug fixes
  - Other notable changes

**Step 5: Create GitHub Release**
- MUST use Write tool to create release notes file FIRST
- Then run: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file release-notes-X.Y.Z.md`
- NEVER use heredoc or pipes - always use --notes-file with actual file

**Step 6: Monitor and Verify**
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
- Version format: X.Y.Z (no 'v' prefix in package.json, but 'v' prefix in git tags)
- Repository: https://github.com/JosXa/opencode-snippets

### Error Handling

If ANY step fails:
1. STOP the workflow
2. Inform user of the failure
3. Provide recovery instructions
4. DO NOT proceed to next steps

CRITICAL: If tag is pushed but CI fails, recovery steps are MANDATORY.
