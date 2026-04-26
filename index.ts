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
  MessagePart,
  TransformInput,
  TransformOutput,
} from "./src/hook-types.js";
import { InjectionManager } from "./src/injection-manager.js";
import { loadSnippets } from "./src/loader.js";
import { logger } from "./src/logger.js";
import { sendIgnoredMessage } from "./src/notification.js";
import { executeShellCommands, type ShellContext } from "./src/shell.js";
import { SkillLoadManager } from "./src/skill-load-manager.js";
import { loadSkills, type SkillRegistry } from "./src/skill-loader.js";
import { expandSkillLoads } from "./src/skill-loading.js";
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
 * Also provides /snippets commands for managing snippets.
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

  // Load skills if either skill feature is enabled
  let skills: SkillRegistry = new Map();
  if (config.experimental.skillRendering || config.experimental.skillLoading) {
    skills = await loadSkills(ctx.directory);
  }

  const startupTime = performance.now() - startupStart;

  logger.debug("Plugin startup complete", {
    startupTimeMs: startupTime.toFixed(2),
    snippetCount: snippets.size,
    skillCount: skills.size,
    skillRenderingEnabled: config.experimental.skillRendering,
    skillLoadingEnabled: config.experimental.skillLoading,
    injectBlocksEnabled: config.experimental.injectBlocks,
    debugLogging: config.logging.debug,
  });

  // Create command handler
  const commandHandler = createCommandExecuteHandler(ctx.client, snippets, ctx.directory);

  const injectionManager = new InjectionManager();
  const skillLoadManager = new SkillLoadManager();

  /**
   * Processes text parts for snippet expansion, skill rendering, and shell command execution.
   * Returns collected inject blocks from expanded snippets with snippet names.
   */
  const processTextParts = async (
    parts: MessagePart[],
  ): Promise<Array<{ snippetName: string; content: string }>> => {
    const messageStart = performance.now();
    let expandTimeTotal = 0;
    let skillTimeTotal = 0;
    let shellTimeTotal = 0;
    let processedParts = 0;
    const allInjected: Array<{ snippetName: string; content: string }> = [];

    const expandOptions: ExpandOptions = {
      extractInject: config.experimental.injectBlocks,
      onInjectBlock: (block) => {
        allInjected.push(block);
      },
    };

    for (const part of parts) {
      if (part.type === "text" && part.text) {
        // 1. Expand skill tags if skill rendering is enabled
        if (config.experimental.skillRendering && skills.size > 0) {
          const skillStart = performance.now();
          part.text = expandSkillTags(part.text, skills);
          skillTimeTotal += performance.now() - skillStart;
        }

        const skillPayloads: string[] = [];
        const loadSkills = async (): Promise<void> => {
          if (!config.experimental.skillLoading || skills.size === 0) return;

          const skillLoadResult = await expandSkillLoads(part.text || "", skills, snippets, {
            expandSkillTagsInContent: config.experimental.skillRendering,
            extractInject: config.experimental.injectBlocks,
          });
          part.text = skillLoadResult.text;
          skillPayloads.push(...skillLoadResult.payloads);
        };

        if (config.experimental.skillLoading && skills.size > 0) {
          const skillStart = performance.now();

          // User requirement: reserve explicit #skill(...) syntax even if a plain
          // #skill snippet also exists.
          await loadSkills();
          skillTimeTotal += performance.now() - skillStart;
        }

        // 2. Expand hashtags recursively with loop detection
        const expandStart = performance.now();
        const expansionResult = expandHashtags(part.text, snippets, new Map(), expandOptions);
        part.text = assembleMessage(expansionResult);
        expandTimeTotal += performance.now() - expandStart;

        // User requirement: snippet-expanded text can also contain #skill(...),
        // so run skill loading again after hashtag expansion.
        if (config.experimental.skillLoading && skills.size > 0) {
          const skillStart = performance.now();
          await loadSkills();
          part.skillLoads = skillPayloads;
          skillTimeTotal += performance.now() - skillStart;
        }

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

  const isIgnoredMessage = (message: TransformOutput["messages"][number]): boolean =>
    message.parts.some((part) => part.ignored);

  const countConversationMessages = (messages: TransformOutput["messages"]): number =>
    messages.filter((message) => !isIgnoredMessage(message)).length;

  const insertInjectionsIntoMessages = (
    messages: TransformOutput["messages"],
    injections: Array<{ targetPosition: number; content: string }>,
  ): TransformOutput["messages"] => {
    if (injections.length === 0) return messages;

    const totalRealMessages = countConversationMessages(messages);
    const buckets = new Map<number, string[]>();
    for (const injection of injections) {
      const position = Math.max(0, Math.min(totalRealMessages, injection.targetPosition));
      const existing = buckets.get(position) || [];
      existing.push(injection.content);
      buckets.set(position, existing);
    }

    const result: TransformOutput["messages"] = [];
    const prepend = buckets.get(0) || [];
    for (const text of prepend) {
      result.push({
        info: { role: "user" },
        parts: [{ type: "text", text }],
      });
    }

    let seenRealMessages = 0;
    messages.forEach((message) => {
      result.push(message);
      if (isIgnoredMessage(message)) return;
      seenRealMessages += 1;
      const texts = buckets.get(seenRealMessages) || [];
      for (const text of texts) {
        result.push({
          info: { role: "user", sessionID: message.info.sessionID },
          parts: [{ type: "text", text }],
        });
      }
    });

    return result;
  };

  const getPartSkillLoads = (parts: MessagePart[]): string[] =>
    parts.flatMap((part) => part.skillLoads || []);

  const getMessageSkillLoads = (
    sessionID: string,
    message: TransformOutput["messages"][number],
  ): string[] => {
    const direct = getPartSkillLoads(message.parts);
    if (direct.length > 0) return direct;

    if (!message.info.id) return [];
    return skillLoadManager.get(sessionID, message.info.id);
  };

  const insertSkillLoadsIntoMessages = (
    sessionID: string,
    messages: TransformOutput["messages"],
  ): TransformOutput["messages"] => {
    const pending = skillLoadManager.drainPending(sessionID);
    const result: TransformOutput["messages"] = [];

    const fallbackByIndex = new Map<number, string[]>();
    if (pending.length > 0) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.info.role !== "user" || isIgnoredMessage(message)) continue;
        if (getMessageSkillLoads(sessionID, message).length > 0) continue;

        const payloads = pending.pop();
        if (!payloads) break;
        fallbackByIndex.set(i, payloads);
      }
    }

    for (const [i, message] of messages.entries()) {
      result.push(message);

      if (message.info.role !== "user" || isIgnoredMessage(message)) {
        continue;
      }

      const direct = getMessageSkillLoads(sessionID, message);
      const payloads = direct.length > 0 ? direct : fallbackByIndex.get(i) || [];
      if (payloads.length === 0) {
        continue;
      }

      // User requirement: try placing hidden skill context immediately after the
      // visible user message so OpenCode sees the visible marker first.
      result.push({
        info: { role: "user", sessionID: message.info.sessionID || sessionID },
        parts: [{ type: "text", text: payloads.join("\n\n") }],
      });
    }

    return result;
  };

  return {
    // Register /snippets commands and skill path
    config: async (opencodeConfig) => {
      // Register skill folder path for automatic discovery
      const cfg = opencodeConfig as typeof opencodeConfig & {
        skills?: { paths?: string[] };
      };
      cfg.skills ??= {};
      cfg.skills.paths ??= [];
      cfg.skills.paths.push(SKILL_DIR);

      // Register /snippets commands
      opencodeConfig.command ??= {};
      opencodeConfig.command.snippets = {
        template: "",
        description: "Manage text snippets (add, delete, list, help)",
      };
      opencodeConfig.command["snippets:reload"] = {
        template: "",
        description: "Reload snippet files from disk",
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

      if (input.messageID) {
        const payloads = getPartSkillLoads(output.parts);
        if (payloads.length > 0) {
          skillLoadManager.register(input.sessionID, input.messageID, payloads);
        }
      } else {
        const payloads = getPartSkillLoads(output.parts);
        if (payloads.length > 0) {
          skillLoadManager.queue(input.sessionID, payloads);
        }
      }

      if (injected.length > 0) {
        const newOnes = injectionManager.registerAndGetNew(input.sessionID, injected);
        if (newOnes.length > 0) {
          const snippetNames = [...new Set(newOnes.map((i) => i.snippetName))];
          await sendIgnoredMessage(
            ctx.client,
            input.sessionID,
            snippetNames.map((name) => `↳ Injected #${name}`).join("\n"),
          );
        }
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
            const newOnes = injectionManager.registerAndGetNew(sessionID, injected);
            if (newOnes.length > 0) {
              const snippetNames = [...new Set(newOnes.map((i) => i.snippetName))];
              await sendIgnoredMessage(
                ctx.client,
                sessionID,
                snippetNames.map((name) => `↳ Injected #${name}`).join("\n"),
              );
            }
          }

          if (sessionID && message.info.id) {
            const payloads = getPartSkillLoads(message.parts);
            if (payloads.length > 0) {
              skillLoadManager.register(sessionID, message.info.id, payloads);
            }
          }
        }
      }

      if (sessionID) {
        const messageCount = countConversationMessages(output.messages);
        const { injections } = injectionManager.getRenderableInjections(
          sessionID,
          messageCount,
          config.injectRecencyMessages,
        );

        logger.debug("Transform hook - checking for injections", {
          sessionID,
          hasInjections: injections.length > 0,
          injectionCount: injections.length,
          messageTexts: output.messages.map((m) => ({
            role: m.info.role,
            text: m.parts
              .filter((p) => p.type === "text")
              .map((p) => (p.text || "").slice(0, 50))
              .join(" | "),
            snippetsProcessed: m.parts.some((p) => p.snippetsProcessed),
          })),
        });

        if (injections.length > 0) {
          const beforeCount = output.messages.length;
          output.messages = insertInjectionsIntoMessages(output.messages, injections);
          logger.debug("Injected ephemeral user messages", {
            sessionID,
            injectionCount: injections.length,
            messagesBefore: beforeCount,
            messagesAfter: output.messages.length,
          });
        }

        if (config.experimental.skillLoading) {
          const beforeSkillLoads = output.messages.length;
          output.messages = insertSkillLoadsIntoMessages(sessionID, output.messages);
          if (output.messages.length > beforeSkillLoads) {
            logger.debug("Injected skill load context messages", {
              sessionID,
              messagesBefore: beforeSkillLoads,
              messagesAfter: output.messages.length,
            });
          }
        }
      }
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
