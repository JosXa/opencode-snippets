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
 * Snippet registry that maps keys to content
 */
export type SnippetRegistry = Map<string, string>;

/**
 * Frontmatter data from snippet files
 */
export interface SnippetFrontmatter {
  /** Alternative hashtags for this snippet */
  aliases?: string[];
  /** Optional description of what this snippet does */
  description?: string;
}
