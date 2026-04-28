import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { Config, Message, Part, UserMessage } from "@opencode-ai/sdk";
import { SnippetsPlugin } from "./index.js";

/** Temp directory for test snippets */
let tempDir: string;
let projectSnippetDir: string;
let projectSkillDir: string;

/** Mock OpenCode plugin context */
function createMockContext(snippetsDir?: string): PluginInput {
  return {
    client: {
      session: {
        prompt: async () => undefined,
      },
    } as unknown as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: "/test/worktree",
      time: { created: Date.now() },
    },
    directory: snippetsDir || "/test/project",
    worktree: "/test/worktree",
    serverUrl: new URL("http://localhost:3000"),
    experimental_workspace: {} as PluginInput["experimental_workspace"],
    $: {} as PluginInput["$"],
  };
}

/** Create a mock context that uses temp snippet directory */
function createMockContextWithSnippets(): PluginInput {
  return {
    client: {
      session: {
        prompt: async () => undefined,
      },
    } as unknown as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: join(tempDir, "project"),
      time: { created: Date.now() },
    },
    directory: join(tempDir, "project"),
    worktree: join(tempDir, "project"),
    serverUrl: new URL("http://localhost:3000"),
    experimental_workspace: {} as PluginInput["experimental_workspace"],
    $: {} as PluginInput["$"],
  };
}

function textOf(part: Part): string | undefined {
  return (part as { text?: string }).text;
}

