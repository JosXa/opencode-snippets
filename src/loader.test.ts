import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSnippets } from "../src/loader.js";

describe("loadSnippets - Dual Path Support", () => {
  let tempDir: string;
  let globalSnippetDir: string;
  let projectSnippetDir: string;

  beforeEach(async () => {
    // Create temporary directories for testing
    tempDir = join(process.cwd(), ".test-temp");
    globalSnippetDir = join(tempDir, "global-snippet");
    projectSnippetDir = join(tempDir, "project", ".opencode", "snippet");

    await mkdir(globalSnippetDir, { recursive: true });
    await mkdir(projectSnippetDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directories
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Global snippets only", () => {
    it("should load snippets with aliases", async () => {
      await writeFile(
        join(globalSnippetDir, "careful.md"),
        `---
aliases: safe
---
Think step by step. Double-check your work.`,
      );

      const snippets = await loadSnippets(undefined, globalSnippetDir);

      expect(snippets.size).toBe(2);
      expect(snippets.get("careful")?.content).toBe("Think step by step. Double-check your work.");
      expect(snippets.get("safe")?.content).toBe("Think step by step. Double-check your work.");
    });

    it("should load multiple snippets from global directory", async () => {
      await writeFile(join(globalSnippetDir, "snippet1.md"), "Content of snippet 1");
      await writeFile(join(globalSnippetDir, "snippet2.md"), "Content of snippet 2");

      const snippets = await loadSnippets(undefined, globalSnippetDir);

      expect(snippets.size).toBe(2);
      expect(snippets.get("snippet1")?.content).toBe("Content of snippet 1");
      expect(snippets.get("snippet2")?.content).toBe("Content of snippet 2");
    });
  });

  describe("Project snippets only", () => {
    it("should load snippets from project directory", async () => {
      await writeFile(
        join(projectSnippetDir, "project-specific.md"),
        "This is a project-specific snippet",
      );

      // Load with project directory
      const projectDir = join(tempDir, "project");
      const snippets = await loadSnippets(projectDir, globalSnippetDir);

      expect(snippets.size).toBe(1);
      expect(snippets.get("project-specific")?.content).toBe("This is a project-specific snippet");
    });

    it("should handle missing global directory when project exists", async () => {
      await writeFile(join(projectSnippetDir, "team-rule.md"), "Team rule 1");
      await writeFile(join(projectSnippetDir, "domain-knowledge.md"), "Domain knowledge");

      const projectDir = join(tempDir, "project");
      const snippets = await loadSnippets(projectDir, globalSnippetDir);

      expect(snippets.size).toBe(2);
      expect(snippets.get("team-rule")?.content).toBe("Team rule 1");
      expect(snippets.get("domain-knowledge")?.content).toBe("Domain knowledge");
    });
  });

  describe("Both global and project snippets", () => {
    it("should merge global and project snippets", async () => {
      // Create global snippet
      await writeFile(join(globalSnippetDir, "global.md"), "Global snippet content");

      // Create project snippet
      await writeFile(join(projectSnippetDir, "project.md"), "Project snippet content");

      const projectDir = join(tempDir, "project");
      const snippets = await loadSnippets(projectDir, globalSnippetDir);

      expect(snippets.size).toBe(2);
      expect(snippets.get("global")?.content).toBe("Global snippet content");
      expect(snippets.get("project")?.content).toBe("Project snippet content");
    });

    it("should allow project snippets to override global snippets", async () => {
      // Create global snippet
      await writeFile(join(globalSnippetDir, "careful.md"), "Global careful content");

      // Create project snippet with same name
      await writeFile(join(projectSnippetDir, "careful.md"), "Project-specific careful content");

      const projectDir = join(tempDir, "project");
      const snippets = await loadSnippets(projectDir, globalSnippetDir);

      // Project snippet should override global
      expect(snippets.get("careful")?.content).toBe("Project-specific careful content");
      expect(snippets.size).toBe(1);
    });
  });

  describe("Alias handling", () => {
    it("should handle multiple aliases from different sources", async () => {
      // Global snippet with aliases
      await writeFile(
        join(globalSnippetDir, "review.md"),
        `---
aliases:
  - pr
  - check
---
Global review guidelines`,
      );

      // Project snippet with aliases
      await writeFile(
        join(projectSnippetDir, "test.md"),
        `---
aliases:
  - tdd
  - testing
---
Project test guidelines`,
      );

      const projectDir = join(tempDir, "project");
      const snippets = await loadSnippets(projectDir, globalSnippetDir);

      expect(snippets.size).toBe(6); // review, pr, check, test, tdd, testing
      expect(snippets.get("review")?.content).toBe("Global review guidelines");
      expect(snippets.get("pr")?.content).toBe("Global review guidelines");
      expect(snippets.get("check")?.content).toBe("Global review guidelines");
      expect(snippets.get("test")?.content).toBe("Project test guidelines");
      expect(snippets.get("tdd")?.content).toBe("Project test guidelines");
      expect(snippets.get("testing")?.content).toBe("Project test guidelines");
    });

    it("should allow project to override global aliases", async () => {
      // Global snippet with aliases
      await writeFile(
        join(globalSnippetDir, "careful.md"),
        `---
aliases:
  - safe
  - cautious
---
Global careful`,
      );

      // Project snippet with same name but different aliases
      await writeFile(
        join(projectSnippetDir, "careful.md"),
        `---
aliases: safe
---
Project careful`,
      );

      const projectDir = join(tempDir, "project");
      const snippets = await loadSnippets(projectDir, globalSnippetDir);

      // Project should override with its aliases
      expect(snippets.get("careful")?.content).toBe("Project careful");
      expect(snippets.get("safe")?.content).toBe("Project careful");
      expect(snippets.get("cautious")?.content).toBeUndefined();
      expect(snippets.size).toBe(2);
    });

    describe("alias vs aliases frontmatter key", () => {
      it("should accept 'alias' (singular) key as string", async () => {
        await writeFile(
          join(globalSnippetDir, "single-alias.md"),
          `---
alias: shortcut
---
Content with singular alias key`,
        );

        const snippets = await loadSnippets(undefined, globalSnippetDir);

        expect(snippets.size).toBe(2);
        expect(snippets.get("single-alias")?.content).toBe("Content with singular alias key");
        expect(snippets.get("shortcut")?.content).toBe("Content with singular alias key");
      });

      it("should accept 'alias' (singular) key as array", async () => {
        await writeFile(
          join(globalSnippetDir, "alias-array.md"),
          `---
alias:
  - one
  - two
---
Content with alias array`,
        );

        const snippets = await loadSnippets(undefined, globalSnippetDir);

        expect(snippets.size).toBe(3);
        expect(snippets.get("alias-array")?.content).toBe("Content with alias array");
        expect(snippets.get("one")?.content).toBe("Content with alias array");
        expect(snippets.get("two")?.content).toBe("Content with alias array");
      });

      it("should accept 'aliases' (plural) key as string", async () => {
        await writeFile(
          join(globalSnippetDir, "aliases-string.md"),
          `---
aliases: shortcut
---
Content with aliases string`,
        );

        const snippets = await loadSnippets(undefined, globalSnippetDir);

        expect(snippets.size).toBe(2);
        expect(snippets.get("aliases-string")?.content).toBe("Content with aliases string");
        expect(snippets.get("shortcut")?.content).toBe("Content with aliases string");
      });

      it("should accept 'aliases' (plural) key as array", async () => {
        await writeFile(
          join(globalSnippetDir, "aliases-array.md"),
          `---
aliases:
  - one
  - two
---
Content with aliases array`,
        );

        const snippets = await loadSnippets(undefined, globalSnippetDir);

        expect(snippets.size).toBe(3);
        expect(snippets.get("aliases-array")?.content).toBe("Content with aliases array");
        expect(snippets.get("one")?.content).toBe("Content with aliases array");
        expect(snippets.get("two")?.content).toBe("Content with aliases array");
      });

      it("should prefer 'aliases' over 'alias' when both are present", async () => {
        await writeFile(
          join(globalSnippetDir, "both-keys.md"),
          `---
aliases:
  - preferred
alias: ignored
---
Content with both keys`,
        );

        const snippets = await loadSnippets(undefined, globalSnippetDir);

        expect(snippets.size).toBe(2);
        expect(snippets.get("both-keys")?.content).toBe("Content with both keys");
        expect(snippets.get("preferred")?.content).toBe("Content with both keys");
        // The 'alias' key should be ignored since 'aliases' takes precedence
        expect(snippets.get("ignored")).toBeUndefined();
      });
    });
  });

  describe("Edge cases", () => {
    it("should handle empty snippet content", async () => {
      await writeFile(join(globalSnippetDir, "empty.md"), "");

      const snippets = await loadSnippets(undefined, globalSnippetDir);
      expect(snippets.size).toBe(1);
      expect(snippets.get("empty")?.content).toBe("");
    });

    it("should handle snippet with only metadata", async () => {
      await writeFile(
        join(globalSnippetDir, "metadata-only.md"),
        `---
description: "A snippet with only metadata"
aliases: meta
---`,
      );

      const snippets = await loadSnippets(undefined, globalSnippetDir);
      expect(snippets.size).toBe(2);
      expect(snippets.get("metadata-only")?.content).toBe("");
      expect(snippets.get("meta")?.content).toBe("");
    });

    it("should handle multiline content", async () => {
      await writeFile(
        join(globalSnippetDir, "multiline.md"),
        `Line 1
Line 2
Line 3`,
      );

      const snippets = await loadSnippets(undefined, globalSnippetDir);
      expect(snippets.get("multiline")?.content).toBe("Line 1\nLine 2\nLine 3");
    });

    it("should ignore non-.md files", async () => {
      await writeFile(join(globalSnippetDir, "not-a-snippet.txt"), "This should be ignored");
      await writeFile(join(globalSnippetDir, "valid.md"), "This should be loaded");

      const snippets = await loadSnippets(undefined, globalSnippetDir);
      expect(snippets.size).toBe(1);
      expect(snippets.get("valid")?.content).toBe("This should be loaded");
      expect(snippets.has("not-a-snippet")).toBe(false);
    });

    it("should handle invalid frontmatter", async () => {
      await writeFile(
        join(globalSnippetDir, "bad-frontmatter.md"),
        `---
invalid yaml
---
Content`,
      );

      await writeFile(join(globalSnippetDir, "special-chars.md"), "Special content");

      const snippets = await loadSnippets(undefined, globalSnippetDir);
      // Should load valid snippet, skip invalid one
      expect(snippets.get("special-chars")?.content).toBe("Special content");
    });

    it("should handle non-existent directories gracefully", async () => {
      const snippets = await loadSnippets(undefined, "/nonexistent/path");
      expect(snippets.size).toBe(0);
    });
  });

  describe("Smoke test - real global snippets", () => {
    it("should load real global snippets without crashing", async () => {
      // This is a smoke test - just verify it doesn't crash
      const snippets = await loadSnippets();

      // We don't assert specific content since we don't control user's global snippets
      // Just verify it returns a Map
      expect(snippets).toBeInstanceOf(Map);
      expect(Array.isArray(Array.from(snippets.keys()))).toBe(true);
    });
  });
});
