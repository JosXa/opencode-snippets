import { access, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { createCommandExecuteHandler } from "./src/commands.js";
import { loadConfig } from "./src/config.js";
import { assembleMessage, type ExpandOptions, expandHashtags } from "./src/expander.js";
import type {
  ChatMessageInput,
  ChatMessageOutput,
  MessagePart,
  SystemTransformInput,
  SystemTransformOutput,
  TransformInput,
  TransformOutput,
} from "./src/hook-types.js";
import { InjectionManager } from "./src/injection-manager.js";
import { loadSnippets } from "./src/loader.js";
import { logger } from "./src/logger.js";
import { deleteSessionMessage, deleteSessionPart, sendIgnoredMessage } from "./src/notification.js";
import { refreshPendingDraftsForText } from "./src/pending-drafts.js";
import { consumeSnippetReloadRequest } from "./src/reload-signal.js";
import { executeShellCommands } from "./src/shell.js";
import { SkillLoadManager } from "./src/skill-load-manager.js";
import { loadSkills, type SkillRegistry } from "./src/skill-loader.js";
import { buildSkillPayloadsFromVisibleText, expandSkillLoads } from "./src/skill-loading.js";
import { expandSkillTags } from "./src/skill-renderer.js";

type OpenCodeConfigWithSkillPaths = {
  skills?: { paths?: string[] };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = join(__dirname, "..");
const SKILL_DIR = join(PLUGIN_ROOT, "skill");
const MARKER_ID_RANDOM_FILL = "0000000000";

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
    await access(legacySkillPath);
    await unlink(legacySkillPath);
    logger.debug("Cleaned up legacy skill file", { path: legacySkillPath });

    // Try to remove the empty directory too
    await rmdir(legacySkillDir).catch(() => {
      // Directory not empty or doesn't exist - that's fine
    });
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

  const opencodeSkillDirs: string[] = [];
  const loadRuntimeSkills = () => loadSkills(ctx.directory, { opencodeSkillDirs });

  // Load skills if either skill feature is enabled. The config hook below refreshes this
  // after OpenCode exposes paths registered by earlier plugins.
  let skills: SkillRegistry = new Map();
  if (config.experimental.skillRendering || config.experimental.skillLoading) {
    skills = await loadRuntimeSkills();
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
  const injectionMarkerIdsBySession = new Map<string, Set<string>>();
  const injectionMarkerRenderQueueBySession = new Map<string, Promise<void>>();

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
        if (await consumeSnippetReloadRequest(ctx.directory)) {
          const fresh = await loadSnippets(ctx.directory);
          snippets.clear();
          for (const [key, value] of fresh) {
            snippets.set(key, value);
          }
        }
        await refreshPendingDraftsForText(part.text, snippets, ctx.directory, async () => {
          await loadSnippets(ctx.directory).then((fresh) => {
            snippets.clear();
            for (const [key, value] of fresh) {
              snippets.set(key, value);
            }
          });
        });
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

        // 3. Execute shell commands: !`command` or !>`command`
        const shellStart = performance.now();
        part.text = await executeShellCommands(part.text, { directory: ctx.directory });

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

  const isSkillContentMessage = (message: TransformOutput["messages"][number]): boolean =>
    message.parts.some(
      (part) => part.type === "text" && (part.text || "").includes("<skill_content name="),
    );

  const isInjectionMarkerMessage = (message: TransformOutput["messages"][number]): boolean =>
    isIgnoredMessage(message) &&
    message.parts.some((part) => part.type === "text" && part.text?.startsWith("↳ Injected "));

  const injectionMarkerPartIdsByMessage = (
    messages: TransformOutput["messages"],
  ): Map<string, string[]> => {
    const ids = new Map<string, string[]>();

    for (const message of messages) {
      if (!message.info.id || !isInjectionMarkerMessage(message)) continue;

      const partIds = message.parts
        .filter((part) => part.type === "text" && part.text?.startsWith("↳ Injected "))
        .map((part) => part.id)
        .filter((id): id is string => !!id);
      if (partIds.length > 0) ids.set(message.info.id, partIds);
    }

    return ids;
  };

  const countConversationMessages = (messages: TransformOutput["messages"]): number =>
    messages.filter((message) => !isIgnoredMessage(message)).length;

  const messageIdPrefix = (messageId: string): string | undefined => {
    const match = /^msg_([0-9a-f]{12})/.exec(messageId);
    return match?.[1];
  };

  const markerSuffix = (targetPosition: number, index: number): string => {
    const suffix = `000${(index + 1).toString(36)}`.slice(-3);
    if (targetPosition === 0) return `${MARKER_ID_RANDOM_FILL}${suffix}`;
    return `zzzzzzzzzzz${suffix}`;
  };

  const buildMarkerMessageId = (
    messages: TransformOutput["messages"],
    targetPosition: number,
    index: number,
  ): string | undefined => {
    const realMessages = messages.filter((message) => !isIgnoredMessage(message));
    const pivot = realMessages[Math.max(0, Math.min(realMessages.length - 1, targetPosition - 1))];
    if (!pivot?.info.id) return undefined;

    const prefix = messageIdPrefix(pivot.info.id);
    if (!prefix) return undefined;

    return `msg_${prefix}${markerSuffix(targetPosition, index)}`;
  };

  const getPersistedMessages = async (sessionID: string): Promise<TransformOutput["messages"]> => {
    try {
      const response = await ctx.client.session.messages({ path: { id: sessionID } });
      return (response.data || []).map((message) => ({
        info: message.info,
        parts: message.parts,
      })) as TransformOutput["messages"];
    } catch (error) {
      logger.debug("Failed to load session messages for injection markers", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  const renderInjectionMarkers = async (
    sessionID: string,
    messages: TransformOutput["messages"],
    injections: Array<{ targetPosition: number; snippetName: string }>,
  ): Promise<void> => {
    if (injections.length === 0) return;

    const next = new Set<string>();
    const pending: Array<{ id: string; text: string }> = [];

    injections.forEach((injection, index) => {
      const id = buildMarkerMessageId(messages, injection.targetPosition, index);
      if (!id) return;

      next.add(id);
      pending.push({ id, text: `↳ Injected ${injection.snippetName}` });
    });

    const persistedMarkerIds = messages
      .filter(isInjectionMarkerMessage)
      .map((message) => message.info.id)
      .filter((id): id is string => !!id);
    const persistedMarkerPartIds = injectionMarkerPartIdsByMessage(messages);
    const previous = new Set([
      ...persistedMarkerIds,
      ...(injectionMarkerIdsBySession.get(sessionID) || []),
    ]);
    const kept = new Set<string>();
    const current = new Set<string>();

    logger.debug("Rendering injection markers", {
      sessionID,
      messageCount: countConversationMessages(messages),
      injectionCount: injections.length,
      nextMarkerIds: [...next],
      persistedMarkerIds,
      persistedMarkerPartIds: Object.fromEntries(persistedMarkerPartIds),
      previousMarkerIds: [...previous],
    });

    for (const id of previous) {
      if (!next.has(id)) {
        let deleted = true;
        for (const partId of persistedMarkerPartIds.get(id) || []) {
          const partDeleted = await deleteSessionPart(
            ctx.client,
            ctx.serverUrl,
            sessionID,
            id,
            partId,
          );
          if (!partDeleted) deleted = false;
        }

        const messageDeleted = await deleteSessionMessage(ctx.client, ctx.serverUrl, sessionID, id);
        if (!messageDeleted) deleted = false;
        if (!deleted) kept.add(id);
      }
    }

    if (kept.size > 0) {
      logger.debug("Skipping injection marker creation until stale markers delete", {
        sessionID,
        keptMarkerIds: [...kept],
        nextMarkerIds: [...next],
      });
      injectionMarkerIdsBySession.set(sessionID, kept);
      return;
    }

    for (const marker of pending) {
      current.add(marker.id);
      if (!previous.has(marker.id)) {
        await sendIgnoredMessage(ctx.client, sessionID, marker.text, marker.id);
      }
    }

    injectionMarkerIdsBySession.set(sessionID, current);
  };

  const scheduleInjectionMarkerRender = (
    sessionID: string,
    messages: TransformOutput["messages"],
    injections: Array<{ targetPosition: number; snippetName: string }>,
  ): void => {
    const previous = injectionMarkerRenderQueueBySession.get(sessionID) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) => {
            // User requirement: marker maintenance must not block the real prompt.
            setTimeout(() => {
              renderInjectionMarkers(sessionID, messages, injections).then(resolve, (error) => {
                logger.debug("Failed to render injection markers", {
                  sessionID,
                  error: error instanceof Error ? error.message : String(error),
                });
                resolve();
              });
            }, 0);
          }),
      );

    injectionMarkerRenderQueueBySession.set(sessionID, next);
  };

  const insertInjectionsIntoMessages = (
    messages: TransformOutput["messages"],
    injections: Array<{ targetPosition: number; snippetName: string; content: string }>,
  ): TransformOutput["messages"] => {
    if (injections.length === 0) return messages;

    const totalRealMessages = countConversationMessages(messages);
    const buckets = new Map<number, Array<{ snippetName: string; content: string }>>();
    for (const injection of injections) {
      const position = Math.max(0, Math.min(totalRealMessages, injection.targetPosition));
      const existing = buckets.get(position) || [];
      existing.push(injection);
      buckets.set(position, existing);
    }

    const result: TransformOutput["messages"] = [];
    const prepend = buckets.get(0) || [];
    for (const injection of prepend) {
      result.push({
        info: { role: "user" },
        parts: [{ type: "text", text: injection.content }],
      });
    }

    let seenRealMessages = 0;
    messages.forEach((message) => {
      result.push(message);
      if (isIgnoredMessage(message)) return;
      seenRealMessages += 1;
      const positioned = buckets.get(seenRealMessages) || [];
      for (const injection of positioned) {
        result.push({
          info: { role: "user", sessionID: message.info.sessionID },
          parts: [{ type: "text", text: injection.content }],
        });
      }
    });

    return result;
  };

  const getPartSkillLoads = (parts: MessagePart[]): string[] =>
    parts.flatMap((part) => part.skillLoads || []);

  const getMessageSkillLoads = async (
    sessionID: string,
    message: TransformOutput["messages"][number],
  ): Promise<string[]> => {
    if (isSkillContentMessage(message)) {
      logger.debug("Skipping skill-content message during load resolution", {
        sessionID,
        messageID: message.info.id,
      });
      return [];
    }

    const direct = getPartSkillLoads(message.parts);
    if (direct.length > 0) {
      logger.debug("Resolved skill loads from direct part metadata", {
        sessionID,
        messageID: message.info.id,
        payloadCount: direct.length,
      });
      return direct;
    }

    if (message.info.id) {
      const stored = skillLoadManager.get(sessionID, message.info.id);
      if (stored.length > 0) {
        logger.debug("Resolved skill loads from message-id registry", {
          sessionID,
          messageID: message.info.id,
          payloadCount: stored.length,
        });
        return stored;
      }
    }

    if (!config.experimental.skillLoading || skills.size === 0) return [];

    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("\n\n");

    const recovered = await buildSkillPayloadsFromVisibleText(text, skills, snippets, {
      expandSkillTagsInContent: config.experimental.skillRendering,
      extractInject: config.experimental.injectBlocks,
    });

    if (recovered.length > 0) {
      logger.debug("Recovered hidden skill payloads from visible markers", {
        sessionID,
        messageID: message.info.id,
        payloadCount: recovered.length,
      });
    }

    if (recovered.length === 0 && text.includes("↳ Loaded ")) {
      logger.debug("Visible skill markers found but no hidden payloads recovered", {
        sessionID,
        messageID: message.info.id,
        text,
      });
    }

    return recovered;
  };

  const insertSkillLoadsIntoMessages = async (
    sessionID: string,
    messages: TransformOutput["messages"],
  ): Promise<TransformOutput["messages"]> => {
    const pendingRaw = skillLoadManager.drainPending(sessionID);
    const result: TransformOutput["messages"] = [];
    const resolvedLoads = await Promise.all(
      messages.map(async (message) => {
        if (message.info.role !== "user" || isIgnoredMessage(message)) {
          return [] as string[];
        }

        return getMessageSkillLoads(sessionID, message);
      }),
    );
    logger.debug("Resolved skill loads for transform messages", {
      sessionID,
      messages: messages.map((message, i) => ({
        messageID: message.info.id,
        role: message.info.role,
        synthetic: message.parts.some((part) => part.synthetic),
        snippetsProcessed: message.parts.some((part) => part.snippetsProcessed),
        text: message.parts
          .filter((part) => part.type === "text")
          .map((part) => (part.text || "").slice(0, 120))
          .join(" | "),
        resolvedLoadCount: (resolvedLoads[i] || []).length,
      })),
    });

    // Dedup requirement: if a queued payload string already exists as a direct
    // skillLoad on any user message (because chat.message attached it to part.skillLoads),
    // a synthetic for that message will be pushed via the `direct` path below.
    // We must NOT also push a fallback synthetic for the same payload, otherwise
    // OpenCode's fresh-session flow (which seems to fire chat.message both with and
    // without messageID) ends up with the skill_content duplicated and stuck onto
    // an unrelated user message like beads-context.
    const directPayloadStrings = new Set<string>();
    for (const [i, message] of messages.entries()) {
      if (message.info.role !== "user" || isIgnoredMessage(message)) continue;
      for (const payload of resolvedLoads[i] || []) {
        directPayloadStrings.add(payload);
      }
    }

    const pending = pendingRaw.filter((entry) => {
      if (entry.payloads.length === 0) return false;
      // If every payload string in this entry is already attached directly to
      // some user message, the synthetic will be emitted there. Drop the dup.
      return entry.payloads.some((p) => !directPayloadStrings.has(p));
    });

    if (pending.length !== pendingRaw.length) {
      logger.debug("Dropped duplicate queued skill payloads", {
        sessionID,
        before: pendingRaw.length,
        after: pending.length,
      });
    }

    const fallbackByIndex = new Map<number, string[]>();
    if (pending.length > 0) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.info.role !== "user" || isIgnoredMessage(message)) continue;
        if ((resolvedLoads[i] || []).length > 0) continue;

        const next = pending.at(-1);
        if (!next) break;

        if (next.messageID && message.info.id && next.messageID !== message.info.id) {
          continue;
        }

        pending.pop();
        fallbackByIndex.set(i, next.payloads);
      }

      while (pending.length > 0) {
        const next = pending.pop();
        if (!next) break;

        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const message = messages[i];
          if (message.info.role !== "user" || isIgnoredMessage(message)) continue;
          if ((resolvedLoads[i] || []).length > 0) continue;
          if (fallbackByIndex.has(i)) continue;
          fallbackByIndex.set(i, next.payloads);
          break;
        }
      }
    }

    for (const [i, message] of messages.entries()) {
      if (message.info.role !== "user" || isIgnoredMessage(message)) {
        result.push(message);
        continue;
      }

      const direct = resolvedLoads[i] || [];
      const payloads = direct.length > 0 ? direct : fallbackByIndex.get(i) || [];
      if (payloads.length === 0) {
        result.push(message);
        continue;
      }

      skillLoadManager.rememberForSession(sessionID, payloads);

      const hiddenText = payloads.join("\n\n");
      if (
        message.parts.some(
          (part) => part.type === "text" && part.synthetic && (part.text || "") === hiddenText,
        )
      ) {
        logger.debug("Hidden skill payload already attached to user message", {
          sessionID,
          messageID: message.info.id,
          hiddenLength: hiddenText.length,
        });
        result.push(message);
        continue;
      }

      // Regression guard from the PTY repro:
      // 1. skill content must stay hidden from the user,
      // 2. skill content must be injected immediately below the visible user message and reach the LLM,
      // 3. the agent must not call `skill` a second time for an already-loaded skill.
      logger.debug("Appended hidden skill payload to user message", {
        sessionID,
        messageID: message.info.id,
        partCountBefore: message.parts.length,
        partCountAfter: message.parts.length + 1,
        hiddenLength: hiddenText.length,
      });
      result.push({
        ...message,
        parts: [{ type: "text", text: hiddenText, synthetic: true }, ...message.parts],
      });
    }

    return result;
  };

  return {
    // Register /snippets commands and skill path
    config: async (opencodeConfig) => {
      // Register skill folder path for automatic discovery
      const cfg = opencodeConfig as typeof opencodeConfig & OpenCodeConfigWithSkillPaths;
      cfg.skills ??= {};
      cfg.skills.paths ??= [];
      cfg.skills.paths.push(SKILL_DIR);

      opencodeSkillDirs.length = 0;
      opencodeSkillDirs.push(...cfg.skills.paths);
      if (config.experimental.skillRendering || config.experimental.skillLoading) {
        skills = await loadRuntimeSkills();
      }

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
      logger.debug("chat.message processed user parts", {
        sessionID: input.sessionID,
        messageID: input.messageID,
        texts: output.parts
          .filter((part) => part.type === "text")
          .map((part) => ({
            text: (part.text || "").slice(0, 200),
            skillLoads: part.skillLoads?.length || 0,
          })),
      });

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
          skillLoadManager.queue(input.sessionID, payloads, input.messageID);
        }
      }

      injectionManager.registerAndGetNew(input.sessionID, injected);

      if (config.experimental.injectBlocks) {
        const persisted = await getPersistedMessages(input.sessionID);
        const current = {
          info: {
            id: output.message.id,
            role: output.message.role,
            sessionID: output.message.sessionID || input.sessionID,
          },
          parts: output.parts,
        };
        const messages = [...persisted, current];
        const messageCount = countConversationMessages(messages);
        const { injections } = injectionManager.getRenderableInjections(
          input.sessionID,
          messageCount,
          config.injectRecencyMessages,
        );
        scheduleInjectionMarkerRender(input.sessionID, messages, injections);
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
          if (message.parts.some((part) => part.synthetic)) continue;

          const injected = await processTextParts(message.parts);

          if (injected.length > 0 && sessionID) {
            injectionManager.registerAndGetNew(sessionID, injected);
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
          output.messages = await insertSkillLoadsIntoMessages(sessionID, output.messages);
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

    "experimental.chat.system.transform": async (
      input: SystemTransformInput,
      output: SystemTransformOutput,
    ) => {
      if (!config.experimental.skillLoading) return;
      if (!input.sessionID) return;

      const payloads = skillLoadManager.getSessionPayloads(input.sessionID);
      if (payloads.length === 0) return;

      const hiddenText = payloads.join("\n\n");
      if (output.system.includes(hiddenText)) {
        logger.debug("Hidden skill payloads already present in system prompt", {
          sessionID: input.sessionID,
          payloadCount: payloads.length,
          hiddenLength: hiddenText.length,
        });
        return;
      }

      output.system.push(hiddenText);
      logger.debug("Mirrored hidden skill payloads into system prompt", {
        sessionID: input.sessionID,
        payloadCount: payloads.length,
        hiddenLength: hiddenText.length,
        systemEntryCount: output.system.length,
      });
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

const plugin: PluginModule & { id: string } = {
  id: "opencode-snippets",
  server: SnippetsPlugin,
};

export const server = SnippetsPlugin;
export default plugin;
