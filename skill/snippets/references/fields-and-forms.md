# Fields and forms

Declare inputs in a YAML frontmatter `fields` mapping and print answers with ordinary Handlebars variables. Infer the requested interaction from ordinary language, preserve the snippet's fluent shape, and add only constraints the user requested. A form edits a readable hashtag invocation; sending the message expands its body.

## Authoring procedure

1. Read the original snippet and identify what the user wants to vary. Keep its aliases, intent, and surrounding-text behavior.
2. Choose stable keys, readable labels, and the requested input types. Put literal metadata under `fields`; select choices use a YAML array.
3. Place short answers inline with `{{key}}`. Use conditional blocks for optional prose and `<append>` for heavier follow-through instructions. Metadata alone does not print an answer.
4. Use typed context values in `#if`, `eq`, or `gt`. Write explicit 0, 1, and many cases when counts change the instruction. Omit empty optional clauses completely.
5. Test field discovery, validation, and actual expansion, including presets and aliases. Do not execute the actions described by the snippet to test its wording.

## Translate these requests

Each fenced block below is a complete Markdown snippet, including its frontmatter. These are authoring examples, not instructions to replace unrelated personal snippets.

### 1. “Ask for a branch name limited to 20 characters”

Use a text field with a Unicode code-point limit. Do not add a naming pattern, a default, or a required flag unless requested.

```markdown
---
fields:
  branch:
    label: Branch name
    maxLength: 20
---
Branch: {{branch}}
```

### 2. “Room to describe a bug and paste reproduction steps”

Use two multiline inputs and preserve their newlines.

```markdown
---
fields:
  bug:
    label: Bug description
    type: textarea
  steps:
    label: Reproduction steps
    type: textarea
---
Bug:
{{bug}}
Reproduction steps:
{{steps}}
```

### 3. “Ask what to build and whether to use a goal”

Use text plus a checkbox. Printed checkbox answers are `yes` or `no`.

```markdown
---
fields:
  task:
    label: What to build
  goal:
    label: Use a goal
    type: checkbox
---
Build {{task}}.
Use a goal: {{goal}}
```

### 4. “Choose a quick, normal, or thorough review”

Use exactly the requested choices in a single selection.

```markdown
---
fields:
  depth:
    label: Review depth
    type: select
    options: [quick, normal, thorough]
---
Review depth: {{depth}}
```

### 5. “Ask for a target branch with main already filled in”

Defaults remain editable.

```markdown
---
fields:
  branch:
    label: Target branch
    default: main
---
Target branch: {{branch}}
```

### 6. “Task is mandatory, extra context optional”

Require only the task. Hide the optional clause when blank.

```markdown
---
fields:
  task:
    label: Task
    required: true
  context:
    label: Extra context
    type: textarea
---
Task: {{task}}
{{#if context}}Extra context: {{context}}{{/if}}
```

### 7. “Ask for 3 to 10 ideas”

Use an integer with inclusive bounds. Do not silently clamp or round answers.

```markdown
---
fields:
  count:
    label: Ideas
    type: number
    min: 3
    max: 10
    integer: true
---
Give me {{count}} ideas.
```

### 8. “Ask for a version once and reuse it”

Declare the key once, then reference its answer wherever needed. Incompatible definitions across nested snippets are errors.

```markdown
---
fields:
  version:
    label: Version
---
Release {{version}}.
Tag the release {{version}} and mention {{version}} in the announcement.
```

### 9. “Package name accepts lowercase letters, digits, hyphens”

Use an explicit pattern and a label that explains the expected input. Do not rewrite the answer.

```markdown
---
fields:
  package:
    label: Package name (lowercase letters, digits, hyphens)
    pattern: '^[a-z0-9-]+$'
---
Package: {{package}}
```

### 10. “Use goal starts checked”

```markdown
---
fields:
  goal:
    label: Use a goal
    type: checkbox
    default: true
---
Use a goal: {{goal}}
```

## Field contract

- Types: `text` (default), `textarea`, `number`, `checkbox`, `select`.
- Keys start with an ASCII letter and continue with letters, digits, or underscores. Prototype-related reserved keys are rejected.
- `label` defaults to a readable key. `default` must match the field type.
- `required: true` rejects blank or whitespace-only strings. A required checkbox permits `false`: it requires a choice, not consent.
- Number constraints are `min`, `max`, and `integer`. Values must be finite.
- Text constraints are `minLength`, `maxLength` (Unicode code points), and `pattern` (regular-expression source). Invalid patterns are definition errors.
- `options: [first, second]` supplies literal string choices for a select.
- Fields appear in mapping order, followed by nested references in body order. A body reference does not declare an input. Every declared field appears in the form, even when its output is inside a conditional branch.
- Unknown metadata and invalid schemas are errors. There is no inline declaration helper or `render` option.
- An explicit `fields` mapping opts the body into Handlebars, including `fields: {}` when only inherited values or helpers are needed. Nested fields do not activate Handlebars in a legacy parent body.
- Values are typed in conditions. Use `{{#if goal}}` for a checkbox and `{{#if (gt count 0)}}` for a positive count. Do not compare a checkbox with the string `"yes"`.
- `{{plural count "option" "options"}}` chooses a singular word for one and the plural otherwise.

