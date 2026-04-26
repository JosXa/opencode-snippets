import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../src/constants.js";
import {
  addPendingDraft,
  getPendingDrafts,
  refreshPendingDraftsForText,
} from "../src/pending-drafts.js";
import type { SnippetInfo, SnippetRegistry } from "../src/types.js";

function snippet(name: string, content: string): SnippetInfo {
  return { name, content, aliases: [], description: undefined, filePath: "", source: "global" };
}

describe("pending draft reloads", () => {
  let tempDir: string;
  const originalConfigDir = PATHS.CONFIG_DIR;

  beforeEach(async () => {
    tempDir = join(process.cwd(), ".test-pending-drafts");
    await mkdir(tempDir, { recursive: true });

    Object.defineProperty(PATHS, "CONFIG_DIR", {
      value: tempDir,
      writable: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    Object.defineProperty(PATHS, "CONFIG_DIR", {
      value: originalConfigDir,
      writable: true,
      configurable: true,
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps workspace pending drafts separate", async () => {
    await addPendingDraft("/repo/a", "draft-one");
    await addPendingDraft("/repo/b", "draft-two");

    expect(await getPendingDrafts("/repo/a")).toEqual(["draft-one"]);
    expect(await getPendingDrafts("/repo/b")).toEqual(["draft-two"]);
  });

  it("keeps pending draft when reloaded content is still empty", async () => {
    const registry: SnippetRegistry = new Map([["draft", snippet("draft", "")]]);

    await addPendingDraft("/repo", "draft");
    await refreshPendingDraftsForText("Use #draft", registry, "/repo", async () => {});

    expect(await getPendingDrafts("/repo")).toEqual(["draft"]);
  });

  it("clears pending draft once reloaded content is non-empty", async () => {
    const registry: SnippetRegistry = new Map([["draft", snippet("draft", "")]]);

    await addPendingDraft("/repo", "draft");
    await refreshPendingDraftsForText("Use #draft", registry, "/repo", async () => {
      registry.set("draft", snippet("draft", "Loaded content"));
    });

    expect(await getPendingDrafts("/repo")).toEqual([]);
  });

  it("ignores pending drafts that are not used in the text", async () => {
    const registry: SnippetRegistry = new Map([["draft", snippet("draft", "")]]);
    let reloaded = false;

    await addPendingDraft("/repo", "draft");
    await refreshPendingDraftsForText("Use #other", registry, "/repo", async () => {
      reloaded = true;
    });

    expect(reloaded).toBe(false);
    expect(await getPendingDrafts("/repo")).toEqual(["draft"]);
  });
});
