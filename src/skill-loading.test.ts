import { describe, expect, it } from "bun:test";
import type { SkillInfo, SkillRegistry } from "./skill-loader.js";
import { expandSkillLoads } from "./skill-loading.js";
import type { SnippetInfo, SnippetRegistry } from "./types.js";

function skill(name: string, content: string): SkillInfo {
  return {
    name,
    content,
    source: "global",
    filePath: `/skills/${name}/SKILL.md`,
  };
}

function snippet(name: string, content: string): SnippetInfo {
  return {
    name,
    content,
    aliases: [],
    filePath: `/snippets/${name}.md`,
    source: "global",
  };
}

function createSkills(entries: Array<[string, string]>): SkillRegistry {
  return new Map(entries.map(([name, content]) => [name, skill(name, content)]));
}

function createSnippets(entries: Array<[string, string]>): SnippetRegistry {
  return new Map(entries.map(([name, content]) => [name, snippet(name, content)]));
}

const options = {
  expandSkillTagsInContent: false,
  extractInject: false,
};

describe("expandSkillLoads", () => {
  it("expands snippets, blocks, and shell substitutions in #skill() payloads", async () => {
    const skills = createSkills([["guide", "Skill instructions: #exact-behavior"]]);
    const snippets = createSnippets([
      [
        "exact-behavior",
        "Inline !>`printf skill-shell`\n<prepend>\nPrepend guidance\n</prepend>\n<append>\nAppend guidance\n</append>",
      ],
    ]);

    const result = await expandSkillLoads("Use #skill(guide)", skills, snippets, options);

    expect(result.text).toBe("Use ↳ Loaded guide");
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0]).toContain(
      "Prepend guidance\n\nSkill instructions: Inline $ printf skill-shell\n--> skill-shell\n\nAppend guidance",
    );
  });

  it("keeps nested #skill() syntax in a skill payload", async () => {
    const skills = createSkills([
      ["guide", "Use #skill(nested) only when required."],
      ["nested", "Nested skill content"],
    ]);

    const result = await expandSkillLoads("#skill(guide)", skills, new Map(), options);

    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0]).toContain("Use #skill(nested) only when required.");
    expect(result.payloads[0]).not.toContain("Nested skill content");
  });
});
