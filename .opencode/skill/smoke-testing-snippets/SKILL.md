---
name: smoke-testing-snippets
description: >-
  Use when smoke-testing opencode-snippets behavior, especially PTY-driven
  OpenCode sessions, snippet UX, and end-to-end snippet features.
license: MIT
---

# smoke-testing-snippets

Use this skill before spawning `opencode` to verify snippet behavior end to end.

## Ambient Rules

These are always relevant. Do not hide them behind progressive disclosure.

1. Rebuild first with `bun run build`. Local `file:///.../opencode-snippets` TUI loads built `dist` output, so stale builds give fake negatives.
2. For non-interactive sanity checks, prefer `opencode run "..."` before burning time on full TUI sessions.
3. For real TUI checks, use `pty_spawn` plus `pty_snapshot` or `pty_snapshot_wait`, not `pty_read`.
4. Wait for a stable anchor like `autoedit` before sending prompt input.
5. Be patient with keypresses. Use separate `pty_write` steps with tiny waits when verifying normal UX. One-burst `#query + arrow + enter/tab` writes are harsher than human typing and should be treated as a separate stress case.
6. Treat PTY OpenCode sessions as disposable on Windows. Bun segfaults and exit code `3` are host noise unless a calmer repro shows the same bug.
7. PTY is bad at mouse-hover validation. If a bug only appears in desktop interaction, suspect hover-state or synthetic mouse events.
8. Smoke test `#skill(...)` both directly and through snippets that expand into `#skill(...)`.

When debugging PTY-driven OpenCode sessions more deeply, please read
[PTY + TUI learnings](./references/learnings.md).

For plugin internals, load the `opencode-plugin-dev` skill via the skill tool.

## Fast Path

1. Spawn OpenCode and wait for `autoedit`.
2. Verify normal behavior with paced `pty_write` steps first.
3. Then try harsher burst writes to separate real UX bugs from PTY ordering artifacts.
4. If counts look wrong, inspect matcher output directly before blaming rendering.
5. For non-TUI snippet features like `#skill(...)`, inspect stored session data too. Visible placeholder text and part metadata can prove transform happened, but they do not alone prove model-facing injected context worked.

## What This Skill Helps With

- snippet filtering mismatches between expected and actual hits
- keyboard navigation vs mouse-hover fights in filtered dropdowns
- PTY/TUI verification flow for `#`, `#o`, `#oc`, arrows, tab, enter
- separating matcher bugs from render or scroll-state bugs
- regular chat and `opencode run` smoke tests for snippet features like `#skill(...)`
- checking stored session/export data when visible transcript differs from model behavior
