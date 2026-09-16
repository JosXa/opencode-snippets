import { PATTERNS } from "./constants.js";
import { type FieldValues, getSnippetForm, renderSnippet, validateFields } from "./fields.js";
import { parseInvocation } from "./invocation.js";
import { LiteralStore } from "./literals.js";
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
  /** Carry this table through skill and shell processing, then restore literals. */
  literals?: LiteralStore;
  /** Resolve an inline skill helper while rendering a snippet. */
  skill?: (name: string) => string;
  /** Whether to extract inject blocks (default: true). If false, inject tags are left as-is. */
  extractInject?: boolean;
  /** Optional callback invoked for each expanded inject block with its source snippet name. */
  onInjectBlock?: (block: InjectBlockInfo) => void;
}

type ExpansionContext = ExpandOptions & { literals: LiteralStore; values?: FieldValues };

interface BlockCollector {
  prepend: BlockRecord[];
  append: BlockRecord[];
  inject: BlockRecord[];
  seen: Set<string>;
}

interface BlockRecord {
  type: BlockType;
  snippetName: string;
  content: string;
}

const BLOCK_TYPES: BlockType[] = ["prepend", "append", "inject"];

function createCollector(): BlockCollector {
  return {
    prepend: [],
    append: [],
    inject: [],
    seen: new Set<string>(),
  };
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
  collector[type].push({ type, snippetName, content });

  if (type === "inject") {
    onInjectBlock?.({ snippetName, content });
  }
}

function addNestedBlocks(
  collector: BlockCollector,
  nested: BlockCollector,
  onInjectBlock?: (block: InjectBlockInfo) => void,
): void {
  for (const type of BLOCK_TYPES) {
    for (const block of nested[type]) {
      addBlock(collector, type, block.snippetName, block.content, onInjectBlock);
    }
  }
}

function expandBlock(
  block: string,
  registry: SnippetRegistry,
  expansionCounts: Map<string, number>,
  options: ExpansionContext,
): { content: string; nested: BlockCollector } {
  const nested = createCollector();
  const content = expandText(block, registry, expansionCounts, nested, {
    ...options,
    onInjectBlock: undefined,
  });

  return { content, nested };
}

function expandText(
  text: string,
  registry: SnippetRegistry,
  expansionCounts: Map<string, number>,
  collector: BlockCollector,
  options: ExpansionContext,
): string {
  const { onInjectBlock } = options;
  const pattern = new RegExp(PATTERNS.HASHTAG.source, "gi");
  let expanded = "";
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const offset = match.index;
    if (offset < end) continue;
    const name = match[1];
    if (
      name.startsWith("_") ||
      (name.toLowerCase() === "skill" && text[offset + match[0].length] === "(")
    )
      continue;
    const snippet = registry.get(name.toLowerCase());
    if (!snippet) continue;
    const form = getSnippetForm(name, registry);
    const parameterized =
      form.fields.length > 0 ||
      Object.hasOwn(snippet, "fields") ||
      /^\(\s*[A-Za-z][A-Za-z0-9_]*\s*=/.test(text.slice(offset + match[0].length));
    const invocation = parameterized ? parseInvocation(text, offset) : undefined;
    const values = options.values ?? getSnippetForm(name, registry, invocation?.values).values;
    const errors = validateFields(
      form.fields,
      Object.fromEntries(
        Object.entries(values).filter(([key]) => form.fields.some((field) => field.name === key)),
      ),
    );
    if (Object.keys(errors).length)
      throw new Error(
        `#${name}: ${Object.values(errors).join("; ")}. Edit snippet fields or supply named arguments.`,
      );
    const scoped = { ...options, values };
    const key = snippet.name.toLowerCase();
    const count = (expansionCounts.get(key) || 0) + 1;
    if (count > MAX_EXPANSION_COUNT) {
      logger.warn(
        `Loop detected: snippet '#${key}' expanded ${count} times (max: ${MAX_EXPANSION_COUNT})`,
      );
      continue;
    }
    expansionCounts.set(key, count);
    const content = renderSnippet(snippet, values, options.literals, options.skill);
    const parsed = parseSnippetBlocks(content, scoped);
    if (parsed === null) {
      logger.warn(`Failed to parse snippet '${key}', leaving hashtag unchanged`);
      continue;
    }

    if (
      !form.fields.length &&
      !Object.hasOwn(snippet, "fields") &&
      parsed.inline === "" &&
      parsed.prepend.length === 0 &&
      parsed.append.length === 0 &&
      parsed.inject.length === 0
    ) {
      continue;
    }

    // User requirement: inline snippet text should replace every hashtag occurrence,
    // but prepend/append/inject side effects should only be inserted once per snippet block.
    for (const block of parsed.prepend) {
      const expanded = expandBlock(block, registry, expansionCounts, scoped);
      addBlock(collector, "prepend", snippet.name, expanded.content, onInjectBlock);
      addNestedBlocks(collector, expanded.nested, onInjectBlock);
    }

    for (const block of parsed.append) {
      const expanded = expandBlock(block, registry, expansionCounts, scoped);
      addBlock(collector, "append", snippet.name, expanded.content, onInjectBlock);
      addNestedBlocks(collector, expanded.nested, onInjectBlock);
    }

    for (const block of parsed.inject) {
      const expanded = expandBlock(block, registry, expansionCounts, scoped);
      addBlock(collector, "inject", snippet.name, expanded.content, onInjectBlock);
      addNestedBlocks(collector, expanded.nested, onInjectBlock);
    }

    expanded +=
      text.slice(end, offset) +
      expandText(parsed.inline, registry, expansionCounts, collector, scoped);
    end = invocation?.end ?? offset + match[0].length;
  }
  return expanded + text.slice(end);
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

  for (const match of content.matchAll(tagPattern)) {
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
  const collector = createCollector();
  const literals = options.literals ?? new LiteralStore();
  const restore = (text: string) => (options.literals ? text : literals.restore(text));
  const expanded = expandText(text, registry, expansionCounts, collector, {
    ...options,
    literals,
    onInjectBlock: options.onInjectBlock
      ? (block) => options.onInjectBlock?.({ ...block, content: restore(block.content) })
      : undefined,
  });

  return {
    text: restore(expanded),
    prepend: collector.prepend.map((block) => restore(block.content)),
    append: collector.append.map((block) => restore(block.content)),
    inject: collector.inject.map((block) => restore(block.content)),
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
