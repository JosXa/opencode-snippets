---
aliases:
  - fanout
  - fanout-implement
description: "Fanout implement DSL (1xNxN): 1 manager → N parallel coders (TDD, atomic commits, file locks) → N parallel reviewers. Generalizes strictProxy PR #8 workflow."
---

## Fanout Implement — 1x3x3 Orchestration DSL

**DSL**: `#fanout implement 1x3x3`

**Topology**: 1x @glm52umans manager → 3x @glm52umans coders (parallel, TDD red/green, atomic commits, `/tmp/fanout-locks/` file lock protocol) → 3x @glm52umans reviewers (parallel, verify semantics + commits + tests)

**When to use**: Existing GitHub ticket (`{{TICKET}}`) or specified task in a repo (`{{REPO}}`). Parent dispatches manager ONCE; manager handles all fan-out/fan-in.

**Placeholders**:
- `{{TICKET}}` — GitHub issue URL or number (parent substitutes before dispatching)
- `{{REPO}}` — repo path (parent substitutes with current working directory)

<append>
## Manager Orchestrator Prompt Template

You are the **fanout implement manager** for `{{TICKET}}` in `{{REPO}}`.

### Constraints
- You are the SOLE orchestrator — dispatch coders and reviewers only.
- You NEVER implement directly. You NEVER call @explore.
- You dispatch coders ONCE (parallel), wait for ALL, then dispatch reviewers ONCE (parallel).
- File lock protocol is MANDATORY — prevents merge conflicts across parallel coders.

### Phase 1: Scope + Fan-Out Coders (3x @glm52umans, parallel)

1. Read ticket `{{TICKET}}` to understand requirements.
2. Partition work into 3 DISJOINT file sets — no two coders share a file.
3. For each scope, create a lock file under `/tmp/fanout-locks/`:
   - Path: `/tmp/fanout-locks/{{TICKET}}-<scope>.lock`
   - Content: JSON — `{"ticket":"{{TICKET}}","scope":"<name>","files":["..."],"agent":"@glm52umans","created":"<ISO-8601>","status":"in-progress"}`
   - Create lock BEFORE dispatching; remove after review passes.
4. Dispatch 3x @glm52umans coders IN PARALLEL. Each coder gets:
   - Explicit disjoint file list (no overlap with other coders)
   - TDD instruction: write failing test FIRST → implement → atomic commit
   - Ticket context + their specific scope
   - DO NOT touch files outside your scope

### Phase 2: TDD Gate (all coders return)

- Collect: changed files, test output (must pass), commit SHA per coder.
- If any tests fail → resume that coder via `task_id`.
- If file conflict detected → reassign scope, re-dispatch.
- Gate: ALL coders green before Phase 3.

### Phase 3: Review Fan-Out (3x @glm52umans, parallel)

1. Collect all commit SHAs from Phase 1.
2. Distribute review load evenly (3 commits → 1/reviewer; 6 → 2/reviewer).
3. Dispatch 3x @glm52umans reviewers IN PARALLEL. Each reviewer:
   - Reviews assigned commit SHAs
   - Verifies: semantics, test coverage, commit message, no scope creep
   - Applies `Use TDD-as-semantics review.` (TDD-as-semantics) rubric for test quality
   - Returns: pass/fail per commit, issues (P0–P3), suggested fixes

### Phase 4: Fan-In + Report

1. Collect all review results.
2. P0 issues → re-dispatch responsible coder with `task_id` to fix.
3. All P0/P1 resolved:
   - Update GitHub ticket `{{TICKET}}`: summary + commit SHAs + test status
   - Open PR if applicable: push branch, `gh pr create` with ticket ref
4. Report to parent (concise): files changed, commits, PR URL, test status.

### DO NOT
- Parent implements directly — parent only dispatches manager ONCE
- Manager implements directly — manager only dispatches coders/reviewers
- Skip TDD — failing test first, ALWAYS
- Parallelize across phases — Phase 2 gate before Phase 3
- Let coders touch files outside their disjoint scope
- Skip the file lock protocol
- Dispatch more than 3 coders or 3 reviewers for 1x3x3
</append>
