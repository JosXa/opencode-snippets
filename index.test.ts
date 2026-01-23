import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { Config, Message, Part, UserMessage } from "@opencode-ai/sdk";
import { SnippetsPlugin } from "./index.js";

/** Temp directory for test snippets */
let tempDir: string;
let globalSnippetDir: string;
let projectSnippetDir: string;

/** Mock OpenCode plugin context */
function createMockContext(snippetsDir?: string): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: "/test/worktree",
      time: { created: new Date().toISOString() },
    },
    directory: snippetsDir || "/test/project",
    worktree: "/test/worktree",
    serverUrl: new URL("http://localhost:3000"),
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
      time: { created: new Date().toISOString() },
    },
    directory: join(tempDir, "project"),
    worktree: join(tempDir, "project"),
    serverUrl: new URL("http://localhost:3000"),
    $: {} as PluginInput["$"],
  };
}

describe("SnippetsPlugin - Hook Integration", () => {
  describe("chat.message hook with actual snippets", () => {
    beforeEach(async () => {
      // Create temp directory structure
      tempDir = join(import.meta.dir, ".test-snippets-" + Date.now());
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

      const userMessage: UserMessage = {
        role: "user",
        content: "Test message",
      };

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
      expect(output.parts[0].text).toBe("Say Hello, I am a test snippet! please");
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
      expect(output.parts[0].text).toBe("#test hashtag");
    });
  });

  describe("experimental.chat.messages.transform hook with actual snippets", () => {
    beforeEach(async () => {
      // Create temp directory structure
      tempDir = join(import.meta.dir, ".test-snippets-transform-" + Date.now());
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
      expect(messages[0].parts[0].text).toBe(
        "Please provide detailed information. Answer my query",
      );

      // Assistant message should remain unchanged
      expect(messages[1].parts[0].text).toBe("#question-hint should not expand");
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
  });

  describe("tool.execute.after hook with actual snippets", () => {
    /** Type for tool.execute.after hook input */
    type ToolExecuteInput = {
      tool: string;
      sessionID: string;
      callID: string;
    };

    /** Type for tool.execute.after hook output */
    type ToolExecuteOutput = {
      title: string;
      output: string;
      metadata: unknown;
    };

    beforeEach(async () => {
      // Create temp directory structure
      tempDir = join(import.meta.dir, ".test-snippets-tool-" + Date.now());
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