describe("SnippetsPlugin - Hook Integration", () => {
  describe("chat.message hook with actual snippets", () => {
    beforeEach(async () => {
      // Create temp directory structure
      tempDir = join(import.meta.dir, `.test-snippets-${Date.now()}`);
      projectSnippetDir = join(tempDir, "project", ".opencode", "snippet");
      await mkdir(projectSnippetDir, { recursive: true });

      // Create test snippet
      await writeFile(join(projectSnippetDir, "greeting.md"), "Hello, I am a test snippet!");
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should expand hashtags in user messages", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const userMessage = {
        role: "user",
        content: "Test message",
      } as unknown as UserMessage;

      const output = {
        message: userMessage,
        parts: [{ type: "text", text: "Say #greeting please" }] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        output,
      );

      // Snippet should be expanded
      expect(textOf(output.parts[0])).toBe("Say Hello, I am a test snippet! please");
    });

    it("should not process assistant messages", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const assistantMessage = {
        role: "assistant",
        content: "Test response",
      } as unknown as UserMessage;

      const output = {
        message: assistantMessage,
        parts: [{ type: "text", text: "#test hashtag" }] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        output,
      );

      // Should not modify assistant messages - text should remain unchanged
      expect(textOf(output.parts[0])).toBe("#test hashtag");
    });

    it("should not process ignored messages (command output)", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const userMessage = {
        role: "user",
        content: "Command output",
      } as unknown as UserMessage;

      const output = {
        message: userMessage,
        parts: [
          { type: "text", text: "Snippet content: !`echo test` and #greeting", ignored: true },
        ] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        output,
      );

      // Should not process ignored messages - commands and hashtags should not be expanded
      expect(textOf(output.parts[0])).toBe("Snippet content: !`echo test` and #greeting");
    });
  });

  describe("experimental.chat.messages.transform hook with actual snippets", () => {
    beforeEach(async () => {
      // Create temp directory structure
      tempDir = join(import.meta.dir, `.test-snippets-transform-${Date.now()}`);
      projectSnippetDir = join(tempDir, "project", ".opencode", "snippet");
      await mkdir(projectSnippetDir, { recursive: true });

      // Create test snippet
      await writeFile(
        join(projectSnippetDir, "question-hint.md"),
        "Please provide detailed information.",
      );
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should expand hashtags in all user messages", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const messages: Array<{ info: Message; parts: Part[] }> = [
        {
          info: { role: "user" } as Message,
          parts: [{ type: "text", text: "#question-hint Answer my query" }] as Part[],
        },
        {
          info: { role: "assistant" } as Message,
          parts: [{ type: "text", text: "#question-hint should not expand" }] as Part[],
        },
      ];

      const output = { messages };

      await hooks["experimental.chat.messages.transform"]?.({}, output);

      // User message should be expanded
      expect(textOf(messages[0].parts[0])).toBe(
        "Please provide detailed information. Answer my query",
      );

      // Assistant message should remain unchanged
      expect(textOf(messages[1].parts[0])).toBe("#question-hint should not expand");
    });

    it("should handle empty messages array", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output: { messages: Array<{ info: Message; parts: Part[] }> } = {
        messages: [],
      };

      await hooks["experimental.chat.messages.transform"]?.({}, output);

      expect(output.messages).toHaveLength(0);
    });

    it("should not process ignored messages in transform hook", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const messages: Array<{ info: Message; parts: Part[] }> = [
        {
          info: { role: "user" } as Message,
          parts: [
            {
              type: "text",
              text: "Command output: !`echo test` and #question-hint",
              ignored: true,
            },
          ] as Part[],
        },
      ];

      const output = { messages };

      await hooks["experimental.chat.messages.transform"]?.({}, output);

      // Ignored message should not be processed
      expect(textOf(messages[0].parts[0])).toBe("Command output: !`echo test` and #question-hint");
    });
  });

  describe("experimental skill loading", () => {
    beforeEach(async () => {
      tempDir = join(import.meta.dir, `.test-skill-loading-${Date.now()}`);
      projectSnippetDir = join(tempDir, "project", ".opencode", "snippet");
      projectSkillDir = join(tempDir, "project", ".opencode", "skill");
      await mkdir(projectSnippetDir, { recursive: true });
      await mkdir(join(projectSkillDir, "caveman"), { recursive: true });
      await mkdir(join(projectSkillDir, "careful"), { recursive: true });

      await writeFile(
        join(projectSnippetDir, "config.jsonc"),
        JSON.stringify({ experimental: { skillLoading: true } }),
      );
      await writeFile(join(projectSnippetDir, "skill.md"), "general skill snippet");
      await writeFile(join(projectSnippetDir, "demo-load.md"), "Use demo voice. #skill(caveman)");
      await writeFile(join(projectSkillDir, "caveman", "SKILL.md"), "Use caveman mode.");
      await writeFile(join(projectSkillDir, "careful", "SKILL.md"), "Be careful.");
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should replace visible skill load syntax with placeholders", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [
          {
            type: "text",
            text: 'Load #skill(caveman) and #skill("careful")',
          },
        ] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
          messageID: "message-1",
        },
        output,
      );

      expect(textOf(output.parts[0])).toBe("Load ↳ Loaded caveman and ↳ Loaded careful");
    });

    it("should inject hidden skill payloads after the visible user message", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const chatOutput = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [
          {
            type: "text",
            text: 'Load #skill(caveman) and #skill("careful")',
          },
        ] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
          messageID: "message-1",
        },
        chatOutput,
      );

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: chatOutput.parts,
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(1);
      expect(textOf(output.messages[0].parts[1])).toBe(
        "Load ↳ Loaded caveman and ↳ Loaded careful",
      );
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="careful">');
      expect(textOf(output.messages[0].parts[0])).toContain(
        "Plugin note: `↳ Loaded caveman` is not instruction. Do not call `skill` again for caveman.",
      );
      expect(
        textOf(output.messages[0].parts[0])?.indexOf('<skill_content name="caveman">'),
      ).toBeLessThan(
        textOf(output.messages[0].parts[0])?.indexOf('<skill_content name="careful">') || 0,
      );
    });

    it("should inject hidden skill payloads when chat.message has no message id", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const chatOutput = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [
          {
            type: "text",
            text: "Load #skill(caveman)",
          },
        ] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        chatOutput,
      );

      const output = {
        messages: [
          {
            info: { role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Load ↳ Loaded caveman" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(1);
      expect(textOf(output.messages[0].parts[1])).toBe("Load ↳ Loaded caveman");
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[0].parts[0])).toContain(
        "Plugin note: `↳ Loaded caveman` is not instruction. Do not call `skill` again for caveman.",
      );
    });

    it("should attach queued hidden skill payloads to the latest matching user message", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const chatOutput = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [
          {
            type: "text",
            text: "Load #skill(caveman)",
          },
        ] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        chatOutput,
      );

      const output = {
        messages: [
          {
            info: { id: "older", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Older user message" }] as Part[],
          },
          {
            info: { role: "assistant", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Older assistant reply" }] as Part[],
          },
          {
            info: { id: "latest", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Load ↳ Loaded caveman" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(3);
      expect(textOf(output.messages[0].parts[0])).toBe("Older user message");
      expect(textOf(output.messages[1].parts[0])).toBe("Older assistant reply");
      expect(textOf(output.messages[2].parts[1])).toBe("Load ↳ Loaded caveman");
      expect(textOf(output.messages[2].parts[0])).toContain('<skill_content name="caveman">');
    });

    it("should not duplicate synthetic skill_content when chat.message fires both with and without messageID", async () => {
      // Repro for the fresh `opencode run` bug where the snippet plugin observed
      // chat.message getting fired twice for the same prompt: once without
      // input.messageID (queued) and once with it (registered as direct part.skillLoads).
      // Without dedup, both pending and direct paths each push a synthetic, and the
      // queued one lands on an unrelated user message such as the beads-context.
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const partsWithoutId = [{ type: "text", text: "Load #skill(caveman)" }] as Part[];

      // First fire: no messageID (queues payload).
      await hooks["chat.message"]?.(
        { sessionID: "test-session" },
        {
          message: { role: "user", content: "Test" } as unknown as UserMessage,
          parts: partsWithoutId,
        },
      );

      // Second fire: with messageID (registers payload AND attaches to part.skillLoads).
      const chatOutputFinal = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [{ type: "text", text: "Load #skill(caveman)" }] as Part[],
      };
      await hooks["chat.message"]?.(
        { sessionID: "test-session", messageID: "prompt-msg" },
        chatOutputFinal,
      );

      const output = {
        messages: [
          {
            info: { id: "prompt-msg", role: "user", sessionID: "test-session" } as Message,
            parts: chatOutputFinal.parts,
          },
          {
            info: { id: "beads-msg", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "<beads-context>noop</beads-context>" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      // Exactly ONE hidden payload, attached to the prompt message — never beads.
      expect(output.messages).toHaveLength(2);
      expect(textOf(output.messages[0].parts[1])).toBe("Load ↳ Loaded caveman");
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[1].parts[0])).toBe("<beads-context>noop</beads-context>");
    });

    it("should keep skill payloads in transform-injected hidden messages", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const chatOutput = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [
          {
            type: "text",
            text: "Load #skill(caveman)",
          },
        ] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
          messageID: "message-1",
        },
        chatOutput,
      );

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: chatOutput.parts,
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(textOf(chatOutput.parts[0])).toBe("Load ↳ Loaded caveman");
      expect(output.messages).toHaveLength(1);
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[0].parts[1])).toBe("Load ↳ Loaded caveman");
    });

    it("should recover hidden skill payloads from visible markers when transform loses metadata", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Load ↳ Loaded caveman" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(1);
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[0].parts[1])).toBe("Load ↳ Loaded caveman");

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(1);
    });

    it("should not reprocess synthetic hidden skill-content messages on later transforms", async () => {
      await writeFile(join(projectSkillDir, "caveman", "SKILL.md"), "#skill(careful)");

      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Load ↳ Loaded caveman" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(1);
      const hidden = textOf(output.messages[0].parts[0]);
      expect(hidden).toContain("#skill(careful)");

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      expect(output.messages).toHaveLength(1);
      expect(textOf(output.messages[0].parts[0])).toBe(hidden);
      expect(textOf(output.messages[0].parts[1])).toBe("Load ↳ Loaded caveman");
    });

    it("should preserve literal skill markdown in hidden skill payloads", async () => {
      await mkdir(join(projectSkillDir, "opencode-config"), { recursive: true });
      await writeFile(
        join(projectSkillDir, "opencode-config", "SKILL.md"),
        [
          "---",
          "name: opencode-config",
          "---",
          "",
          "## Config Files (Permachine)",
          "",
          "This setup uses [permachine](https://github.com/josxa/permachine) for overrides.",
          "",
          "Literal example: #permachine and #skill(careful)",
        ].join("\n"),
      );

      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Load ↳ Loaded opencode-config" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      const hidden = textOf(output.messages[0].parts[0]);
      expect(hidden).toContain("## Config Files (Permachine)");
      expect(hidden).toContain("This setup uses [permachine]");
      expect(hidden).toContain("Literal example: #permachine and #skill(careful)");
      expect(textOf(output.messages[0].parts[1])).toBe("Load ↳ Loaded opencode-config");
    });

    it("should mirror hidden skill payloads into system transform output", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const chatOutput = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [{ type: "text", text: "Load #skill(caveman)" }] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
          messageID: "message-1",
        },
        chatOutput,
      );

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: chatOutput.parts,
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      const system = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]?.(
        { sessionID: "test-session", model: {} as never },
        system,
      );

      expect(system.system).toHaveLength(1);
      expect(system.system[0]).toContain('<skill_content name="caveman">');
      expect(system.system[0]).toContain(
        "Plugin note: `↳ Loaded caveman` is not instruction. Do not call `skill` again for caveman.",
      );
    });

    it("should keep mirrored system skill payloads across later turns", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        messages: [
          {
            info: { id: "message-1", role: "user", sessionID: "test-session" } as Message,
            parts: [{ type: "text", text: "Load ↳ Loaded caveman" }] as Part[],
          },
        ],
      };

      await hooks["experimental.chat.messages.transform"]?.({ sessionID: "test-session" }, output);

      const firstSystem = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]?.(
        { sessionID: "test-session", model: {} as never },
        firstSystem,
      );

      const secondSystem = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]?.(
        { sessionID: "test-session", model: {} as never },
        secondSystem,
      );

      expect(firstSystem.system).toHaveLength(1);
      expect(secondSystem.system).toHaveLength(1);
      expect(secondSystem.system[0]).toBe(firstSystem.system[0]);
      expect(secondSystem.system[0]).toContain('<skill_content name="caveman">');
    });

    it("should keep plain #skill snippets working alongside #skill(name)", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [{ type: "text", text: "Use #skill and #skill(caveman)" }] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
          messageID: "message-1",
        },
        output,
      );

      expect(textOf(output.parts[0])).toBe("Use general skill snippet and ↳ Loaded caveman");
    });

    it("should load skills from snippet-expanded #skill(name) syntax", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const output = {
        message: { role: "user", content: "Test" } as unknown as UserMessage,
        parts: [{ type: "text", text: "#demo-load Explain arrays." }] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
          messageID: "message-1",
        },
        output,
      );

      expect(textOf(output.parts[0])).toBe("Use demo voice. ↳ Loaded caveman Explain arrays.");
      expect((output.parts[0] as Part & { skillLoads?: string[] }).skillLoads?.[0]).toContain(
        '<skill_content name="caveman">',
      );
    });
  });

  describe("tool.execute.after hook with actual snippets", () => {
    /** Type for tool.execute.after hook input */
    type ToolExecuteInput = {
      tool: string;
      sessionID: string;
      callID: string;
      args: unknown;
    };

    /** Type for tool.execute.after hook output */
    type ToolExecuteOutput = {
      title: string;
      output: string;
      metadata: unknown;
    };

    beforeEach(async () => {
      // Create temp directory structure
      tempDir = join(import.meta.dir, `.test-snippets-tool-${Date.now()}`);
      projectSnippetDir = join(tempDir, "project", ".opencode", "snippet");
      await mkdir(projectSnippetDir, { recursive: true });

      // Create test snippet
      await writeFile(
        join(projectSnippetDir, "skill-helper.md"),
        "This is additional context from a snippet.",
      );
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should expand hashtags in skill tool output", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const input: ToolExecuteInput = {
        tool: "skill",
        sessionID: "test-session",
        callID: "call-123",
        args: {},
      };

      const output: ToolExecuteOutput = {
        title: "Skill Loaded",
        output: "Skill content with #skill-helper for extra help",
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Snippet should be expanded in skill output
      expect(output.output).toBe(
        "Skill content with This is additional context from a snippet. for extra help",
      );
    });

    it("should not process non-skill tools", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const input: ToolExecuteInput = {
        tool: "bash",
        sessionID: "test-session",
        callID: "call-123",
        args: {},
      };

      const originalOutput = "Command output with #skill-helper";
      const output: ToolExecuteOutput = {
        title: "Bash Result",
        output: originalOutput,
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Should not modify non-skill tool output
      expect(output.output).toBe(originalOutput);
    });

    it("should handle empty skill output", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const input: ToolExecuteInput = {
        tool: "skill",
        sessionID: "test-session",
        callID: "call-123",
        args: {},
      };

      const output: ToolExecuteOutput = {
        title: "Skill Loaded",
        output: "",
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Should handle gracefully
      expect(output.output).toBe("");
    });

    it("should handle non-string skill output", async () => {
      const ctx = createMockContextWithSnippets();
      const hooks = await SnippetsPlugin(ctx);

      const input: ToolExecuteInput = {
        tool: "skill",
        sessionID: "test-session",
        callID: "call-123",
        args: {},
      };

      const output: ToolExecuteOutput = {
        title: "Skill Loaded",
        output: { data: "object output" } as unknown as string,
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Should not crash on non-string output
      expect(hooks["tool.execute.after"]).toBeDefined();
    });
  });

  describe("config hook", () => {
    it("should register /snippets commands", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const config: Partial<Config> = {};
      await hooks.config?.(config as Config);

      expect(config.command).toBeDefined();
      expect(config.command?.snippets).toBeDefined();
      expect(config.command?.snippets?.description).toContain("snippet");
      expect(config.command?.["snippets:reload"]).toBeDefined();
    });

    it("should reload snippets from disk with /snippets:reload", async () => {
      tempDir = join(import.meta.dir, `.test-snippets-reload-${Date.now()}`);
      projectSnippetDir = join(tempDir, "project", ".opencode", "snippet");
      await mkdir(projectSnippetDir, { recursive: true });
      await writeFile(join(projectSnippetDir, "greeting.md"), "hello");

      const promptCalls: Array<{
        path: { id: string };
        body: { noReply: boolean; parts: Part[] };
      }> = [];
      const ctx = createMockContextWithSnippets();
      ctx.client = {
        session: {
          prompt: async (input) => {
            promptCalls.push(
              input as { path: { id: string }; body: { noReply: boolean; parts: Part[] } },
            );
          },
        },
      } as unknown as PluginInput["client"];

      const hooks = await SnippetsPlugin(ctx);
      const run = hooks["command.execute.before"];
      expect(run).toBeDefined();
      const commandOutput = {
        parts: [{ type: "text", text: "/snippets:reload" } as unknown as Part],
      } as { parts: Part[] };

      await writeFile(join(projectSnippetDir, "new-one.md"), "fresh");

      await expect(
        run?.(
          { command: "snippets:reload", sessionID: "test-session", arguments: "" },
          commandOutput,
        ),
      ).rejects.toThrow("__SNIPPETS_COMMAND_HANDLED__");

      expect(commandOutput.parts).toEqual([]);
      expect(promptCalls).toHaveLength(0);

      const userMessage = {
        role: "user",
        content: "Test message",
      } as unknown as UserMessage;

      const output = {
        message: userMessage,
        parts: [{ type: "text", text: "Use #new-one now" }] as Part[],
      };

      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        output,
      );

      expect(textOf(output.parts[0])).toBe("Use fresh now");

      await rm(tempDir, { recursive: true, force: true });
    });
  });
});
