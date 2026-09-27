# Snippets library BDD

Run the Gherkin features with Cucumber and Bun:

```sh
bun install --frozen-lockfile
bun run test:bdd
bun run test:bdd --tags @navigation
bun run test:bdd --name 'Cancel a form'
bun run test:bdd --dry-run
bun run typecheck:bdd
```

`bun test` also runs this suite through `tests/library-bdd.test.ts`. CI uses that
entrypoint and uploads the Cucumber HTML report, JUnit XML, and failure traces.
Reports go to `.tmp/bdd`; set `SNIPPETS_BDD_ARTIFACTS` to change the destination.
A filter that matches no scenarios fails the run.

## What the suite exercises

The features mount the production `SnippetLibrary` and `SnippetForm` in the
native OpenTUI test renderer. Steps send terminal key sequences, bracketed paste,
and mouse events. Each scenario gets its own renderer and temporary snippet files.
Search, source parsing, editing, validation, and filesystem operations use the
production code.

The surrounding OpenCode dialog API is a deferred mock. Steps inspect its labels
and respond through `I choose ... in host dialog ...` or `I answer host dialog ...`.
These steps verify the plugin's dialog contract. They do not exercise OpenCode's
dialog implementation. Clipboard, route close, reload, and host mode are also
test doubles. The suite needs no model, account, or running OpenCode service.

The driver includes OpenTUI's managed editor keymap with Enter bound to host
submission. Assertions check that library and form keys do not submit a prompt.
Kitty keyboard encoding preserves modifiers such as Ctrl+Enter and Shift+Enter.
The existing renderer regression tests also exercise legacy terminal encoding.

## Add a journey

Put user-facing behavior in `features/*.feature`. Use Scenario Outlines for the
same behavior with different inputs. Add reusable TypeScript steps under `steps/`;
keep state on `LibraryWorld` so scenarios remain independent.

Use `When I press keys "Tab, Enter"` for a short sequence of consecutive presses.
Commas separate presses; `+` combines modifiers, as in `"Ctrl+End, Enter"`.
Each press waits for rendering and has its own trace entry. Keep text entry and
intermediate assertions in separate steps. Use `I press ","` for a literal comma.

Drive interactions through `press`, `type`, `paste`, and `click`. Read rendered
text, focus, clipboard output, or disk contents for assertions. Do not call a
component's action handler or set its editor contents directly. Retry observable
assertions with `until` when disk work can outlive a render pass.

On failure, the HTML report includes the terminal frame. Text artifacts contain
the step sequence, terminal inputs, earlier frames, and the final frame. Scenario
IDs keep artifacts from different outline examples separate. Scenarios run
serially because terminal input is shared within a process.
