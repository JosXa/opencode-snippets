import { describe, expect, test } from "bun:test";
import { findDollarSkillLoads, formatSkillLoad } from "./skill-invocation.js";

describe("dollar skill invocations", () => {
  test.each([
    ["$review", ["review"]],
    ["$first $second", ["first", "second"]],
    ["$first\n$second", ["first", "second"]],
    ["($review), [$host:proof]; $review: findings.", ["review", "host:proof", "review"]],
    ['"$review" $1password $review.', ["review", "1password", "review"]],
  ])("extracts complete IDs from %s", (text, names) => {
    const matches = findDollarSkillLoads(text);
    expect(matches.map((match) => match.name)).toEqual(names);
    for (const match of matches) expect(text.slice(match.start, match.end)).toBe(`$${match.name}`);
  });

  test.each([
    "foo$review",
    "\\$review",
    "/\\$review\\b/",
    "/$review/",
    "/($review)/",
    "pattern = /($review)/g",
    "/[/$review($other)]/",
    "$review.path",
    "$review/path",
    "$review\\path",
    "$review(arguments)",
    "$review[0]",
    "$review::proof",
    "$reviewExtra",
    "$reviewé",
    "$HOME",
    "$Review",
    "$100",
    "$_review",
    `\${review}`,
    "$(pwd)",
    "$$review",
    "$review$",
    "$review + x$",
    "$$\n$review\n$$",
    '`echo "$review"`',
    "``echo `$review` now``",
    '!`printf "%s" "$review"`',
    '!>`printf "%s" "$review"`',
    "```sh\n$review\n```",
    "~~~sh\n$review\n~~~",
    "```sh\n$review",
    "`unfinished $review",
    "    $review",
    "\t$review",
  ])("keeps literal syntax unchanged: %s", (text) => {
    expect(findDollarSkillLoads(text)).toEqual([]);
  });

  test.each([
    "`$inside` $outside",
    "```sh\n$inside\n````\n$outside",
    "~~~sh\n$inside\n~~~~\n$outside",
    "``one ` $inside`` $outside",
    "$inside$ $outside",
    "$$\n$inside\n$$ $outside",
    "    $inside\n$outside",
    "/($inside)/g $outside",
    "/[/$inside($other)]/ $outside",
  ])("resumes matching after a literal region: %s", (text) => {
    expect(findDollarSkillLoads(text).map((match) => match.name)).toEqual(["outside"]);
  });

  test("only completion recognizes an empty dollar query", () => {
    expect(findDollarSkillLoads("中🙂 $")).toEqual([]);
    expect(findDollarSkillLoads("中🙂 $", true)).toEqual([{ start: 4, end: 5, name: "" }]);
    expect(findDollarSkillLoads(`\${review}`, true)).toEqual([]);
  });

  test("an unfinished regex with many character classes cannot trap the scanner", () => {
    const text = `/${"[aaaa]".repeat(2000)} $outside`;
    expect(findDollarSkillLoads(text).map((match) => match.name)).toEqual(["outside"]);
  });
});

describe("skill invocation formatting", () => {
  test.each(["review", "host:proof", "plugin:remote", "1password"])("prefers $%s", (name) => {
    expect(formatSkillLoad(name)).toBe(`$${name}`);
  });
  test.each([
    "Release Notes",
    "Review",
    "100",
    "host/proof",
    "review.extra",
  ])("retains the quoted legacy form for %s", (name) =>
    expect(formatSkillLoad(name)).toBe(`#skill(${JSON.stringify(name)})`));
});
