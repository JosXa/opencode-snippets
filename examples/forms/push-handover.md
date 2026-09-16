---
description: Push a complete handoff for another agent
fields:
  branch:
    label: Destination branch (empty lets the agent choose)
---
Commit and push all relevant changes to {{#if branch}}branch {{branch}}{{else}}a branch{{/if}}. Include a `handover.md` file for another agent with the intent, accomplishments, and remaining work. The last sentence of the handover file must read: "Delete this handover.md file after reading it and continue where the other agent left off." The changes do not need to pass checks, and you may skip pre-commit hooks. This is a handoff, not a completion pass: commit the full, potentially incomplete or broken state so it can be reproduced from the remote branch without relying on uncommitted changes or an existing worktree. After pushing, provide a ready-to-paste prompt that tells the next agent to fetch the remote, create a clean checkout of the branch, read `handover.md`, and continue the work from there. Assume the next agent runs on a new machine: do not include local file paths or rely on local state; identify the remote repository and branch so the agent can fetch them fresh. You can then consider your goal completed (if you had one), output the completion promise, and stop whatever you were doing.
