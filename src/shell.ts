import { PATTERNS } from "./constants.js";
import { logger } from "./logger.js";

/**
 * Executes shell commands in text using !`command` syntax
 *
 * @param text - The text containing shell commands to execute
 * @param ctx - The plugin context (with Bun shell)
 * @returns The text with shell commands replaced by their output
 */
type ShellContext = {
  $: (template: TemplateStringsArray, ...args: unknown[]) => {
    quiet: () => { nothrow: () => { text: () => Promise<string> } };
  };
};

export async function executeShellCommands(text: string, ctx: ShellContext): Promise<string> {
  let result = text;

  // Reset regex state (global flag requires this)
  PATTERNS.SHELL_COMMAND.lastIndex = 0;

  // Find all shell command matches
  const matches = [...text.matchAll(PATTERNS.SHELL_COMMAND)];

  // Execute each command and replace in text
  for (const match of matches) {
    const cmd = match[1];
    const _placeholder = match[0];

    try {
      const output = await ctx.$`${{ raw: cmd }}`.quiet().nothrow().text();
      // Format like slash commands: print command first, then output
      const replacement = `$ ${cmd}\n--> ${output.trim()}`;
      result = result.replace(_placeholder, replacement);
    } catch (error) {
      // If shell command fails, leave it as-is
      // This preserves the original syntax for debugging
      logger.warn("Shell command execution failed", {
        command: cmd,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
