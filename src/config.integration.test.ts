import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
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

      // Temporarily override PATHS for this test
      const originalPaths = require("./constants.js").PATHS;
      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      require("./constants.js").PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);

      // Restore
      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = originalPaths.CONFIG_FILE_GLOBAL;
      require("./constants.js").PATHS.SNIPPETS_DIR = originalPaths.SNIPPETS_DIR;
    });

    it("should accept 'enabled' string for debug logging", () => {
      writeFileSync(
        join(globalDir, "config.jsonc"),
        JSON.stringify({ logging: { debug: "enabled" } }),
      );

      const originalPaths = require("./constants.js").PATHS;
      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      require("./constants.js").PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);

      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = originalPaths.CONFIG_FILE_GLOBAL;
      require("./constants.js").PATHS.SNIPPETS_DIR = originalPaths.SNIPPETS_DIR;
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

      const originalPaths = require("./constants.js").PATHS;
      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      require("./constants.js").PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig(projectDir);

      expect(config.logging.debug).toBe(true);

      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = originalPaths.CONFIG_FILE_GLOBAL;
      require("./constants.js").PATHS.SNIPPETS_DIR = originalPaths.SNIPPETS_DIR;
    });

    it("should merge partial project config", () => {
      // Global: debug=false, hideCommandInOutput=true
      writeFileSync(
        join(globalDir, "config.jsonc"),
        JSON.stringify({ logging: { debug: false }, hideCommandInOutput: true }),
      );

      // Project: only debug=true (hideCommandInOutput should inherit from global)
      writeFileSync(
        join(projectDir, ".opencode", "snippet", "config.jsonc"),
        JSON.stringify({ logging: { debug: true } }),
      );

      const originalPaths = require("./constants.js").PATHS;
      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = join(globalDir, "config.jsonc");
      require("./constants.js").PATHS.SNIPPETS_DIR = globalDir;

      const config = loadConfig(projectDir);

      expect(config.logging.debug).toBe(true);
      expect(config.hideCommandInOutput).toBe(true); // inherited from global

      require("./constants.js").PATHS.CONFIG_FILE_GLOBAL = originalPaths.CONFIG_FILE_GLOBAL;
      require("./constants.js").PATHS.SNIPPETS_DIR = originalPaths.SNIPPETS_DIR;
    });
  });
});
