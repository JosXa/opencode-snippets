# Snippet fields and forms

## Goal and approved scope

Define typed fields in YAML frontmatter and render snippet bodies with Handlebars.
Collect answers in a native OpenTUI form and retain readable deferred invocations such as
`#review(reviewers=3, fix=yes, cycles=2)`. Filling a form changes the reference
in the composer; the body expands only when the message is sent.

The user approved migration of **only** these personal snippets:

- `myapps`: app name to search for.
- `remindme`: reminder text, delivered in the final reply after the current
  task. It is not a calendar/scheduled reminder.
- `push-handover`: optional destination branch. Empty means the agent chooses.
- The six review snippets: `review`, `review-with-three`, `review-and-fix`,
  `review-and-fix-with-three`, `review-and-fix-loop`, and
  `review-and-fix-with-three-loop`. Consolidate through a shared template and
  preserve familiar names as presets.
- `reword-now`, `reword-three`, `reword-five`: a general `reword` template with
  count and optional tone, preserving existing shortcuts, including libraries
  where `reword-now` is an alias of `reword-this`.
- `five-options`, `ten-options`, `twenty-options`: a general `options` template
  with count and existing shortcuts.
- `suggest-name`: count and optional naming constraint, including nested
  parameter support for the options template.
- `generate-prompt` (alias `prompt`): optional outcome/extra instructions,
  platform choice, OpenCode involved, file output, and optional output path.

The user explicitly excluded `new-worktree-and-branch`: the agent should
continue to choose the name. Earlier branch-name/max-length examples are
language acceptance examples, not permission to migrate that snippet.
Other audit candidates and the earlier standalone prompt-generator demo are
outside this migration. The implementation targets the OpenCode V2 branch.

## Authoring contract

Use YAML field metadata and ordinary Handlebars variables and conditionals:

```markdown
---
fields:
  app:
    label: App name
    required: true
---
Search MyApps for {{app}}.
```

The plugin owns the `fields` schema. Handlebars supplies variable lookup,
subexpressions, whitespace control, and conditional blocks. The mapping is
authoritative: body references do not create fields. Remove the inline `field`
declaration helper and its `render` option after migrating the current forms.
Opening a form must not execute shell commands, load skill bodies, or evaluate
a template to find its schema. An explicit `fields` mapping (including an empty
mapping) opts the snippet body into Handlebars; inline `skill` helpers also do.
Nested forms contribute their metadata without activating unrelated legacy
parent bodies. Preserve direct context variables in declared templates.

Implementation contract for field metadata:

- A literal stable key identifies a field. Keys are ASCII letters followed by
  letters, digits, or underscores; reject prototype-related reserved names.
- `label` is optional and defaults to a readable form of the key.
- `type`: `text` (default), `textarea`, `number`, `checkbox`, `select`.
- `default`: literal string, number, or boolean of the matching type.
- `required`: boolean, default false. Required strings cannot be whitespace
  only. A required checkbox still permits false: this asks for a choice, not
  consent. Checkbox initial state defaults to false.
- `min`, `max`, `integer`: numeric constraints. Number values must be finite.
- `minLength`, `maxLength`: string lengths measured in Unicode code points.
- `pattern`: a regular-expression source for text validation, with a useful
  label-based error. Invalid expressions are definition errors.
- `options: [quick, normal, thorough]`: a YAML sequence of string choices.
- Reject nonmapping schemas, invalid definitions/options, and unknown metadata
  with actionable errors before effects. Metadata is data, never executable.

Field order follows authored mapping order, then nested references in body order.
Repeated `{{app}}` references reuse one value; incompatible definitions in a
nested tree are errors. Keys are available as typed Handlebars context values
for conditions. Printed checkbox field answers
are exactly `yes` or `no`. Preserve text/newlines/HTML verbatim (`noEscape`).
Register small `eq`, `gt`, and `plural` helpers for the concrete review wording;
`plural count "reviewer" "reviewers"` returns the chosen word.

Support standard Handlebars escaping for literal expressions. Existing bodies
without a fields mapping or inline-skill helpers remain literal templates, including the
later-stage `{{session_id}}` placeholder in `review-opencode-sessions`. Ordinary
user prose is not globally processed as Handlebars.

