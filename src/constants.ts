import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Regular expression patterns used throughout the plugin
 */
export const PATTERNS = {
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
// Match the host's config root in both the server and the local TUI process.
const configDir =
  process.env.OPENCODE_CONFIG_DIR ||
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");

export const PATHS = {
  /** OpenCode configuration directory */
  CONFIG_DIR: configDir,

  /** Preferred global snippets directory */
  SNIPPETS_DIR: join(configDir, "snippet"),

  /** Alternate global snippets directory */
  SNIPPETS_DIR_ALT: join(configDir, "snippets"),
} as const;

/**
 * Pick the directory that holds new snippets and config.jsonc: the alternate
 * directory when only it exists, otherwise the preferred one.
 */
export function resolveSnippetDir(preferred: string, alt: string): string {
  return existsSync(alt) && !existsSync(preferred) ? alt : preferred;
}

/**
 * Get project-specific paths based on project directory
 */
export function getProjectPaths(projectDir: string) {
  const snippetDir = join(projectDir, ".opencode", "snippet");
  const snippetDirAlt = join(projectDir, ".opencode", "snippets");
  return {
    SNIPPETS_DIR: snippetDir,
    SNIPPETS_DIR_ALT: snippetDirAlt,
    CONFIG_FILE: join(resolveSnippetDir(snippetDir, snippetDirAlt), "config.jsonc"),
  };
}

export function getSnippetDirectories(projectDir?: string, globalDir?: string) {
  const project = projectDir ? getProjectPaths(projectDir) : undefined;
  return [
    ...(globalDir ? [globalDir] : [PATHS.SNIPPETS_DIR_ALT, PATHS.SNIPPETS_DIR]).map((path) => ({
      path,
      source: "global" as const,
    })),
    ...(project ? [project.SNIPPETS_DIR_ALT, project.SNIPPETS_DIR] : []).map((path) => ({
      path,
      source: "project" as const,
    })),
  ];
}

/**
 * Plugin configuration
 */
export const CONFIG = {
  /** File extension for snippet files */
  SNIPPET_EXTENSION: ".md",
} as const;
