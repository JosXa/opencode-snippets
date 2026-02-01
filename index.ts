import { rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { createCommandExecuteHandler } from "./src/commands.js";
import { loadConfig } from "./src/config.js";
import { assembleMessage, type ExpandOptions, expandHashtags } from "./src/expander.js";
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
import { loadSkills, type SkillRegistry } from "./src/skill-loader.js";
import { expandSkillTags } from "./src/skill-renderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = join(__dirname, "..");
const SKILL_DIR = join(PLUGIN_ROOT, "skill");

/**
 * Clean up legacy skill installation from pre-v1.7.0
 * We used to force-install SKILL.md to ~/.config/opencode/skill/snippets/
 * Now we register the skill path instead, so we remove the orphaned file.
 *
 * TODO: Remove this cleanup code around mid-2026 when most users have upgraded.
 */
async function cleanupLegacySkillInstall(): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return;

  const legacySkillDir = join(home, ".config", "opencode", "skill", "snippets");
  const legacySkillPath = join(legacySkillDir, "SKILL.md");

  try {
    const file = Bun.file(legacySkillPath);
    if (await file.exists()) {
      await unlink(legacySkillPath);
      logger.debug("Cleaned up legacy skill file", { path: legacySkillPath });

      // Try to remove the empty directory too
      await rmdir(legacySkillDir).catch(() => {
        // Directory not empty or doesn't exist - that's fine
      });
    }
  } catch (err) {
    logger.debug("Failed to cleanup legacy skill", { error: String(err) });
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

  // Clean up legacy skill installation (pre-v1.7.0)
  cleanupLegacySkillInstall();

  // Load all snippets at startup (global + project directory)
  const startupStart = performance.now();
  const snippets = await loadSnippets(ctx.directory);

  // Load skills if skill rendering is enabled
  let skills: SkillRegistry = new Map();
  if (config.experimental.skillRendering) {
    skills = await loadSkills(ctx.directory);
  }

  const startupTime = performance.now() - startupStart;

  logger.debug("Plugin startup complete", {
    startupTimeMs: startupTime.toFixed(2),
    snippetCount: snippets.size,
    skillCount: skills.size,
    skillRenderingEnabled: config.experimental.skillRendering,
    injectBlocksEnabled: config.experimental.injectBlocks,
    debugLogging: config.logging.debug,
  });

  // Create command handler
  const commandHandler = createCommandExecuteHandler(ctx.client, snippets, ctx.directory);

  const injectionManager = new InjectionManager();

  /**
   * Processes text parts for snippet expansion, skill rendering, and shell command execution.
   * Returns collected inject blocks from expanded snippets.
   */
  const processTextParts = async (
    parts: Array<{ type: string; text?: string }>,
  ): Promise<string[]> => {
    const messageStart = performance.now();
    let expandTimeTotal = 0;
    let skillTimeTotal = 0;
    let shellTimeTotal = 0;
    let processedParts = 0;
    const allInjected: string[] = [];

    const expandOptions: ExpandOptions = {
      extractInject: config.experimental.injectBlocks,
    };

    for (const part of parts) {
      if (part.type === "text" && part.text) {
        // 1. Expand skill tags if skill rendering is enabled
        if (config.experimental.skillRendering && skills.size > 0) {
          const skillStart = performance.now();
          part.text = expandSkillTags(part.text, skills);
          skillTimeTotal += performance.now() - skillStart;
        }

        // 2. Expand hashtags recursively with loop detection
        const expandStart = performance.now();
        const expansionResult = expandHashtags(part.text, snippets, new Map(), expandOptions);
        part.text = assembleMessage(expansionResult);
        allInjected.push(...expansionResult.inject);
        expandTimeTotal += performance.now() - expandStart;

        // 3. Execute shell commands: !`command`
        const shellStart = performance.now();
        part.text = await executeShellCommands(part.text, ctx as unknown as ShellContext, {
          hideCommandInOutput: config.hideCommandInOutput,
        });
        shellTimeTotal += performance.now() - shellStart;
        processedParts += 1;
      }
    }

    if (processedParts > 0) {
      const totalTime = performance.now() - messageStart;
      logger.debug("Text parts processing complete", {
        totalTimeMs: totalTime.toFixed(2),
        skillTimeMs: skillTimeTotal.toFixed(2),
        snippetExpandTimeMs: expandTimeTotal.toFixed(2),
        shellTimeMs: shellTimeTotal.toFixed(2),
        processedParts,
        injectedCount: allInjected.length,
      });
    }

    return allInjected;
  };

  return {
    // Register /snippet command and skill path
    config: async (opencodeConfig) => {
      // Register skill folder path for automatic discovery
      const cfg = opencodeConfig as typeof opencodeConfig & {
        skills?: { paths?: string[] };
      };
      cfg.skills ??= {};
      cfg.skills.paths ??= [];
      cfg.skills.paths.push(SKILL_DIR);

      // Register /snippet command
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

      if (injected.length > 0) {
        injectionManager.addInjections(input.sessionID, injected);
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

          if (injected.length > 0 && sessionID) {
            injectionManager.addInjections(sessionID, injected);
          }
        }
      }

      if (sessionID) {
        const injections = injectionManager.getInjections(sessionID);
        logger.debug("Transform hook - checking for injections", {
          sessionID,
          hasInjections: !!injections,
          injectionCount: injections?.length || 0,
          messageTexts: output.messages.map((m) => ({
            role: m.info.role,
            text: m.parts
              .filter((p) => p.type === "text")
              .map((p) => (p.text || "").slice(0, 50))
              .join(" | "),
            snippetsProcessed: m.parts.some((p) => p.snippetsProcessed),
          })),
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

    // Process skill tool output to expand snippets and skill tags in skill content
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "skill") return;

      // The skill tool returns markdown content in its output
      // Expand skill tags and hashtags in the skill content
      if (typeof output.output === "string" && output.output.trim()) {
        let processed = output.output;

        // First expand skill tags if enabled
        if (config.experimental.skillRendering && skills.size > 0) {
          processed = expandSkillTags(processed, skills);
        }

        // Then expand hashtag snippets
        const expandOptions: ExpandOptions = {
          extractInject: config.experimental.injectBlocks,
        };
        const expansionResult = expandHashtags(processed, snippets, new Map(), expandOptions);
        output.output = assembleMessage(expansionResult);

        logger.debug("Skill content expanded", {
          tool: input.tool,
          callID: input.callID,
        });
      }
    },
  };
};