## Existing syntax and processing

- Nested snippets remain `#name` / `#name(key=value)`.
- Preserve OpenCode-style shell interpolation: backtick commands prefixed by
  `!` and `!>`; it still executes after snippet expansion.
- Preserve `<prepend>`, `<append>`, and `<inject>` semantics and deduplication.
- Preserve `#skill(...)`: visible loaded marker and hidden skill context.
- Add `{{skill "review"}}` for inline skill bodies. Keep existing XML skill
  rendering working during migration; document the preferred replacement.
- Unknown hashtags and escaped `#_name` references remain literal.
- Protect supplied text from subsequent hashtag, skill, XML-block, Handlebars,
  and shell interpretation. This boundary must cover values printed through
  helper calls or context variables, including text in append/inject blocks.
  Restore literal text only after effects have been processed.
- Retain durable once-only processing and replay: edited/copied invocation
  text is self-contained; replay does not reopen forms or rerun effects.
- Prepare and validate all text parts before reserving command or shell effects.
  Pure validation failures remain retryable. Preparation models management
  commands in memory so later parts see their planned registry changes.
  Completed results bypass preparation; interrupted effects remain blocked.

## Invocation grammar

The composer representation is `#name(key="value", count=3, flag=yes)`.

- Comma-separated named arguments, with whitespace around separators allowed.
- Text uses JSON double-quoted string escaping, including `\n`, quotes, and
  backslashes. Numeric literals must be finite. Booleans serialize as yes/no;
  accept true/false as well. No expressions, eval, or positional arguments.
- Parse balanced quoted content, including commas/parentheses inside strings.
- Reject duplicate and unknown keys, wrong types, incomplete/malformed argument
  lists, and invalid values with useful errors; never partially expand a known
  invocation and leave its suffix behind.
- Parenthetical prose after legacy snippets must retain its old meaning.
  `#skill(...)` retains its existing separate grammar.
- Serialize values in field order so the display is predictable. The full
  invocation is the durable state; hidden UI-only IDs are not required.

Nested field discovery walks snippet references without side effects, bounded
by the existing recursion rules. All fields reachable through one top-level
invocation share a key space; different top-level invocations have independent
answers. Nested literal arguments provide preset defaults; explicit outer
answers override the presets for matching keys. This permits
`#review-with-three(reviewers=2)` to override its usual three-reviewer preset.
Conflicting schemas must report an error rather than silently collide.

## TUI interaction

- Accepting a completion by Tab/Enter/mouse opens a form iff fields exist.
- Mark these autocomplete entries with `☷`, including nested field presets.
- Typing a space after an exact name also opens its form. A partial/unknown
  name followed by space stays ordinary text; it must not select a fuzzy match.
- Do not submit the prompt when accepting a completion or confirming a form.
- Show all fields in declaration order in a scrollable dialog, with labels,
  current/default values, field errors, and clear confirm/cancel controls.
- Native text inputs, textareas, and selection lists; numeric validation on
  text inputs; a small keyboard/mouse checkbox since OpenTUI lacks one.
- Tab/Shift+Tab move between fields, arrows select, Space toggles checkbox,
  Ctrl+J inserts multiline text, Enter confirms from any field, Escape cancels.
  Keep the action row `OK`, `Cancel`, `Help`. Hide keyboard shortcuts and
  navigation instructions by default; the Help button toggles their visibility.
- Confirm writes the filled reference and restores composer focus. Cancel
  preserves the exact original reference and previous answers.
- Provide an Edit snippet fields command/shortcut for the invocation under
  the cursor, including already-filled references, and advertise it in Help.
- Update only the reference range. Preserve surrounding Unicode text, cursor
  behavior, attachments/extmarks, and unrelated prompt content.
- Long values remain serializable with escaped newlines; visual folding is
  optional, not necessary for initial delivery.
- Blank optional values preserve context-based behavior. Bare headless
  invocations use defaults; invalid/missing required values reject processing
  with an actionable error before rendering effects.

## Review wording: implementation decisions

Fields include target type, optional target and focus, reviewer count, fix
checkbox, and maximum cycles. Keep existing behavioral defaults in presets:
base review = one reviewer/one cycle/no fixes; three-reviewer presets = three;
fix presets = fixes enabled; loop presets = three cycles.

