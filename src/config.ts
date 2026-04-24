import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { importCjs } from "./cjs-interop.js";
import { getProjectPaths, PATHS } from "./constants.js";
import { logger } from "./logger.js";

const { parse: parseJsonc } = await importCjs<typeof import("jsonc-parser")>("jsonc-parser");

/**
 * Boolean setting that can be true/false or "enabled"/"disabled" for flexibility
 */
export type BooleanSetting = boolean | "enabled" | "disabled";

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Enable debug logging to file */
  debug: boolean;
}

/**
 * Experimental features configuration
 */
export interface ExperimentalConfig {
  /** Enable skill rendering with <skill>name</skill> or <skill name="name" /> syntax */
  skillRendering: boolean;
  /** Enable #skill(name) syntax that injects OpenCode-style skill payloads above the message */
  skillLoading: boolean;
  /** Enable <inject>...</inject> blocks for persistent context messages */
  injectBlocks: boolean;
}

/**
 * Configuration schema for the snippets plugin
 */
export interface SnippetsConfig {
  /** Logging settings */
  logging: LoggingConfig;

  /** Experimental features */
  experimental: ExperimentalConfig;

  /** Hide shell command in output, showing only the result */
  hideCommandInOutput: boolean;

  /** How many messages from the bottom of the conversation to place injected context */
  injectRecencyMessages: number;
}

/**
 * Raw config as it appears in the file (before normalization)
 */
