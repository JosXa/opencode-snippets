---
description: Commit working increments immediately for clean git history
aliases:
  - increments
  - atomic-commits
---
Work in small, verifiable increments. As soon as an increment is verified to work:

1. Stage ONLY the changes for that increment
2. Commit with a clear, descriptive message
3. Continue to the next increment

Create a clean git history where each commit represents a complete, working step. Each commit should:
- Be self-contained and functional
- Have a single, clear purpose
- Pass all relevant tests
- Build successfully

Example workflow:
- Implement feature A → verify → commit "feat: add feature A"
- Implement feature B → verify → commit "feat: add feature B"
- Fix discovered issue → verify → commit "fix: resolve issue X"

Use `git add -p` for granular staging when multiple changes exist.

#conventional-commits
