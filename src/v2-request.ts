import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import type { Plugin as EffectPlugin } from "@opencode/plugin/effect";
import { Effect, type Scope, Stream } from "effect";
import { loadConfig } from "./config.js";
import { assembleMessage, expandHashtags } from "./expander.js";
import { getSnippetForm } from "./fields.js";
import { type Invocation, parseInvocation } from "./invocation.js";
import { LiteralStore } from "./literals.js";
import { loadSnippets } from "./loader.js";
import { logger } from "./logger.js";
import { executeShellCommands } from "./shell.js";
import { loadFromDirectory, type SkillRegistry } from "./skill-loader.js";
import { expandSkillLoads } from "./skill-loading.js";
import { expandSkillTags } from "./skill-renderer.js";
import type { SnippetRegistry } from "./types.js";
import { executeV2SnippetCommand, isV2SnippetCommand } from "./v2-command.js";
import { nativeSkillRegistry } from "./v2-skills.js";
import { type Processed as DurableProcessed, DurableStore, type TextPatch } from "./v2-state.js";

const PROCESSED = "opencode-snippets:processed";
const SUBMITTED = "opencode-snippets:submitted";
const GENERATED = "opencode-snippets:generated";

type Processed = {
  text: string[];
  hidden: string[];
  injections: Array<{ name: string; content: string }>;
};

type Submitted = Omit<Processed, "text"> & { text: string };

function createTextPatch(original: string, output: string): TextPatch {
  let start = 0;
  while (start < original.length && start < output.length && original[start] === output[start])
    start++;
  let end = original.length;
  let outputEnd = output.length;
  while (end > start && outputEnd > start && original[end - 1] === output[outputEnd - 1]) {
    end--;
    outputEnd--;
  }
  return { start, end, replacement: output.slice(start, outputEnd) };
}

function minimizeProcessed(original: string[], result: Processed): DurableProcessed {
  return {
    patches: result.text.map((text, index) => createTextPatch(original[index] ?? "", text)),
    hidden: result.hidden,
    injections: result.injections,
  };
}

function restoreProcessed(original: string[], result: DurableProcessed): Processed {
  return {
    text: result.patches.map((patch, index) => {
      const text = original[index] ?? "";
      return `${text.slice(0, patch.start)}${patch.replacement}${text.slice(patch.end)}`;
    }),
    hidden: result.hidden,
    injections: result.injections,
  };
}

type MutableMessage = {
  id?: string;
  role: string;
  content: Array<
    | { type: "text"; text: string; metadata?: Record<string, unknown> }
    | { type: string; [key: string]: unknown }
  >;
  metadata?: Record<string, unknown>;
};

export interface V2SetupOptions {
  directory?: string;
  /** Explicit discovery roots keep tests and embedded runtimes away from the host user's files. */
  globalDirectory?: string;
  homeDirectory?: string;
  dataDirectory?: string;
  skillDirectory: string;
}

export type V2Cleanup = (() => Promise<void>) & {
  deleteSession: (sessionID: string, directory?: string) => Promise<void>;
};