## Presets and inherited answers

A shared `options.md` can read:

```markdown
---
fields:
  count:
    label: Options
    type: number
    default: 5
    min: 0
    integer: true
---
{{#if (gt count 0)}}give me {{count}} {{plural count "option" "options"}} to choose from{{/if}}
```

A `ten-options.md` preset contains `#options(count=10)`. Its alias can remain `ten`. `#ten(count=2)` overrides the preset and emits “give me 2 options to choose from”. `#options(count=0)` emits nothing.

Nested references share one key space within each top-level invocation. Literal nested arguments are defaults; explicit outer arguments win. Separate top-level invocations have independent answers. A naming snippet can reference `#options` and inherit `count`; declare the same count metadata if the parent also declares it. Never invent dynamic hashtag arguments such as `#options(count={{count}})`.

## Conditional wording and omission

```markdown
---
fields:
  count:
    label: Suggestions
    type: number
    default: 1
    min: 0
    integer: true
  tone:
    label: Tone (optional)
---
{{#if (gt count 0)}}reword ({{#if (eq count 1)}}choose a better way to phrase this{{else}}give me {{count}} suggestions{{/if}}{{#if tone}}; tone: {{tone}}{{/if}}){{/if}}
```

The source text comes from the surrounding user message. Zero omits the reword request; one asks the agent to choose a phrase; more than one asks for suggestions. Blank tone adds no dangling clause.

The [form examples](../../../examples/forms/) preserve the review presets: base = one reviewer, one cycle, no fixes; `with-three` = three reviewers; `and-fix` = fixes enabled; `loop` = at most three cycles. Zero reviewers or zero cycles emits no review directive. One reviewer uses singular handoff wording without parallelism, and one cycle omits repetition. Several reviewers get distinct areas and complete context; several cycles stop when no actionable findings remain. Fixing and red/green instructions appear only when fixes are enabled. Empty target and focus clauses disappear.

`remindme` asks for reminder text to include in the final reply after the current task. `push-handover` accepts an optional destination branch; blank preserves the agent's choice. The branch-name acceptance example above does not authorize changing `new-worktree-and-branch`.

`generate-prompt` (alias `prompt`) accepts optional multiline `outcome` and `extra`, a `platform` selection defaulting to `From context`, `opencode` defaulting to false, `file` defaulting to true, and optional `path`. Blank outcome uses the surrounding conversation. The OpenCode-specific section appears only when checked; selecting a platform emits direct instructions for that platform. Disabling file output omits the path and file fallback instructions and requests a copyable reply instead.

## Invocation, escaping, and skills

```text
#myapps(app="Payroll")
#review(reviewers=3, fix=yes, cycles=2, focus="Errors, retries (including timeouts)")
#remindme(text="Check the draft\nThen ask \"ready?\"")
```

Arguments are named and comma-separated. Text uses JSON double-quoted escaping; numbers are finite; booleans serialize as `yes`/`no` and also accept `true`/`false`. No positional arguments, expressions, duplicate keys, or unknown keys. Serialized fields follow discovery order. Missing required answers fail before effects run; headless use can provide a filled invocation directly.

Answers remain literal, including newlines, HTML, hashtags, shell syntax, XML blocks, and Handlebars. They are not a way to generate executable snippet syntax. Use standard Handlebars escaping for literal expressions in a field-bearing body:

```markdown
---
fields:
  name: {}
---
Name: {{name}}
Literal example: \{{example}}
```

`#_name` escapes a snippet reference. Ordinary user prose is not globally processed as Handlebars, and existing bodies without their own `fields` mapping or inline-skill helpers stay literal, including placeholders such as `{{session_id}}`.

Use `{{skill "review"}}` inside a snippet for an inline skill body. Existing XML skill rendering remains supported; prefer the helper in new templates. `#skill(review)` retains its separate syntax and shows a loaded marker with hidden skill context. Forms discover fields without running shell commands or loading skill bodies. Existing `!`/`!>` backtick shell substitution still runs after expansion.
