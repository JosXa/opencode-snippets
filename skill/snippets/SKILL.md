---
name: snippets
description: MUST use when user asks to create, edit, manage, or share snippets, or asks how snippets work
---

# Snippets

Reusable text blocks expanded via `#hashtag` in messages.

## Locations

### Snippets
- **Global directories**: `~/.config/opencode/snippet/` and `~/.config/opencode/snippets/`
- **Project directories**: `.opencode/snippet/` and `.opencode/snippets/` (project overrides global, `snippet/` wins over `snippets/`)

### Configuration
- **Global file**: `~/.config/opencode/snippet/config.jsonc`
- **Project file**: `.opencode/snippet/config.jsonc` (merges with global, project takes priority)

IMPORTANT: Snippets live only in those four snippet directories. Check those exact locations. Do not glob anywhere else in the repo or workspace.

IMPORTANT: Config files stay under `snippet/config.jsonc`. The plural `snippets/` support is for snippet markdown files only.

IMPORTANT: When modifying snippet configuration:
1. Check BOTH locations for existing config files
2. If only one exists, modify that one
3. If both exist, ask the user which one to modify
4. If neither exists, create the global config

### Logs
- **Debug logs**: `~/.config/opencode/logs/snippets/daily/YYYY-MM-DD.log`

## Configuration

All boolean settings accept: `true`, `false`, `"enabled"`, `"disabled"`

Full config example with all options:

```jsonc
{
  // JSON Schema for editor autocompletion
  "$schema": "https://raw.githubusercontent.com/JosXa/opencode-snippets/v2.2.0/schema/config.schema.json",

  // Logging settings
  "logging": {
    // Enable debug logging to file
    // Logs are written to ~/.config/opencode/logs/snippets/daily/
    // Default: false
    "debug": false
  },

  // Experimental features (may change or be removed)
  "experimental": {
    // Enable <inject>...</inject> blocks for persistent context messages
    // Default: false
    "injectBlocks": false,
    // Enable skill rendering with <skill>name</skill> syntax
    // Default: false
    "skillRendering": false,
    // Enable #skill(name) syntax
    // Default: false
    "skillLoading": false
  },

  // How many messages from bottom to place injected context
  // Default: 5
  "injectRecencyMessages": 5
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

The plugin adds shell substitution to regular OpenCode prompts, not just snippet files.

- `#other` - include another snippet (recursive, max 15 depth)
- `` !`cmd` `` - shell substitution, output only
- `` !>`cmd` `` - shell substitution, show command plus output

Use `!>` when the exact command matters. LLMs tend to trust the output more when they can see which terminal command just ran. The command gives the output context, which makes it more informative and easier to interpret.

### Prepend/Append Blocks

Move content to message start/end instead of inline. Best for long reference material that breaks writing flow.

A snippet can include a `<prepend>` or `<append>` block and ordinary body text at the same time. Only the block content moves. Text outside the block still expands inline where `#snippet` was used. Use this to keep snippets flowing inside a sentence: a short visible body like `Jira`, `bead`, or `cherry-pick` stays in the user's prose, while heavy guidance is hidden in the block.

```md
---
aliases: jira
---
<prepend>
## Jira Field Mappings

- customfield_16570 => Acceptance Criteria
- customfield_11401 => Team
</prepend>

Jira MCP
```

Input: `Create bug in #jira about leak`
Output: The field mappings are prepended at the top, and the visible inline expansion becomes `Create bug in Jira MCP about leak`.

Use `<append>` for reference material at end. Content inside blocks should use `##` headings.

#### Wrap block content in semantic XML tags

Inside a `<prepend>` or `<append>` block, wrap content in custom tags that label its role for the LLM:

- `<task>...</task>` - the next thing the agent should do
- `<user_reminder>...</user_reminder>` - persistent reminder of user intent
- `<guidance>...</guidance>`, `<info>...</info>` - context, rules, reference
- `<condition="...">...</condition>` - guidance that only applies in a specific case

Tags are not magic. They give the model a clear role label for the chunk so it does not blend into the rest of the message.

#### When to prepend vs append

Prepend puts the block at the very top of the message. The user's typed line lands last, which the LLM tends to follow more closely. Use prepend for **general context and guidance**, especially short blocks. Use it sparingly for many-paragraph blocks: a wall of text dumped on top of a one-word `#tag` is visually jarring for the user reading their own message.

Append puts the block at the bottom. The user's line stays at the top, less jarring. Adherence to the user line can soften slightly, but append is ideal when the block contains a `<task>` or instruction that should be the **next thing the agent does**.

Rule of thumb: short context => prepend; important next step => append; heavy reference docs => prepend with a tiny inline body so the user's sentence still flows.

### Inject Blocks (Experimental)

Add persistent context that the LLM sees throughout the entire agentic loop, without cluttering the visible message.

```md
---
aliases: safe
---
Think step by step.
<inject>
IMPORTANT: Double-check all code for security vulnerabilities.
Always suggest tests for any implementation.
</inject>
```

Input: `Review this code #safe`
Output: User sees "Review this code Think step by step." but the LLM also receives the inject content as separate context that persists for the entire conversation turn.

Use for rules, constraints, or context that should influence all responses without appearing inline.

Enable in config:
```jsonc
{
  "experimental": {
    "injectBlocks": true
  }
}
```

### Skill Rendering (Experimental)

Inline OpenCode skills directly into messages using XML tags:

```md
Create a Jira ticket. <skill>jira</skill>
<!-- or -->
<skill name="jira" />
```

Enable in config:
```jsonc
{
  "experimental": {
    "skillRendering": true
  }
}
```

Skills are loaded from OpenCode's standard directories (`~/.config/opencode/skill/` and `.opencode/skill/`).

### Skill Loading (Experimental)

Load OpenCode skills with command-style syntax while keeping the visible message compact:

```md
Use caveman mode. #skill(caveman)
<!-- or -->
#skill("opencode-config")
```

Enable in config:
```jsonc
{
  "experimental": {
    "skillLoading": true
  }
}
```

Visible transcript text becomes `↳ Loaded name`. The model receives the full OpenCode-style `<skill_content>` wrapper immediately after that message.

Treat `#skill(...)` as hidden context injection, not inline expansion. User usually sees compact placeholder text, while the model receives an extra injected user message containing the full `<skill_content>` payload. Do not assume one visible bubble can hold different hidden text. The implementation achieves this by inserting an additional hidden message immediately after the visible one.

`#skill(...)` also works when produced by snippet expansion, not only when the user types it directly.

## Escaped Hashtag References

When a user writes `#_snippet-name` with a leading underscore after `#`, they are referring to the snippet `#snippet-name` without triggering expansion. This is an escape convention for talking about a snippet in conversation, for example `navigate to #_myapps`. Always interpret `#_foo` as meaning `#foo`. Do not ask for clarification. Silently resolve the underscored form to the real snippet name.

## Commands

- `/snippets add <name> [content]` - create global snippet
- `/snippets add --project <name>` - create project snippet
- `/snippets list` - show all available
- `/snippets delete <name>` - remove snippet
- `/snippets:reload` - reload snippet files from disk

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
