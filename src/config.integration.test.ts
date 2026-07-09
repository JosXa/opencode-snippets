import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { PATHS } from "./constants.js";
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

  describe("logging.debug config", () => {
    it("should enable debug logging when config.logging.debug is true", () => {
      writeFileSync(join(globalDir, "config.jsonc"), JSON.stringify({ logging: { debug: true } }));

      // Capture original values as primitives (not references) before patching
      const origConfigFile = PATHS.CONFIG_FILE_GLOBAL;
      const origSnippetsDir = PATHS.SNIPPETS_DIR;
      PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);

      // Restore original values
      PATHS.CONFIG_FILE_GLOBAL = origConfigFile;
      PATHS.SNIPPETS_DIR = origSnippetsDir;
    });

    it("should accept 'enabled' string for debug logging", () => {
      writeFileSync(
        join(globalDir, "config.jsonc"),
        JSON.stringify({ logging: { debug: "enabled" } }),
      );

      const origConfigFile = PATHS.CONFIG_FILE_GLOBAL;
      const origSnippetsDir = PATHS.SNIPPETS_DIR;
      PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);

      PATHS.CONFIG_FILE_GLOBAL = origConfigFile;
      PATHS.SNIPPETS_DIR = origSnippetsDir;
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

      const origConfigFile = PATHS.CONFIG_FILE_GLOBAL;
      const origSnippetsDir = PATHS.SNIPPETS_DIR;
      PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig(projectDir);

      expect(config.logging.debug).toBe(true);

      PATHS.CONFIG_FILE_GLOBAL = origConfigFile;
      PATHS.SNIPPETS_DIR = origSnippetsDir;
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

      const origConfigFile = PATHS.CONFIG_FILE_GLOBAL;
      const origSnippetsDir = PATHS.SNIPPETS_DIR;
      PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig(projectDir);

      expect(config.logging.debug).toBe(true);
      expect(config.injectRecencyMessages).toBe(9); // inherited from global

      PATHS.CONFIG_FILE_GLOBAL = origConfigFile;
      PATHS.SNIPPETS_DIR = origSnippetsDir;
    });
  });
});
