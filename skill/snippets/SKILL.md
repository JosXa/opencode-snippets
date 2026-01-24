---
name: snippets
description: MUST use when user asks to create, edit, manage, or share snippets, or asks how snippets work
---

# Snippets

Reusable text blocks expanded via `#hashtag` in messages.

## Locations

### Snippets
- **Global**: `~/.config/opencode/snippet/*.md`
- **Project**: `.opencode/snippet/*.md` (overrides global)

### Configuration
- **Global**: `~/.config/opencode/snippet/config.jsonc`
- **Project**: `.opencode/snippet/config.jsonc` (merges with global, project takes priority)

### Logs
- **Debug logs**: `~/.config/opencode/logs/snippets/daily/YYYY-MM-DD.log`

## Configuration

All boolean settings accept: `true`, `false`, `"enabled"`, `"disabled"`

Full config example with all options:

```jsonc
{
  // JSON Schema for editor autocompletion
  "$schema": "https://raw.githubusercontent.com/JosXa/opencode-snippets/main/schema/config.schema.json",

  // Logging settings
  "logging": {
    // Enable debug logging to file
    // Default: false
    "debug": false
  },

  // Automatically install SKILL.md to global skill directory
  // When enabled, the snippets skill is copied to ~/.config/opencode/skill/snippets/
  // This enables the LLM to understand how to use snippets
  // Default: true
  "installSkill": true
}
```

## Snippet Format

```md
---
aliases:
  - short
  - alt
description: Optional
---
Content here
```

Frontmatter optional. Filename (minus .md) = primary hashtag.

## Features

- `#other` - include another snippet (recursive, max 15 depth)
- `` !`cmd` `` - shell substitution, output injected

### Prepend/Append Blocks

Move content to message start/end instead of inline. Best for long reference material that breaks writing flow.

```md
---
aliases: jira
---
Jira MCP
<prepend>
## Jira Field Mappings

- customfield_16570 => Acceptance Criteria
- customfield_11401 => Team
</prepend>
```

Input: `Create bug in #jira about leak`
Output: Prepended section at top + `Create bug in Jira MCP about leak`.

Use `<append>` for reference material at end. Content inside blocks should use `##` headings.

## Commands

- `/snippet add <name> [content]` - create global snippet
- `/snippet add --project <name>` - create project snippet
- `/snippet list` - show all available
- `/snippet delete <name>` - remove snippet

## Good Snippets

Short, focused, single-purpose. Examples:

```md
# careful.md
---
aliases: safe
---
Be careful, autonomous, and ONLY do what I asked.
```

```md
# context.md
---
aliases: ctx
---
Project: !`basename $(pwd)`
Branch: !`git branch --show-current`
```

Compose via includes: `#base-rules` inside `#project-config`.

## Sharing Snippets

Share to GitHub Discussions: https://github.com/JosXa/opencode-snippets/discussions/categories/snippets

When user wants to share:

1. Check `gh --version` works
2. **If gh available**: MUST use question tool to ask user to confirm posting + ask "When do you use it?". Then:
   ```bash
   gh api graphql -f query='mutation($repoId: ID!, $catId: ID!, $title: String!, $body: String!) { createDiscussion(input: {repositoryId: $repoId, categoryId: $catId, title: $title, body: $body}) { discussion { url } } }' -f repoId="R_kgDOQ968oA" -f catId="DIC_kwDOQ968oM4C1Qcv" -f title="filename.md" -f body="<body>"
   ```
   Body format:
   ```
   ## Snippet Content
   
   \`\`\`markdown
   <full snippet file content>
   \`\`\`
   
   ## When do you use it?
   
   <user's answer>
   ```
3. **If gh unavailable**: Open browser:
   ```
   https://github.com/JosXa/opencode-snippets/discussions/new?category=snippets&title=<url-encoded-filename>.md
   ```
   Ask user (without question tool) for "When do you use it?" info. Tell them to paste snippet in markdown fence.
