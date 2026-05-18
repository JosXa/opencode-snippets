import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSnippetDir } from "./constants.js";

describe("resolveSnippetDir", () => {
  let tmp: string;
  let preferred: string;
  let alt: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `resolve-snippet-dir-${Date.now()}`);
    preferred = join(tmp, "snippet");
    alt = join(tmp, "snippets");
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("neither exists, use preferred dir (will be created)", () => {
    expect(resolveSnippetDir(preferred, alt)).toBe(preferred);
  });

  it("only alt exists, use alt dir (avoids creating redundant preferred dir)", () => {
    mkdirSync(alt);
    expect(resolveSnippetDir(preferred, alt)).toBe(alt);
  });

  it("only preferred exists, use preferred dir", () => {
    mkdirSync(preferred);
    expect(resolveSnippetDir(preferred, alt)).toBe(preferred);
  });

  it("both exist, use preferred dir", () => {
    mkdirSync(preferred);
    mkdirSync(alt);
    expect(resolveSnippetDir(preferred, alt)).toBe(preferred);
  });
});
