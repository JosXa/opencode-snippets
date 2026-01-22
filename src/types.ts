/**
 * A snippet with its content and metadata
 */
export interface Snippet {
  /** The primary name/key of the snippet */
  name: string;
  /** The content of the snippet (without frontmatter) */
  content: string;
  /** Alternative names that also trigger this snippet */
  aliases: string[];
}

/**
 * Extended snippet info with file metadata
 */
export interface SnippetInfo {
  name: string;
  content: string;
  aliases: string[];
  description?: string;
  filePath: string;
  source: "global" | "project";
}

/**
 * Snippet registry that maps keys to snippet info
 */
export type SnippetRegistry = Map<string, SnippetInfo>;

/**
 * Frontmatter data from snippet files
 */
export interface SnippetFrontmatter {
  /** Alternative hashtags for this snippet (plural form) */
  aliases?: string | string[];
  /** Alternative hashtags for this snippet (singular form, same as aliases) */
  alias?: string | string[];
  /** Optional description of what this snippet does */
  description?: string;
}
