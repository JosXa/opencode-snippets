import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath, loadConfig } from "./config.js";
import { GLOBAL_PATHS } from "./constants.js";

// Use temp directories for testing to avoid affecting real config
const TEST_TEMP_DIR = join(import.meta.dirname ?? ".", ".test-temp-config");
const TEST_GLOBAL_SNIPPETS_DIR = join(TEST_TEMP_DIR, "global", "snippet");
const TEST_GLOBAL_SNIPPETS_DIR_ALT = join(TEST_TEMP_DIR, "global", "snippets"); // nonexistent
const TEST_PROJECT_DIR = join(TEST_TEMP_DIR, "project");
const TEST_PROJECT_SNIPPETS_DIR = join(TEST_PROJECT_DIR, ".opencode", "snippet");
const TEST_GLOBAL_CONFIG_FILE = join(TEST_GLOBAL_SNIPPETS_DIR, "config.jsonc");

// Store original GLOBAL_PATHS values to restore after tests
const originalActiveSnippetsDir = GLOBAL_PATHS.ACTIVE_SNIPPETS_DIR;
const originalSnippetsDirAlt = GLOBAL_PATHS.SNIPPETS_DIR_ALT;
const originalConfigFile = GLOBAL_PATHS.CONFIG_FILE;

describe("config", () => {
  beforeEach(() => {
    // Clean up any existing test directories
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true });
    }

    // Create test directories
    mkdirSync(TEST_GLOBAL_SNIPPETS_DIR, { recursive: true });
    mkdirSync(TEST_PROJECT_SNIPPETS_DIR, { recursive: true });

    // Override GLOBAL_PATHS for testing (using Object.defineProperty since GLOBAL_PATHS is readonly)
    Object.defineProperty(GLOBAL_PATHS, "ACTIVE_SNIPPETS_DIR", {
      value: TEST_GLOBAL_SNIPPETS_DIR,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(GLOBAL_PATHS, "SNIPPETS_DIR_ALT", {
      value: TEST_GLOBAL_SNIPPETS_DIR_ALT, // nonexistent, so alt is never chosen
      writable: true,
      configurable: true,
    });
    Object.defineProperty(GLOBAL_PATHS, "CONFIG_FILE", {
      value: TEST_GLOBAL_CONFIG_FILE,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore original GLOBAL_PATHS
    Object.defineProperty(GLOBAL_PATHS, "ACTIVE_SNIPPETS_DIR", {
      value: originalActiveSnippetsDir,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(GLOBAL_PATHS, "SNIPPETS_DIR_ALT", {
      value: originalSnippetsDirAlt,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(GLOBAL_PATHS, "CONFIG_FILE", {
      value: originalConfigFile,
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

  describe("getGlobalConfigPath", () => {
    it("should return the global config path", () => {
      const path = getGlobalConfigPath();
      expect(path).toBe(TEST_GLOBAL_CONFIG_FILE);
    });
  });

  describe("getProjectConfigPath", () => {
    it("should return the project config path", () => {
      const path = getProjectConfigPath("/some/project");
      expect(path).toBe(join("/some/project", ".opencode", "snippet", "config.jsonc"));
    });
  });
});
