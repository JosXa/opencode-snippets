import { parseCommandArgs } from "./arg-parser.js";
import { parseAddOptions } from "./commands.js";
import type { SnippetOverlay } from "./loader.js";
import { createSnippet, deleteSnippet, listSnippets, reloadSnippets } from "./loader.js";
import type { SnippetRegistry } from "./types.js";

const HELP = `Snippet commands:
  /snippets list
  /snippets add <name> ["content"] [--project] [--aliases a,b] [--desc "text"]
  /snippets delete <name>
  /snippets:reload`;

export function isV2SnippetCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === "/snippets:reload" || /^\/snippets(?:\s|$)/.test(trimmed);
}

export async function executeV2SnippetCommand(
  input: string,
  snippets: SnippetRegistry,
  directory?: string,
  globalDir?: string,
  overlay?: SnippetOverlay,
): Promise<string | undefined> {
  if (!isV2SnippetCommand(input)) return;
  const trimmed = input.trim();
  if (trimmed === "/snippets:reload") {
    await reloadSnippets(snippets, directory, globalDir, overlay);
    const count = listSnippets(snippets).length;
    return `Reloaded ${count} snippet${count === 1 ? "" : "s"}.`;
  }

  const args = parseCommandArgs(trimmed.slice("/snippets".length).trim());
  const action = args.shift()?.toLowerCase() ?? "help";
  if (action === "list" || action === "ls") {
    const items = listSnippets(snippets);
    if (items.length === 0) return "No snippets found.";
    return items
      .map(
        (item) =>
          `#${item.name}${item.aliases.length ? ` (aliases: ${item.aliases.join(", ")})` : ""}\n${item.content.trim() || "(empty)"}`,
      )
      .join("\n\n");
  }
  if (action === "add" || action === "create" || action === "new") {
    const name = args.shift();
    if (!name) return HELP;
    let content = "";
    if (args[0] && !/^--[A-Za-z]/.test(args[0])) content = args.shift() ?? "";
    // Share V1 option semantics: ignore missing values and keep the last valid occurrence.
    const options = parseAddOptions(args);
    const project = options.isProject;
    const path = await createSnippet(
      name,
      content,
      { aliases: options.aliases, description: options.description },
      project ? directory : undefined,
      globalDir,
      overlay,
    );
    await reloadSnippets(snippets, directory, globalDir, overlay);
    return `Added ${project ? "project" : "global"} snippet #${name}.\nFile: ${path}`;
  }
  if (action === "delete" || action === "remove" || action === "rm") {
    const name = args[0];
    if (!name) return HELP;
    const path = await deleteSnippet(name, directory, globalDir, overlay);
    await reloadSnippets(snippets, directory, globalDir, overlay);
    return path ? `Deleted snippet #${name}.\nRemoved: ${path}` : `Snippet not found: #${name}`;
  }
  return HELP;
}
