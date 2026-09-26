# Product

## Register

product

## Users and purpose

OpenCode users compose reusable instructions through inline hashtags. The snippet
library lets them find, understand, create, and maintain those instructions inside
the terminal, including aliases, typed fields, and nested snippets.

## Design principles

- Keep the searchable list beside the selected snippet and its dependencies.
- Make every file operation available without an external editor.
- Show which scope and file supply a snippet, including overridden definitions.
- Preserve authored Markdown and frontmatter when editing.
- Protect unsaved work and report conflicts with changes made outside the library.

## Interaction and accessibility

Use native OpenTUI controls and the active OpenCode theme. Support keyboard and
mouse navigation, visible focus and selection, and narrow terminals. Labels and
status text must communicate meaning without relying on color alone.

## Visual direction

Use a compact terminal layout with thin separators, a highlighted selected row,
source and dependency inspection, and a persistent shortcut footer. Avoid
decorative cards, graphics, and fixed brand colors.
