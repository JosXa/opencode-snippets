import { PATHS } from "./constants.js";
import { createSnippet, deleteSnippet, listSnippets, reloadSnippets } from "./loader.js";
import { logger } from "./logger.js";
import { sendIgnoredMessage } from "./notification.js";
import type { SnippetRegistry } from "./types.js";

/** Marker error to indicate command was handled */
const COMMAND_HANDLED_MARKER = "__SNIPPETS_COMMAND_HANDLED__";

interface CommandContext {
  client: any;
  sessionId: string;
  args: string[];
  rawArguments: string;
  snippets: SnippetRegistry;
  projectDir?: string;
}

/**
 * Creates the command execute handler for the snippets command
 */
export function createCommandExecuteHandler(
  client: any,
  snippets: SnippetRegistry,
  projectDir?: string,
) {
  return async (input: { command: string; sessionID: string; arguments: string }) => {
    if (input.command !== "snippet") return;

    const args = input.arguments.split(/\s+/).filter(Boolean);
    const subcommand = args[0]?.toLowerCase() || "help";

    const ctx: CommandContext = {
      client,
      sessionId: input.sessionID,
      args: args.slice(1),
      rawArguments: input.arguments,
      snippets,
      projectDir,
    };

    try {
      switch (subcommand) {
        case "add":
        case "create":
        case "new":
          await handleAddCommand(ctx);
          break;
        case "delete":
        case "remove":
        case "rm":
          await handleDeleteCommand(ctx);
          break;
        case "list":
        case "ls":
          await handleListCommand(ctx);
          break;
        case "help":
        default:
          await handleHelpCommand(ctx);
          break;
      }
    } catch (error) {
      if (error instanceof Error && error.message === COMMAND_HANDLED_MARKER) {
        throw error;
      }
      logger.error("Command execution failed", {
        subcommand,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendIgnoredMessage(
        ctx.client,
        ctx.sessionId,
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Signal that command was handled
    throw new Error(COMMAND_HANDLED_MARKER);
  };
}

/**
 * Handle /snippet add <name> ["content"] [--project] [--alias=<alias>] [--desc=<description>]
 */
async function handleAddCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, args, rawArguments, snippets, projectDir } = ctx;

  if (args.length === 0) {
    await sendIgnoredMessage(
      client,
      sessionId,
      'Usage: /snippet add <name> ["content"] [options]\n\n' +
        "Adds a new snippet. Defaults to global directory.\n\n" +
        "Examples:\n" +
        "  /snippet add greeting\n" +
        '  /snippet add bye "see you later"\n' +
        '  /snippet add hi "hello there" --alias=hello,hey\n' +
        '  /snippet add fix "fix imports" --project\n\n' +
        "Options:\n" +
        "  --project       Add to project directory (.opencode/snippet/)\n" +
        "  --alias=X,Y,Z   Add aliases (comma-separated)\n" +
        '  --desc="..."    Add a description',
    );
    return;
  }

  const name = args[0];

  // Extract quoted content from raw arguments
  // Match content between quotes after the subcommand and name
  const quotedMatch = rawArguments.match(/(?:add|create|new)\s+\S+\s+"([^"]+)"/i);
  const content = quotedMatch ? quotedMatch[1] : "";

  const isProject = args.includes("--project");
  const aliases: string[] = [];
  let description: string | undefined;

  for (const arg of args.slice(1)) {
    if (arg.startsWith("--alias=")) {
      const values = arg
        .slice(8)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      aliases.push(...values);
    } else if (arg.startsWith("--desc=")) {
      description = arg.slice(7);
    }
  }

  // Default to global, --project puts it in project directory
  const targetDir = isProject ? projectDir : undefined;
  const location = isProject && projectDir ? "project" : "global";

  try {
    const filePath = await createSnippet(name, content, { aliases, description }, targetDir);

    // Reload snippets
    await reloadSnippets(snippets, projectDir);

    let message = `Added ${location} snippet: ${name}\nFile: ${filePath}`;
    if (content) {
      message += `\nContent: "${truncate(content, 50)}"`;
    } else {
      message += "\n\nEdit the file to add your snippet content.";
    }
    if (aliases.length > 0) {
      message += `\nAliases: ${aliases.join(", ")}`;
    }

    await sendIgnoredMessage(client, sessionId, message);
  } catch (error) {
    await sendIgnoredMessage(
      client,
      sessionId,
      `Failed to add snippet: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Handle /snippet delete <name>
 */
async function handleDeleteCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, args, snippets, projectDir } = ctx;

  if (args.length === 0) {
    await sendIgnoredMessage(
      client,
      sessionId,
      "Usage: /snippet delete <name>\n\nDeletes a snippet by name. " +
        "Project snippets are checked first, then global.",
    );
    return;
  }

  const name = args[0];

  const deletedPath = await deleteSnippet(name, projectDir);

  if (deletedPath) {
    // Reload snippets
    await reloadSnippets(snippets, projectDir);

    await sendIgnoredMessage(
      client,
      sessionId,
      `Deleted snippet: #${name}\nRemoved: ${deletedPath}`,
    );
  } else {
    await sendIgnoredMessage(
      client,
      sessionId,
      `Snippet not found: #${name}\n\nUse /snippet list to see available snippets.`,
    );
  }
}

/** Maximum characters for snippet content preview */
const MAX_CONTENT_PREVIEW_LENGTH = 200;
/** Maximum characters for aliases display */
const MAX_ALIASES_LENGTH = 50;
/** Divider line */
const DIVIDER = "────────────────────────────────────────────────";

/**
 * Truncate text with ellipsis if it exceeds maxLength
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Format aliases for display, truncating if needed
 */
function formatAliases(aliases: string[]): string {
  if (aliases.length === 0) return "";

  const joined = aliases.join(", ");
  if (joined.length <= MAX_ALIASES_LENGTH) {
    return ` (aliases: ${joined})`;
  }

  // Truncate and show count
  const truncated = truncate(joined, MAX_ALIASES_LENGTH - 10);
  return ` (aliases: ${truncated} +${aliases.length})`;
}

/**
 * Format a single snippet for display
 */
function formatSnippetEntry(s: { name: string; content: string; aliases: string[] }): string {
  const header = `${s.name}${formatAliases(s.aliases)}`;
  const content = truncate(s.content.trim(), MAX_CONTENT_PREVIEW_LENGTH);

  return `${header}\n${DIVIDER}\n${content || "(empty)"}`;
}

/**
 * Handle /snippet list
 */
async function handleListCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, snippets, projectDir } = ctx;

  const snippetList = listSnippets(snippets);

  if (snippetList.length === 0) {
    await sendIgnoredMessage(
      client,
      sessionId,
      "No snippets found.\n\n" +
        `Global snippets: ${PATHS.SNIPPETS_DIR}\n` +
        (projectDir
          ? `Project snippets: ${projectDir}/.opencode/snippet/`
          : "No project directory detected.") +
        "\n\nUse /snippet add <name> to add a new snippet.",
    );
    return;
  }

  const lines: string[] = [];

  // Group by source
  const globalSnippets = snippetList.filter((s) => s.source === "global");
  const projectSnippets = snippetList.filter((s) => s.source === "project");

  if (globalSnippets.length > 0) {
    lines.push(`── Global (${PATHS.SNIPPETS_DIR}) ──`, "");
    for (const s of globalSnippets) {
      lines.push(formatSnippetEntry(s), "");
    }
  }

  if (projectSnippets.length > 0) {
    lines.push(`── Project (${projectDir}/.opencode/snippet/) ──`, "");
    for (const s of projectSnippets) {
      lines.push(formatSnippetEntry(s), "");
    }
  }

  await sendIgnoredMessage(client, sessionId, lines.join("\n").trimEnd());
}

/**
 * Handle /snippet help
 */
async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId } = ctx;

  const helpText = `Snippets Command - Manage text snippets

Usage: /snippet <command> [options]

Commands:
  add <name> ["content"] [options]
    --project               Add to project directory (default: global)
    --alias=X,Y,Z           Add aliases (comma-separated)
    --desc="..."            Add a description

  delete <name>             Delete a snippet
  list                      List all available snippets
  help                      Show this help message

Snippet Locations:
  Global:  ~/.config/opencode/snippet/
  Project: <project>/.opencode/snippet/

Usage in messages:
  Type #snippet-name to expand a snippet inline.
  Snippets can reference other snippets recursively.

Examples:
  /snippet add greeting
  /snippet add bye "see you later"
  /snippet add hi "hello there" --alias=hello,hey
  /snippet add fix "fix imports" --project
  /snippet delete old-snippet
  /snippet list`;

  await sendIgnoredMessage(client, sessionId, helpText);
}