- Zero reviewers or zero cycles intentionally emits no review directive.
- One reviewer uses singular wording and omits parallelism instructions.
- One cycle omits repeat/loop instructions.
- Several reviewers get distinct areas; several cycles stop on no actionable
  findings and remain bounded by the selected maximum.
- Fix=false omits fixing and red/green instructions; fix=true includes the
  existing validation procedure. Empty target/focus/tone/branch clauses vanish.
- Numerals and pluralization must agree; zero must never accidentally activate
  a truthy string branch. Test 0/1/many with both checkbox values.

These zero semantics are an implementation decision completing the user's
request for sensible omissions at 0 and 1; they must be visible in docs/tests.

## Natural-language authoring through the snippets skill

The skill translates ordinary requests into the API without requiring users to
know its syntax. Infer the interaction, never invent unrequested constraints.
Keep the root skill short and put detailed examples in a linked reference.

| User request | Interpretation |
| --- | --- |
| Ask for a branch name limited to 20 characters | Text field with maxLength=20; an authoring example, not a migration of the user's worktree snippet. |
| Room to describe a bug and paste reproduction steps | Two multiline fields preserving newlines. |
| Ask what to build and whether to use a goal | Text plus checkbox; printed yes/no. |
| Choose a quick, normal, or thorough review | Single selection with exactly those choices. |
| Ask for a target branch with main already filled in | Editable default="main". |
| Task is mandatory, extra context optional | Required task and optional context. |
| Ask for 3 to 10 ideas | Integer with inclusive bounds. |
| Ask for a version once and reuse it | One key referenced at several positions. |
| Package name accepts lowercase letters, digits, hyphens | Explicit pattern and readable validation error; no silent rewriting. |
| Use goal starts checked | Checkbox default=true. |

## Module APIs

Field discovery and invocation parsing are shared by the expander, V2 request
processing, and TUI. The public functions consumed by the TUI are:

```ts
type FieldValue = string | number | boolean
type FieldValues = Record<string, FieldValue>
type FieldDefinition = {
  name: string; label: string;
  type: "text" | "textarea" | "number" | "checkbox" | "select";
  required: boolean; default?: FieldValue;
  min?: number; max?: number; integer?: boolean;
  minLength?: number; maxLength?: number; pattern?: string;
  options?: string[];
}
// src/fields.ts
getSnippetForm(name: string, registry: SnippetRegistry, supplied?: FieldValues):
  { fields: FieldDefinition[]; values: FieldValues }
validateFields(fields: FieldDefinition[], values: FieldValues): Record<string, string>
// src/invocation.ts (UTF-16 offsets; UI converts using native editor ranges)
parseInvocation(text: string, start: number):
  { name: string; start: number; end: number; values: FieldValues; parameterized: boolean } | undefined
serializeInvocation(name: string, values: FieldValues): string
```

Invalid definitions/invocations throw an Error with a user-facing message.
Validation returns errors by field key. `getSnippetForm` applies defaults and
presets but leaves missing required values editable; the sender enforces them.

## Required verification

- Unit/integration tests: syntax/escaping, types, bounds, defaults, unknown keys,
  repeats/conflicts, 0/1/many, nested presets, aliases, multiple invocations,
  literal values containing shell/hash/XML/template syntax, normal legacy
  snippets and direct shell syntax, skill modes, durable replay and edits.
- Exercise all ten skill authoring examples against the implemented API.
- Build the installed distribution entrypoints; typecheck and run the existing
  relevant suite. Use Bun and the repository's checks.
- Fresh OpenCode V2 server/CLI tests of persisted and model-facing expansion,
  errors, and side-effect replay. Prefer deterministic local model fixtures.
- Fresh real TUI: completion, exact-space trigger, cancel, confirm, edit,
  multiline, checkbox, selection, validation, multiple fields, Unicode and
  attachments. Test real built output, not an unrepresentative source import.
- Register the tested build for the user's V2 setup and migrate only approved
  personal snippets after tests pass. Preserve unrelated work in dirty repos.
- Record transient runtime/config/build/test evidence separately from this
  standing specification. Do not claim a check passed without observing it.
