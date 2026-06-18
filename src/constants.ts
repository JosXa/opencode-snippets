import { existsSync } from "node:fs";
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
 * Resolved paths for a snippet scope (global or project).
 */
export interface SnippetPaths {
  /** OpenCode configuration directory for the scope (e.g. ~/.config/opencode or projectDir/.opencode) */
  CONFIG_DIR: string;
  /** Canonical preferred snippets directory */
  SNIPPETS_DIR_PREFERRED: string;
  /** Alternate snippets directory */
  SNIPPETS_DIR_ALT: string;
  /** Resolved active snippets directory: preferred, unless only alt exists */
  ACTIVE_SNIPPETS_DIR: string;
  /** Config file path inside ACTIVE_SNIPPETS_DIR */
  CONFIG_FILE: string;
}

/**
 * Resolve the active snippets directory for writing/init.
 *
 * Uses alt only when it already exists and preferred does not
 * This avoids creating a redundant snippet/ dir next to an existing snippets/ dir.
 * Falls back to preferred in all other cases (including creation).
 */
export function resolveSnippetDir(preferred: string, alt: string): string {
  if (existsSync(alt) && !existsSync(preferred)) return alt;
  return preferred;
}

/**
 * Get global paths.
 */
function getGlobalPaths(): SnippetPaths {
  const configDir = join(homedir(), ".config", "opencode");
  const preferred = join(configDir, "snippet");
  const alt = join(configDir, "snippets");
  const active = resolveSnippetDir(preferred, alt);
  return {
    CONFIG_DIR: configDir,
    SNIPPETS_DIR_PREFERRED: preferred,
    SNIPPETS_DIR_ALT: alt,
    ACTIVE_SNIPPETS_DIR: active,
    CONFIG_FILE: join(active, "config.jsonc"),
  };
}

/**
 * Get project-specific paths based on project directory.
 */
export function getProjectPaths(projectDir: string): SnippetPaths {
  const configDir = join(projectDir, ".opencode");
  const preferred = join(configDir, "snippet");
  const alt = join(configDir, "snippets");
  const active = resolveSnippetDir(preferred, alt);
  return {
    CONFIG_DIR: configDir,
    SNIPPETS_DIR_PREFERRED: preferred,
    SNIPPETS_DIR_ALT: alt,
    ACTIVE_SNIPPETS_DIR: active,
    CONFIG_FILE: join(active, "config.jsonc"),
  };
}

/**
 * Global file system paths, computed once at startup.
 */
export const GLOBAL_PATHS = getGlobalPaths();

/**
 * Plugin configuration
 */
export const CONFIG = {
  /** File extension for snippet files */
  SNIPPET_EXTENSION: ".md",
} as const;
