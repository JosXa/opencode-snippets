# Dollar syntax for skill invocations

Investigated 10 October 2026 against opencode-snippets commit `28cea646e95671176f99fc0aa414d61ba6eb241f`, the OpenCode V2 documentation, and [Codex commit `4bad6d7`](https://github.com/openai/codex/tree/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da). This report assumes that snippet references keep `#name` and only loading skills gains `$name`. No runtime syntax or user configuration was changed.

## Recommendation

Add `$skill-id` as the preferred spelling for skill loading and keep `#skill(...)` as an accepted spelling. Use a parser that recognizes context and escapes before enabling dollar matching. A substitution of the existing regular expression would change ordinary code and shell commands.

A bare `$skill-id` is sufficient to trigger automatic loading, just as `#skill(id)` is today.

The benefit is a shorter invocation that Codex users recognize. Portability still requires each harness to own skill resolution and loading. Matching Codex's prefix alone does not provide that integration.

## What changes for users

The invocation shrinks from 14 characters in `#skill(review)` to 7 in `$review`. The dollar spelling removes the wrapper and closing parenthesis. Distinct prefixes also let autocomplete show skills for `$` and snippets for `#`, avoiding a mixed list when the user knows which kind they want.

Today the plugin shows both kinds in its `#` completion menu, with a skill-only query after `#skill(`. Splitting the prefixes loses the convenience of browsing both collections from one trigger unless that existing menu remains available. The implementation includes trigger detection, search scoring, insertion, and form handling, so changing the server matcher alone would leave the composer inserting the old syntax. See the [trigger and completion implementation](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/tui-trigger.ts#L24-L125), [scoring for skill searches](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/tui-search.ts#L77-L85), and [composer insertion](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/tui-v2.tsx#L341-L365).

The current syntax accepts quoted names, including names with spaces. A bare dollar token cannot represent `#skill("Release Notes")` without another quoting rule. Prefer the native ID in dollar completions and retain the existing spelling for arbitrary display names. Native IDs such as `host:proof` also need an explicit token grammar because a matcher limited to letters and hyphens would truncate them. The plugin currently accepts native IDs and display names, lowercases both, and uses IDs to distinguish skills with identical display names. See [name parsing](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/skill-loading.ts#L128-L140), [registry aliases](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/v2-skills.ts), and OpenCode's [ID rules](https://opencode.ai/v2/docs/skills#ids).

The change does not inherently remove any loading capability. Recursive snippet composition can still produce a skill invocation, and the existing loader can still provide hidden content and the visible `↳ Loaded name` marker. The injected skill body has the same size regardless of the invocation's spelling. See the [submission processing order](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/v2-request.ts#L165-L213) and [payload construction](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/skill-loading.ts#L142-L201).

## Conflicts in the plugin

### Code and executable shell substitutions

The current skill matcher scans the whole text. It does not skip inline code, fenced code, escaped references, or the command inside a shell substitution. Skill loading occurs before the prompt's shell substitutions execute. That behavior is already observable for `#skill(...)`, but dollar tokens occur routinely in programming examples. See the [matcher](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/constants.ts#L14-L15), [matching loop](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/skill-loading.ts#L27-L74), and [processing order](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/v2-request.ts#L190-L213).

For a registered `review` skill, these are different user intentions:

```text
$review
Explain the shell variable $review.
Explain `echo "$review"`.
!`printf '%s' "$review"`
Explain $review$ in this formula.
```

A parser cannot distinguish the first 2 sentences from syntax alone. Skipping code and command regions avoids some collisions, but ordinary prose still needs an explicit escape. Registry lookup limits accidental loads to installed skills, so installing a new skill can make previously harmless text trigger loading.

With a naive dollar matcher, the executable example becomes:

```text
!`printf '%s' "↳ Loaded review"`
```

This changes the command before execution. Loaded skill bodies can themselves run configured shell substitutions, so an accidental match can also trigger effects from the skill. See [skill body rendering](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/skill-loading.ts#L179-L201).

### Escapes, variable syntax, and token boundaries

An escape must survive the entire processing pipeline. The existing `#_name` convention applies to snippet references and does not establish a dollar escape. A dollar matcher must explicitly recognize a chosen escape such as `\$review` rather than matching the dollar after the backslash. See [snippet escape handling](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/expander.ts#L118-L130).

Decide how to treat `$$review`, `$review.path`, `$review/path`, and `$review(...)` before writing the matcher. Matching the `review` prefix can damage math, PHP variable expressions, PowerShell expressions, or source examples. Rejecting all punctuation after a name would also reject normal prose such as `Use $review.`

Uppercase environment variables need particular care because the current registry lookup ignores case. A registered `home` skill could match `$HOME` under a case-insensitive dollar regex. Braced `${review}` and parenthesized `$(pwd)` do not match a bare identifier pattern, but that does not make all shell syntax safe.

Field answers already have a separate protection mechanism. Rendered values remain opaque until the plugin finishes processing skills and shell commands, so a supplied answer containing `$review` can stay literal without adding another validation layer. The dollar autocomplete must also avoid opening inside quoted field answers, as the hashtag completion currently does. See [literal storage](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/literals.ts), [field rendering](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/fields.ts#L379-L405), and [form-aware triggers](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/tui-form-state.ts#L58-L77).

### Shell quoting before the plugin receives a prompt

When passing a prompt through a shell, dollar syntax may expand before OpenCode receives it:

```sh
opencode2 run "$review"
```

In Bash, this expands the `review` variable. Use single quotes for a literal dollar invocation:

```sh
opencode2 run '$review'
```

The composer does not have this outer shell expansion. Documentation and automation examples need to distinguish those paths. Bash documents the difference between [double quotes](https://www.gnu.org/software/bash/manual/html_node/Double-Quotes.html) and [single quotes](https://www.gnu.org/software/bash/manual/html_node/Single-Quotes.html).

## Portability and native ownership

[OpenAI documents `$skill-name`](https://developers.openai.com/codex/skills/) for Codex CLI and its IDE extension. The same page describes `@` selection for ChatGPT. [OpenCode V2 documents `@skill-id`](https://opencode.ai/v2/docs/skills#loading) for native explicit loading. Invocation spelling therefore varies even between products that share skill files.

The [Agent Skills specification](https://agentskills.io/specification) defines skill files and metadata. The [guide to adding skills to clients](https://agentskills.io/client-implementation/adding-skills-support) lists slash commands and dollar mentions as possible approaches and leaves the syntax to the client.

For a future Codex adapter, native skill selection should own loading where available. Expanding `$name` into the plugin's visible marker before Codex handles it could consume the native mention. Processing it after native loading could inject duplicate content. Host identity, permission checks, resource paths, and replay behavior need an adapter contract independent of the textual prefix.

OpenCode derives IDs from paths while Codex documents possible duplicate names in its selectors. Keeping a skill's lowercase kebab-case name aligned with its directory and avoiding duplicates improves portability more than choosing the prefix alone. See [OpenCode IDs and precedence](https://opencode.ai/v2/docs/skills#ids) and [Codex discovery](https://developers.openai.com/codex/skills/#where-codex-loads-local-skills).

## What Codex actually does

### Dollar is also a prefix for apps and connectors

Codex uses the same dollar mention namespace for apps and connectors. In its core selector, a plain skill name that conflicts with a connector slug is not selected as a skill. Duplicate skill names also need disambiguation through a selected path, represented in text as `[$name](path)`. The TUI and extension take the first matching skill in some paths, so copying the prefix cannot reproduce a single consistent Codex policy. See [core selection](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/selection.rs#L121-L200), [collision tests](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/selection_tests.rs#L227-L290), and [TUI submission](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/chatwidget/skills.rs#L204-L256).

An adapter must respect native mention ownership instead of assuming that every registered `$name` is exclusively a skill. The plugin's current explicit wrapper distinguishes this intent without sharing that namespace.

### Codex does not solve all literal conflicts

Codex's core parser also scans code and backslash-escaped text without excluding them. It suppresses a fixed set of environment-variable names, case-insensitively, which also prevents plain `$home` and `$path` from selecting skills with those names. Its completion logic suppresses uppercase versions while allowing lowercase queries, so even the completion menu and core parser differ. These findings describe the inspected source rather than a stable published contract. See the [core parser](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/mentions.rs#L88-L149), [environment-variable filter](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/mentions.rs#L208-L228), and [completion classification](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/bottom_pane/chat_composer/completion_target.rs#L302-L353).

The core parser accepts `:` in names, including a trailing colon in `Use $review: now`, whereas the TUI's submit parser omits colons from plain names. Native qualification and prose punctuation therefore need deliberate handling in the plugin. See [allowed characters in core](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/mentions.rs#L226-L228) and [allowed characters in the TUI](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/mention_codec.rs#L273-L275).

### Pasted code and regular expressions

The terminal submission path expands large paste placeholders into their full text and drops the placeholder elements before scanning for tool mentions. It does not preserve pasted content as a protected region for this scan. See [paste expansion](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/bottom_pane/chat_composer.rs#L2523-L2589), [submission preparation](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/bottom_pane/chat_composer.rs#L2986-L2994), and [mention selection on submission](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/chatwidget/input_submission.rs#L275-L340).

The parser uses a byte scanner, rather than a regular expression or Markdown parser. Ignoring linked mentions and the environment-variable filter, the patterns for plain mentions are equivalent to:

```regex
\$([A-Za-z0-9_-]+)      # TUI
\$([A-Za-z0-9_:-]+)     # core
```

Neither scanner checks the preceding character, code delimiters, or a backslash. These examples therefore extract `review` in both paths:

```text
foo$review
\$review
`$review`
/\$review\b/
```

Fenced code containing `$review` behaves the same way. By contrast, `/foo$/`, `/\b\$/`, `/\$[a-z]+/`, `${review}`, and `$(pwd)` contain no dollar followed immediately by an allowed name character and produce no plain mention. A candidate only becomes a selected skill if an enabled catalog entry matches. See the [TUI scanner](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/chatwidget/skills.rs#L309-L359) and [skill matching](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/chatwidget/skills.rs#L204-L256).

For ordinary pasted code with a plain mention, Codex submits the original user text and adds a separate structured skill item. It does not replace the matching token with `↳ Loaded ...` as this plugin does. The conflict in Codex is unintended skill activation, whereas the current plugin's replacement model can also alter the code itself. See [text and skill items in submission](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/tui/src/chatwidget/input_submission.rs#L275-L340).

A proposed `\b\$` boundary would not match bare `$review` at the start of a prompt, or after a space, because dollar is a non-word character. It would match `foo$review` because `o` is a word character and dollar is not. An identifier boundary and a parser's handling of literal regions are separate decisions.

### Matching spelling does not match ordering or repetition

The plugin currently emits a payload for every occurrence in visible order. Codex core deduplicates repeated references and emits text-selected skills in discovery order. A prompt with `$first` followed by `$second`, or `$review` repeated, need not produce the same context in both harnesses. See the [plugin matching loop](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/skill-loading.ts#L27-L74) and Codex's [ordering test](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/selection_tests.rs#L73-L88) and [deduplication test](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/skills/src/selection_tests.rs#L211-L225).

Neither implementation recursively loads references found in an injected skill body. Codex scans the current user turn and wraps the chosen skill files. The plugin likewise renders snippets and shell substitutions inside the skill without running another skill-loading pass. A model can still decide to use another skill from that text, which is separate from parser recursion. See [Codex turn selection](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/core/src/session/turn.rs#L1082-L1083), [prompt loading](https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/ext/skills/src/host_prompt.rs#L69-L110), and the [plugin regression test](https://github.com/JosXa/opencode-snippets/blob/28cea646e95671176f99fc0aa414d61ba6eb241f/src/skill-loading.test.ts#L57-L68).

## Suggested behavior contract

1. Prefer `$skill-id` in new completions and examples while continuing to accept `#skill(...)` for existing authored prompts and names that need quoting.
2. Keep skill loading behind the existing feature setting and retain the same hidden payload semantics in OpenCode.
3. Skip inline code, fenced code, and executable shell-substitution regions for dollar matching, and define an explicit literal escape and a rule for paired math delimiters.
4. Match a complete supported ID, including native qualification where needed, and define case and boundary behavior deliberately.
5. Preserve protected field answers and the current handling of skill references inside loaded skill bodies without introducing recursive skill loading as part of a spelling change.
6. Ensure each host loads an invocation once and keep saved expansion results stable on replay.

Keeping 2 accepted spellings adds parser branches initially. Over time, `$skill-id` can become the normal authoring convention while `#skill(...)` remains a compatibility form. Users gain fewer characters and a separate completion trigger for skills, but the parser requires more context rules because code already uses dollar signs for other purposes.

## Investigation evidence

An isolated Bun probe called the existing loader with synthetic skills and temporarily substituted a naive dollar regex in that process. It confirmed matches inside inline and fenced code, inside executable substitution text, after a backslash, in paired math delimiters, and through `$HOME` when `home` was registered. It also confirmed that recursive snippets can produce dollar invocations and that rendered field answers remain literal through the existing protection mechanism.

The probe did not execute prompt shell commands or run a modified plugin in a harness. These results demonstrate the failure of a regex-only replacement, rather than the behavior of a proposed complete parser. The [probe source](file:///tmp/opencode/dollar-skill-probe.ts) and [results](file:///tmp/opencode/dollar-skill-probe.json) are temporary investigation artifacts.
