import { describe, expect, test } from "bun:test";
import type { SkillInfo } from "./skill-loader.js";
import {
  filterSkills,
  filterSnippets,
  highlightMatches,
  matchedAliases,
  snippetDescription,
} from "./tui-search.js";
import type { SnippetInfo } from "./types.js";

function snippet(
  overrides: Partial<SnippetInfo> & Pick<SnippetInfo, "name" | "content">,
): SnippetInfo {
  return {
    aliases: [],
    source: "global",
    description: undefined,
    filePath: `/tmp/${overrides.name}.md`,
    ...overrides,
  };
}

function skill(overrides: Partial<SkillInfo> & Pick<SkillInfo, "name" | "content">): SkillInfo {
  return {
    source: "global",
    description: undefined,
    filePath: `/tmp/${overrides.name}/SKILL.md`,
    ...overrides,
  };
}

describe("filterSnippets", () => {
  test("prefers prefix matches before substring matches", () => {
    const result = filterSnippets(
      [
        snippet({ name: "grab-bag", content: "substring only" }),
        snippet({ name: "ab-helper", content: "prefix match" }),
      ],
      "ab",
    );

    expect(result.map((item) => item.name)).toEqual(["ab-helper", "grab-bag"]);
  });

  test("matches aliases by substring", () => {
    const result = filterSnippets(
      [
        snippet({ name: "review", aliases: ["abbr"], content: "alias hit" }),
        snippet({ name: "other", content: "miss" }),
      ],
      "bb",
    );

    expect(result.map((item) => item.name)).toEqual(["review"]);
  });

  test("does not match snippet body content", () => {
    const result = filterSnippets(
      [
        snippet({ name: "ship", content: "contains zebra token" }),
        snippet({ name: "review", content: "different body" }),
      ],
      "zebra",
    );

    expect(result).toEqual([]);
  });

  test("prefers project snippets when scores tie", () => {
    const result = filterSnippets(
      [
        snippet({ name: "abc-global", content: "x" }),
        snippet({ name: "abc-project", content: "x", source: "project" }),
      ],
      "abc",
    );

    expect(result.map((item) => item.name)).toEqual(["abc-project", "abc-global"]);
  });

  test("returns all matches instead of truncating to a fixed top slice", () => {
    const result = filterSnippets(
      Array.from({ length: 12 }, (_, index) =>
        snippet({ name: `match-${index.toString().padStart(2, "0")}`, content: "x" }),
      ),
      "match",
    );

    expect(result).toHaveLength(12);
  });

  test("matches compact queries against hyphenated snippet names and aliases", () => {
    const result = filterSnippets(
      [
        snippet({ name: "skill-smoke", aliases: ["skill smoke"], content: "x" }),
        snippet({ name: "other", content: "x" }),
      ],
      "skillsmoke",
    );

    expect(result.map((item) => item.name)).toEqual(["skill-smoke"]);
  });

  test("does not keep stale matches for unrelated garbage queries", () => {
    const result = filterSnippets(
      [snippet({ name: "git-context", aliases: ["ctx", "warmup"], content: "x" })],
      "abaaaaaaasdfjoiwj",
    );

    expect(result).toEqual([]);
  });
});

describe("filterSkills", () => {
  test("matches skill names directly", () => {
    const result = filterSkills(
      [skill({ name: "caveman", content: "smart caveman mode" })],
      "caveman",
    );

    expect(result.map((item) => item.name)).toEqual(["caveman"]);
  });

  test("matches skill(tag) text so users can type skill(caveman)", () => {
    const result = filterSkills(
      [skill({ name: "caveman", content: "smart caveman mode" })],
      "skill(cave",
    );

    expect(result.map((item) => item.name)).toEqual(["caveman"]);
  });

  test("returns all skills for an empty query", () => {
    const result = filterSkills(
      [skill({ name: "caveman", content: "x" }), skill({ name: "opencode-config", content: "x" })],
      "",
    );

    expect(result).toHaveLength(2);
  });

  test("matches compact queries against skill(tag) text", () => {
    const result = filterSkills(
      [skill({ name: "smoke-testing-snippets", content: "x" })],
      "skillsmoke",
    );

    expect(result.map((item) => item.name)).toEqual(["smoke-testing-snippets"]);
  });

  test("keeps matching when compact query shrinks during deletion", () => {
    const result = filterSkills([skill({ name: "demo-voice", content: "x" })], "demovoic");

    expect(result.map((item) => item.name)).toEqual(["demo-voice"]);
  });
});

describe("snippetDescription", () => {
  test("prefers description over content", () => {
    expect(
      snippetDescription(
        snippet({ name: "review", description: "One line", content: "Longer body text" }),
      ),
    ).toBe("One line");
  });

  test("keeps the full text and only normalizes whitespace", () => {
    expect(
      snippetDescription(
        snippet({
          name: "review",
          description: "This is\n\n a much longer description that should stay intact",
          content: "body",
        }),
      ),
    ).toBe("This is a much longer description that should stay intact");
  });
});

describe("matchedAliases", () => {
  test("returns the aliases whose text matches the current query", () => {
    expect(
      matchedAliases(
        snippet({
          name: "opencode-run-instructions",
          aliases: ["ocr", "opencode run"],
          content: "body",
        }),
        "run",
      ),
    ).toEqual(["opencode run"]);
  });

  test("returns an exact short alias match", () => {
    expect(
      matchedAliases(
        snippet({
          name: "opencode-run-instructions",
          aliases: ["ocr", "opencode run"],
          content: "body",
        }),
        "ocr",
      ),
    ).toEqual(["ocr"]);
  });

  test("returns an empty list when aliases do not match", () => {
    expect(
      matchedAliases(snippet({ name: "review", aliases: ["rvw"], content: "body" }), "zz"),
    ).toEqual([]);
  });

  test("matches aliases even when the query drops separators", () => {
    expect(
      matchedAliases(
        snippet({ name: "skill-smoke", aliases: ["skill smoke"], content: "body" }),
        "skillsmoke",
      ),
    ).toEqual(["skill smoke"]);
  });
});

describe("highlightMatches", () => {
  test("highlights case-insensitive substring matches", () => {
    expect(highlightMatches("#Abacus", "ab")).toEqual([
      { text: "#", match: false },
      { text: "Ab", match: true },
      { text: "acus", match: false },
    ]);
  });

  test("highlights repeated matches", () => {
    expect(highlightMatches("abab", "ab")).toEqual([
      { text: "ab", match: true },
      { text: "ab", match: true },
    ]);
  });

  test("returns plain text when nothing matches", () => {
    expect(highlightMatches("review", "zz")).toEqual([{ text: "review", match: false }]);
  });
});
