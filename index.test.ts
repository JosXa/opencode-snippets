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
    client: {} as PluginInput["client"],
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
    client: {} as PluginInput["client"],
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

    it("should inject hidden skill payloads before the visible user message", async () => {
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

      expect(output.messages).toHaveLength(2);
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="careful">');
      expect(
        textOf(output.messages[0].parts[0])?.indexOf('<skill_content name="caveman">'),
      ).toBeLessThan(
        textOf(output.messages[0].parts[0])?.indexOf('<skill_content name="careful">') || 0,
      );
      expect(textOf(output.messages[1].parts[0])).toBe(
        "Load ↳ Loaded caveman and ↳ Loaded careful",
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

      expect(output.messages).toHaveLength(2);
      expect(textOf(output.messages[0].parts[0])).toContain('<skill_content name="caveman">');
      expect(textOf(output.messages[1].parts[0])).toBe("Load ↳ Loaded caveman");
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
    it("should register /snippet command", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const config: Partial<Config> = {};
      await hooks.config?.(config as Config);

      expect(config.command).toBeDefined();
      expect(config.command?.snippet).toBeDefined();
      expect(config.command?.snippet?.description).toContain("snippet");
    });
  });
});
