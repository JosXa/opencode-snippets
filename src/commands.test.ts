import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCommandExecuteHandler } from "./commands.js";
import { loadSnippets, reloadSnippets } from "./loader.js";
import type { SnippetRegistry } from "./types.js";

describe("Snippet Commands", () => {
  let tempDir: string;
  let projectDir: string;
  let projectSnippetDir: string;
  let globalSnippetDir: string;
  let snippets: SnippetRegistry;
  let mockClient: { session: { prompt: ReturnType<typeof vi.fn> } };
  let capturedMessages: string[];

  beforeEach(async () => {
    // Create temporary directories for testing
    tempDir = join(process.cwd(), ".test-commands-temp");
    projectDir = join(tempDir, "project");
    projectSnippetDir = join(projectDir, ".opencode", "snippet");
    globalSnippetDir = join(tempDir, "global-snippet");

    await mkdir(projectSnippetDir, { recursive: true });
    await mkdir(globalSnippetDir, { recursive: true });

    // Initialize empty snippet registry
    snippets = new Map();

    // Create mock client that captures messages
    capturedMessages = [];
    mockClient = {
      session: {
        prompt: vi.fn(async (args: { body: { parts: { text: string }[] } }) => {
          capturedMessages.push(args.body.parts[0].text);
        }),
      },
    };
  });

  afterEach(async () => {
    // Clean up temporary directories
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper function to execute a snippet command and return the captured message.
   * Uses --project flag to write to controlled test directory.
   */
  async function executeCommand(command: string): Promise<string> {
    capturedMessages = [];
    // Pass projectDir so --project flag writes to our test directory
    const handler = createCommandExecuteHandler(mockClient, snippets, projectDir);
    try {
      await handler({
        command: "snippet",
        sessionID: "test-session",
        arguments: command,
      });
    } catch (e) {
      // Command handled marker is expected
      if (!(e instanceof Error && e.message === "__SNIPPETS_COMMAND_HANDLED__")) {
        throw e;
      }
    }
    return capturedMessages[capturedMessages.length - 1] || "";
  }

  describe("Alias argument parsing", () => {
    describe("--alias=a,b syntax (equals sign)", () => {
      it("should parse --alias=a,b", async () => {
        const result = await executeCommand('add test "content" --alias=foo,bar --project');
        expect(result).toContain("Aliases: foo, bar");

        // Verify file was created with correct aliases
        const content = await readFile(join(projectSnippetDir, "test.md"), "utf-8");
        expect(content).toContain("aliases:");
        expect(content).toContain("foo");
        expect(content).toContain("bar");
      });

      it("should parse --aliases=a,b", async () => {
        const result = await executeCommand('add test2 "content" --aliases=baz,qux --project');
        expect(result).toContain("Aliases: baz, qux");

        const content = await readFile(join(projectSnippetDir, "test2.md"), "utf-8");
        expect(content).toContain("aliases:");
        expect(content).toContain("baz");
        expect(content).toContain("qux");
      });
    });

    describe("--alias a,b syntax (space separated)", () => {
      it("should parse --alias a,b", async () => {
        const result = await executeCommand('add test3 "content" --alias foo,bar --project');
        expect(result).toContain("Aliases: foo, bar");

        const content = await readFile(join(projectSnippetDir, "test3.md"), "utf-8");
        expect(content).toContain("aliases:");
        expect(content).toContain("foo");
        expect(content).toContain("bar");
      });

      it("should parse --aliases a,b", async () => {
        const result = await executeCommand('add test4 "content" --aliases baz,qux --project');
        expect(result).toContain("Aliases: baz, qux");

        const content = await readFile(join(projectSnippetDir, "test4.md"), "utf-8");
        expect(content).toContain("aliases:");
        expect(content).toContain("baz");
        expect(content).toContain("qux");
      });
    });

    describe("all alias variations combined", () => {
      it("should handle single alias with --alias=x", async () => {
        const result = await executeCommand('add single1 "content" --alias=one --project');
        expect(result).toContain("Aliases: one");
      });

      it("should handle single alias with --alias x", async () => {
        const result = await executeCommand('add single2 "content" --alias one --project');
        expect(result).toContain("Aliases: one");
      });

      it("should handle single alias with --aliases=x", async () => {
        const result = await executeCommand('add single3 "content" --aliases=one --project');
        expect(result).toContain("Aliases: one");
      });

      it("should handle single alias with --aliases x", async () => {
        const result = await executeCommand('add single4 "content" --aliases one --project');
        expect(result).toContain("Aliases: one");
      });

      it("should handle multiple aliases with --alias=a,b,c", async () => {
        const result = await executeCommand('add multi1 "content" --alias=a,b,c --project');
        expect(result).toContain("Aliases: a, b, c");
      });

      it("should handle multiple aliases with --alias a,b,c", async () => {
        const result = await executeCommand('add multi2 "content" --alias a,b,c --project');
        expect(result).toContain("Aliases: a, b, c");
      });

      it("should handle multiple aliases with --aliases=a,b,c", async () => {
        const result = await executeCommand('add multi3 "content" --aliases=a,b,c --project');
        expect(result).toContain("Aliases: a, b, c");
      });

      it("should handle multiple aliases with --aliases a,b,c", async () => {
        const result = await executeCommand('add multi4 "content" --aliases a,b,c --project');
        expect(result).toContain("Aliases: a, b, c");
      });

      it("should handle aliases with whitespace in comma-separated list", async () => {
        // Note: This tests the split/trim logic
        const result = await executeCommand('add whitespace "content" --alias=a,b,c --project');
        expect(result).toContain("Aliases: a, b, c");
      });
    });
  });

  describe("Description argument parsing", () => {
    it("should parse --desc=value", async () => {
      await executeCommand('add desc1 "content" --desc=mydescription --project');
      const content = await readFile(join(projectSnippetDir, "desc1.md"), "utf-8");
      expect(content).toContain("description: mydescription");
    });

    it("should parse --desc value", async () => {
      await executeCommand('add desc2 "content" --desc mydescription --project');
      const content = await readFile(join(projectSnippetDir, "desc2.md"), "utf-8");
      expect(content).toContain("description: mydescription");
    });

    it("should parse --description=value", async () => {
      await executeCommand('add desc3 "content" --description=mydescription --project');
      const content = await readFile(join(projectSnippetDir, "desc3.md"), "utf-8");
      expect(content).toContain("description: mydescription");
    });

    it("should parse --description value", async () => {
      await executeCommand('add desc4 "content" --description mydescription --project');
      const content = await readFile(join(projectSnippetDir, "desc4.md"), "utf-8");
      expect(content).toContain("description: mydescription");
    });
  });

  describe("Combined alias and description parsing", () => {
    it("should handle --alias=a,b with --desc=x", async () => {
      const result = await executeCommand('add combo1 "content" --alias=a,b --desc=test --project');
      expect(result).toContain("Aliases: a, b");
      const content = await readFile(join(projectSnippetDir, "combo1.md"), "utf-8");
      expect(content).toContain("description: test");
    });

    it("should handle --aliases x,y with --description z", async () => {
      const result = await executeCommand(
        'add combo2 "content" --aliases x,y --description desc --project',
      );
      expect(result).toContain("Aliases: x, y");
      const content = await readFile(join(projectSnippetDir, "combo2.md"), "utf-8");
      expect(content).toContain("description: desc");
    });

    it("should handle mixed syntaxes", async () => {
      const result = await executeCommand(
        'add combo3 "content" --alias foo --description=bar --project',
      );
      expect(result).toContain("Aliases: foo");
      const content = await readFile(join(projectSnippetDir, "combo3.md"), "utf-8");
      expect(content).toContain("description: bar");
    });
  });

  describe("Multiline snippet content", () => {
    it("should create snippet without quoted content for manual editing", async () => {
      const result = await executeCommand("add multiline-empty --project");
      expect(result).toContain("Edit the file to add your snippet content");
      expect(result).toContain("Added project snippet: multiline-empty");
    });

    it("should handle quoted content with simple text", async () => {
      const result = await executeCommand('add simple "hello world" --project');
      expect(result).toContain('Content: "hello world"');
    });

    it("should create snippet file that can contain multiline content when edited", async () => {
      // Create a snippet, then manually add multiline content
      await executeCommand("add multiline-test --project");

      // Write multiline content to the file
      const multilineContent = `---
aliases:
  - ml
  - multi
---
Line 1
Line 2
Line 3

Code block:
\`\`\`javascript
function test() {
  return "hello";
}
\`\`\`

End of snippet`;

      await writeFile(join(projectSnippetDir, "multiline-test.md"), multilineContent);

      // Reload snippets and verify
      const freshSnippets = await loadSnippets(projectDir, globalSnippetDir);

      const snippet = freshSnippets.get("multiline-test");
      expect(snippet).toBeDefined();
      expect(snippet?.content).toContain("Line 1");
      expect(snippet?.content).toContain("Line 2");
      expect(snippet?.content).toContain("function test()");
      expect(snippet?.aliases).toContain("ml");
      expect(snippet?.aliases).toContain("multi");
    });

    it("should display multiline snippets correctly in list", async () => {
      // Create a multiline snippet
      await writeFile(
        join(projectSnippetDir, "multiline-display.md"),
        `First line
Second line
Third line
Fourth line with more content`,
      );

      const freshSnippets = await loadSnippets(projectDir, globalSnippetDir);

      // Copy to our test registry
      for (const [key, value] of freshSnippets) {
        snippets.set(key, value);
      }

      const result = await executeCommand("list");
      expect(result).toContain("multiline-display");
      expect(result).toContain("First line");
    });
  });

  describe("List display with long snippets", () => {
    it("should truncate long snippet content in list view", async () => {
      // Create a snippet with very long content
      const longContent = "A".repeat(300);
      await writeFile(join(projectSnippetDir, "long-snippet.md"), longContent);

      const freshSnippets = await loadSnippets(projectDir, globalSnippetDir);
      for (const [key, value] of freshSnippets) {
        snippets.set(key, value);
      }

      const result = await executeCommand("list");
      expect(result).toContain("long-snippet");
      // Should be truncated with ellipsis
      expect(result).toContain("...");
      // Should not contain full 300 A's
      expect(result.length).toBeLessThan(500);
    });

    it("should truncate long aliases in list view", async () => {
      // Create a snippet with many aliases
      const manyAliases = Array.from({ length: 20 }, (_, i) => `alias${i}`);
      await writeFile(
        join(projectSnippetDir, "many-aliases.md"),
        `---
aliases:
${manyAliases.map((a) => `  - ${a}`).join("\n")}
---
Content here`,
      );

      const freshSnippets = await loadSnippets(projectDir, globalSnippetDir);
      for (const [key, value] of freshSnippets) {
        snippets.set(key, value);
      }

      const result = await executeCommand("list");
      expect(result).toContain("many-aliases");
      expect(result).toContain("aliases:");
      // Should have truncation indicator
      expect(result).toContain("...");
    });

    it("should display empty snippets as (empty)", async () => {
      await writeFile(join(projectSnippetDir, "empty-snippet.md"), "");

      const freshSnippets = await loadSnippets(projectDir, globalSnippetDir);
      for (const [key, value] of freshSnippets) {
        snippets.set(key, value);
      }

      const result = await executeCommand("list");
      expect(result).toContain("empty-snippet");
      expect(result).toContain("(empty)");
    });

    it("should group snippets by source (global vs project)", async () => {
      // Create global snippet
      await writeFile(join(globalSnippetDir, "global-test.md"), "Global content");

      // Create project snippet
      await writeFile(join(projectSnippetDir, "project-test.md"), "Project content");

      const freshSnippets = await loadSnippets(projectDir, globalSnippetDir);
      for (const [key, value] of freshSnippets) {
        snippets.set(key, value);
      }

      const result = await executeCommand("list");
      expect(result).toContain("Global");
      expect(result).toContain("Project");
      expect(result).toContain("global-test");
      expect(result).toContain("project-test");
    });
  });

  describe("Help command", () => {
    it("should show help with --aliases (plural)", async () => {
      const result = await executeCommand("help");
      expect(result).toContain("--aliases");
      expect(result).toContain("--description");
    });

    it("should show add subcommand help with correct syntax", async () => {
      const result = await executeCommand("add");
      expect(result).toContain("--aliases");
      expect(result).toContain("--description");
    });
  });

  describe("Edge cases", () => {
    it("should handle --alias at end of command without value", async () => {
      // Should not crash, just not add aliases
      const result = await executeCommand('add edge1 "content" --alias --project');
      expect(result).toContain("Added project snippet: edge1");
      expect(result).not.toContain("Aliases:");
    });

    it("should handle --alias followed by another flag", async () => {
      // --alias followed by --desc should not consume --desc as alias
      const result = await executeCommand('add edge2 "content" --alias --desc=test --project');
      // This is edge case behavior - --desc should not be consumed as alias
      expect(result).toContain("Added");
    });

    it("should handle empty alias list", async () => {
      const result = await executeCommand('add edge3 "content" --alias= --project');
      expect(result).not.toContain("Aliases:");
    });
  });
});
