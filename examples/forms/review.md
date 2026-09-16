---
description: Review a branch, PR/MR, untracked changes, or specific files
fields:
  target_type:
    label: Review target type
    type: select
    options: [infer, branch diff, PR/MR, untracked changes, files]
    default: infer
  target:
    label: Exact target (optional)
  focus:
    label: Review focus (optional)
    type: textarea
  reviewers:
    label: Reviewers
    type: number
    default: 1
    min: 0
    integer: true
  fix:
    label: Fix validated findings
    type: checkbox
    default: false
  cycles:
    label: Maximum review cycles
    type: number
    default: 1
    min: 0
    integer: true
---
{{#if (gt reviewers 0)}}{{#if (gt cycles 0)}}review{{#if fix}} and fix{{/if}}

<append>
{{#if (eq target_type "infer")}}Determine which type of review to perform:
- a diff of branch X to the target branch
- a PR/MR
- all untracked git changes
- specific files only
{{else}}Review target type: {{target_type}}.
{{/if}}{{#if target}}Exact review target: {{target}}.
{{/if}}{{#if focus}}Review focus: {{focus}}
{{/if}}
{{#if (eq reviewers 1)}}You MUST delegate the review to the `review` subagent. Do not perform the review yourself.

The subagent starts with zero context. Give it the exact review target and worktree path, the intent behind the changes, and every user-requested review focus.
{{else}}Use exactly {{reviewers}} parallel `review` subtasks. Do not perform the review yourself.

Each of the {{reviewers}} subtasks should take care of a different area. Tailor the "What to look for" section accordingly. All {{reviewers}} {{plural reviewers "reviewer" "reviewers"}} start with zero context. Give each the exact review target and worktree path, the intent behind the changes, and every user-requested review focus.
{{/if}}{{#if fix}}
Investigate and fix every finding you determine is correct.

For each accepted finding, create a red unit/integration test to reproduce the issue faithfully from a user perspective. Do not encode your hypothesis for why it is failing; ensure the observed effects are accurately caught by a red test. Choose a test name matching the specification and add inline comments to document intent. Only once a red test faithfully reproduces the issue, make the smallest correct fix, confirm green, then run the relevant regression check.
{{/if}}{{#if (gt cycles 1)}}
Repeat until there are no more actionable or relevant findings. Count your cycles and report how many review stages it took{{#if fix}}, as well as the fixes you made as a result of the reviews{{/if}}. Limit the number of cycles to {{cycles}}, with {{reviewers}} {{plural reviewers "reviewer" "reviewers"}} per cycle.
{{/if}}</append>
{{/if}}{{/if}}
