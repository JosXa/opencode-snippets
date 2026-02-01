import { PATTERNS } from "./constants.js";
import { logger } from "./logger.js";
import type { ExpansionResult, ParsedSnippetContent, SnippetRegistry } from "./types.js";

/**
 * Maximum number of times a snippet can be expanded to prevent infinite loops
 */
const MAX_EXPANSION_COUNT = 15;

/**
 * Tag types for parsing
 */
type BlockType = "prepend" | "append" | "inject";

/**
 * Options for snippet expansion
 */
export interface ExpandOptions {
  /** Whether to extract inject blocks (default: true). If false, inject tags are left as-is. */
  extractInject?: boolean;
}

/**
 * Parses snippet content to extract inline text and prepend/append/inject blocks
 *
 * Uses a lenient stack-based parser:
 * - Unclosed tags → treat rest of content as block
 * - Nesting → log error, return null (skip expansion)
 * - Multiple blocks → collected in document order
 *
 * @param content - The raw snippet content to parse
 * @param options - Parsing options
 * @returns Parsed content with inline, prepend, append, and inject parts, or null on error
 */
export function parseSnippetBlocks(
  content: string,
  options: ExpandOptions = {},
): ParsedSnippetContent | null {
  const { extractInject = true } = options;
  const prepend: string[] = [];
  const append: string[] = [];
  const inject: string[] = [];
  let inline = "";

  // Build regex pattern based on what tags we're processing
  const tagTypes = extractInject ? "prepend|append|inject" : "prepend|append";
  const tagPattern = new RegExp(`<(/?)(?<tagName>${tagTypes})>`, "gi");
  let lastIndex = 0;
  let currentBlock: { type: BlockType; startIndex: number; contentStart: number } | null = null;

  let match = tagPattern.exec(content);
  while (match !== null) {
    const isClosing = match[1] === "/";
    const tagName = match.groups?.tagName?.toLowerCase() as BlockType;
    const tagStart = match.index;
    const tagEnd = tagStart + match[0].length;

    if (isClosing) {
      // Closing tag
      if (currentBlock === null) {
        // Closing tag without opening - ignore it, treat as inline content
        continue;
      }
      if (currentBlock.type !== tagName) {
        // Mismatched closing tag - this is a nesting error
        logger.warn(
          `Mismatched closing tag: expected </${currentBlock.type}>, found </${tagName}>`,
        );
        return null;
      }
      // Extract block content
      const blockContent = content.slice(currentBlock.contentStart, tagStart).trim();
      if (blockContent) {
        if (currentBlock.type === "prepend") {
          prepend.push(blockContent);
        } else if (currentBlock.type === "append") {
          append.push(blockContent);
        } else {
          inject.push(blockContent);
        }
      }
      lastIndex = tagEnd;
      currentBlock = null;
    } else {
      // Opening tag
      if (currentBlock !== null) {
        // Nested opening tag - error
        logger.warn(`Nested tags not allowed: found <${tagName}> inside <${currentBlock.type}>`);
        return null;
      }
      // Add any inline content before this tag
      const inlinePart = content.slice(lastIndex, tagStart);
      inline += inlinePart;
      currentBlock = { type: tagName, startIndex: tagStart, contentStart: tagEnd };
    }
    match = tagPattern.exec(content);
  }

  // Handle unclosed tag (lenient: treat rest as block content)
  if (currentBlock !== null) {
    const blockContent = content.slice(currentBlock.contentStart).trim();
    if (blockContent) {
      if (currentBlock.type === "prepend") {
        prepend.push(blockContent);
      } else if (currentBlock.type === "append") {
        append.push(blockContent);
      } else {
        inject.push(blockContent);
      }
    }
  } else {
    // Add any remaining inline content
    inline += content.slice(lastIndex);
  }

  return {
    inline: inline.trim(),
    prepend,
    append,
    inject,
  };
}

