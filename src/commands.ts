import { parseCommandArgs } from "./arg-parser.js";
import { getProjectPaths, PATHS } from "./constants.js";
import { createSnippet, deleteSnippet, listSnippets, reloadSnippets } from "./loader.js";
import { logger } from "./logger.js";
import { sendIgnoredMessage } from "./notification.js";
import type { OpencodeClient, SnippetRegistry } from "./types.js";

/** Marker error to indicate command was handled */
const COMMAND_HANDLED_MARKER = "__SNIPPETS_COMMAND_HANDLED__";

interface CommandContext {
  client: OpencodeClient;
  sessionId: string;
  args: string[];
  rawArguments: string;
  snippets: SnippetRegistry;
  projectDir?: string;
}

/**
 * Parsed options from the add command arguments
 */
export interface AddOptions {
  aliases: string[];
  description: string | undefined;
  isProject: boolean;
}

/**
 * Parses option arguments for the add command.
 *
 * Supports all variations per PR #13 requirements:
 * - --alias=a,b, --alias a,b, --aliases=a,b, --aliases a,b
 * - --desc=x, --desc x, --description=x, --description x
 * - --project flag
 *
 * @param args - Array of parsed arguments (after name and content extraction)
 * @returns Parsed options object
 */
export function parseAddOptions(args: string[]): AddOptions {
  const result: AddOptions = {
    aliases: [],
    description: undefined,
    isProject: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip non-option arguments
    if (!arg.startsWith("--")) {
      continue;
    }

    // Handle --project flag
    if (arg === "--project") {
      result.isProject = true;
      continue;
    }

    // Check for --alias or --aliases
    if (arg === "--alias" || arg === "--aliases") {
      // Space-separated: --alias a,b
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        result.aliases = parseAliasValue(nextArg);
        i++; // Skip the value arg
      }
      continue;
    }

    if (arg.startsWith("--alias=") || arg.startsWith("--aliases=")) {
      // Equals syntax: --alias=a,b
      const value = arg.includes("--aliases=")
        ? arg.slice("--aliases=".length)
        : arg.slice("--alias=".length);
      result.aliases = parseAliasValue(value);
      continue;
    }

    // Check for --desc or --description
    if (arg === "--desc" || arg === "--description") {
      // Space-separated: --desc value
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        result.description = nextArg;
        i++; // Skip the value arg
      }
      continue;
    }

    if (arg.startsWith("--desc=") || arg.startsWith("--description=")) {
      // Equals syntax: --desc=value
      const value = arg.startsWith("--description=")
        ? arg.slice("--description=".length)
        : arg.slice("--desc=".length);
      result.description = value;
    }
  }

  return result;
}

/**
 * Parse comma-separated alias values, trimming whitespace
 */
