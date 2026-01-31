import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath, loadConfig } from "./config.js";
import { PATHS } from "./constants.js";

// Use temp directories for testing to avoid affecting real config
const TEST_TEMP_DIR = join(import.meta.dirname ?? ".", ".test-temp-config");
const TEST_GLOBAL_SNIPPETS_DIR = join(TEST_TEMP_DIR, "global", "snippet");
const TEST_PROJECT_DIR = join(TEST_TEMP_DIR, "project");
const TEST_PROJECT_SNIPPETS_DIR = join(TEST_PROJECT_DIR, ".opencode", "snippet");

// Store original PATHS values to restore after tests
const originalSnippetsDir = PATHS.SNIPPETS_DIR;
const originalConfigFileGlobal = (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL;

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
    Object.defineProperty(PATHS, "CONFIG_FILE_GLOBAL", {
      value: join(TEST_GLOBAL_SNIPPETS_DIR, "config.jsonc"),
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
    Object.defineProperty(PATHS, "CONFIG_FILE_GLOBAL", {
      value: originalConfigFileGlobal,
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
        experimental: { inject: false },
        installSkill: true,
        hideCommandInOutput: false,
      });
    });

    it("should auto-create global config file when it doesn't exist", () => {
      // Config file should not exist initially
      expect(existsSync((PATHS as Record<string, string>).CONFIG_FILE_GLOBAL)).toBe(false);

      loadConfig();

      // Config file should be created
      expect(existsSync((PATHS as Record<string, string>).CONFIG_FILE_GLOBAL)).toBe(true);
    });

    it("should load global config file", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ logging: { debug: true }, installSkill: false }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
      expect(config.installSkill).toBe(false);
    });

    it("should parse JSONC with comments", () => {
      const jsoncContent = `{
        // This is a comment
        "logging": {
          /* Block comment */
          "debug": true
        },
        "installSkill": false
      }`;
      writeFileSync((PATHS as Record<string, string>).CONFIG_FILE_GLOBAL, jsoncContent, "utf-8");

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
      expect(config.installSkill).toBe(false);
    });

    it("should accept 'enabled' string for debug", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ logging: { debug: "enabled" } }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
    });

    it("should accept 'disabled' string for debug", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ logging: { debug: "disabled" } }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.logging.debug).toBe(false);
    });

    it("should accept 'enabled' string for installSkill", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ installSkill: "enabled" }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.installSkill).toBe(true);
    });

    it("should accept 'disabled' string for installSkill", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ installSkill: "disabled" }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.installSkill).toBe(false);
    });

    it("should merge partial config with defaults", () => {
      // Only set debug, installSkill should use default
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ logging: { debug: true } }),
        "utf-8",
      );

      const config = loadConfig();

      expect(config.logging.debug).toBe(true);
      expect(config.installSkill).toBe(true); // Default value
    });

    it("should merge project config with global config (project has priority)", () => {
      // Global config
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ logging: { debug: true }, installSkill: true }),
        "utf-8",
      );

      // Project config (overrides global)
      const projectConfigPath = join(TEST_PROJECT_SNIPPETS_DIR, "config.jsonc");
      writeFileSync(projectConfigPath, JSON.stringify({ logging: { debug: false } }), "utf-8");

      const config = loadConfig(TEST_PROJECT_DIR);

      expect(config.logging.debug).toBe(false); // Overridden by project
      expect(config.installSkill).toBe(true); // From global
    });

    it("should handle malformed JSONC gracefully", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        "{ invalid json }",
        "utf-8",
      );

      const config = loadConfig();

      // Should return defaults when config is invalid
      expect(config).toEqual({
        logging: { debug: false },
        experimental: { inject: false },
        installSkill: true,
        hideCommandInOutput: false,
      });
    });

    it("should ignore invalid config value types", () => {
      writeFileSync(
        (PATHS as Record<string, string>).CONFIG_FILE_GLOBAL,
        JSON.stringify({ logging: { debug: "yes" }, installSkill: 123 }),
        "utf-8",
      );

      const config = loadConfig();

      // Should use defaults for invalid types
      expect(config.logging.debug).toBe(false);
      expect(config.installSkill).toBe(true);
    });
  });

  describe("getGlobalConfigPath", () => {
    it("should return the global config path", () => {
      const path = getGlobalConfigPath();
      expect(path).toBe((PATHS as Record<string, string>).CONFIG_FILE_GLOBAL);
    });
  });

  describe("getProjectConfigPath", () => {
    it("should return the project config path", () => {
      const path = getProjectConfigPath("/some/project");
      expect(path).toBe(join("/some/project", ".opencode", "snippet", "config.jsonc"));
    });
  });
});
