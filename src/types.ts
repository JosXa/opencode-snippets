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
  /** Alternative hashtags for this snippet (plural form, preferred) */
  aliases?: string | string[];
  /** Alternative hashtags for this snippet (singular form, also accepted) */
  alias?: string | string[];
  /** Optional description of what this snippet does */
  description?: string;
}

/**
 * Parsed snippet content with inline text and prepend/append blocks
 */
export interface ParsedSnippetContent {
  /** Content outside blocks (replaces hashtag inline) */
  inline: string;
  /** <prepend> block contents in document order */
  prepend: string[];
  /** <append> block contents in document order */
  append: string[];
}

/**
 * Result of expanding hashtags, including collected prepend/append blocks
 */
export interface ExpansionResult {
  /** The inline-expanded text */
  text: string;
  /** Collected prepend blocks from all expanded snippets */
  prepend: string[];
  /** Collected append blocks from all expanded snippets */
  append: string[];
}