function parseAliasValue(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Creates the command execute handler for the snippets command
 */
export function createCommandExecuteHandler(
  client: OpencodeClient,
  snippets: SnippetRegistry,
  projectDir?: string,
) {
  return async (input: { command: string; sessionID: string; arguments: string }) => {
    if (input.command === "snippets:reload") {
      await handleReloadCommand({
        client,
        sessionId: input.sessionID,
        args: [],
        rawArguments: input.arguments,
        snippets,
        projectDir,
      });
      throw new Error(COMMAND_HANDLED_MARKER);
    }

    if (input.command !== "snippets") return;

    // Use shell-like argument parsing to handle quoted strings correctly
    const args = parseCommandArgs(input.arguments);
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
 * Handle /snippets add <name> ["content"] [--project] [--alias=<alias>] [--desc=<description>]
 */
async function handleAddCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, args, snippets, projectDir } = ctx;

  if (args.length === 0) {
    await sendIgnoredMessage(
      client,
      sessionId,
      'Usage: /snippets add <name> ["content"] [options]\n\n' +
        "Adds a new snippet. Defaults to global directory.\n\n" +
        "Examples:\n" +
        "  /snippets add greeting\n" +
        '  /snippets add bye "see you later"\n' +
        '  /snippets add hi "hello there" --aliases hello,hey\n' +
        '  /snippets add fix "fix imports" --project\n\n' +
        "Options:\n" +
        "  --project             Add to project directory (.opencode/snippet/)\n" +
        "  --aliases X,Y,Z       Add aliases (comma-separated)\n" +
        '  --desc "..."          Add a description',
    );
    return;
  }

  const name = args[0];

  // Extract content: second argument if it doesn't start with --
  // The arg-parser already handles quoted strings, so content is clean
  let content = "";
  let optionArgs = args.slice(1);

  if (args[1] && !args[1].startsWith("--")) {
    content = args[1];
    optionArgs = args.slice(2);
  }

  // Parse all options using the new parser
  const options = parseAddOptions(optionArgs);

  // Default to global, --project puts it in project directory
  const targetDir = options.isProject ? projectDir : undefined;
  const location = options.isProject && projectDir ? "project" : "global";

  try {
    const filePath = await createSnippet(
      name,
      content,
      { aliases: options.aliases, description: options.description },
      targetDir,
    );

    // Reload snippets
    await reloadSnippets(snippets, projectDir);

    let message = `Added ${location} snippet: ${name}\nFile: ${filePath}`;
    if (content) {
      message += `\nContent: "${truncate(content, 50)}"`;
    } else {
      message += "\n\nEdit the file to add your snippet content.";
    }
    if (options.aliases.length > 0) {
      message += `\nAliases: ${options.aliases.join(", ")}`;
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
 * Handle /snippets delete <name>
 */
async function handleDeleteCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, args, snippets, projectDir } = ctx;

  if (args.length === 0) {
    await sendIgnoredMessage(
      client,
      sessionId,
      "Usage: /snippets delete <name>\n\nDeletes a snippet by name. " +
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
      `Snippet not found: #${name}\n\nUse /snippets list to see available snippets.`,
    );
  }
}

/**
 * Handle /snippets:reload
 */
async function handleReloadCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, snippets, projectDir } = ctx;

  await reloadSnippets(snippets, projectDir);

  const count = listSnippets(snippets).length;
  await sendIgnoredMessage(
    client,
    sessionId,
    `Reloaded ${count} snippet${count === 1 ? "" : "s"}.`,
  );
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
  return `${text.slice(0, maxLength - 3)}...`;
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

function globalSnippetLocations(): string {
  return `${PATHS.SNIPPETS_DIR}/ or ${PATHS.SNIPPETS_DIR_ALT}/`;
}

function projectSnippetLocations(projectDir: string): string {
  const paths = getProjectPaths(projectDir);
  return `${paths.SNIPPETS_DIR}/ or ${paths.SNIPPETS_DIR_ALT}/`;
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
 * Handle /snippets list
 */
async function handleListCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId, snippets, projectDir } = ctx;

  const snippetList = listSnippets(snippets);

  if (snippetList.length === 0) {
    await sendIgnoredMessage(
      client,
      sessionId,
      "No snippets found.\n\n" +
        `Global snippets: ${globalSnippetLocations()}\n` +
        (projectDir
          ? `Project snippets: ${projectSnippetLocations(projectDir)}`
          : "No project directory detected.") +
        "\n\nUse /snippets add <name> to add a new snippet.",
    );
    return;
  }

  const lines: string[] = [];

  // Group by source
  const globalSnippets = snippetList.filter((s) => s.source === "global");
  const projectSnippets = snippetList.filter((s) => s.source === "project");

  if (globalSnippets.length > 0) {
    lines.push(`── Global (${globalSnippetLocations()}) ──`, "");
    for (const s of globalSnippets) {
      lines.push(formatSnippetEntry(s), "");
    }
  }

  if (projectSnippets.length > 0 && projectDir) {
    lines.push(`── Project (${projectSnippetLocations(projectDir)}) ──`, "");
    for (const s of projectSnippets) {
      lines.push(formatSnippetEntry(s), "");
    }
  }

  await sendIgnoredMessage(client, sessionId, lines.join("\n").trimEnd());
}

/**
 * Handle /snippets help
 */
async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const { client, sessionId } = ctx;

  const helpText = `Snippets Command - Manage text snippets

Usage: /snippets <command> [options]

Commands:
  add <name> ["content"] [options]
    --project               Add to project directory (default: global)
    --aliases X,Y,Z         Add aliases (comma-separated)
    --desc "..."            Add a description

  delete <name>             Delete a snippet
  list                      List all available snippets
  /snippets:reload          Reload snippet files from disk
  help                      Show this help message

Snippet Locations:
  Global:  ~/.config/opencode/snippet/ or ~/.config/opencode/snippets/
  Project: <project>/.opencode/snippet/ or <project>/.opencode/snippets/

Usage in messages:
  Type #snippet-name to expand a snippet inline.
  Snippets can reference other snippets recursively.

Examples:
  /snippets add greeting
  /snippets add bye "see you later"
  /snippets add hi "hello there" --aliases hello,hey
  /snippets add fix "fix imports" --project
  /snippets delete old-snippet
  /snippets list
  /snippets:reload`;

  await sendIgnoredMessage(client, sessionId, helpText);
}