interface RawConfig {
  logging?: {
    debug?: BooleanSetting;
  };
  experimental?: {
    skillRendering?: BooleanSetting;
    skillLoading?: BooleanSetting;
    injectBlocks?: BooleanSetting;
  };
  hideCommandInOutput?: BooleanSetting;
  injectRecencyMessages?: number | string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: SnippetsConfig = {
  logging: {
    debug: false,
  },
  experimental: {
    skillRendering: false,
    skillLoading: false,
    injectBlocks: false,
  },
  hideCommandInOutput: false,
  injectRecencyMessages: 5,
};

/**
 * Default config file content with comments explaining all options
 */
const DEFAULT_CONFIG_CONTENT = `{
  // JSON Schema for editor autocompletion
  "$schema": "https://raw.githubusercontent.com/JosXa/opencode-snippets/v2.1.1/schema/config.schema.json",

  // Logging settings
  "logging": {
    // Enable debug logging to file
    // Logs are written to ~/.config/opencode/logs/snippets/daily/
    // Values: true, false, "enabled", "disabled"
    // Default: false
    "debug": false
  },

  // Experimental features (may change or be removed)
  "experimental": {
    // Enable skill rendering with <skill>name</skill> or <skill name="name" /> syntax
    // When enabled, skill tags are replaced with the skill's content body
    // Skills are loaded from OpenCode's standard skill directories
    // Values: true, false, "enabled", "disabled"
    // Default: false
    "skillRendering": false,

    // Enable #skill(name) syntax that shows a placeholder inline while injecting
    // the OpenCode-style <skill_content> payload to the model above the message
    // Values: true, false, "enabled", "disabled"
    // Default: false
    "skillLoading": false
  },

  // Hide shell command in snippet output
  // When false (default), shell commands show as "$ command\\n--> output"
  // When true, only the output is shown (matching OpenCode's slash command behavior)
  // Values: true, false, "enabled", "disabled"
  // Default: false
  "hideCommandInOutput": false,

  // How many messages from the bottom of the conversation to place injected context
  // Higher = injection feels "older" to the model, lower = closer to recent context
  // Default: 5
  "injectRecencyMessages": 5
}
`;

/**
 * Normalize boolean setting to boolean
 */
function normalizeBooleanSetting(value: BooleanSetting | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  return undefined;
}

function normalizePositiveInteger(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

/**
 * Parse a JSONC file and return the parsed object
 */
function parseJsoncFile(filePath: string): RawConfig {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = parseJsonc(content);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawConfig;
    }

    logger.warn("Config file has invalid structure, using defaults", { filePath });
    return {};
  } catch (error) {
    logger.warn("Failed to parse config file", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Ensure the global snippets directory and config file exist
 */
function ensureGlobalConfigExists(): void {
  // Create snippets directory if it doesn't exist
  if (!existsSync(PATHS.SNIPPETS_DIR)) {
    mkdirSync(PATHS.SNIPPETS_DIR, { recursive: true });
    logger.debug("Created global snippets directory", { path: PATHS.SNIPPETS_DIR });
  }

  // Create default config file if it doesn't exist
  if (!existsSync(PATHS.CONFIG_FILE_GLOBAL)) {
    writeFileSync(PATHS.CONFIG_FILE_GLOBAL, DEFAULT_CONFIG_CONTENT, "utf-8");
    logger.debug("Created default config file", { path: PATHS.CONFIG_FILE_GLOBAL });
  }
}

/**
 * Load and merge configuration from global and project-specific config files
 *
 * Configuration priority (highest to lowest):
 * 1. Project-specific config (.opencode/snippet/config.jsonc)
 * 2. Global config (~/.config/opencode/snippet/config.jsonc)
 * 3. Default values
 *
 * @param projectDir - Optional project directory to check for project-specific config
 * @returns Merged configuration object
 */
export function loadConfig(projectDir?: string): SnippetsConfig {
  // Ensure global directory and config file exist
  ensureGlobalConfigExists();

  // Start with defaults
  let config: SnippetsConfig = structuredClone(DEFAULT_CONFIG);

  // Load global config
  if (existsSync(PATHS.CONFIG_FILE_GLOBAL)) {
    const globalConfig = parseJsoncFile(PATHS.CONFIG_FILE_GLOBAL);
    config = mergeConfig(config, globalConfig);
    logger.debug("Loaded global config", { path: PATHS.CONFIG_FILE_GLOBAL });
  }

  // Load project config if project directory is provided
  if (projectDir) {
    const projectPaths = getProjectPaths(projectDir);
    if (existsSync(projectPaths.CONFIG_FILE)) {
      const projectConfig = parseJsoncFile(projectPaths.CONFIG_FILE);
      config = mergeConfig(config, projectConfig);
      logger.debug("Loaded project config", { path: projectPaths.CONFIG_FILE });
    }
  }

  logger.debug("Final config", {
    loggingDebug: config.logging.debug,
    experimentalSkillRendering: config.experimental.skillRendering,
    experimentalSkillLoading: config.experimental.skillLoading,
    hideCommandInOutput: config.hideCommandInOutput,
    injectRecencyMessages: config.injectRecencyMessages,
  });

  return config;
}

/**
 * Merge raw config into base config
 */
function mergeConfig(base: SnippetsConfig, raw: RawConfig): SnippetsConfig {
  const debugValue = normalizeBooleanSetting(raw.logging?.debug);
  const skillRenderingValue = normalizeBooleanSetting(raw.experimental?.skillRendering);
  const skillLoadingValue = normalizeBooleanSetting(raw.experimental?.skillLoading);
  const injectBlocksValue = normalizeBooleanSetting(raw.experimental?.injectBlocks);
  const hideCommandValue = normalizeBooleanSetting(raw.hideCommandInOutput);
  const injectRecencyValue = normalizePositiveInteger(raw.injectRecencyMessages);

  return {
    logging: {
      debug: debugValue !== undefined ? debugValue : base.logging.debug,
    },
    experimental: {
      skillRendering:
        skillRenderingValue !== undefined ? skillRenderingValue : base.experimental.skillRendering,
      skillLoading:
        skillLoadingValue !== undefined ? skillLoadingValue : base.experimental.skillLoading,
      injectBlocks:
        injectBlocksValue !== undefined ? injectBlocksValue : base.experimental.injectBlocks,
    },
    hideCommandInOutput:
      hideCommandValue !== undefined ? hideCommandValue : base.hideCommandInOutput,
    injectRecencyMessages:
      injectRecencyValue !== undefined ? injectRecencyValue : base.injectRecencyMessages,
  };
}

/**
 * Get the path to the global config file
 */
export function getGlobalConfigPath(): string {
  return PATHS.CONFIG_FILE_GLOBAL;
}

/**
 * Get the path to the project config file
 */
export function getProjectConfigPath(projectDir: string): string {
  return getProjectPaths(projectDir).CONFIG_FILE;
}
