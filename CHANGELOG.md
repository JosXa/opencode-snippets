# Changelog

## Unreleased

- `/snippets` opens the snippet library. The library provides source editing,
  search, dependency navigation, file management, reload, and form testing.
- Removed `/snippets:library`, `/snippets:reload`, `/snippets:edit`, and the
  `add`, `list`, `delete`, and `help` subcommands from the current OpenCode integration.
  Invocation editing remains available through Ctrl+G and the command palette.
- Removed management commands from prompt processing, including headless/API
  submissions and batches that created or deleted snippets between text parts.
  Agents and scripts can still edit the Markdown files directly.
- Removed the combined text listing of all snippet bodies. The library shows
  each snippet's source when selected.
- The library refuses to overwrite existing files when creating snippets and
  refuses writes through symlinked files. The removed `add` command allowed these
  operations when its path checks passed. Use **Edit source** to update a file.
- Documentation now describes the current OpenCode setup. Earlier OpenCode V1
  instructions used `plugin` in `opencode.json` and `tui.json`; the current setup
  uses `plugins` in `opencode.json` and loads the terminal plugin automatically.
