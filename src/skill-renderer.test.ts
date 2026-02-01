import type { SkillInfo, SkillRegistry } from "./skill-loader.js";
import { expandSkillTags } from "./skill-renderer.js";

/** Helper to create a SkillInfo from just content */
function skill(content: string, name = "test"): SkillInfo {
  return { name, content, source: "global", filePath: "" };
}

/** Helper to create a registry from [key, content] pairs */
function createRegistry(entries: [string, string][]): SkillRegistry {
  return new Map(entries.map(([key, content]) => [key, skill(content, key)]));
}

describe("expandSkillTags", () => {
  describe("Block format <skill>name</skill>", () => {
    it("should expand a single skill tag", () => {
      const registry = createRegistry([["jira", "Jira skill content"]]);

      const result = expandSkillTags("Use <skill>jira</skill> for tickets", registry);

      expect(result).toBe("Use Jira skill content for tickets");
    });

    it("should expand multiple skill tags", () => {
      const registry = createRegistry([
        ["jira", "Jira skill"],
        ["github", "GitHub skill"],
      ]);

      const result = expandSkillTags("<skill>jira</skill> and <skill>github</skill>", registry);

      expect(result).toBe("Jira skill and GitHub skill");
    });

    it("should leave unknown skills unchanged", () => {
      const registry = createRegistry([["known", "Known content"]]);

      const result = expandSkillTags("<skill>known</skill> and <skill>unknown</skill>", registry);

      expect(result).toBe("Known content and <skill>unknown</skill>");
    });

    it("should be case-insensitive for skill names", () => {
      const registry = createRegistry([["jira", "Jira content"]]);

      const result = expandSkillTags("<skill>JIRA</skill> <skill>Jira</skill>", registry);

      expect(result).toBe("Jira content Jira content");
    });

    it("should trim whitespace in skill names", () => {
      const registry = createRegistry([["jira", "Jira content"]]);

      const result = expandSkillTags("<skill>  jira  </skill>", registry);

      expect(result).toBe("Jira content");
    });
  });

  describe('Self-closing format <skill name="name" />', () => {
    it("should expand skill with double quotes", () => {
      const registry = createRegistry([["jira", "Jira skill content"]]);

      const result = expandSkillTags('Use <skill name="jira" /> for tickets', registry);

      expect(result).toBe("Use Jira skill content for tickets");
    });

    it("should expand skill with single quotes", () => {
      const registry = createRegistry([["jira", "Jira skill content"]]);

      const result = expandSkillTags("Use <skill name='jira' /> for tickets", registry);

      expect(result).toBe("Use Jira skill content for tickets");
    });

    it("should expand skill without space before slash", () => {
      const registry = createRegistry([["jira", "Jira skill content"]]);

      const result = expandSkillTags('Use <skill name="jira"/> for tickets', registry);

      expect(result).toBe("Use Jira skill content for tickets");
    });

    it("should expand multiple self-closing tags", () => {
      const registry = createRegistry([
        ["jira", "Jira skill"],
        ["github", "GitHub skill"],
      ]);

      const result = expandSkillTags('<skill name="jira" /> and <skill name="github" />', registry);

      expect(result).toBe("Jira skill and GitHub skill");
    });

    it("should leave unknown skills unchanged", () => {
      const registry = createRegistry([["known", "Known content"]]);

      const result = expandSkillTags(
        '<skill name="known" /> and <skill name="unknown" />',
        registry,
      );

      expect(result).toBe('Known content and <skill name="unknown" />');
    });

    it("should be case-insensitive for skill names", () => {
      const registry = createRegistry([["jira", "Jira content"]]);

      const result = expandSkillTags('<skill name="JIRA" /> <skill name="Jira" />', registry);

      expect(result).toBe("Jira content Jira content");
    });
  });

  describe("Mixed formats", () => {
    it("should handle both formats in the same text", () => {
      const registry = createRegistry([
        ["jira", "Jira skill"],
        ["github", "GitHub skill"],
      ]);

      const result = expandSkillTags('<skill name="jira" /> and <skill>github</skill>', registry);

      expect(result).toBe("Jira skill and GitHub skill");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty registry", () => {
      const registry: SkillRegistry = new Map();

      const result = expandSkillTags("<skill>anything</skill>", registry);

      expect(result).toBe("<skill>anything</skill>");
    });

    it("should handle text without skill tags", () => {
      const registry = createRegistry([["jira", "Jira content"]]);

      const result = expandSkillTags("No skill tags here", registry);

      expect(result).toBe("No skill tags here");
    });

    it("should handle empty text", () => {
      const registry = createRegistry([["jira", "Jira content"]]);

      const result = expandSkillTags("", registry);

      expect(result).toBe("");
    });

    it("should preserve multiline skill content", () => {
      const registry = createRegistry([["jira", "Line 1\nLine 2\nLine 3"]]);

      const result = expandSkillTags("Start\n<skill>jira</skill>\nEnd", registry);

      expect(result).toBe("Start\nLine 1\nLine 2\nLine 3\nEnd");
    });

    it("should handle skill names with hyphens", () => {
      const registry = createRegistry([["my-skill", "My skill content"]]);

      const result = expandSkillTags("<skill>my-skill</skill>", registry);

      expect(result).toBe("My skill content");
    });

    it("should handle skill names with underscores", () => {
      const registry = createRegistry([["my_skill", "My skill content"]]);

      const result = expandSkillTags('<skill name="my_skill" />', registry);

      expect(result).toBe("My skill content");
    });
  });

  describe("Real-world scenarios", () => {
    it("should expand a Jira skill with custom field mappings", () => {
      const registry = createRegistry([
        [
          "jira",
          `## Jira Custom Field Mappings

When creating issues, use these field mappings:
- customfield_16570 => Acceptance Criteria
- customfield_11401 => Team`,
        ],
      ]);

      const result = expandSkillTags("Create a bug ticket in Jira. <skill>jira</skill>", registry);

      expect(result).toContain("Create a bug ticket in Jira.");
      expect(result).toContain("Jira Custom Field Mappings");
      expect(result).toContain("customfield_16570");
    });

    it("should work with snippet-style instructions", () => {
      const registry = createRegistry([
        ["careful", "Think step by step and double-check your work."],
        ["testing", "Always write tests for new functionality."],
      ]);

      const result = expandSkillTags(
        "Implement this feature. <skill>careful</skill> <skill>testing</skill>",
        registry,
      );

      expect(result).toBe(
        "Implement this feature. Think step by step and double-check your work. Always write tests for new functionality.",
      );
    });
  });
});
