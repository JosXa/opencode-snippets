import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Regular expression patterns used throughout the plugin
 */
export const PATTERNS = {
  /** Matches hashtags like #snippet-name */
  HASHTAG: /#([a-z0-9\-_]+)/gi,

  /** Matches shell commands like !`command` */
  SHELL_COMMAND: /!`([^`]+)`/g,

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
export const PATHS = {
  /** OpenCode configuration directory */
  CONFIG_DIR: join(homedir(), ".config", "opencode"),

  /** Snippets directory */
  SNIPPETS_DIR: join(homedir(), ".config", "opencode", "snippet"),

  /** Global config file */
  CONFIG_FILE_GLOBAL: join(homedir(), ".config", "opencode", "snippet", "config.jsonc"),
} as const;

/**
 * Get project-specific paths based on project directory
 */
export function getProjectPaths(projectDir: string) {
  const snippetDir = join(projectDir, ".opencode", "snippet");
  return {
    SNIPPETS_DIR: snippetDir,
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
