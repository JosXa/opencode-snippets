import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { createCommandExecuteHandler } from "./src/commands.js";
import { loadConfig } from "./src/config.js";
import { assembleMessage, expandHashtags } from "./src/expander.js";
import { loadSnippets } from "./src/loader.js";
import { logger } from "./src/logger.js";
import { executeShellCommands, type ShellContext } from "./src/shell.js";
import type { ExpansionResult } from "./src/types.js";

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
    debugLogging: config.logging.debug,
  });

  // Create command handler
  const commandHandler = createCommandExecuteHandler(ctx.client, snippets, ctx.directory);

  // Map to store active injections per session
  const activeInjections = new Map<string, string[]>();

  /**
   * Processes text parts for snippet expansion and shell command execution
   * Returns collected inject blocks
   */
  const processTextParts = async (parts: Array<{ type: string; text?: string }>) => {
    const messageStart = performance.now();
    let expandTimeTotal = 0;
    let shellTimeTotal = 0;
    let processedParts = 0;
    const allInjected: string[] = [];

    for (const part of parts) {
      if (part.type === "text" && part.text) {
        // 1. Expand hashtags recursively with loop detection
        const expandStart = performance.now();
        const expansionResult = expandHashtags(part.text, snippets);
        part.text = assembleMessage(expansionResult);
        allInjected.push(...expansionResult.inject);
        const expandTime = performance.now() - expandStart;
        expandTimeTotal += expandTime;

        // 2. Execute shell commands: !`command`
        const shellStart = performance.now();
        part.text = await executeShellCommands(part.text, ctx as unknown as ShellContext, {
          hideCommandInOutput: config.hideCommandInOutput,
        });
        const shellTime = performance.now() - shellStart;
        shellTimeTotal += shellTime;
        processedParts += 1;
      }
    }

    const totalTime = performance.now() - messageStart;
    if (processedParts > 0) {
      logger.debug("Text parts processing complete", {
        totalTimeMs: totalTime.toFixed(2),
        snippetExpandTimeMs: expandTimeTotal.toFixed(2),
        shellTimeMs: shellTimeTotal.toFixed(2),
        processedParts,
        injectedCount: allInjected.length,
      });
    }

    return allInjected;
  };

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

    "chat.message": async (input: any, output: any) => {
      // Only process user messages, never assistant messages
      if (output.message.role !== "user") return;
      // Skip processing if any part is marked as ignored (e.g., command output)
      if (output.parts.some((part: any) => "ignored" in part && part.ignored)) return;

      const injected = await processTextParts(output.parts);

      // Mark parts as processed to avoid re-processing in transform
      output.parts.forEach((part: any) => {
        if (part.type === "text") {
          (part as any).snippetsProcessed = true;
        }
      });

      const sessionID = input.sessionID;

      // CRITICAL: Clear old injections from this session FIRST
      // This ensures injections only last for ONE user message cycle
      if (activeInjections.has(sessionID)) {
        logger.debug("Clearing previous injections for new user message", {
          sessionID,
          previousCount: activeInjections.get(sessionID)?.length || 0,
        });
        activeInjections.delete(sessionID);
      }

      // Store any NEW injections for this session
      if (injected.length > 0) {
        activeInjections.set(sessionID, injected);
        logger.debug("Stored NEW inject blocks for session", {
          sessionID,
          count: injected.length,
        });
      }
    },

    // Process all messages including question tool responses
    "experimental.chat.messages.transform": async (input: any, output: any) => {
      // SessionID might be in different locations depending on OpenCode version
      const sessionID = input.sessionID || input.session?.id || output.messages[0]?.info?.sessionID;

      logger.debug("Transform hook called", {
        inputSessionID: input.sessionID,
        extractedSessionID: sessionID,
        messageCount: output.messages.length,
        hasSessionID: !!sessionID,
      });

      for (const message of output.messages) {
        // Only process user messages
        if (message.info.role === "user") {
          // Skip if already processed in chat.message hook
          if (message.parts.some((part: any) => (part as any).snippetsProcessed)) continue;
          // Skip processing if any part is marked as ignored (e.g., command output)
          if (message.parts.some((part: any) => "ignored" in part && part.ignored)) continue;

          const injected = await processTextParts(message.parts);

          // Also collect injections found during transform (e.g. from tool outputs if they contain hashtags)
          if (injected.length > 0 && sessionID) {
            const existing = activeInjections.get(sessionID) || [];
            // Deduplicate to avoid adding same injection multiple times in transform loop
            const newInjections = injected.filter((inv) => !existing.includes(inv));
            if (newInjections.length > 0) {
              activeInjections.set(sessionID, [...existing, ...newInjections]);
            }
          }
        }
      }

      // Inject active injections at the end of the message history
      // WITHOUT synthetic flag so they're visible to the user
      if (sessionID) {
        const injections = activeInjections.get(sessionID);
        logger.debug("Transform hook - checking for injections", {
          sessionID,
          hasInjections: !!injections,
          injectionCount: injections?.length || 0,
          totalSessions: activeInjections.size,
          allSessionIDs: Array.from(activeInjections.keys()),
        });
        if (injections && injections.length > 0) {
          const beforeCount = output.messages.length;
          for (const injectText of injections) {
            output.messages.push({
              info: {
                role: "user",
                sessionID: sessionID,
              } as any,
              parts: [{ type: "text", text: injectText }],
            });
          }
          logger.debug("Injected ephemeral user messages", {
            sessionID,
            injectionCount: injections.length,
            messagesBefore: beforeCount,
            messagesAfter: output.messages.length,
          });
          // DO NOT clear here - let session.idle handle it
        }
      }
    },

    // Clear active injections when the session goes idle
    "session.idle": async ({ sessionID }: { sessionID: string }) => {
      if (activeInjections.has(sessionID)) {
        activeInjections.delete(sessionID);
        logger.debug("Cleared active injections on session idle", { sessionID });
      }
    },

    // Process skill tool output to expand snippets in skill content

    // Process skill tool output to expand snippets in skill content
    "tool.execute.after": async (input, output) => {
      // Only process the skill tool
      if (input.tool !== "skill") return;

      // The skill tool returns markdown content in its output
      // Expand hashtags in the skill content
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
