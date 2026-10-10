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
  return new Map(entries.map(([name, content]) => [name.toLowerCase(), skill(name, content)]));
}

function createSnippets(entries: Array<[string, string]>): SnippetRegistry {
  return new Map(entries.map(([name, content]) => [name, snippet(name, content)]));
}

const options = {
  expandSkillTagsInContent: false,
  extractInject: false,
};

describe("expandSkillLoads", () => {
  it("loads a bare dollar invocation automatically", async () => {
    const result = await expandSkillLoads(
      "$guide",
      createSkills([["guide", "GUIDE_BODY"]]),
      new Map(),
      options,
    );
    expect(result.text).toBe("↳ Loaded guide");
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0]).toContain("GUIDE_BODY");
  });

  it("preserves order and occurrence counts across dollar and legacy forms", async () => {
    const skills = createSkills([
      ["first", "FIRST_BODY"],
      ["second", "SECOND_BODY"],
    ]);
    const result = await expandSkillLoads(
      '$second #skill("first") $second',
      skills,
      new Map(),
      options,
    );
    expect(result.text).toBe("↳ Loaded second ↳ Loaded first ↳ Loaded second");
    expect(
      result.payloads.map((payload) => payload.match(/<skill_content name="([^"]+)">/)?.[1]),
    ).toEqual(["second", "first", "second"]);
  });

  it("retains unknown dollars and quoted display names without overlapping matches", async () => {
    const skills = createSkills([
      ["Release Notes", "RELEASE_BODY"],
      ["$guide", "QUOTED_BODY"],
      ["guide", "GUIDE_BODY"],
    ]);
    const result = await expandSkillLoads(
      '$unknown #skill("Release Notes") #skill("$guide")',
      skills,
      new Map(),
      options,
    );
    expect(result.text).toBe("$unknown ↳ Loaded Release Notes ↳ Loaded $guide");
    expect(result.payloads).toHaveLength(2);
  });

  it("does not load dollar references in code or executable substitution text", async () => {
    const text = '$guide$ `echo "$guide"` !`printf "%s" "$guide"` \\$guide $HOME';
    const result = await expandSkillLoads(
      text,
      createSkills([
        ["guide", "GUIDE_BODY"],
        ["home", "HOME_BODY"],
      ]),
      new Map(),
      options,
    );
    expect(result.text).toBe(text);
    expect(result.payloads).toEqual([]);
  });

  it("does not recursively load dollar references from skill bodies", async () => {
    const skills = createSkills([
      ["guide", "$nested"],
      ["nested", "NESTED_BODY"],
    ]);
    const result = await expandSkillLoads("$guide", skills, new Map(), options);
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0]).toContain("$nested");
    expect(result.payloads[0]).not.toContain("NESTED_BODY");
  });

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
