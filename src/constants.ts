import { join } from "node:path"
import { homedir } from "node:os"

/**
 * Regular expression patterns used throughout the plugin
 */
export const PATTERNS = {
  /** Matches hashtags like #snippet-name */
  HASHTAG: /#([a-z0-9\-_]+)/gi,
  
  /** Matches shell commands like !`command` */
  SHELL_COMMAND: /!`([^`]+)`/g,
} as const

/**
 * OpenCode configuration directory
 */
export const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode")

/**
 * File system paths
 */
export const PATHS = {
  /** OpenCode configuration directory */
  CONFIG_DIR: OPENCODE_CONFIG_DIR,
  
  /** Snippets directory */
  SNIPPETS_DIR: join(OPENCODE_CONFIG_DIR, "snippet"),
} as const

/**
 * Plugin configuration
 */
export const CONFIG = {
  /** File extension for snippet files */
  SNIPPET_EXTENSION: ".md",
} as const
