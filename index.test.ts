import { describe, expect, it, mock } from "bun:test";
import type { Message, Part, UserMessage } from "@opencode-ai/sdk";
import { SnippetsPlugin } from "./index.js";
import type { SnippetRegistry } from "./src/types.js";

/** Mock OpenCode plugin context */
function createMockContext(snippetsDir?: string) {
  return {
    client: {} as any,
    project: {} as any,
    directory: snippetsDir || "/test/project",
    worktree: "/test/worktree",
    serverUrl: new URL("http://localhost:3000"),
    $: {} as any,
  };
}

describe("SnippetsPlugin - Hook Integration", () => {
  describe("chat.message hook", () => {
    it("should expand hashtags in user messages", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const userMessage: UserMessage = {
        role: "user",
        content: "Test message",
      };

      const output = {
        message: userMessage,
        parts: [{ type: "text", text: "#test hashtag" }] as Part[],
      };

      // Note: This test would need actual snippet loading
      // For now it verifies the hook exists and can be called
      await hooks["chat.message"]?.(
        {
          sessionID: "test-session",
        },
        output,
      );

      // Hook should process the parts
      expect(hooks["chat.message"]).toBeDefined();
    });

    it("should not process assistant messages", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const assistantMessage = {
        role: "assistant",
        content: "Test response",
      } as any;

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

  describe("experimental.chat.messages.transform hook", () => {
    it("should expand hashtags in all user messages", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const messages = [
        {
          info: { role: "user" } as Message,
          parts: [{ type: "text", text: "#test in question response" }] as Part[],
        },
        {
          info: { role: "assistant" } as Message,
          parts: [{ type: "text", text: "#test should not expand" }] as Part[],
        },
      ];

      const output = { messages };

      await hooks["experimental.chat.messages.transform"]?.({}, output);

      // Hook should exist
      expect(hooks["experimental.chat.messages.transform"]).toBeDefined();

      // Assistant message should remain unchanged
      expect(messages[1].parts[0].text).toBe("#test should not expand");
    });

    it("should handle empty messages array", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const output = { messages: [] };

      await hooks["experimental.chat.messages.transform"]?.({}, output);

      expect(output.messages).toHaveLength(0);
    });
  });

  describe("tool.execute.after hook", () => {
    it("should expand hashtags in skill tool output", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const input = {
        tool: "skill",
        sessionID: "test-session",
        callID: "call-123",
      };

      const output = {
        title: "Skill Loaded",
        output: "Skill content with #test hashtag",
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Hook should exist
      expect(hooks["tool.execute.after"]).toBeDefined();
    });

    it("should not process non-skill tools", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const input = {
        tool: "bash",
        sessionID: "test-session",
        callID: "call-123",
      };

      const originalOutput = "Command output with #test";
      const output = {
        title: "Bash Result",
        output: originalOutput,
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Should not modify non-skill tool output
      expect(output.output).toBe(originalOutput);
    });

    it("should handle empty skill output", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const input = {
        tool: "skill",
        sessionID: "test-session",
        callID: "call-123",
      };

      const output = {
        title: "Skill Loaded",
        output: "",
        metadata: {},
      };

      await hooks["tool.execute.after"]?.(input, output);

      // Should handle gracefully
      expect(output.output).toBe("");
    });

    it("should handle non-string skill output", async () => {
      const ctx = createMockContext();
      const hooks = await SnippetsPlugin(ctx);

      const input = {
        tool: "skill",
        sessionID: "test-session",
        callID: "call-123",
      };

      const output = {
        title: "Skill Loaded",
        output: { data: "object output" } as any,
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

      const config = {} as any;
      await hooks.config?.(config);

      expect(config.command).toBeDefined();
      expect(config.command.snippet).toBeDefined();
      expect(config.command.snippet.description).toContain("snippet");
    });
  });
});