/**
 * Expands hashtags in text recursively with loop detection
 *
 * Returns an ExpansionResult containing the inline-expanded text plus
 * collected prepend/append blocks from all expanded snippets.
 *
 * @param text - The text containing hashtags to expand
 * @param registry - The snippet registry to look up hashtags
 * @param expansionCounts - Map tracking how many times each snippet has been expanded
 * @param options - Expansion options
 * @returns ExpansionResult with text and collected blocks
 */
export function expandHashtags(
  text: string,
  registry: SnippetRegistry,
  expansionCounts = new Map<string, number>(),
  options: ExpandOptions = {},
): ExpansionResult {
  const collectedPrepend: string[] = [];
  const collectedAppend: string[] = [];
  const collectedInject: string[] = [];

  let expanded = text;
  let hasChanges = true;

  // Keep expanding until no more hashtags are found
  while (hasChanges) {
    const previous = expanded;
    let loopDetected = false;

    // Reset regex state (global flag requires this)
    PATTERNS.HASHTAG.lastIndex = 0;

    // We need to collect blocks during replacement, so we track them here
    const roundPrepend: string[] = [];
    const roundAppend: string[] = [];
    const roundInject: string[] = [];

    expanded = expanded.replace(PATTERNS.HASHTAG, (match, name) => {
      const key = name.toLowerCase();

      const snippet = registry.get(key);
      if (snippet === undefined) {
        // Unknown snippet - leave as-is
        return match;
      }

      // Track expansion count to prevent infinite loops
      const count = (expansionCounts.get(key) || 0) + 1;
      if (count > MAX_EXPANSION_COUNT) {
        // Loop detected! Leave the hashtag as-is and stop expanding
        logger.warn(
          `Loop detected: snippet '#${key}' expanded ${count} times (max: ${MAX_EXPANSION_COUNT})`,
        );
        loopDetected = true;
        return match; // Leave as-is instead of error message
      }

      expansionCounts.set(key, count);

      // Parse the snippet content for blocks
      const parsed = parseSnippetBlocks(snippet.content, options);
      if (parsed === null) {
        // Parse error - leave hashtag unchanged
        logger.warn(`Failed to parse snippet '${key}', leaving hashtag unchanged`);
        return match;
      }

      // Collect prepend/append/inject blocks
      roundPrepend.push(...parsed.prepend);
      roundAppend.push(...parsed.append);
      roundInject.push(...parsed.inject);

      // Recursively expand any hashtags in the inline content
      const nestedResult = expandHashtags(parsed.inline, registry, expansionCounts, options);

      // Collect blocks from nested expansion
      roundPrepend.push(...nestedResult.prepend);
      roundAppend.push(...nestedResult.append);
      roundInject.push(...nestedResult.inject);

      return nestedResult.text;
    });

    // Add this round's blocks to collected blocks
    collectedPrepend.push(...roundPrepend);
    collectedAppend.push(...roundAppend);
    collectedInject.push(...roundInject);

    // Only continue if the text actually changed AND no loop was detected
    hasChanges = expanded !== previous && !loopDetected;
  }

  return {
    text: expanded,
    prepend: collectedPrepend,
    append: collectedAppend,
    inject: collectedInject,
  };
}

/**
 * Assembles the final message from an expansion result
 *
 * Joins: prepend blocks + inline text + append blocks
 * with double newlines between non-empty sections.
 *
 * @param result - The expansion result to assemble
 * @returns The final assembled message
 */
export function assembleMessage(result: ExpansionResult): string {
  const parts: string[] = [];

  // Add prepend blocks
  if (result.prepend.length > 0) {
    parts.push(result.prepend.join("\n\n"));
  }

  // Add main text
  if (result.text.trim()) {
    parts.push(result.text);
  }

  // Add append blocks
  if (result.append.length > 0) {
    parts.push(result.append.join("\n\n"));
  }

  return parts.join("\n\n");
}
