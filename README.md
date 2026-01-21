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

**Example: Slash commands as snippet proxies**

**Example: Slash commands as snippet proxies**

`~/.config/opencode/snippet/todoadd.md`:
```markdown
Add this todo item via todowrite
```

`~/.config/opencode/command/todo-add.md`:
```markdown
---
description: Add a todo item
---
#todoadd

$ARGUMENTS
```

The `/todo-add` slash command is just a thin wrapper around `#todoadd`. The snippet holds the actual logic, the command is the interface. Minimal boilerplate, maximum reuse.

**Example: Extending snippets with logic**

`~/.config/opencode/command/commit-and-push.md`:
```markdown
---
description: Create a git commit and push to remote
agent: fast
---
Please create a git commit with the current changes and push to the remote repository.

Here is the current git status:
!`git status`

Here are the staged changes:
!`git diff --cached`

#conventional-commits
#project-context
```

The slash command provides workflow logic (git status, diffs, push) while reusing shared snippets for commit conventions and project context.

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

**1. Create a snippet file:**

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

```
Refactor this function #careful
```

The LLM receives:
```
Refactor this function Think step by step. Double-check your work before making changes.
Ask clarifying questions if anything is ambiguous.
```

## 📁 Where to Store Snippets

Snippets can be stored in two locations:

### Global Snippets
`~/.config/opencode/snippet/*.md` - Available in all projects

Perfect for:
- Team standards and conventions
- Personal preferences and workflows
- Reusable patterns across projects

### Project-Specific Snippets
`.opencode/snippet/*.md` - Only available in this project

Perfect for:
- Project-specific context and conventions
- Team-specific workflows
- Domain knowledge and terminology

**Both directories are loaded automatically.** Project snippets override global snippets with the same name, just like OpenCode's slash commands.

## Features

### Hashtag Expansion

Any `#snippet-name` is replaced with the contents of `~/.config/opencode/snippet/snippet-name.md`:

```
#review-checklist Please check my PR
```

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

Snippets support the same `!`backtick\`` syntax as [OpenCode slash commands](https://opencode.ai/docs/commands/#shell-output) for injecting live command output:

```markdown
Current branch: !`git branch --show-current`
Last commit: !`git log -1 --oneline`
Working directory: !`pwd`
```

### Recursive Includes

Snippets can include other snippets:

```markdown
# In base-context.md:
#project-info
#coding-standards
#git-conventions
```

Loop detection prevents infinite recursion.

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

### `~/.config/opencode/snippet/review.md`
```markdown
---
aliases:
  - pr
  - check
---
Review this code for:
- Security vulnerabilities
- Performance issues  
- Code style consistency
- Missing error handling
- Test coverage gaps
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
| Position | Must come first | Anywhere |
| Multiple per message | No | Yes |
| Live shell data | Yes | Yes |
| Best for | Triggering actions & workflows | Context injection |

**Use both together:**
```
/commit #conventional-commits #project-context
```

## Configuration

### Snippet Directory

All snippets live in `~/.config/opencode/snippet/` as `.md` files.

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
