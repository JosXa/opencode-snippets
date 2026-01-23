import type { Plugin } from "@opencode-ai/plugin";
import { createCommandExecuteHandler } from "./src/commands.js";
import { assembleMessage, expandHashtags } from "./src/expander.js";
import { loadSnippets } from "./src/loader.js";
import { logger } from "./src/logger.js";
import { executeShellCommands, type ShellContext } from "./src/shell.js";

/**
 * Snippets Plugin for OpenCode
 *
 * Expands hashtag-based shortcuts in user messages into predefined text snippets.
 * Also provides /snippet command for managing snippets.
 *
 * @see https://github.com/JosXa/opencode-snippets for full documentation
 */
export const SnippetsPlugin: Plugin = async (ctx) => {
  // Load all snippets at startup (global + project directory)
  const startupStart = performance.now();
  const snippets = await loadSnippets(ctx.directory);
  const startupTime = performance.now() - startupStart;

  logger.debug("Plugin startup complete", {
    startupTimeMs: startupTime.toFixed(2),
    snippetCount: snippets.size,
  });

  // Create command handler
  const commandHandler = createCommandExecuteHandler(ctx.client, snippets, ctx.directory);

  return {
    // Register /snippet command
    config: async (opencodeConfig) => {
      opencodeConfig.command ??= {};
      opencodeConfig.command.snippet = {
        template: "",
        description: "Manage text snippets (add, delete, list, help)",
      };
    },

    // Handle /snippet command execution
    "command.execute.before": commandHandler,

    "chat.message": async (_input, output) => {
      // Only process user messages, never assistant messages
      if (output.message.role !== "user") return;

      const messageStart = performance.now();
      let expandTimeTotal = 0;
      let shellTimeTotal = 0;
      let processedParts = 0;

      for (const part of output.parts) {
        if (part.type === "text" && part.text) {
          // 1. Expand hashtags recursively with loop detection
          const expandStart = performance.now();
          const expansionResult = expandHashtags(part.text, snippets);
          part.text = assembleMessage(expansionResult);
          const expandTime = performance.now() - expandStart;
          expandTimeTotal += expandTime;

          // 2. Execute shell commands: !`command`
          const shellStart = performance.now();
          part.text = await executeShellCommands(part.text, ctx as unknown as ShellContext);
          const shellTime = performance.now() - shellStart;
          shellTimeTotal += shellTime;
          processedParts += 1;
        }
      }

      const totalTime = performance.now() - messageStart;
      if (processedParts > 0) {
        logger.debug("Message processing complete", {
          totalTimeMs: totalTime.toFixed(2),
          snippetExpandTimeMs: expandTimeTotal.toFixed(2),
          shellTimeMs: shellTimeTotal.toFixed(2),
          processedParts,
        });
      }
    },
  };
};
