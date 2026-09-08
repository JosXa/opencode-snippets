---
name: snippets
description: MUST use when user asks to create, edit, manage, or share snippets, or asks how snippets work
---

# Snippets

Reusable text blocks expanded via `#hashtag` in messages. Use the plugin's
[README](https://github.com/JosXa/opencode-snippets/blob/opencode-v2/README.md)
as the source of truth for installation, configuration, and supported syntax.

## Locations and configuration

Check only the documented global and project snippet directories. Snippet
configuration is always `snippet/config.jsonc`; plural `snippets/` supports
Markdown snippets only.

When modifying configuration:

1. Check both documented configuration locations.
2. Modify the existing location when only one exists.
3. Ask the user which location to modify when both exist.
4. Create the global configuration when neither exists.

## Snippet format

The filename (without `.md`) is the primary hashtag. Frontmatter is optional:

```md
---
aliases:
  - short
description: Optional
---
Content here
```

## Authoring rules

- Read [Creating snippets](./references/creating-snippets.md) before creating or restructuring a snippet.
- Use `!>` rather than `` !`cmd` `` when the command itself helps the model interpret its output.
- Use `<inject>` only for context that must persist for the whole turn.
- Treat `#skill(...)` as hidden context injection, not inline expansion.
- Interpret `#_name` as an escaped reference to `#name`; do not expand it.

## Commands

- `/snippets add <name> [content]`
- `/snippets add --project <name>`
- `/snippets list`
- `/snippets delete <name>`
- `/snippets:reload`

## Sharing snippets

Share to [GitHub Discussions](https://github.com/JosXa/opencode-snippets/discussions/categories/snippets).

1. Check that `gh --version` succeeds.
2. If it is available, use the question tool to get approval to post and ask when the user uses the snippet. Use a body file with `gh` rather than an inline body.
3. If it is unavailable, open the new-discussion URL and ask the user for the same usage context.
