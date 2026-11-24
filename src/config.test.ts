import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath, loadConfig } from "./config.js";
import { PATHS } from "./constants.js";

// Use temp directories for testing to avoid affecting real config
const TEST_TEMP_DIR = join(import.meta.dirname ?? ".", ".test-temp-config");
const TEST_GLOBAL_SNIPPETS_DIR = join(TEST_TEMP_DIR, "global", "snippet");
const TEST_GLOBAL_SNIPPETS_DIR_ALT = join(TEST_TEMP_DIR, "global", "snippets");
const TEST_GLOBAL_CONFIG_FILE = join(TEST_GLOBAL_SNIPPETS_DIR, "config.jsonc");
const TEST_PROJECT_DIR = join(TEST_TEMP_DIR, "project");
const TEST_PROJECT_SNIPPETS_DIR = join(TEST_PROJECT_DIR, ".opencode", "snippet");
const TEST_PROJECT_SNIPPETS_DIR_ALT = join(TEST_PROJECT_DIR, ".opencode", "snippets");

// Store original PATHS values to restore after tests
const originalSnippetsDir = PATHS.SNIPPETS_DIR;
const originalSnippetsDirAlt = PATHS.SNIPPETS_DIR_ALT;

describe("config", () => {
  beforeEach(() => {
    // Clean up any existing test directories
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true });
    }

    // Create test directories
    mkdirSync(TEST_GLOBAL_SNIPPETS_DIR, { recursive: true });
    mkdirSync(TEST_PROJECT_SNIPPETS_DIR, { recursive: true });

    // Override PATHS for testing (using Object.defineProperty since PATHS is readonly)
    Object.defineProperty(PATHS, "SNIPPETS_DIR", {
      value: TEST_GLOBAL_SNIPPETS_DIR,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(PATHS, "SNIPPETS_DIR_ALT", {
      value: TEST_GLOBAL_SNIPPETS_DIR_ALT,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore original PATHS
    Object.defineProperty(PATHS, "SNIPPETS_DIR", {
      value: originalSnippetsDir,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(PATHS, "SNIPPETS_DIR_ALT", {
      value: originalSnippetsDirAlt,
      writable: true,
      configurable: true,
    });

    // Clean up test directories
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true });
    }
  });

  describe("loadConfig", () => {
    it("should return default config when no config file exists", () => {
      const config = loadConfig();

      expect(config).toEqual({
        logging: { debug: false },
        experimental: { skillRendering: false, skillLoading: false, injectBlocks: false },
        injectRecencyMessages: 5,
      });
    });

    it("should auto-create global config file when it doesn't exist", () => {
      // Config file should not exist initially
      expect(existsSync(TEST_GLOBAL_CONFIG_FILE)).toBe(false);

      loadConfig();

      // Config file should be created
      expect(existsSync(TEST_GLOBAL_CONFIG_FILE)).toBe(true);
    });

    it("should load global config file", () => {
      writeFileSync(TEST_GLOBAL_CONFIG_FILE, JSON.stringify({ logging: { debug: true } }), "utf-8");

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
    });

    it("should parse JSONC with comments", () => {
      const jsoncContent = `{
        // This is a comment
        "logging": {
          /* Block comment */
          "debug": true
        }
      }`;
      writeFileSync(TEST_GLOBAL_CONFIG_FILE, jsoncContent, "utf-8");

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
    });

    it("should accept 'enabled' string for debug", () => {
      writeFileSync(
        TEST_GLOBAL_CONFIG_FILE,
        JSON.stringify({ logging: { debug: "enabled" } }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
    });

    it("should accept 'disabled' string for debug", () => {
      writeFileSync(
        TEST_GLOBAL_CONFIG_FILE,
        JSON.stringify({ logging: { debug: "disabled" } }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.logging.debug).toBe(false);
    });

    it("should merge partial config with defaults", () => {
      // Only set debug, other options should use default
      writeFileSync(TEST_GLOBAL_CONFIG_FILE, JSON.stringify({ logging: { debug: true } }), "utf-8");

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
      expect(config.injectRecencyMessages).toBe(5);
    });

    it("should merge project config with global config (project has priority)", () => {
      // Global config
      writeFileSync(TEST_GLOBAL_CONFIG_FILE, JSON.stringify({ logging: { debug: true } }), "utf-8");

      // Project config (overrides global)
      const projectConfigPath = join(TEST_PROJECT_SNIPPETS_DIR, "config.jsonc");
      writeFileSync(projectConfigPath, JSON.stringify({ logging: { debug: false } }), "utf-8");

      const config = loadConfig(TEST_PROJECT_DIR);

      expect(config.logging.debug).toBe(false); // Overridden by project
    });

    it("should handle malformed JSONC gracefully", () => {
      writeFileSync(TEST_GLOBAL_CONFIG_FILE, "{ invalid json }", "utf-8");

      const config = loadConfig();

      // Should return defaults when config is invalid
      expect(config).toEqual({
        logging: { debug: false },
        experimental: { skillRendering: false, skillLoading: false, injectBlocks: false },
        injectRecencyMessages: 5,
      });
    });

    it("should load experimental skill loading config", () => {
      writeFileSync(
        TEST_GLOBAL_CONFIG_FILE,
        JSON.stringify({ experimental: { skillLoading: true } }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.experimental.skillLoading).toBe(true);
    });

    it("should ignore invalid config value types", () => {
      writeFileSync(
        TEST_GLOBAL_CONFIG_FILE,
        JSON.stringify({ logging: { debug: "yes" } }),
        "utf-8",
      );

      const config = loadConfig();

      // Should use defaults for invalid types
      expect(config.logging.debug).toBe(false);
    });
  });

  describe("plural snippets directories", () => {
    it("creates the global config inside an existing snippets/ without creating snippet/", () => {
      rmSync(TEST_GLOBAL_SNIPPETS_DIR, { recursive: true });
      mkdirSync(TEST_GLOBAL_SNIPPETS_DIR_ALT, { recursive: true });

      loadConfig();

      expect(getGlobalConfigPath()).toBe(join(TEST_GLOBAL_SNIPPETS_DIR_ALT, "config.jsonc"));
      expect(existsSync(join(TEST_GLOBAL_SNIPPETS_DIR_ALT, "config.jsonc"))).toBe(true);
      expect(existsSync(TEST_GLOBAL_SNIPPETS_DIR)).toBe(false);
    });

    it("reads the project config from an existing .opencode/snippets/", () => {
      rmSync(TEST_PROJECT_SNIPPETS_DIR, { recursive: true });
      mkdirSync(TEST_PROJECT_SNIPPETS_DIR_ALT, { recursive: true });
      writeFileSync(
        join(TEST_PROJECT_SNIPPETS_DIR_ALT, "config.jsonc"),
        JSON.stringify({ logging: { debug: true } }),
        "utf-8",
      );

      expect(getProjectConfigPath(TEST_PROJECT_DIR)).toBe(
        join(TEST_PROJECT_SNIPPETS_DIR_ALT, "config.jsonc"),
      );
      expect(loadConfig(TEST_PROJECT_DIR).logging.debug).toBe(true);
    });

    it("keeps snippet/ when both directories exist", () => {
      mkdirSync(TEST_GLOBAL_SNIPPETS_DIR_ALT, { recursive: true });

      expect(getGlobalConfigPath()).toBe(TEST_GLOBAL_CONFIG_FILE);
    });
  });
});
