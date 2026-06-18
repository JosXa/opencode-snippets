import { exec } from "node:child_process";
import { promisify } from "node:util";
import { PATTERNS } from "./constants.js";
import { logger } from "./logger.js";

const execAsync = promisify(exec);

/**
 * Executes shell commands in text using !`command` or !>`command` syntax
 *
 * @param text - The text containing shell commands to execute
 * @param ctx - Shell execution context
 * @returns The text with shell commands replaced by their output
 */
export type ShellContext = {
  directory?: string;
};

export async function executeShellCommands(text: string, ctx: ShellContext): Promise<string> {
  let result = text;

  // Reset regex state (global flag requires this)
  PATTERNS.SHELL_COMMAND.lastIndex = 0;

  // Find all shell command matches
  const matches = [...text.matchAll(PATTERNS.SHELL_COMMAND)];

  // Execute each command and replace in text
  for (const match of matches) {
    const showCommand = match[1] === "!>";
    const cmd = match[2];
    const _placeholder = match[0];

    try {
      const output = await execAsync(cmd, { cwd: ctx.directory });
      const text = `${output.stdout}${output.stderr}`.trim();
      // `!>` preserves command provenance when the model should see what just ran.
      const replacement = showCommand ? `$ ${cmd}\n--> ${text}` : text;
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
