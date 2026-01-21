# opencode-snippets

**Instant inline text expansion for OpenCode** - Type `#snippet` anywhere in your message and watch it transform.

## Why Snippets?

OpenCode has powerful `/slash` commands, but they must come first in your message. What if you want to inject context *mid-thought*?

```
# With slash commands (must be first):
/git-status Please review my changes

# With snippets (anywhere!):
Please review my changes #git-status and suggest improvements #code-style
```

**Snippets work like `@file` mentions** - natural, inline, composable. Build complex prompts from reusable pieces without breaking your flow.

## Installation

```bash
# Add to your opencode.json plugins array:
"plugins": ["opencode-snippets"]

# Then install:
bun install
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
aliases: ["safe", "cautious"]
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
aliases: ["cp", "pick"]
description: "Git cherry-pick helper"
---
Always pick parent 1 for merge commits.
```

Now `#cherry-pick`, `#cp`, and `#pick` all expand to the same content.

### Shell Command Substitution

Inject live system data with `!`backtick\`` syntax:

```markdown
Current branch: !`git branch --show-current`
Last commit: !`git log -1 --oneline`
Working directory: !`pwd`
```

Output:
```
Current branch: $ git branch --show-current
--> main
Last commit: $ git log -1 --oneline  
--> abc123f feat: add new feature
Working directory: $ pwd
--> /home/user/project
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
aliases: ["ctx"]
---
Project: !`basename $(pwd)`
Branch: !`git branch --show-current`
Recent changes: !`git diff --stat HEAD~3 | tail -5`
```

### `~/.config/opencode/snippet/review.md`
```markdown
---
aliases: ["pr", "check"]
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
aliases: ["min", "terse"]
---
Be extremely concise. No explanations unless asked.
```

## Snippets vs Slash Commands

| Feature | `/commands` | `#snippets` |
|---------|-------------|-------------|
| Position | Must be first | Anywhere |
| Multiple per message | No | Yes |
| Live shell data | Via implementation | Built-in `!\`cmd\`` |
| Best for | Actions & workflows | Context injection |

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
- Failed shell commands preserve the `!\`cmd\`` syntax
- Frontmatter is stripped from expanded content
- Only user messages are processed (not assistant responses)

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## License

MIT
