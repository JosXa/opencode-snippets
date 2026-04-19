# opencode-snippets

✨ **Instant inline text expansion for OpenCode** - Type `#snippet` anywhere in your message and watch it transform.

> [!TIP]
> **Share Your Snippets!**  
> Got a snippet that saves you time? Share yours or steal ideas from the community!
> Browse and contribute in [GitHub Discussions](https://github.com/JosXa/opencode-snippets/discussions/categories/snippets).

## Why Snippets?

As developers, we DRY (Don't Repeat Yourself) our code. We extract functions, create libraries, compose modules. Why should our prompts be any different?

Stop copy-pasting (or worse, *typing* 🤢) the same instructions into every message. Snippets bring software engineering principles to prompt engineering:

- 🔄 **DRY** - Write once, reuse everywhere
- 🧩 **Composability** - Build complex prompts from simple pieces  
- 🔧 **Maintainability** - Update once, apply everywhere
- 🔍 **Discoverability** - Your team's best practices, always a `#hashtag` away

OpenCode's `/slash` commands must come first. Snippets work anywhere:

```
# Slash commands (must be first):
/git-status Please review my changes

# Snippets (anywhere!):
Please review my changes #git-status and suggest improvements #code-style
```

Snippets work like `@file` mentions - natural, inline, composable.

### 🎯 Composable by Design

Snippets compose with each other and with slash commands. Reference `#snippets` anywhere - in your messages, in slash commands, even inside other snippets:

**Example: Extending commands with snippets**

`~/.config/opencode/command/commit-and-push.md`:
```markdown
---
description: Create a git commit and push to remote
---
Please create a git commit with the current changes and push to the remote repository.
#use-conventional-commits

Here is the current git status:
!`git status`

Here are the staged changes:
!`git diff --cached`

#project-context
```

You could also make "current git status and staged changes" a shell-enabled snippet of its own.

**Example: Snippets composing snippets**

`~/.config/opencode/snippet/code-standards.md`:
```markdown
#style-guide
#error-handling
#testing-requirements
```

https://github.com/user-attachments/assets/76975a9e-e326-431e-8be5-39a9f6572851

`~/.config/opencode/snippet/full-review.md`:
```markdown
#code-standards
#security-checklist
#performance-tips
```

Compose base snippets into higher-level ones. Type `#full-review` to inject all standards at once, keeping each concern in its own maintainable file.

**The power:** Mix and match. Type `#tdd #careful` for test-driven development with extra caution. 
Build `/commit #conventional-commits #project-context` for context-aware commits. Create layered prompts from small, reusable pieces.  
<img width="708" height="185" alt="image" src="https://github.com/user-attachments/assets/2c537c4b-6afe-4bb1-9fb4-484034f9ce8b" />

## Installation

```bash
opencode plugin opencode-snippets -gf
```

This installs the package and wires up both the server plugin and the TUI plugin for autocompletion automatically.



<details>
<summary>Manual Installation (or for AI agents)</summary>

If you edit config manually, the configurations are separate, so you need both entries yourself.

Required: add the package to your `opencode.json` plugins array:

```json
{
  "plugins": [
    "opencode-snippets"
  ]
}
```

Strongly recommended: add the same package to `tui.json` too:

```json
{
  "plugin": [
    "opencode-snippets"
  ]
}
```

<details>
<summary>Local Development</summary>

For local development with a `file:///` plugin path, point OpenCode at the package directory:

```json
{
  "plugins": [
    "file:///D:/projects/opencode-snippets"
  ]
}
```

Strongly recommended for local TUI testing too, wire the same package directory into `tui.json`:

```json
{
  "plugin": [
    "file:///D:/projects/opencode-snippets"
  ]
}
```

Using the directory lets OpenCode read the package manifest and discover both targets.

</details>

</details>

## Quick Start

**1. Create your global snippets directory:**

```bash
mkdir -p ~/.config/opencode/snippet
```

The plugin also loads `~/.config/opencode/snippets/` if you already use the plural form.

**2. Add your first snippet:**

`~/.config/opencode/snippet/careful.md`:
```markdown
---
aliases: safe
---
Think step by step. Double-check your work before committing changes.
Ask clarifying questions if anything is ambiguous.
```

**3. Use it anywhere:**

https://github.com/user-attachments/assets/ebb303b5-d41b-4d87-8f08-eb1d730db5c8

## Where to Store Snippets

Snippets can be global (`~/.config/opencode/snippet/*.md` or `~/.config/opencode/snippets/*.md`) or project-specific (`.opencode/snippet/*.md` or `.opencode/snippets/*.md`). Both singular and plural directory names are loaded automatically. Project snippets override global ones with the same name, and `snippet/` wins over `snippets/` within the same scope.

## Features

### Aliases

Define multiple triggers for the same snippet:

`~/.config/opencode/snippet/cherry-pick.md`:
```markdown
---
aliases:
  - cp
  - pick
description: "Git cherry-pick helper"
---
Always pick parent 1 for merge commits.
```

Now `#cherry-pick`, `#cp`, and `#pick` all expand to the same content.

Single alias doesn't need array syntax:
```markdown
---
aliases: safe
---
```

You can also use JSON array style: `aliases: ["cp", "pick"]`

### Shell Command Substitution

Snippets support the same ``!`command` `` syntax as [OpenCode slash commands](https://opencode.ai/docs/commands/#shell-output) for injecting live command output:

```markdown
Current branch: !`git branch --show-current`
Last commit: !`git log -1 --oneline`
Working directory: !`pwd`
```

> **Note:** By default, snippets show both the command and its output (unlike OpenCode's slash commands which only show output):
> ``!`ls` `` → 
> ```
> $ ls
> --> <output>
> ```
> This tells the LLM which command was actually run and makes failures visible (empty output would otherwise be indistinguishable from success).
>
> To match OpenCode's slash command behavior (output only), set `hideCommandInOutput: true` in your config.

### Recursive Includes

Snippets can include other snippets using `#snippet-name` syntax. This allows building complex, composable snippets from smaller pieces:

```markdown
# In base-style.md:
Use TypeScript strict mode. Always add JSDoc comments.

# In python-style.md:
Use type hints. Follow PEP 8.

# In review.md:
Review this code carefully:
#base-style
#python-style
#security-checklist
```

**Loop Protection:** Snippets are expanded up to 15 times per message to support deep nesting. If a circular reference is detected (e.g., `#a` includes `#b` which includes `#a`), expansion stops after 15 iterations and the remaining hashtag is left as-is. A warning is logged to help debug the issue.

**Example of loop protection:**
```markdown
# self.md contains: "I reference #self"
# Expanding #self produces:
I reference I reference I reference ... (15 times) ... I reference #self
```

This generous limit supports complex snippet hierarchies while preventing infinite loops.

### Prepend and Append Blocks

For long reference material that would break your writing flow, use `<append>` blocks to place content at the end of your message:

```markdown
---
aliases: jira-mcp
---
Jira MCP server
<append>
## Jira MCP Usage

Use these custom field mappings when creating issues:
- customfield_16570 => Acceptance Criteria
- customfield_11401 => Team
</append>
```

**Input:** `Create a bug ticket in #jira-mcp about the memory leak`

**Output:**
```
Create a bug ticket in Jira MCP server about the memory leak

## Jira MCP Usage

Use these custom field mappings when creating issues:
- customfield_16570 => Acceptance Criteria
- customfield_11401 => Team
```

Write naturally—reference what you need mid-sentence—and the context follows at the bottom.

Use `<prepend>` for content that should appear at the top of your message. Multiple blocks of the same type are concatenated in order of appearance.

**Block behavior:**
- Content outside `<prepend>`/`<append>` blocks replaces the hashtag inline
- If a snippet has only blocks (no inline content), the hashtag is simply removed
- Blocks from nested snippets are collected and assembled in the final message
- Unclosed tags are handled leniently (rest of content becomes the block)
- Nested blocks are not allowed—the hashtag is left unchanged

### Inject Blocks (Experimental)

Add persistent context that the LLM sees throughout the entire agentic loop, without cluttering your visible message:

```markdown
---
aliases: safe
---
Think step by step.
<inject>
IMPORTANT: Double-check all code for security vulnerabilities.
Always suggest tests for any implementation.
</inject>
```

**Input:** `Review this code #safe`

**What happens:**
- Your message shows: `Review this code Think step by step.`
- The LLM also receives the inject content as a separate context message
- This context persists for the entire conversation turn (agentic loop)

Use inject blocks for rules, constraints, or instructions that should influence all LLM responses without appearing inline in your message.

Injected context is placed **N messages from the bottom** of the conversation (default: 5) to prevent instruction overfitting, where the model fixates on injected content as if it were the user's latest directive. As the conversation grows, the injection floats upward, maintaining a steady distance from the latest turn. Configure the offset with `injectRecencyMessages`. For the full design rationale, see [Injection Placement Strategy](docs/injection-placement.md).

**Enable in config:**

```jsonc
{
  "experimental": {
    "injectBlocks": true
  }
}
```

### Skill Rendering (Experimental)

Inline OpenCode skills directly into your messages using XML-style tags:

```markdown
Create a Jira ticket. <skill>jira</skill>
```

Or use the self-closing format:

```markdown
<skill name="jira" /> Create a ticket for the bug.
```

**Enable in config:**

```jsonc
{
  "experimental": {
    "skillRendering": true
  }
}
```

Skills are loaded from OpenCode's standard skill directories:
- **Global**: `~/.config/opencode/skill/<name>/SKILL.md`
- **Project**: `.opencode/skill/<name>/SKILL.md`

When a skill tag is found, it's replaced with the skill's content body (frontmatter stripped). Unknown skills leave the tag unchanged.

### Skill Loading (Experimental)

Load a skill with OpenCode-style wrapper content without showing the full skill body inline:

```markdown
Write this in caveman mode. #skill(caveman)
```

Quoted names are also supported:

```markdown
#skill("opencode-config")
```

**Enable in config:**

```jsonc
{
  "experimental": {
    "skillLoading": true
  }
}
```

When enabled, the user-visible message shows `↳ Loaded name`, while the model receives an injected OpenCode-style `<skill_content>` payload immediately above that message. Multiple `#skill(...)` calls in one message are injected in source order.

Quick project-local demo in this repo:

```markdown
Explain closures in two lines. #skill(demo-voice)
```

Or use the included snippet that expands into `#skill(...)`:

```markdown
#demo-skill Explain closures in two lines.
```

Demo files live at `.opencode/skill/demo-voice/SKILL.md` and `.opencode/snippet/demo-skill.md`.

## Example Snippets

### `~/.config/opencode/snippet/context.md`
```markdown
---
aliases: ctx
---
Project: !`basename $(pwd)`
Branch: !`git branch --show-current`
Recent changes: !`git diff --stat HEAD~3 | tail -5`
```

### `~/.config/opencode/snippet/minimal.md`
```markdown
---
aliases:
  - min
  - terse
---
Be extremely concise. No explanations unless asked.
```

## Snippets vs Slash Commands

| Feature | `/commands` | `#snippets` |
|---------|-------------|-------------|
| Position | Must come first 🏁 | Anywhere 📍 |
| Multiple per message | No ❌ | Yes ✅ |
| Live shell data | Yes 💻 | Yes 💻 |
| Best for | Triggering actions & workflows ⚡ | Context injection 📝 |

> [!TIP]
> #### My recommendation:
> 
> Use /slash commands for **triggering actions and workflows** imperatively - anything that needs to happen _right now_: `/commit-and-push`, `/add-worktree`, or `/pull-rebase`.  
> Use #snippets for **all other context engineering**.
>
> If you can't decide, get the best of both worlds and just have your command proxy through to the snippet:
>
> `~/.config/opencode/command/pull.md`:
> ```markdown
> ---
> description: Proxy through to the snippet at snippet/pull.md
> ---
> #pull
> ```

## Configuration

The plugin can be configured via `config.jsonc` files:

- **Global**: `~/.config/opencode/snippet/config.jsonc`
- **Project**: `.opencode/snippet/config.jsonc` (overrides global settings)

Snippet markdown files are loaded from both `snippet/` and `snippets/`, but config files stay in `snippet/config.jsonc`.

A default config file is created automatically on first run.

### Full Configuration Example

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/JosXa/opencode-snippets/v2.0.2/schema/config.schema.json",
  "logging": {
    "debug": false // Enable debug logging (logs: ~/.config/opencode/logs/snippets/daily/)
  },
  "experimental": {
    "injectBlocks": false, // Enable <inject>...</inject> blocks for persistent context
    "skillRendering": false, // Enable <skill>name</skill> tag expansion
    "skillLoading": false // Enable #skill(name) OpenCode-style loading
  },
  "hideCommandInOutput": false, // Show only output for shell commands (hides "$ cmd\n-->")
  "injectRecencyMessages": 5 // How many messages from the bottom to place injected context
}
```

All boolean settings accept: `true`, `false`, `"enabled"`, `"disabled"`

### Debug Logging

Logs are written to `~/.config/opencode/logs/snippets/daily/` when enabled.

## Behavior Notes

- Snippets expand everywhere: regular chat, question responses, skills, and slash commands
- Injected snippet context is placed N messages from the bottom (configured by `injectRecencyMessages`) and shows a `↳ Injected #name` indicator when first registered
- `#skill(name)` inserts OpenCode-style skill payload text above the visible user message while keeping the transcript inline placeholder compact
- Snippets are loaded once at plugin startup
- Hashtag matching is **case-insensitive** (`#Hello` = `#hello`)
- Unknown hashtags are left unchanged
- Failed shell commands preserve the original syntax in output
- Frontmatter is stripped from expanded content
- Only user messages are processed (not assistant responses)

## Contributing

Contributions welcome! Please open an issue or PR on GitHub. 
👥 [Discord Forum](https://discord.com/channels/1391832426048651334/1463378026833379409)

## License

MIT
