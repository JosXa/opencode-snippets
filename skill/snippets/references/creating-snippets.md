# Creating snippets

Use when authoring a new snippet or restructuring an existing one. Covers shape choice (inline / parenthetical / block), prepend vs append, and the trigger phrasing that makes a snippet read fluently inside a sentence. Not needed for using existing snippets — only for designing them.

The user picks the snippet name. Everything else flows from it.

## Principle

A good snippet is *fluent*: the user can drop `#name` inside an ordinary sentence and have it read like normal prose, while the agent still receives the full directive. Most snippet names are nouns, noun phrases, or short verb phrases — those almost always lend themselves to fluent use. Default to fluent unless the name truly cannot work as inline prose.

## Decision tree

Work through these in order. Stop at the first shape that fits. Asking the user is allowed but not required — choose for them when the answer is obvious.

**1. Can the snippet name read fluently inside a sentence?**

Test: imagine the user typing `Please use #name here`, `Add a #name to this`, or `Treat this as a #name`. If at least one of those reads as natural English with `name` substituted in (whether as a noun, term, or short verb phrase), the answer is yes. Examples that pass: `progressive-disclosure`, `semantic-compression`, `jira`, `ascii-diagram`, `dry-run`, `tdd`, `myapps`. Examples that fail: command-like handles (`red-green-repro`), role labels (`instructor`), workflow names that only make sense standalone (`architecture-council`).

- **Yes → go to step 2.**
- **No → use Shape C (standalone body).**

**2. Does the directive belong right next to the term, or can it wait until the end of the message?**

- **Right next to the term, and it fits in one short clause → Shape B (parenthetical).** Examples: `Jira (via #executor)`, `ASCII diagram (using proper box drawing characters)`, `dry-run (don't do the action, just prepare everything and show me what you will do)`. Use this when the clarification is short enough to stay inline without breaking the sentence and the agent must see it immediately beside the term, not at message end.
- **Can wait until the end, or is too heavy for a parenthetical → Shape A (bare term + block).**

**3. For Shape A: prepend or append?**

- **Append (default for Shape A).** Use when the block is *follow-through* the agent should perform or reference after reading the user's sentence — reminders, templates, reference material, "now also do this," guidance about the work just requested. Examples: `progressive-disclosure`, `semantic-compression`, `review`, `tdd`, `learn`.
- **Prepend.** Use when the block is *interpretive priming* — context, persona, task definition, skill loading, environmental state the agent needs *before* reading the user's sentence in order to interpret it correctly. Examples: `meta` (sets reasoning mode), `bead` (injects current Beads context), `opencode-config` (loads the config skill upfront), `generate-prompt` (defines the exact semantics of an otherwise ambiguous trigger phrase).
- **Heuristic.** If removing the block would make the user's sentence ambiguous or misinterpretable, prepend. If the sentence is fully understandable on its own and the block adds execution detail, append.

## Shapes

**Shape A: bare term + `<append>` (or `<prepend>`) block.** The fluent default for snippets with heavier directives.

```md
---
description: Prefer rare, precise, load-bearing terms over worn common ones.
---
semantic compression

<append>
<info>
Prefer sharp terms: mot juste, hapax, load-bearing. ...
</info>
</append>
```

Input: `Please use #semantic-compression here`
Output: visible `Please use semantic compression here`, with the `<info>` block landing at message end.

**Shape B: `name (parenthetical instructions)`.** Use when the directive is short and must sit next to the term.

```md
ASCII diagram (using proper box drawing characters)
```

Input: `Sketch this as an #ascii-diagram first`
Output: visible `Sketch this as an ASCII diagram (using proper box drawing characters) first`.

Hybrids exist: a parenthetical can coexist with an `<append>` block when the inline clarification routes the agent and the block carries reusable guidance (e.g. `Test-Driven Development (TDD)` + appended TDD principles).

**Shape C: standalone body, no inline fluency.** Use when the snippet name doesn't fit inside a sentence and the body *is* the request. Typed alone in chat, not composed into prose. Examples: `architecture-council`, `red-green-repro`, full stack/setup recipes. No block needed — the whole body runs inline.

```md
create a red unit/integration test to reproduce this faithfully ...
```

## Prepend vs append, in detail

- **Append (default).** Block lands at message end. The user's typed line stays at the top, which the LLM tends to follow most closely. Use for follow-through the agent does after reading the user's sentence — reminders, templates, reference material, next-step directives.
- **Prepend.** Block lands at message start. Use for interpretive priming the agent needs *before* reading the user's sentence — persona, task definition, environmental context, skill loading. Keep prepend blocks short; a wall of text on top of a one-word `#tag` is visually jarring for the user reading their own message.

Test: if removing the block would make the user's sentence ambiguous or misinterpretable, prepend it. Otherwise append.

## Wrap block content in semantic XML tags

Inside a `<prepend>` or `<append>` block, wrap content in custom tags that label its role for the LLM:

- `<task>...</task>` — the next thing the agent should do
- `<user_reminder>...</user_reminder>` — persistent reminder of user intent
- `<guidance>...</guidance>`, `<info>...</info>` — context, rules, reference
- `<condition="...">...</condition>` — guidance that only applies in a specific case

Tags are not magic. They give the model a clear role label for the chunk so it does not blend into the rest of the message.
