# PTY + TUI Learnings

Non-obvious learnings from debugging `opencode-snippets` through spawned OpenCode TUI sessions.

## Session Strategy

- `pty_snapshot` and `pty_snapshot_wait` are the right tools for TUIs. `pty_read` is too ANSI-noisy and loses screen structure.
- Search for stable screen anchors like `autoedit` to detect ready state. Then send prompt input fast. Long idle time increases chances the Bun TUI crashes first.
- Use `since` snapshots aggressively. They make `#`, `#o`, `#oc` diffs obvious without rereading the whole screen.
- On this Windows setup, Bun can segfault under PTY after a few seconds. Exit code `3` plus `panic ... Segmentation fault` is a Bun/runtime problem, not automatically the plugin.
- Fresh subagents did discover this repo-local skill on their own when asked to stress-test the TUI. The short description plus local relevance was enough. Good sign the skill is discoverable without hand-holding.

## Verification Shortcuts

- Rebuild before relaunching TUI with `bun run build`. The local plugin is referenced as `file:///D:/projects/opencode-snippets`, but the package exports point at `dist`, so stale build output gives fake negatives.
- Use `opencode run "..."` for cheap plugin/config smoke tests. Reserve full TUI launches for layout, key handling, and autocomplete behavior.
- In OpenCode `Prompt`, `onSubmit` is a post-submit callback, not a submit interceptor. If Enter still leaks through, do not try to "fix" it in wrapper `onSubmit`.
- When the visible hit count looks wrong, verify matcher output directly in-process:

```bash
bun -e "import { loadSnippets, listSnippets } from './src/loader.js'; import { filterSnippets } from './src/tui-search.js'; const r = await loadSnippets(process.cwd()); console.log(filterSnippets(listSnippets(r), 'oc').map(x => x.name));"
```

- That check matters because result sets merge project snippets from `./.opencode/snippet` with global snippets from `~/.config/opencode/snippet`. Memory of an earlier machine or repo can be wrong.

## TUI Control Details

- `pty_write` escapes are enough for core navigation: `\b` for backspace, `\u001b[B` for down, `\u001b[A` for up.
- PTY cannot exercise real mouse hover behavior. If keyboard navigation is only broken in your desktop session, suspect hover-state or synthetic mouse events, not the arrow key handler itself.
- Native `input_submit` can be beaten by plugin commands, but only if your command registers after `Prompt` mounts. OpenCode prepends newer command registrations, so delayed registration changes keybind priority.
- `PromptRef.submit()` is a safe fallback when you intercept `input_submit` yourself and decide there is no snippet action to consume.
- OpenCode's built-in autocomplete already documents one nasty quirk: filtering can trigger synthetic mouse events because the layout moves under the cursor. Read `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` before inventing a new theory.
- One-chunk PTY bursts are harsher than real typing. `#re + down + enter` in a single `pty_write` can still outrun prompt-state visibility even when normal Enter acceptance is fixed. Treat that as a separate lower-level stress case, not automatically a normal UX bug.
- Separate `pty_write` steps with tiny waits are a better approximation of human typing. In this session, paced `#mi` + Enter, paced `#mi` + Down + Enter, and paced `#mi` + Tab all worked, while one-burst variants were the flaky ones.

## Architectural Clues

- For dropdown behavior, OpenCode source of truth is split across:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`
  - `packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx`
- If a custom dropdown diverges from native behavior, compare container shape first. Extra wrappers around `scrollbox` children can cause misleading viewport gaps or stale scroll behavior.
- If the filtered count is correct in `filterSnippets(...)` but the screen looks wrong, the bug is almost certainly render-tree or scroll-state, not search ranking.
