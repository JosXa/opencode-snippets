import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Regular expression patterns used throughout the plugin
 */
export const PATTERNS = {
  /** Matches hashtags like #snippet-name */
  HASHTAG: /#([a-z0-9\-_]+)/gi,

  /** Matches shell commands like !`command` or !>`command` */
  SHELL_COMMAND: /(!>?)`([^`]+)`/g,

  /** Matches skill loads like #skill(name) or #skill("name") */
  SKILL_LOAD: /#skill\(\s*([^\r\n)]+?)\s*\)/gi,

  /**
   * Matches skill tags in two formats:
   * 1. Self-closing: <skill name="skill-name" /> or <skill name='skill-name'/>
   * 2. Block format: <skill>skill-name</skill>
   */
  SKILL_TAG_SELF_CLOSING: /<skill\s+name=["']([^"']+)["']\s*\/>/gi,
  SKILL_TAG_BLOCK: /<skill>([^<]+)<\/skill>/gi,
} as const;

/**
 * File system paths
 */
export function _configDir(): string {
  return (
    (typeof process !== "undefined" && process.env && process.env.OPENCODE_CONFIG_DIR) ||
    join(homedir(), ".config", "opencode")
  );
}

export const PATHS = {
  /** OpenCode configuration directory — respects OPENCODE_CONFIG_DIR env override */
  CONFIG_DIR: _configDir(),

  /** Preferred global snippets directory */
  SNIPPETS_DIR: join(_configDir(), "snippet"),

  /** Alternate global snippets directory */
  SNIPPETS_DIR_ALT: join(_configDir(), "snippets"),

  /** Global config file */
  CONFIG_FILE_GLOBAL: join(_configDir(), "snippet", "config.jsonc"),
} as const;

/**
 * Get project-specific paths based on project directory
 */
export function getProjectPaths(projectDir: string) {
  const snippetDir = join(projectDir, ".opencode", "snippet");
  return {
    SNIPPETS_DIR: snippetDir,
    SNIPPETS_DIR_ALT: join(projectDir, ".opencode", "snippets"),
    CONFIG_FILE: join(snippetDir, "config.jsonc"),
  };
}

/**
 * Plugin configuration
 */
export const CONFIG = {
  /** File extension for snippet files */
  SNIPPET_EXTENSION: ".md",
} as const;
