import { describe, expect, test } from "bun:test";
import {
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
