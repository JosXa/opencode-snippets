import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { Effect, Queue, Stream } from "effect";
import type { SnippetRegistry } from "./types.js";
import { expandRequestMessages, setupV2Snippets, setupV2SnippetsEffect } from "./v2-request.js";
import { DurableStore } from "./v2-state.js";

const snippets: SnippetRegistry = new Map([
  [
    "proof",
    {
      name: "proof",
      description: "V2 request proof",
      content: "EXPANDED_BY_V2_REQUEST_HOOK",
      source: "project",
      filePath: "/tmp/proof.md",
      aliases: [],
    },
  ],
]);

// Mirrors OC2 session/runner/to-llm-message.ts: native skills precede nonempty
// prompt text; text attachments follow it, and message metadata survives intact.
function nativeUser(
  submission: { messageID: string; prompt: { text: string }; metadata?: Record<string, unknown> },
  skills: string[] = [],
) {
  return {
    id: submission.messageID,
    role: "user",
    metadata: structuredClone(submission.metadata),
    content: [
      ...skills.map((text) => ({ type: "text", text })),
      ...(submission.prompt.text === "" ? [] : [{ type: "text", text: submission.prompt.text }]),
      {
        type: "text",
        text: "\n\nAttached file: notes.txt\n\nATTACHMENT #chosen",
        metadata: {
          attachment: { source: { type: "inline" }, name: "notes.txt", description: undefined },
        },
      },
    ],
  };
}

