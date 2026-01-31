import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { createCommandExecuteHandler } from "./src/commands.js";
import { loadConfig } from "./src/config.js";
import { assembleMessage, expandHashtags } from "./src/expander.js";
import type {
  ChatMessageInput,
  ChatMessageOutput,
  SessionIdleEvent,
  TransformInput,
  TransformOutput,
} from "./src/hook-types.js";
import { InjectionManager } from "./src/injection-manager.js";
import { loadSnippets } from "./src/loader.js";
import { logger } from "./src/logger.js";
import { executeShellCommands, type ShellContext } from "./src/shell.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = join(__dirname, "..");
const SKILL_DIR = join(PLUGIN_ROOT, "skill");

// Install skill to global config directory
async function installSkillToGlobal() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const globalSkillDir = join(home, ".config", "opencode", "skill", "snippets");
  const globalSkillPath = join(globalSkillDir, "SKILL.md");
  const sourceSkillPath = join(SKILL_DIR, "snippets", "SKILL.md");

  try {
    const sourceFile = Bun.file(sourceSkillPath);
    if (!(await sourceFile.exists())) {
      logger.debug("Source skill not found", { path: sourceSkillPath });
      return;
    }

    // Check if already installed with same content
    const globalFile = Bun.file(globalSkillPath);
    if (await globalFile.exists()) {
      const existing = await globalFile.text();
      const source = await sourceFile.text();
      if (existing === source) {
        logger.debug("Skill already installed", { path: globalSkillPath });
        return;
      }
    }

    mkdirSync(globalSkillDir, { recursive: true });
    await Bun.write(globalSkillPath, sourceFile);
    logger.debug("Installed snippets skill", { path: globalSkillPath });
  } catch (err) {
    logger.debug("Failed to install skill", { error: String(err) });
  }
}

/**
 * Snippets Plugin for OpenCode
 *
 * Expands hashtag-based shortcuts in user messages into predefined text snippets.
 * Also provides /snippet command for managing snippets.
 *
 * @see https://github.com/JosXa/opencode-snippets for full documentation
 */
export const SnippetsPlugin: Plugin = async (ctx) => {
  // Load configuration (global + project-local override)
  const config = loadConfig(ctx.directory);

  // Apply config settings
  logger.debugEnabled = config.logging.debug;

  // Install skill to global config so OpenCode discovers it (if enabled)
  if (config.installSkill) {
    await installSkillToGlobal();
  }

  // Load all snippets at startup (global + project directory)
  const startupStart = performance.now();
  const snippets = await loadSnippets(ctx.directory);
  const startupTime = performance.now() - startupStart;

  logger.debug("Plugin startup complete", {
    startupTimeMs: startupTime.toFixed(2),
    snippetCount: snippets.size,
    installSkill: config.installSkill,
    experimentalInject: config.experimental.inject,
    debugLogging: config.logging.debug,
  });

  // Create command handler
  const commandHandler = createCommandExecuteHandler(ctx.client, snippets, ctx.directory);

  const injectionManager = new InjectionManager();

  /**
   * Processes text parts for snippet expansion and shell command execution.
   * Returns collected inject blocks from expanded snippets.
   */
  const processTextParts = async (
    parts: Array<{ type: string; text?: string }>,
  ): Promise<string[]> => {
    const messageStart = performance.now();
    let expandTimeTotal = 0;
    let shellTimeTotal = 0;
    let processedParts = 0;
    const allInjected: string[] = [];

    for (const part of parts) {
      if (part.type === "text" && part.text) {
        const expandStart = performance.now();
        const expansionResult = expandHashtags(part.text, snippets);
        part.text = assembleMessage(expansionResult);
        allInjected.push(...expansionResult.inject);
        expandTimeTotal += performance.now() - expandStart;

        const shellStart = performance.now();
        part.text = await executeShellCommands(part.text, ctx as unknown as ShellContext, {
          hideCommandInOutput: config.hideCommandInOutput,
        });
        shellTimeTotal += performance.now() - shellStart;
        processedParts += 1;
      }
    }

    if (processedParts > 0) {
      logger.debug("Text parts processing complete", {
        totalTimeMs: (performance.now() - messageStart).toFixed(2),
        snippetExpandTimeMs: expandTimeTotal.toFixed(2),
        shellTimeMs: shellTimeTotal.toFixed(2),
        processedParts,
        injectedCount: allInjected.length,
      });
    }

    return allInjected;
  };

  return {
    config: async (opencodeConfig) => {
      opencodeConfig.command ??= {};
      opencodeConfig.command.snippet = {
        template: "",
        description: "Manage text snippets (add, delete, list, help)",
      };
    },

    "command.execute.before": commandHandler,

    "chat.message": async (input: ChatMessageInput, output: ChatMessageOutput) => {
      if (output.message.role !== "user") return;
      if (output.parts.some((part) => part.ignored)) return;

      const injected = await processTextParts(output.parts);

      output.parts.forEach((part) => {
        if (part.type === "text") {
          part.snippetsProcessed = true;
        }
      });

      if (config.experimental.inject) {
        injectionManager.setInjections(input.sessionID, injected);
      }
    },

    "experimental.chat.messages.transform": async (
      input: TransformInput,
      output: TransformOutput,
    ) => {
      const sessionID = input.sessionID || input.session?.id || output.messages[0]?.info?.sessionID;

      logger.debug("Transform hook called", {
        inputSessionID: input.sessionID,
        extractedSessionID: sessionID,
        messageCount: output.messages.length,
        hasSessionID: !!sessionID,
      });

      for (const message of output.messages) {
        if (message.info.role === "user") {
          if (message.parts.some((part) => part.snippetsProcessed)) continue;
          if (message.parts.some((part) => part.ignored)) continue;

          const injected = await processTextParts(message.parts);

          if (config.experimental.inject && injected.length > 0 && sessionID) {
            injectionManager.addInjections(sessionID, ...injected);
          }
        }
      }

      if (config.experimental.inject && sessionID) {
        const injections = injectionManager.getInjections(sessionID);
        logger.debug("Transform hook - checking for injections", {
          sessionID,
          hasInjections: !!injections,
          injectionCount: injections?.length || 0,
        });
        if (injections && injections.length > 0) {
          const beforeCount = output.messages.length;
          for (const injectText of injections) {
            output.messages.push({
              info: {
                role: "user",
                sessionID: sessionID,
              },
              parts: [{ type: "text", text: injectText }],
            });
          }
          logger.debug("Injected ephemeral user messages", {
            sessionID,
            injectionCount: injections.length,
            messagesBefore: beforeCount,
            messagesAfter: output.messages.length,
          });
        }
      }
    },

    "session.idle": async (event: SessionIdleEvent) => {
      injectionManager.clearSession(event.sessionID);
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "skill") return;

      if (typeof output.output === "string" && output.output.trim()) {
        const expansionResult = expandHashtags(output.output, snippets);
        output.output = assembleMessage(expansionResult);

        logger.debug("Skill content expanded", {
          tool: input.tool,
          callID: input.callID,
        });
      }
    },
  };
};