export async function setupV2Snippets(
  context: Plugin.Context,
  options: V2SetupOptions,
): Promise<V2Cleanup> {
  type Runtime = {
    directory: string;
    config: ReturnType<typeof loadConfig>;
    snippets: Awaited<ReturnType<typeof loadSnippets>>;
    skills: SkillRegistry;
  };
  const sessionDirectories = new Map<string, string>();
  const processed = new Map<string, Map<string, Processed>>();
  const activeInjections = new Map<string, Array<{ name: string; content: string }>>();
  const stores = new Map<string, DurableStore>();
  const globalConfigFile = options.globalDirectory
    ? join(options.globalDirectory, "config.jsonc")
    : undefined;

  const directoryFor = async (sessionID: string) => {
    let directory = options.directory;
    if (!directory) {
      const session = await context.session.get({ sessionID });
      directory = session.location?.directory;
    }
    if (!directory)
      throw new Error(`Unable to resolve project directory for session ${sessionID}.`);
    directory = await realpath(directory);
    sessionDirectories.set(sessionID, directory);
    return directory;
  };

  const runtimeFor = async (sessionID: string): Promise<Runtime> => {
    const directory = await directoryFor(sessionID);
    const config = loadConfig(directory, globalConfigFile);
    logger.debugEnabled ||= config.logging.debug;
    // TUI commands and draft edits happen in another process. Read current files
    // for new work; durable results retain the original expansion on replay.
    const snippets = await loadSnippets(directory, options.globalDirectory);
    const skills =
      config.experimental.skillLoading ||
      config.experimental.skillRendering ||
      [...snippets.values()].some((snippet) => /\{\{[~#]?\s*skill\b/.test(snippet.content))
        ? nativeSkillRegistry((await context.skill.list({ location: { directory } })).data)
        : new Map();
    return { directory, config, snippets, skills };
  };

  const forgetSession = async (sessionID: string, eventDirectory?: string) => {
    const unresolvedDirectory = sessionDirectories.get(sessionID) ?? eventDirectory;
    sessionDirectories.delete(sessionID);
    processed.delete(sessionID);
    activeInjections.delete(sessionID);
    if (!unresolvedDirectory) return;
    const directory = await realpath(unresolvedDirectory);
    const store = stores.get(directory) ?? new DurableStore(directory, options);
    await store.deleteSession(sessionID);
  };

  // The beta skill editor accepts complete skills, not discovery directories.
  const bundledSkills: SkillRegistry = new Map();
  await loadFromDirectory(options.skillDirectory, bundledSkills, "global");
  // Processing submission text must not activate context effects: a queued
  // prompt may not belong to the turn currently being sent to the model.
  const processText = async (sessionID: string, key: string, originalText: string[]) => {
    const directory = await directoryFor(sessionID);
    let store = stores.get(directory);
    if (!store) {
      store = new DurableStore(directory, options);
      stores.set(directory, store);
    }
    const durableResult = await store.process(sessionID, key, {
      prepare: async () => {
        const { config, snippets, skills } = await runtimeFor(sessionID);
        const executionSnippets = new Map(snippets);
        const overlay = new Map<string, string | null>();
        const injections: Processed["injections"] = [];
        const hidden: string[] = [];
        const parts: Array<{ command: string } | { text: string; literals: LiteralStore }> = [];
        for (const original of originalText) {
          if (isV2SnippetCommand(original)) {
            // Use the same command and loader logic over virtual files, so later
            // parts see creations, aliases and deletion fallbacks before effects.
            await executeV2SnippetCommand(
              original,
              snippets,
              directory,
              options.globalDirectory,
              overlay,
            );
            if (
              !skills.size &&
              [...snippets.values()].some((snippet) => /\{\{[~#]?\s*skill\b/.test(snippet.content))
            ) {
              for (const [name, skill] of nativeSkillRegistry(
                (await context.skill.list({ location: { directory } })).data,
              ))
                skills.set(name, skill);
            }
            parts.push({ command: original });
            continue;
          }
          const literals = new LiteralStore();
          let text = assembleMessage(
            expandHashtags(
              config.experimental.skillRendering
                ? renderDirectSkillTags(original, snippets, skills)
                : original,
              snippets,
              new Map(),
              {
                literals,
                skill: (name) => {
                  const skill = skills.get(name.toLowerCase());
                  if (!skill) throw new Error(`Unknown inline skill '${name}'`);
                  return skill.content;
                },
                extractInject: config.experimental.injectBlocks,
                onInjectBlock: (block) =>
                  injections.push({
                    name: block.snippetName,
                    content: literals.restore(block.content),
                  }),
              },
            ),
          );
          // Hashtag expansion reserves #skill(...). Resolve all loads together so
          // direct, recursive, prepend and append loads follow the visible order.
          if (config.experimental.skillLoading) {
            const loaded = await expandSkillLoads(text, skills, snippets, {
              expandSkillTagsInContent: config.experimental.skillRendering,
              extractInject: config.experimental.injectBlocks,
            });
            text = loaded.text;
            hidden.push(...loaded.payloads.map((payload) => literals.restore(payload)));
          }
          parts.push({ text, literals });
        }
        return { parts, snippets: executionSnippets, hidden, injections };
      },
      execute: async ({ parts, snippets, hidden, injections }) => {
        const transformedText: string[] = [];
        // Prepare every text part before commands or shell from any part can run.
        for (const part of parts) {
          if ("command" in part) {
            const command = await executeV2SnippetCommand(
              part.command,
              snippets,
              directory,
              options.globalDirectory,
            );
            transformedText.push(`[opencode-snippets command completed]\n${command}`);
            continue;
          }
          transformedText.push(
            part.literals.restore(await executeShellCommands(part.text, { directory })),
          );
        }
        return minimizeProcessed(originalText, { text: transformedText, hidden, injections });
      },
    });
    return restoreProcessed(originalText, durableResult);
  };

  const expandContext = async (request: { sessionID: string; messages: unknown[] }) => {
    const config = loadConfig(await directoryFor(request.sessionID), globalConfigFile);
    const sessionProcessed = processed.get(request.sessionID) ?? new Map<string, Processed>();
    processed.set(request.sessionID, sessionProcessed);
    const messages = request.messages as MutableMessage[];
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].metadata?.[GENERATED]) messages.splice(index, 1);
    }
    const history = [...messages];
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.role !== "user" || message.metadata?.[GENERATED]) continue;
      const submitted = asSubmitted(message.metadata?.[SUBMITTED]);
      if (submitted) {
        // OC2 has already persisted the expanded prompt. Its model message may
        // prepend native skills and append attachments (or omit empty text).
        // Restore only hidden effects; never replay prompt text by part index.
        if (submitted.hidden.length) {
          messages.splice(index + 1, 0, generatedMessage(submitted.hidden.join("\n\n")));
        }
        activateInjections(activeInjections, request.sessionID, submitted.injections);
        continue;
      }
      const key = messageKey(message, index);
      const metadataResult = asProcessed(message.metadata?.[PROCESSED]);
      const cached = metadataResult ?? sessionProcessed.get(key);
      if (cached) {
        let textIndex = 0;
        for (const part of message.content) {
          if (part.type === "text" && typeof part.text === "string") {
            part.text = cached.text[textIndex++] ?? part.text;
          }
        }
        if (cached.hidden.length) {
          messages.splice(index + 1, 0, generatedMessage(cached.hidden.join("\n\n")));
        }
        activateInjections(activeInjections, request.sessionID, cached.injections);
        message.metadata = { ...message.metadata, [PROCESSED]: cached };
        continue;
      }

      const originalText = message.content.flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : [],
      );
      const result = await processText(request.sessionID, key, originalText);
      let textIndex = 0;
      for (const part of message.content) {
        if (part.type === "text" && typeof part.text === "string") {
          part.text = result.text[textIndex++] ?? part.text;
        }
      }
      sessionProcessed.set(key, result);
      message.metadata = { ...message.metadata, [PROCESSED]: result };
      activateInjections(activeInjections, request.sessionID, result.injections);
      if (result.hidden.length) {
        messages.splice(index + 1, 0, generatedMessage(result.hidden.join("\n\n")));
      }
      // V2 can rebuild the full durable history. Keep walking so every prior
      // user message is restored, while this cache keeps side effects one-shot.
    }

    const injections = activeInjections.get(request.sessionID) ?? [];
    // Hidden skill payloads must not shift the recency window or separate a
    // submitted message from its skill context.
    const target = history[Math.max(0, history.length - Math.max(1, config.injectRecencyMessages))];
    messages.splice(
      target ? messages.indexOf(target) : 0,
      0,
      ...injections.map((item) => generatedMessage(item.content, "injection")),
    );
  };
  const registrations = await Promise.all([
    context.skill.transform((draft) => {
      for (const skill of bundledSkills.values()) {
        draft.add({
          id: skill.filePath as never,
          name: skill.name as never,
          description: skill.description,
          location: skill.filePath as never,
          content: skill.content,
        });
      }
    }),
    context.session.hook("prompt", async (submission) => {
      // Expand the submitted text itself, not just the later model-context copy,
      // so the persisted/visible message has the same replacement as the model.
      const previous = asSubmitted(submission.metadata?.[SUBMITTED]);
      if (previous?.text === submission.prompt.text) return;
      const key = `prompt:${createHash("sha256")
        .update(JSON.stringify([submission.messageID, submission.prompt.text]))
        .digest("hex")}`;
      const result = await processText(submission.sessionID, key, [submission.prompt.text]);
      submission.prompt.text = result.text[0];
      const submitted: Submitted = {
        text: submission.prompt.text,
        hidden: result.hidden,
        injections: result.injections,
      };
      submission.metadata = { ...submission.metadata, [SUBMITTED]: submitted };
    }),
    context.session.hook("context", expandContext),
    context.tool.hook("execute.after", async (event) => {
      if (event.tool !== "skill" || event.status !== "completed") return;
      const { snippets, skills, config } = await runtimeFor(event.sessionID);
      expandToolResult(
        event.result as unknown,
        snippets,
        skills,
        config.experimental.skillRendering,
        config.experimental.injectBlocks,
      );
    }),
  ]);

  const eventsAbort = new AbortController();
  const eventLoop = async () => {
    for await (const event of context.event.subscribe({ signal: eventsAbort.signal })) {
      if (event.type === "session.deleted") {
        await forgetSession(event.data.sessionID, event.location?.directory).catch((error) => {
          logger.warn("Failed to delete durable snippet session state", {
            sessionID: event.data.sessionID,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  };
  void eventLoop().catch(() => {
    // Event streams end during normal plugin/server shutdown.
  });

  const cleanup = Object.assign(
    async () => {
      eventsAbort.abort();
      sessionDirectories.clear();
      processed.clear();
      activeInjections.clear();
      stores.clear();
      await Promise.all(registrations.map((registration) => registration.dispose()));
    },
    { deleteSession: forgetSession },
  );
  return cleanup;
}

function asProcessed(value: unknown): Processed | undefined {
  if (!value || typeof value !== "object") return;
  const candidate = value as Partial<Processed>;
  if (!Array.isArray(candidate.text) || !candidate.text.every((item) => typeof item === "string"))
    return;
  if (
    !Array.isArray(candidate.hidden) ||
    !candidate.hidden.every((item) => typeof item === "string")
  )
    return;
  if (!Array.isArray(candidate.injections)) return;
  return candidate as Processed;
}

function asSubmitted(value: unknown): Submitted | undefined {
  if (!value || typeof value !== "object") return;
  const candidate = value as Partial<Submitted>;
  if (typeof candidate.text !== "string") return;
  if (!asProcessed({ ...candidate, text: [candidate.text] })) return;
  return candidate as Submitted;
}

function activateInjections(
  activeInjections: Map<string, Array<{ name: string; content: string }>>,
  sessionID: string,
  injections: Array<{ name: string; content: string }>,
): void {
  if (!injections.length) return;
  const active = activeInjections.get(sessionID) ?? [];
  for (const injection of injections) {
    if (
      !active.some((item) => item.name === injection.name && item.content === injection.content)
    ) {
      active.push(injection);
    }
  }
  activeInjections.set(sessionID, active);
}

/** Adapt the deterministic Promise setup to V2's scoped Effect plugin host. */
export function setupV2SnippetsEffect(
  context: EffectPlugin.Context,
  options: V2SetupOptions,
): Effect.Effect<void, never, Scope.Scope> {
  type Callback = (input: never) => Promise<void> | void;
  let contextCallback: Callback | undefined;
  let promptCallback: Callback | undefined;
  let toolCallback: Callback | undefined;
  let skillCallback: ((draft: never) => void) | undefined;
  const registration = { dispose: async () => undefined };

  const promiseContext = {
    ...context,
    session: {
      ...context.session,
      get: (input: never) => Effect.runPromise(context.session.get(input)),
      hook: (name: string, callback: Callback) => {
        if (name === "context") contextCallback = callback;
        if (name === "prompt") promptCallback = callback;
        return Promise.resolve(registration);
      },
    },
    tool: {
      ...context.tool,
      hook: (name: string, callback: Callback) => {
        if (name === "execute.after") toolCallback = callback;
        return Promise.resolve(registration);
      },
    },
    skill: {
      ...context.skill,
      list: (input: never) => Effect.runPromise(context.skill.list(input)),
      transform: (callback: (draft: never) => void) => {
        skillCallback = callback;
        return Promise.resolve(registration);
      },
    },
    event: {
      subscribe: ({ signal }: { signal?: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      }),
    },
  } as unknown as Plugin.Context;

  return Effect.gen(function* () {
    const cleanup = yield* Effect.promise(() => setupV2Snippets(promiseContext, options));
    if (skillCallback) {
      yield* context.skill.transform((draft) => skillCallback?.(draft as never));
    }
    if (promptCallback) {
      yield* context.session.hook("prompt", (input) =>
        Effect.promise(() => Promise.resolve(promptCallback?.(input as never))),
      );
    }
    if (contextCallback) {
      yield* context.session.hook("context", (input) =>
        Effect.promise(() => Promise.resolve(contextCallback?.(input as never))),
      );
    }
    if (toolCallback) {
      yield* context.tool.hook("execute.after", (input) =>
        Effect.promise(() => Promise.resolve(toolCallback?.(input as never))),
      );
    }
    yield* context.event.subscribe().pipe(
      // The exported Effect entry must consume the host's real lifecycle stream.
      Stream.runForEach((event) =>
        event.type === "session.deleted"
          ? Effect.promise(() =>
              cleanup
                .deleteSession(event.data.sessionID, event.location?.directory)
                .catch((error) => {
                  logger.warn("Failed to delete durable snippet session state", {
                    sessionID: event.data.sessionID,
                    error: error instanceof Error ? error.message : String(error),
                  });
                }),
            )
          : Effect.void,
      ),
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Effect.promise(cleanup));
  });
}

function messageKey(message: MutableMessage, index: number): string {
  // Submission expansion changes the persisted text. A patch for the original
  // hashtag must never be replayed against expanded text (or an edited message).
  const digest = createHash("sha256")
    .update(`${message.id ?? index}:${JSON.stringify(message.content)}`)
    .digest("hex");
  return `content:${digest}`;
}

function generatedMessage(text: string, kind = "skill"): MutableMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    metadata: { [GENERATED]: kind },
  };
}

function expandToolResult(
  value: unknown,
  snippets: SnippetRegistry,
  skills: SkillRegistry,
  renderSkills: boolean,
  extractInject: boolean,
): void {
  if (!value || typeof value !== "object") return;
  for (const key of ["output", "text", "value"] as const) {
    const record = value as Record<string, unknown>;
    if (typeof record[key] !== "string") continue;
    const literals = new LiteralStore();
    const source = renderSkills
      ? renderDirectSkillTags(record[key] as string, snippets, skills)
      : (record[key] as string);
    const text = assembleMessage(
      expandHashtags(source, snippets, new Map(), {
        extractInject,
        literals,
        skill: (name) => {
          const skill = skills.get(name.toLowerCase());
          if (!skill) throw new Error(`Unknown inline skill '${name}'`);
          return skill.content;
        },
      }),
    );
    record[key] = literals.restore(text);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child)
        expandToolResult(item, snippets, skills, renderSkills, extractInject);
    } else if (child && typeof child === "object") {
      expandToolResult(child, snippets, skills, renderSkills, extractInject);
    }
  }
}

/** Retain the legacy XML stage while excluding the self-contained argument text. */
function renderDirectSkillTags(
  text: string,
  snippets: SnippetRegistry,
  skills: SkillRegistry,
): string {
  const literals = new LiteralStore();
  let end = 0;
  let masked = "";
  for (const match of text.matchAll(/#([a-z0-9][a-z0-9_-]*)/gi)) {
    if (
      match.index < end ||
      !snippets.has(match[1].toLowerCase()) ||
      match[1].toLowerCase() === "skill"
    )
      continue;
    if (
      !getSnippetForm(match[1], snippets).fields.length &&
      !/^\(\s*[A-Za-z][A-Za-z0-9_]*\s*=/.test(text.slice(match.index + match[0].length))
    )
      continue;
    const invocation = parseInvocation(text, match.index) as Invocation;
    masked +=
      text.slice(end, match.index) + literals.protect(text.slice(match.index, invocation.end));
    end = invocation.end;
  }
  return literals.restore(expandSkillTags(masked + text.slice(end), skills));
}

/** Small deterministic seam used by tests and the V2 request-context hook. */
export async function expandRequestMessages(
  messages: unknown[],
  snippets: SnippetRegistry,
  directory?: string,
): Promise<boolean> {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as {
      role?: string;
      type?: string;
      content?: unknown;
      text?: unknown;
    };
    if (message.role !== "user" && message.type !== "user") continue;
    const parts = Array.isArray(message.content) ? message.content : undefined;
    if (parts) {
      let changed = false;
      for (const part of parts) {
        if (part?.type !== "text" || typeof part.text !== "string") continue;
        part.text = await expandPlainText(part.text, snippets, directory);
        changed = true;
      }
      return changed;
    }
    if (typeof message.content === "string") {
      message.content = await expandPlainText(message.content, snippets, directory);
      return true;
    }
    if (typeof message.text === "string") {
      message.text = await expandPlainText(message.text, snippets, directory);
      return true;
    }
    return false;
  }
  return false;
}

async function expandPlainText(
  text: string,
  snippets: SnippetRegistry,
  directory?: string,
): Promise<string> {
  const literals = new LiteralStore();
  return literals.restore(
    await executeShellCommands(
      assembleMessage(
        expandHashtags(text, snippets, new Map(), { extractInject: false, literals }),
      ),
      { directory },
    ),
  );
}
