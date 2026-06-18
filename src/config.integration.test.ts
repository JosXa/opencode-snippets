import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { GLOBAL_PATHS } from "./constants.js";
import { logger } from "./logger.js";

describe("Config Integration", () => {
  let tempDir: string;
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `snippets-config-int-${Date.now()}`);
    globalDir = join(tempDir, "global", ".config", "opencode", "snippet");
    projectDir = join(tempDir, "project");

    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".opencode", "snippet"), { recursive: true });

    // Reset logger state
    logger.debugEnabled = false;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    logger.debugEnabled = false;
  });

  function withGlobalDir(fn: () => void) {
    const origPreferred = GLOBAL_PATHS.SNIPPETS_DIR_PREFERRED;
    const origActive = GLOBAL_PATHS.ACTIVE_SNIPPETS_DIR;
    const origAlt = GLOBAL_PATHS.SNIPPETS_DIR_ALT;
    const origConfig = GLOBAL_PATHS.CONFIG_FILE;

    GLOBAL_PATHS.SNIPPETS_DIR_PREFERRED = globalDir;
    GLOBAL_PATHS.ACTIVE_SNIPPETS_DIR = globalDir;
    GLOBAL_PATHS.SNIPPETS_DIR_ALT = join(globalDir, ".nonexistent-alt");
    GLOBAL_PATHS.CONFIG_FILE = join(globalDir, "config.jsonc");

    try {
      fn();
    } finally {
      GLOBAL_PATHS.SNIPPETS_DIR_PREFERRED = origPreferred;
      GLOBAL_PATHS.ACTIVE_SNIPPETS_DIR = origActive;
      GLOBAL_PATHS.SNIPPETS_DIR_ALT = origAlt;
      GLOBAL_PATHS.CONFIG_FILE = origConfig;
    }
  }

  describe("logging.debug config", () => {
    it("should enable debug logging when config.logging.debug is true", () => {
      writeFileSync(join(globalDir, "config.jsonc"), JSON.stringify({ logging: { debug: true } }));

      withGlobalDir(() => {
        const config = loadConfig();
        expect(config.logging.debug).toBe(true);
      });
    });

    it("should accept 'enabled' string for debug logging", () => {
      writeFileSync(
        join(globalDir, "config.jsonc"),
        JSON.stringify({ logging: { debug: "enabled" } }),
      );

      withGlobalDir(() => {
        const config = loadConfig();
        expect(config.logging.debug).toBe(true);
      });
    });
  });

  describe("project config override", () => {
    it("should override global config with project config", () => {
      // Global: debug=false
      writeFileSync(join(globalDir, "config.jsonc"), JSON.stringify({ logging: { debug: false } }));

      // Project: debug=true
      writeFileSync(
        join(projectDir, ".opencode", "snippet", "config.jsonc"),
        JSON.stringify({ logging: { debug: true } }),
      );

      withGlobalDir(() => {
        const config = loadConfig(projectDir);
        expect(config.logging.debug).toBe(true);
      });
    });

    it("should merge partial project config", () => {
      // Global: debug=false, injectRecencyMessages=9
      writeFileSync(
        join(globalDir, "config.jsonc"),
        JSON.stringify({ logging: { debug: false }, injectRecencyMessages: 9 }),
      );

      // Project: only debug=true (injectRecencyMessages should inherit from global)
      writeFileSync(
        join(projectDir, ".opencode", "snippet", "config.jsonc"),
        JSON.stringify({ logging: { debug: true } }),
      );

      withGlobalDir(() => {
        const config = loadConfig(projectDir);
        expect(config.logging.debug).toBe(true);
        expect(config.injectRecencyMessages).toBe(9); // inherited from global
      });
    });
  });
});
