import { describe, expect, test } from "bun:test";
import {
  findTrailingHashtagTrigger,
  insertSnippetTag,
  replaceTrailingHashtag,
  truncateSnippetPreview,
} from "./tui-trigger.js";

describe("findTrailingHashtagTrigger", () => {
  test("matches a hashtag at the start of input", () => {
    expect(findTrailingHashtagTrigger("#review")).toEqual({
      start: 0,
      end: 7,
      query: "review",
      token: "#review",
    });
  });

  test("matches a hashtag after whitespace", () => {
    expect(findTrailingHashtagTrigger("please #review")).toEqual({
      start: 7,
      end: 14,
      query: "review",
      token: "#review",
    });
  });

  test("matches an empty hashtag query", () => {
    expect(findTrailingHashtagTrigger("please #")).toEqual({
      start: 7,
      end: 8,
      query: "",
      token: "#",
    });
  });

  test("does not match hashes inside file line ranges", () => {
    expect(findTrailingHashtagTrigger("src/app.ts#12-20")).toBeUndefined();
  });

  test("does not match when the hashtag is not at the cursor end", () => {
    expect(findTrailingHashtagTrigger("#review later")).toBeUndefined();
  });
});

describe("replaceTrailingHashtag", () => {
  test("replaces the active trailing hashtag and adds a space", () => {
    expect(replaceTrailingHashtag("please #rev", "review")).toBe("please #review ");
  });

  test("returns undefined when there is no active trailing hashtag", () => {
    expect(replaceTrailingHashtag("please review", "review")).toBeUndefined();
  });
});

describe("insertSnippetTag", () => {
  test("replaces the trailing hashtag when present", () => {
    expect(insertSnippetTag("please #rev", "review")).toBe("please #review ");
  });

  test("appends a snippet tag to an empty prompt", () => {
    expect(insertSnippetTag("", "review")).toBe("#review ");
  });

  test("appends with a separating space when needed", () => {
    expect(insertSnippetTag("please review", "checklist")).toBe("please review #checklist ");
  });
});

describe("truncateSnippetPreview", () => {
  test("normalizes whitespace", () => {
    expect(truncateSnippetPreview("hello\n\nworld", 20)).toBe("hello world");
  });

  test("truncates long previews", () => {
    expect(truncateSnippetPreview("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefg...");
  });
});
