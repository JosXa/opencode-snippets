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
export interface InjectBlockInfo {
  snippetName: string;
  content: string;
}

export interface ExpandOptions {
  /** Whether to extract inject blocks (default: true). If false, inject tags are left as-is. */
  extractInject?: boolean;
  /** Optional callback invoked for each expanded inject block with its source snippet name. */
  onInjectBlock?: (block: InjectBlockInfo) => void;
}

interface BlockCollector {
  prepend: string[];
  append: string[];
  inject: string[];
  seen: Set<string>;
}

function addBlock(
  collector: BlockCollector,
  type: BlockType,
  snippetName: string,
  content: string,
  onInjectBlock?: (block: InjectBlockInfo) => void,
): void {
  if (!content) return;

  const key = `${type}\u0000${snippetName.toLowerCase()}\u0000${content}`;
  if (collector.seen.has(key)) return;

  collector.seen.add(key);
  collector[type].push(content);

  if (type === "inject") {
    onInjectBlock?.({ snippetName, content });
  }
}

function expandText(
  text: string,
  registry: SnippetRegistry,
  expansionCounts: Map<string, number>,
  collector: BlockCollector,
  options: ExpandOptions,
): string {
  const { onInjectBlock } = options;
  let expanded = text;
  let hasChanges = true;

  while (hasChanges) {
    const previous = expanded;
    let loopDetected = false;

    PATTERNS.HASHTAG.lastIndex = 0;

    expanded = expanded.replace(PATTERNS.HASHTAG, (match, name, offset, input) => {
      if (name.toLowerCase() === "skill" && input[offset + match.length] === "(") {
        return match;
      }

      const snippet = registry.get(name.toLowerCase());
      if (snippet === undefined) {
        return match;
      }

      const key = snippet.name.toLowerCase();
      const count = (expansionCounts.get(key) || 0) + 1;
      if (count > MAX_EXPANSION_COUNT) {
        logger.warn(
          `Loop detected: snippet '#${key}' expanded ${count} times (max: ${MAX_EXPANSION_COUNT})`,
        );
        loopDetected = true;
        return match;
      }

      expansionCounts.set(key, count);

      const parsed = parseSnippetBlocks(snippet.content, options);
      if (parsed === null) {
        logger.warn(`Failed to parse snippet '${key}', leaving hashtag unchanged`);
        return match;
      }

      if (
        parsed.inline === "" &&
        parsed.prepend.length === 0 &&
        parsed.append.length === 0 &&
        parsed.inject.length === 0
      ) {
        return match;
      }

      // User requirement: inline snippet text should replace every hashtag occurrence,
      // but prepend/append/inject side effects should only be inserted once per snippet block.
      for (const block of parsed.prepend) {
        addBlock(
          collector,
          "prepend",
          snippet.name,
          expandText(block, registry, expansionCounts, collector, options),
          onInjectBlock,
        );
      }

      for (const block of parsed.append) {
        addBlock(
          collector,
          "append",
          snippet.name,
          expandText(block, registry, expansionCounts, collector, options),
          onInjectBlock,
        );
      }

      for (const block of parsed.inject) {
        addBlock(
          collector,
          "inject",
          snippet.name,
          expandText(block, registry, expansionCounts, collector, options),
          onInjectBlock,
        );
      }

      return expandText(parsed.inline, registry, expansionCounts, collector, options);
    });

    hasChanges = expanded !== previous && !loopDetected;
  }

  return expanded;
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
  const collector: BlockCollector = {
    prepend: [],
    append: [],
    inject: [],
    seen: new Set<string>(),
  };

  const expanded = expandText(text, registry, expansionCounts, collector, options);

  return {
    text: expanded,
    prepend: collector.prepend,
    append: collector.append,
    inject: collector.inject,
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
