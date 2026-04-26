# Instant snippet expansion

Status: planning. Not implemented.

## Goal

Snippets opt in via frontmatter `instant: true`. When the user picks an instant
snippet from the autocomplete dropdown, the snippet expands into the prompt
buffer immediately at accept time, instead of being deferred to the
submit-time chat hook. The cursor lands at the position the snippet author
intended, so the user can keep typing in context.

## Why a primitive

We rejected two cheaper designs:

1. _Inline-only at accept, defer blocks._ Blocks (`<prepend>`, `<append>`,
   `<inject>`) keep flowing through the existing chat hook. Bad UX: users
   pick a snippet, see partial expansion, and have no way to learn what the
   snippet actually contains until after submit. Half-magic. Confusing for
   debugging.
2. _Restrict instant to inline-only snippets._ Loader rejects `instant: true`
   on snippets that contain block tags. Forces snippet authors to split a
   single concept into two files or give up the feature. Documentation
   burden, surprise at load time.

Instead we treat instant expansion as a primitive: the snippet author writes
exactly what should appear in the prompt at expansion time, including the
cursor anchor, and the TUI honors it.

## Snippet author surface

Frontmatter:

```yaml
---
instant: true
description: ...
aliases: [...]
---
```

Body uses an explicit cursor marker. Proposed token: `$0`. Borrowed from LSP
snippet syntax so it reads naturally for anyone who has used VS Code or
similar editors.

```md
---
instant: true
---
Please review the following code:

```
$0
```

Focus on correctness and edge cases.
```

After expansion the cursor sits between the fenced code lines. The user types
the code, hits enter, sends.

If `$0` is omitted the cursor lands at end of expanded content. That matches
the existing implicit behavior of non-instant snippets and avoids forcing
authors to mark every snippet.

`<prepend>`, `<append>`, `<inject>` blocks remain valid inside instant
snippets. They are extracted into the prompt parts model the same way
deferred snippets handle them at submit time, but the work happens at accept
time. The visible prompt buffer holds only the inline body. Blocks live as
hidden parts attached to the prompt and ride along on submit.

## Trigger flow

1. User types `#tag`. Autocomplete shows the snippet with an "instant" badge.
2. User selects via Enter, Tab, or click.
3. Plugin replaces `#tag` with the inline body of the snippet, with `$0`
   stripped, and sets the cursor to where `$0` was (or end of inline body if
   absent).
4. Plugin attaches block content (prepend/append/inject) as parts on the
   prompt, so the existing submit-time pipeline finds them and routes them
   correctly.
5. Recursive expansion of nested snippets happens at accept time too. Same
   cycle detection as the existing expander.

## Hard blocker: cursor positioning

`@opencode-ai/plugin/tui` `TuiPromptRef` exposes:

```ts
type TuiPromptRef = {
  focused: boolean;
  current: TuiPromptInfo;       // input: string, mode, parts
  set(prompt: TuiPromptInfo): void;
  reset(): void;
  blur(): void;
  focus(): void;
  submit(): void;
};
```

No cursor read. No cursor write. `TuiPromptInfo` has no caret field. The
host textarea owns the caret and never exposes it. When we call `set()` the
cursor goes wherever the host decides, which today is end-of-input (because
that is where text we appended landed).

Without upstream changes we cannot deliver the primitive UX. Workarounds
(zero-width markers, fake selections, send-key hacks) all leak.

## Required upstream changes

Investigate and pick one. Both involve `sst/opencode` and probably
`@opencode-ai/plugin`:

1. **Add `cursor` to the prompt API.**
   - Extend `TuiPromptInfo` with `cursor?: number` (UTF-16 code-unit offset
     into `input`).
   - `TuiPromptRef.set()` honors `cursor` if present, else current behavior.
   - `TuiPromptRef.current.cursor` reflects current caret.
2. **Add a dedicated `setInputWithCursor(input, cursor)` method.** Less
   invasive on `TuiPromptInfo` shape, more surface area on `TuiPromptRef`.

Option 1 is cleaner. The plugin already shovels whole `TuiPromptInfo`
objects through `set()`; adding an optional field is backward compatible.

## Plan

1. Audit upstream TUI prompt component (find the textarea, see how `set`
   maps to internal state, see how cursor is tracked).
2. Sketch the API change as a patch on `~/projects/opencode.worktrees/dev`
   so we can show the upstream maintainers a concrete diff rather than a
   feature request.
3. Open a feature request on `sst/opencode` referencing the patch.
4. While that lands, ship the snippet-side parser (frontmatter `instant`,
   `$0` cursor token, accept-time expansion path) gated behind a runtime
   capability check. If the host TUI lacks cursor support, fall back to
   end-of-input expansion plus a one-time toast nudging users to update.
5. When the upstream change ships, drop the fallback.

## Open questions

- Cursor token bikeshed: `$0` (LSP), `${cursor}`, `<cursor/>`, `|`. `$0` is
  shortest and familiar. Risk: collides with literal shell `$0`. Mitigation:
  require `\$0` to escape, or scope the token to instant snippets only.
- Multiple cursors? LSP allows `$1`, `$2` for tab stops. Out of scope for
  v1. Single cursor or end-of-input.
- Selection ranges? Same answer. v1 is single caret.
- What happens if the snippet body is empty after `$0` strip? Insert
  nothing, just place caret. Edge case but cheap to handle.
- How does instant interact with `#skill(...)` loads? Skills don't use this
  path. No interaction.
