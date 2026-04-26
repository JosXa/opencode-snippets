import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../src/constants.js";
import { consumeSnippetReloadRequest, markSnippetReloadRequested } from "../src/reload-signal.js";

describe("snippet reload signal", () => {
  let tempDir: string;
  const originalConfigDir = PATHS.CONFIG_DIR;

  beforeEach(async () => {
    tempDir = join(process.cwd(), ".test-reload-signal");
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

  it("consumes a one-shot reload request", async () => {
    await markSnippetReloadRequested("/repo");

    expect(await consumeSnippetReloadRequest("/repo")).toBe(true);
    expect(await consumeSnippetReloadRequest("/repo")).toBe(false);
  });

  it("keeps reload requests scoped by workspace", async () => {
    await markSnippetReloadRequested("/repo/a");

    expect(await consumeSnippetReloadRequest("/repo/b")).toBe(false);
    expect(await consumeSnippetReloadRequest("/repo/a")).toBe(true);
  });
});
