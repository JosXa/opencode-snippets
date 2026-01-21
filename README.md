# opencode-snippets

✨ **Instant inline text expansion for OpenCode** - Type `#snippet` anywhere in your message and watch it transform.

## Why Snippets?

As developers, we DRY (Don't Repeat Yourself) our code. We extract functions, create libraries, compose modules. Why should our prompts be any different?

Stop copy-pasting the same instructions into every message. Snippets bring software engineering principles to prompt engineering:

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
Please create a git commit with the current changes and push to the remote repository. #use-conventional-commits

Here is the current git status:
!`git status`

Here are the staged changes:
!`git diff --cached`

#project-context
```

You could also make "current git status and staged changes" a snippet of its own.

**Example: Snippets composing snippets**

`~/.config/opencode/snippet/code-standards.md`:
```markdown
#style-guide
#error-handling
#testing-requirements
```

`~/.config/opencode/snippet/full-review.md`:
```markdown
#code-standards
#security-checklist
#performance-tips
```

Compose base snippets into higher-level ones. Type `#full-review` to inject all standards at once, keeping each concern in its own maintainable file.

**The power:** Mix and match. Type `#tdd #careful` for test-driven development with extra caution. Build `/commit #conventional-commits #project-context` for context-aware commits. Create layered prompts from small, reusable pieces.

## Installation

Add to your `opencode.json` plugins array:

```json
{
  "plugins": [
    "opencode-snippets"
  ]
}
```

## Quick Start

**1. Create your global snippets directory:**

```bash
mkdir -p ~/.config/opencode/snippet
```

**2. Add your first snippet:**

`~/.config/opencode/snippet/careful.md`:
```markdown
---
aliases: safe
---
Think step by step. Double-check your work before making changes.
Ask clarifying questions if anything is ambiguous.
```

**3. Use it anywhere:**

https://github.com/user-attachments/assets/d31b69b5-cc7a-4208-9f6e-71c1a278536a

## Where to Store Snippets

Snippets can be global (`~/.config/opencode/snippet/*.md`) or project-specific (`.opencode/snippet/*.md`). Both directories are loaded automatically. Project snippets override global ones with the same name, just like OpenCode's slash commands.

## Features

### Aliases

Define multiple triggers for the same snippet:

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

> **Note:** Snippets deviate slightly from the regular slash command behavior. Instead of just passing the command output to the LLM, snippets prepend the command itself:
> ``!`ls` `` → 
> ```
> $ ls
> --> <output>
> ```
> This tells the LLM which command was actually run and makes failures visible (empty output would otherwise be indistinguishable from success).
>
> **TODO:** This behavior should either be PR'd upstream to OpenCode or made configurable in opencode-snippets.

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

**Use both together:**
```
/commit #conventional-commits #project-context
```

## Configuration

### Debug Logging

Enable debug logs by setting an environment variable:

```bash
DEBUG_SNIPPETS=true opencode
```

Logs are written to `~/.config/opencode/logs/snippets/daily/`.

## Behavior Notes

- Snippets are loaded once at plugin startup
- Hashtag matching is **case-insensitive** (`#Hello` = `#hello`)
- Unknown hashtags are left unchanged
- Failed shell commands preserve the original syntax in output
- Frontmatter is stripped from expanded content
- Only user messages are processed (not assistant responses)

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## License

MIT