async function submissionFixture() {
  const directory = await mkdtemp(join(tmpdir(), "snippets-native-submission-"));
  const snippetDirectory = join(directory, ".opencode", "snippet");
  const skillDirectory = join(directory, "skills");
  await mkdir(snippetDirectory, { recursive: true });
  await mkdir(join(skillDirectory, "hidden"), { recursive: true });
  await writeFile(join(snippetDirectory, "chosen.md"), "CHOSEN_TEXT");
  await writeFile(
    join(snippetDirectory, "queued.md"),
    "queued visible <inject>QUEUED_INJECTION</inject>",
  );
  await writeFile(
    join(snippetDirectory, "config.jsonc"),
    JSON.stringify({ experimental: { injectBlocks: true, skillLoading: true } }),
  );
  await writeFile(
    join(skillDirectory, "hidden", "SKILL.md"),
    "---\nname: hidden\ndescription: Hidden skill\n---\nDURABLE_HIDDEN_SKILL",
  );
  const hooks = new Map<string, (input: never) => Promise<void>>();
  const registration = { dispose: async () => {} };
  const skills = [
    {
      id: "hidden",
      name: "hidden",
      description: "Hidden skill",
      location: join(skillDirectory, "hidden", "SKILL.md"),
      content: "DURABLE_HIDDEN_SKILL",
    },
  ];
  const context = {
    session: {
      get: async () => ({ location: { directory } }),
      hook: async (name: string, callback: (input: never) => Promise<void>) => {
        hooks.set(name, callback);
        return registration;
      },
    },
    skill: {
      transform: async () => registration,
      list: async ({ location }: { location: { directory: string } }) => {
        expect(location.directory).toBe(directory);
        return { data: skills };
      },
    },
    tool: {
      hook: async (name: string, callback: (input: never) => Promise<void>) => {
        hooks.set(name, callback);
        return registration;
      },
    },
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
  };
  const start = () =>
    setupV2Snippets(context as never, {
      directory,
      skillDirectory,
      globalDirectory: join(directory, "global"),
      homeDirectory: join(directory, "home"),
      dataDirectory: join(directory, "data"),
    });
  let cleanup = await start();
  return {
    directory,
    skills,
    invoke: async (name: string, input: unknown) => {
      const hook = hooks.get(name);
      if (hook) await hook(input as never);
    },
    restart: async () => {
      await cleanup();
      cleanup = await start();
    },
    dispose: async () => {
      await cleanup();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("native OC2 submitted messages", () => {
  test("keeps mixed direct, recursive and block skill payloads in visible order", async () => {
    const host = await submissionFixture();
    try {
      host.skills.push({ ...host.skills[0], id: "other-id", name: "Other", content: "OTHER_BODY" });
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "leaf.md"), "#skill(hidden)");
      await Bun.write(
        join(directory, "outer.md"),
        '<prepend>#leaf</prepend>BODY<append>#skill("other-id")</append>',
      );
      await Bun.write(join(directory, "skill.md"), "WRONG_SNIPPET");
      const submission = {
        sessionID: "ordered",
        messageID: "ordered-message",
        prompt: { text: '#outer #skill("Other") #leaf' },
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(
        "↳ Loaded hidden\n\nBODY ↳ Loaded Other ↳ Loaded hidden\n\n↳ Loaded Other",
      );
      const request = { sessionID: "ordered", messages: [nativeUser(submission)] };
      await host.invoke("context", request);
      expect(
        [...request.messages[1].content[0].text.matchAll(/<skill_content name="([^"]+)">/g)].map(
          (match) => match[1],
        ),
      ).toEqual(["hidden", "Other", "hidden", "Other"]);
    } finally {
      await host.dispose();
    }
  });

  test("refreshes nested files and completed drafts without changing durable results", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "parent.md"), "#child #draft");
      await Bun.write(join(directory, "child.md"), "OLD");
      await Bun.write(join(directory, "draft.md"), "");
      const first = { sessionID: "refresh", messageID: "first", prompt: { text: "#parent" } };
      await host.invoke("prompt", first);
      expect(first.prompt.text).toBe("OLD #draft");
      await Bun.write(join(directory, "child.md"), "NEW !`printf x >> refresh-count; printf ONCE`");
      await Bun.write(join(directory, "draft.md"), "#skill(hidden)");
      const second = { sessionID: "refresh", messageID: "second", prompt: { text: "#parent" } };
      await host.invoke("prompt", second);
      expect(second.prompt.text).toBe("NEW ONCE ↳ Loaded hidden");
      await host.restart();
      // Retry the original admission, including its raw text, after files changed.
      const replay = { sessionID: "refresh", messageID: "first", prompt: { text: "#parent" } };
      await host.invoke("prompt", replay);
      expect(replay.prompt.text).toBe("OLD #draft");
      await host.invoke("context", {
        sessionID: "refresh",
        messages: [nativeUser(first), nativeUser(second)],
      });
      expect(await Bun.file(join(host.directory, "refresh-count")).text()).toBe("x");
      await rm(join(directory, "child.md"));
      const third = { sessionID: "refresh", messageID: "third", prompt: { text: "#parent" } };
      await host.invoke("prompt", third);
      expect(third.prompt.text).toBe("#child ↳ Loaded hidden");
    } finally {
      await host.dispose();
    }
  });

  test("uses native skill IDs and refreshed host content rather than a second filesystem registry", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "native.md"), '#skill("plugin:remote")');
      host.skills.push({
        ...host.skills[0],
        id: "plugin:remote",
        name: "Remote",
        content: "HOST_ONLY",
      });
      const submission = {
        sessionID: "native-registry",
        messageID: "first",
        prompt: { text: "#native" },
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe("↳ Loaded Remote");
      host.skills[1].content = "HOST_UPDATED";
      const next = {
        sessionID: "native-registry",
        messageID: "second",
        prompt: { text: "#native" },
      };
      await host.invoke("prompt", next);
      const request = {
        sessionID: "native-registry",
        messages: [nativeUser(submission), nativeUser(next)],
      };
      await host.invoke("context", request);
      expect(request.messages[1].content[0].text).toContain("HOST_ONLY");
      expect(request.messages[3].content[0].text).toContain("HOST_UPDATED");
    } finally {
      await host.dispose();
    }
  });

  test("restores injection order and measures recency using real messages after restart", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks: true, skillLoading: true },
          injectRecencyMessages: 2,
        }),
      );
      await Bun.write(
        join(directory, "first.md"),
        "FIRST<inject>OLD_CONTEXT</inject>#skill(hidden)",
      );
      await Bun.write(
        join(directory, "second.md"),
        "SECOND<inject>NEW_CONTEXT</inject>#skill(hidden)",
      );
      const first = { sessionID: "recency", messageID: "first", prompt: { text: "#first" } };
      const second = { sessionID: "recency", messageID: "second", prompt: { text: "#second" } };
      await host.invoke("prompt", first);
      await host.invoke("prompt", second);
      for (const restart of [false, true]) {
        if (restart) await host.restart();
        const request = {
          sessionID: "recency",
          messages: [
            nativeUser(first),
            { id: "reply", role: "assistant", content: [{ type: "text", text: "REPLY" }] },
            nativeUser(second),
          ],
        };
        await host.invoke("context", request);
        await host.invoke("context", request);
        expect(
          request.messages.map((message) =>
            message.content[0].text.replace(/<skill_content[\s\S]*/, "SKILL"),
          ),
        ).toEqual([
          "FIRST↳ Loaded hidden",
          "SKILL",
          "OLD_CONTEXT",
          "NEW_CONTEXT",
          "REPLY",
          "SECOND↳ Loaded hidden",
          "SKILL",
        ]);
      }
    } finally {
      await host.dispose();
    }
  });

  // These boundaries match origin/main's V1 pipeline and real V1 skill-tool output:
  // XML renders before hashtags, hidden skill bodies retain literal markdown,
  // and injection blocks only recurse through snippet references.
  test("preserves V1 expansion boundaries around skill bodies, XML and injections", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks: true, skillLoading: true, skillRendering: true },
        }),
      );
      await Bun.write(join(directory, "xml.md"), '<skill name="hidden" />');
      await Bun.write(
        join(directory, "parent.md"),
        "#chosen<inject>#chosen #skill(hidden) !`printf NEVER`</inject>",
      );
      host.skills[0].content = "#chosen #skill(hidden) !`printf NEVER`";
      const submission = {
        sessionID: "boundaries",
        messageID: "first",
        prompt: { text: "#xml #parent #skill(hidden) #_chosen #missing" },
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(
        '<skill name="hidden" /> CHOSEN_TEXT ↳ Loaded hidden #_chosen #missing',
      );
      const request = { sessionID: "boundaries", messages: [nativeUser(submission)] };
      await host.invoke("context", request);
      expect(request.messages[0].content[0].text).toBe(
        "CHOSEN_TEXT #skill(hidden) !`printf NEVER`",
      );
      expect(request.messages[2].content[0].text).toContain(
        "#chosen #skill(hidden) !`printf NEVER`",
      );
    } finally {
      await host.dispose();
    }
  });

  test.each([
    true,
    false,
  ])("matches V1 recursive skill-tool expansion with injectBlocks=%s", async (injectBlocks) => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks, skillRendering: true, skillLoading: true },
        }),
      );
      await Bun.write(join(directory, "inner.md"), "#chosen");
      await Bun.write(
        join(directory, "outer.md"),
        "BODY #inner <prepend>PRE #inner</prepend><append>POST #inner</append><inject>INJECT #inner</inject> #skill(hidden) !`printf NEVER`",
      );
      const event = {
        sessionID: "tool",
        tool: "skill",
        status: "completed",
        result: { content: [{ type: "text", text: "#outer" }] },
      };
      await host.invoke("execute.after", event);
      const text = event.result.content[0].text;
      expect(text).toContain("PRE CHOSEN_TEXT");
      expect(text).toContain("BODY CHOSEN_TEXT");
      expect(text).toContain("POST CHOSEN_TEXT");
      expect(text).toContain("#skill(hidden) !`printf NEVER`");
      expect(text.includes("INJECT CHOSEN_TEXT")).toBe(!injectBlocks);
      await Bun.write(join(directory, "inner.md"), "UPDATED");
      event.result.content[0].text = "#outer";
      await host.invoke("execute.after", event);
      expect(event.result.content[0].text).toContain("BODY UPDATED");
      for (const overrides of [{ tool: "read" }, { status: "error" }]) {
        const untouched = {
          ...event,
          ...overrides,
          result: { content: [{ type: "text", text: "#outer" }] },
        };
        await host.invoke("execute.after", untouched);
        expect(untouched.result.content[0].text).toBe("#outer");
      }
    } finally {
      await host.dispose();
    }
  });

  test.each([
    "#skill(hidden)",
    "#oct",
    "#octui",
    "#nested",
  ])("loads skills introduced by %s and retains their hidden context after restart", async (text) => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "oct.md"),
        "---\naliases: [octui]\n---\nMake sure to test it thoroughly through the TUI or opencode run: #skill(hidden)",
      );
      await Bun.write(join(directory, "nested.md"), "#octui");
      await Bun.write(join(directory, "skill.md"), "PLAIN_SKILL_SNIPPET");
      const submission = {
        sessionID: "recursive",
        messageID: "recursive-message",
        prompt: { text },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toContain("↳ Loaded hidden");
      expect(submission.prompt.text).not.toContain("#skill(");
      expect(submission.prompt.text).not.toContain("PLAIN_SKILL_SNIPPET");
      expect(submission.prompt.text).not.toContain("DURABLE_HIDDEN_SKILL");
      for (const restart of [false, true]) {
        if (restart) await host.restart();
        await host.invoke("prompt", submission);
        const message = nativeUser(submission);
        const request = { sessionID: submission.sessionID, messages: [message] };
        await host.invoke("context", request);
        await host.invoke("context", request);
        expect(request.messages[0]).toEqual(message);
        expect(request.messages).toHaveLength(2);
        expect(request.messages[1].content[0].text).toContain('<skill_content name="hidden">');
        expect(request.messages[1].content[0].text).toContain("DURABLE_HIDDEN_SKILL");
      }
    } finally {
      await host.dispose();
    }
  });

  test.each([
    { text: "#chosen", skills: ["NATIVE_SKILL_A #chosen", "NATIVE_SKILL_B"] },
    { text: "", skills: [] },
  ])("preserves native skills and attachments around submitted '$text'", async ({
    text,
    skills,
  }) => {
    const host = await submissionFixture();
    try {
      const submission = {
        sessionID: "native",
        messageID: "native-message",
        prompt: { text },
        metadata: { unrelated: "keep" },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(text ? "CHOSEN_TEXT" : "");
      const message = nativeUser(submission, skills);
      const expected = structuredClone(message.content);
      await host.invoke("context", { sessionID: submission.sessionID, messages: [message] });
      expect(message.content).toEqual(expected);
      expect(message.metadata?.unrelated).toBe("keep");
    } finally {
      await host.dispose();
    }
  });

  test("queued snippet injections activate only when their message enters model context", async () => {
    const host = await submissionFixture();
    try {
      const submission = {
        sessionID: "queue",
        messageID: "queued-message",
        prompt: { text: "#queued" },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      const running = {
        sessionID: "queue",
        messages: [
          { id: "current", role: "user", content: [{ type: "text", text: "Running turn" }] },
        ],
      };
      await host.invoke("context", running);
      expect(JSON.stringify(running.messages)).not.toContain("QUEUED_INJECTION");
      const consumed = { sessionID: "queue", messages: [nativeUser(submission)] };
      await host.invoke("context", consumed);
      expect(
        consumed.messages.flatMap((message) => message.content.map((part) => part.text)),
      ).toContain("QUEUED_INJECTION");
    } finally {
      await host.dispose();
    }
  });

  test("retains hidden skills and one-shot shell output across restart with native multipart metadata", async () => {
    const host = await submissionFixture();
    try {
      const submission = {
        sessionID: "restart",
        messageID: "restart-message",
        prompt: { text: "#chosen #skill(hidden) !`printf x >> count.txt; wc -c < count.txt`" },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toContain("CHOSEN_TEXT");
      expect(submission.prompt.text).toContain("1");
      const persisted = nativeUser(submission, ["NATIVE_SKILL"]);
      for (const restart of [false, true]) {
        if (restart) {
          await host.restart();
          // Re-submitting retained prompt metadata must not lose hidden payloads
          // or execute the shell again, either.
          await host.invoke("prompt", submission);
        }
        const message = nativeUser(submission, ["NATIVE_SKILL"]);
        const request = { sessionID: "restart", messages: [message] };
        await host.invoke("context", request);
        expect(message.content).toEqual(persisted.content);
        expect(
          request.messages.filter((item) =>
            item.content.some((part) => part.text.includes("DURABLE_HIDDEN_SKILL")),
          ),
        ).toHaveLength(1);
        expect(await readFile(join(host.directory, "count.txt"), "utf8")).toBe("x");
      }
    } finally {
      await host.dispose();
    }
  });
});

describe("V2 request expansion", () => {
  test("chosen hashtags are replaced in submitted text as well as model context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-submission-"));
    const skillDirectory = join(directory, "skills");
    await mkdir(join(directory, ".opencode", "snippet"), { recursive: true });
    await mkdir(skillDirectory);
    await writeFile(join(directory, ".opencode", "snippet", "chosen.md"), "CHOSEN_TEXT");
    const hooks = new Map<string, (input: never) => Effect.Effect<void>>();
    const registration = Effect.succeed({ dispose: () => Effect.void });
    const context = {
      skill: { transform: () => registration },
      session: {
        get: () => Effect.succeed({ location: { directory } }),
        hook: (name: string, callback: (input: never) => Effect.Effect<void>) => {
          hooks.set(name, callback);
          return registration;
        },
      },
      tool: { hook: () => registration },
      event: { subscribe: () => Stream.empty },
    };
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* setupV2SnippetsEffect(context as never, {
              directory,
              skillDirectory,
              globalDirectory: join(directory, "global"),
              homeDirectory: join(directory, "home"),
              dataDirectory: join(directory, "data"),
            });
            const submission = {
              sessionID: "submission-session",
              messageID: "submission-message",
              prompt: { text: "Please #chosen and #unknown" },
              delivery: "queue",
            };
            // OC2 submits PromptInput.text; context-only expansion cannot replace the visible submission.
            yield* hooks.get("prompt")?.(submission as never) ?? Effect.void;
            expect(submission.prompt.text).toBe("Please CHOSEN_TEXT and #unknown");
            const request = {
              sessionID: submission.sessionID,
              messages: [
                {
                  id: submission.messageID,
                  role: "user",
                  content: [{ type: "text", text: submission.prompt.text }],
                },
              ],
            };
            yield* hooks.get("context")?.(request as never) ?? Effect.void;
            expect(request.messages[0].content[0].text).toBe("Please CHOSEN_TEXT and #unknown");
            // Historical/raw messages still need the model-context fallback independently of submission.
            const historical = {
              sessionID: "history-session",
              messages: [
                {
                  id: "history-message",
                  role: "user",
                  content: [{ type: "text", text: "#chosen" }],
                },
              ],
            };
            yield* hooks.get("context")?.(historical as never) ?? Effect.void;
            expect(historical.messages[0].content[0].text).toBe("CHOSEN_TEXT");
            const shellSubmission = {
              sessionID: "shell-submission-session",
              messageID: "shell-submission-message",
              prompt: {
                text: "#chosen !`printf x >> submitted-count.txt; wc -c < submitted-count.txt`",
              },
              delivery: "queue",
            };
            yield* hooks.get("prompt")?.(shellSubmission as never) ?? Effect.void;
            expect(shellSubmission.prompt.text).toBe("CHOSEN_TEXT 1");
            const shellContext = {
              sessionID: shellSubmission.sessionID,
              messages: [
                {
                  id: shellSubmission.messageID,
                  role: "user",
                  content: [{ type: "text", text: shellSubmission.prompt.text }],
                },
              ],
            };
            yield* hooks.get("context")?.(shellContext as never) ?? Effect.void;
            expect(shellContext.messages[0].content[0].text).toBe("CHOSEN_TEXT 1");
            expect(
              yield* Effect.promise(() => readFile(join(directory, "submitted-count.txt"), "utf8")),
            ).toBe("x");
          }),
        ),
      );
      // A restarted server sees the persisted, already-expanded text, not the original hashtag.
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* setupV2SnippetsEffect(context as never, {
              directory,
              skillDirectory,
              globalDirectory: join(directory, "global"),
              homeDirectory: join(directory, "home"),
              dataDirectory: join(directory, "data"),
            });
            const restored = {
              sessionID: "submission-session",
              messages: [
                {
                  id: "submission-message",
                  role: "user",
                  content: [{ type: "text", text: "Please CHOSEN_TEXT and #unknown" }],
                },
              ],
            };
            yield* hooks.get("context")?.(restored as never) ?? Effect.void;
            expect(restored.messages[0].content[0].text).toBe("Please CHOSEN_TEXT and #unknown");
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("expands the latest AI SDK user message in place", async () => {
    const messages = [
      { role: "user", content: "old #proof" },
      { role: "assistant", content: "reply" },
      { role: "user", content: [{ type: "text", text: "new #proof" }] },
    ];

    expect(await expandRequestMessages(messages, snippets)).toBe(true);
    expect(messages[0].content).toBe("old #proof");
    expect(messages[2].content).toEqual([
      { type: "text", text: "new EXPANDED_BY_V2_REQUEST_HOOK" },
    ]);
  });

  test("supports the V2 schema user text shape", async () => {
    const messages = [{ type: "user", text: "#proof" }];

    expect(await expandRequestMessages(messages, snippets)).toBe(true);
    expect(messages[0].text).toBe("EXPANDED_BY_V2_REQUEST_HOOK");
  });

  test("leaves non-user messages unchanged", async () => {
    const messages = [{ role: "system", content: "#proof" }];

    expect(await expandRequestMessages(messages, snippets)).toBe(false);
    expect(messages[0].content).toBe("#proof");
  });

  test("expands shell substitutions after snippets", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "#proof !`printf _SHELL`" }] },
    ];
    expect(await expandRequestMessages(messages, snippets)).toBe(true);
    expect(messages[0].content[0].text).toBe("EXPANDED_BY_V2_REQUEST_HOOK _SHELL");
  });

  test("registers the native skill, context, and tool hooks and expands context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-native-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(snippetDirectory, "proof.md"), "native V2 expansion");
    await writeFile(
      join(skillDirectory, "SKILL.md"),
      "---\nname: snippets\ndescription: test\n---\ntest",
    );

    let source: unknown;
    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    let toolHook: ((event: Record<string, unknown>) => Promise<void>) | undefined;
    let disposed = 0;
    const registration = { dispose: async () => void disposed++ };
    const context = {
      skill: {
        transform: async (callback: (draft: { add: (value: unknown) => void }) => void) => {
          callback({
            add: (value) => {
              source = value;
            },
          });
          return registration;
        },
      },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: {
        hook: async (_name: string, callback: typeof toolHook) => {
          toolHook = callback;
          return registration;
        },
      },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory: join(directory, "home"),
        skillDirectory,
      });
      const request = {
        sessionID: "session-test",
        messages: [{ role: "user", content: [{ type: "text", text: "use #proof" }] }],
      };
      await contextHook?.(request);

      expect(source).toMatchObject({
        location: join(skillDirectory, "SKILL.md"),
        name: "snippets",
      });
      expect(request.messages[0].content[0].text).toBe("use native V2 expansion");
      expect(toolHook).toBeFunction();
      await cleanup();
      expect(disposed).toBe(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("runs shell substitutions and management commands once across request rebuilding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-once-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(snippetDirectory, "delete-me.md"), "temporary");
    await writeFile(join(snippetDirectory, "replay.md"), "EXPANDED");

    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory: join(directory, "home"),
        skillDirectory,
      });
      const rawShell = "!`printf x >> count.txt; wc -c < count.txt`";
      const buildShellRequest = () => ({
        sessionID: "shell-session",
        messages: [
          { id: "shell-message", role: "user", content: [{ type: "text", text: rawShell }] },
        ],
      });
      const firstShell = buildShellRequest();
      const rebuiltShell = buildShellRequest();
      await contextHook?.(firstShell);
      await contextHook?.(rebuiltShell);
      expect(firstShell.messages[0].content[0].text).toBe("1");
      expect(rebuiltShell.messages[0].content[0].text).toBe("1");
      expect(await Bun.file(join(directory, "count.txt")).text()).toBe("x");

      const idlessShell = "!`printf y >> idless.txt; wc -c < idless.txt`";
      const idlessRequest = {
        sessionID: "shell-session",
        messages: [{ role: "user", content: [{ type: "text", text: idlessShell }] }],
      };
      await contextHook?.(idlessRequest);
      expect(idlessRequest.messages[0].content[0].text).toBe("1");
      await contextHook?.(idlessRequest);
      expect(idlessRequest.messages[0].content[0].text).toBe("1");
      expect(await Bun.file(join(directory, "idless.txt")).text()).toBe("y");

      const buildDurableHistory = (includeNew: boolean) => ({
        sessionID: "durable-session",
        messages: [
          {
            id: "durable-old",
            role: "user",
            content: [
              { type: "text", text: "!`printf a >> durable-old.txt; wc -c < durable-old.txt`" },
            ],
          },
          { id: "reply", role: "assistant", content: [{ type: "text", text: "ok" }] },
          ...(includeNew
            ? [
                {
                  id: "durable-new",
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "!`printf b >> durable-new.txt; wc -c < durable-new.txt`",
                    },
                  ],
                },
              ]
            : []),
        ],
      });
      const firstHistory = buildDurableHistory(false);
      const rebuiltHistory = buildDurableHistory(true);
      await contextHook?.(firstHistory);
      await contextHook?.(rebuiltHistory);
      const rebuiltAgain = buildDurableHistory(true);
      await contextHook?.(rebuiltAgain);
      expect(firstHistory.messages[0].content[0].text).toBe("1");
      expect(rebuiltHistory.messages[0].content[0].text).toBe("1");
      expect(rebuiltHistory.messages[2].content[0].text).toBe("1");
      expect(rebuiltAgain.messages[0].content[0].text).toBe("1");
      expect(rebuiltAgain.messages[2].content[0].text).toBe("1");
      expect(await Bun.file(join(directory, "durable-old.txt")).text()).toBe("a");
      expect(await Bun.file(join(directory, "durable-new.txt")).text()).toBe("b");

      const replayHistory = {
        sessionID: "replay-session",
        messages: [
          { id: "replay-1", role: "user", content: [{ type: "text", text: "one #replay" }] },
        ],
      };
      await contextHook?.(replayHistory);
      expect(replayHistory.messages[0].content[0].text).toBe("one EXPANDED");
      const rebuiltReplayHistory = {
        sessionID: "replay-session",
        messages: [
          { id: "replay-1", role: "user", content: [{ type: "text", text: "one #replay" }] },
          { id: "replay-2", role: "user", content: [{ type: "text", text: "two #replay" }] },
          { id: "replay-3", role: "user", content: [{ type: "text", text: "three #replay" }] },
        ],
      };
      await contextHook?.(rebuiltReplayHistory);
      expect(rebuiltReplayHistory.messages.map((message) => message.content[0].text)).toEqual([
        "one EXPANDED",
        "two EXPANDED",
        "three EXPANDED",
      ]);

      const buildCommandRequest = () => ({
        sessionID: "command-session",
        messages: [
          {
            id: "command-message",
            role: "user",
            content: [{ type: "text", text: "/snippets delete delete-me" }],
          },
        ],
      });
      const firstCommand = buildCommandRequest();
      const rebuiltCommand = buildCommandRequest();
      await contextHook?.(firstCommand);
      await contextHook?.(rebuiltCommand);
      expect(firstCommand.messages[0].content[0].text).toContain("Deleted snippet #delete-me");
      expect(rebuiltCommand.messages[0].content[0].text).toBe(
        firstCommand.messages[0].content[0].text,
      );
      const globalCommand = {
        sessionID: "global-command-session",
        messages: [
          {
            id: "global-command-message",
            role: "user",
            content: [{ type: "text", text: '/snippets add isolated "GLOBAL_ONLY"' }],
          },
        ],
      };
      await contextHook?.(globalCommand);
      expect(await readFile(join(directory, "global-snippets", "isolated.md"), "utf8")).toBe(
        "GLOBAL_ONLY",
      );
      await cleanup();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses project-scoped registries for sessions served by one plugin instance", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-projects-"));
    const projectA = join(root, "a");
    const projectB = join(root, "b");
    const skillDirectory = join(root, "skill", "snippets");
    for (const [directory, content] of [
      [projectA, "PROJECT_A"],
      [projectB, "PROJECT_B"],
    ]) {
      const snippetsDir = join(directory, ".opencode", "snippet");
      await mkdir(snippetsDir, { recursive: true });
      await writeFile(join(snippetsDir, "proof.md"), content);
    }
    await mkdir(skillDirectory, { recursive: true });

    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({
          location: { directory: sessionID === "a" ? projectA : projectB },
        }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        globalDirectory: join(root, "global-snippets"),
        homeDirectory: join(root, "home"),
        skillDirectory,
      });
      const requestA = {
        sessionID: "a",
        messages: [{ id: "a1", role: "user", content: [{ type: "text", text: "#proof" }] }],
      };
      const requestB = {
        sessionID: "b",
        messages: [{ id: "b1", role: "user", content: [{ type: "text", text: "#proof" }] }],
      };
      await contextHook?.(requestA);
      await contextHook?.(requestB);
      expect(requestA.messages[0].content[0].text).toBe("PROJECT_A");
      expect(requestB.messages[0].content[0].text).toBe("PROJECT_B");
      await cleanup();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accumulates and deduplicates injections, then clears session state on deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-inject-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(snippetDirectory, "config.jsonc"),
      '{"experimental":{"injectBlocks":true}}',
    );
    await writeFile(join(snippetDirectory, "a.md"), "<inject>INJECT_A</inject>");
    await writeFile(join(snippetDirectory, "b.md"), "<inject>INJECT_B</inject>");

    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    let deleteSession: ((event: unknown) => void) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            const event = await new Promise((resolve) => {
              deleteSession = resolve;
            });
            yield event;
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory: join(directory, "home"),
        skillDirectory,
      });
      await Bun.sleep(0);
      const build = (latest: string, id: string) => ({
        sessionID: "inject-session",
        messages: [
          { id: "m1", role: "user", content: [{ type: "text", text: "#a" }] },
          ...(id === "m1" ? [] : [{ id, role: "user", content: [{ type: "text", text: latest }] }]),
        ],
      });
      await contextHook?.(build("#a", "m1"));
      const both = build("#b", "m2");
      await contextHook?.(both);
      const rebuilt = build("#b", "m2");
      await contextHook?.(rebuilt);
      const injections = rebuilt.messages.filter(
        (message) => message.metadata?.["opencode-snippets:generated"] === "injection",
      );
      expect(injections.map((message) => message.content[0].text).sort()).toEqual([
        "INJECT_A",
        "INJECT_B",
      ]);
      const durableStore = new DurableStore(directory, {
        homeDirectory: join(directory, "home"),
      });
      expect(
        Object.keys(JSON.parse(await readFile(durableStore.path, "utf8")).sessions),
      ).toHaveLength(1);

      deleteSession?.({ type: "session.deleted", data: { sessionID: "inject-session" } });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          Object.keys(JSON.parse(await readFile(durableStore.path, "utf8")).sessions).length === 0
        )
          break;
        await Bun.sleep(10);
      }
      expect(JSON.parse(await readFile(durableStore.path, "utf8")).sessions).toEqual({});
      const afterDeletion = {
        sessionID: "inject-session",
        messages: [{ id: "fresh", role: "user", content: [{ type: "text", text: "nothing" }] }],
      };
      await contextHook?.(afterDeletion);
      expect(
        afterDeletion.messages.some(
          (message) => message.metadata?.["opencode-snippets:generated"] === "injection",
        ),
      ).toBe(false);
      await cleanup();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("the exported Effect adapter prunes durable state from the real deletion stream", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-effect-delete-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(snippetDirectory, "proof.md"), "EFFECT_EXPANDED");

    try {
      const events = await Effect.runPromise(Queue.unbounded<unknown>());
      let contextHook: ((request: never) => Effect.Effect<void>) | undefined;
      const registration = { dispose: () => Effect.void };
      const context = {
        options: {},
        skill: {
          transform: (callback: (draft: { add: (value: unknown) => void }) => void) => {
            callback({ add: () => undefined });
            return Effect.succeed(registration);
          },
        },
        session: {
          get: () => Effect.succeed({ location: { directory } }),
          hook: (_name: string, callback: typeof contextHook) => {
            contextHook = callback;
            return Effect.succeed(registration);
          },
        },
        tool: { hook: () => Effect.succeed(registration) },
        event: { subscribe: () => Stream.fromQueue(events) },
      };

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* setupV2SnippetsEffect(context as never, {
              directory,
              globalDirectory: join(directory, "global-snippets"),
              homeDirectory: join(directory, "home"),
              skillDirectory,
            });
            const request = {
              sessionID: "effect-session",
              messages: [
                { id: "effect-message", role: "user", content: [{ type: "text", text: "#proof" }] },
              ],
            };
            yield* contextHook?.(request as never) ?? Effect.void;
            expect(request.messages[0].content[0].text).toBe("EFFECT_EXPANDED");

            const store = new DurableStore(directory, {
              homeDirectory: join(directory, "home"),
            });
            expect(
              Object.keys(
                JSON.parse(yield* Effect.promise(() => readFile(store.path, "utf8"))).sessions,
              ),
            ).toHaveLength(1);
            yield* Queue.offer(events, {
              type: "session.deleted",
              data: { sessionID: "effect-session" },
              location: { directory },
            });
            for (let attempt = 0; attempt < 50; attempt++) {
              const state = JSON.parse(yield* Effect.promise(() => readFile(store.path, "utf8")));
              if (Object.keys(state.sessions).length === 0) break;
              yield* Effect.sleep("10 millis");
            }
            expect(
              JSON.parse(yield* Effect.promise(() => readFile(store.path, "utf8"))).sessions,
            ).toEqual({});
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("clears memory after a failed deletion and continues with a later successful deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-delete-resilience-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    const homeDirectory = join(directory, "home");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(snippetDirectory, "config.jsonc"),
      '{"experimental":{"injectBlocks":true}}',
    );
    await writeFile(join(snippetDirectory, "inject.md"), "<inject>ACTIVE</inject>");

    const queued: unknown[] = [];
    let wake: (() => void) | undefined;
    const emit = (event: unknown) => {
      queued.push(event);
      wake?.();
      wake = undefined;
    };
    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            while (!signal.aborted) {
              if (queued.length === 0) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                  signal.addEventListener("abort", resolve, { once: true });
                });
              }
              if (signal.aborted) return;
              const event = queued.shift();
              if (event) yield event;
            }
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory,
        skillDirectory,
      });
      const activate = async (sessionID: string, id: string) => {
        await contextHook?.({
          sessionID,
          messages: [{ id, role: "user", content: [{ type: "text", text: "#inject" }] }],
        });
      };
      await activate("failed-session", "failed-message");
      const store = new DurableStore(directory, { homeDirectory });
      const dataBackup = `${store.directory}.backup`;
      await Bun.sleep(0);
      await Bun.file(store.path).exists();
      await import("node:fs/promises").then(({ rename }) => rename(store.directory, dataBackup));
      await writeFile(store.directory, "blocks durable cleanup");
      emit({ type: "session.deleted", data: { sessionID: "failed-session" } });

      let cleared = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const request = {
          sessionID: "failed-session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "observe" }] }],
        };
        await contextHook?.(request);
        cleared = !request.messages.some(
          (message) => message.metadata?.["opencode-snippets:generated"] === "injection",
        );
        if (cleared) break;
        await Bun.sleep(10);
      }
      expect(cleared).toBe(true);

      await rm(store.directory, { force: true });
      await import("node:fs/promises").then(({ rename }) => rename(dataBackup, store.directory));
      await activate("successful-session", "successful-message");
      emit({ type: "session.deleted", data: { sessionID: "successful-session" } });
      for (let attempt = 0; attempt < 50; attempt++) {
        const state = JSON.parse(await readFile(store.path, "utf8"));
        if (Object.keys(state.sessions).length === 1) break;
        await Bun.sleep(10);
      }
      expect(Object.keys(JSON.parse(await readFile(store.path, "utf8")).sessions)).toHaveLength(1);
      await cleanup();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
