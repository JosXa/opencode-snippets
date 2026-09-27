# Match OpenCode's native colors

Use the host control with the same purpose as the reference. For lists and action
footers, inspect `packages/tui/src/ui/dialog-select.tsx` on OpenCode's V2 branch.
For editable text, inspect `dialog-prompt.tsx`. Check behavior in the installed
runtime as well: source from a newer revision can differ.

## Token pairs

Resolve colors through `context.theme.surface("dialog")`. A foreground token and
its background form a pair, so copying only the blue selection fill is insufficient.

| State | Foreground | Background |
| --- | --- | --- |
| Selected list row | `text.action.primary.focused` | `background.action.primary.focused` |
| Selection retained while an action has focus | `text.muted` | `background.raised.high` |
| Focused action and shortcut | `text.action.primary.focused` | `background.action.primary.focused` |
| Idle action | `text.base` | Inherited dialog surface |
| Idle shortcut or placeholder | `text.muted` | Inherited dialog surface |
| Disabled action and shortcut | `text.action.primary.disabled` | Inherited dialog surface |
| Focused list filter | `text.formfield.focused` | `background.formfield.focused` |

Selected list titles and focused action labels are bold. Apply the selected
foreground to the scope marker too. When focus moves to an action, mute the
retained row and remove its bold attribute. Use field tokens for editable text;
do not rely on OpenTUI's default focused foreground.

## Compare rendered output

1. Build the plugin. Stage its distribution in a private temporary directory so
   concurrent builds cannot reload it during inspection. Verify that the isolated
   CLI config registers the directory containing the built entrypoints.
2. Launch a fresh `opencode2` in a private tmux server with isolated config and
   database. Copy the user's theme into that config. Open the native control and
   plugin page in the same process, at the same terminal dimensions.
3. Capture each state with `tmux -L "$socket" capture-pane -p -e -t "$pane"`.
   The `-e` flag preserves ANSI colors. A plain text capture cannot prove color
   parity. Compare title, selected row, scope marker, idle action, focused action,
   shortcut, placeholder, typed filter, and selection after focus moves away.
4. Decode SGR foreground, background, and bold attributes at matching text cells.
   Track state across spans and lines, including resets. Compare foreground and
   background together. Keep captures and comparison results in temporary test
   evidence, rather than recording theme-specific RGB values as design rules.
5. In renderer tests, use `captureSpans()` to assert colors and attributes. Give
   base text, focused text, field text, and disabled text distinct fixture colors.
   Locate the list row by its marker and name so a matching detail heading cannot
   satisfy the assertion. Move focus with the keyboard and check mouse hover.
6. Close the private tmux server when finished. Rebuild the registered local
   distribution after production edits so the next user session loads them.

Screenshots help compare composition, but terminal transparency, font rendering,
and inactive-window dimming can change their apparent colors. Use semantic tokens
and ANSI or renderer spans to establish the actual color mapping.
