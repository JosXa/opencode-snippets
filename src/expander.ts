import { PATTERNS } from "./constants.js";
import { logger } from "./logger.js";
import type { SnippetRegistry } from "./types.js";

/**
 * Maximum number of times a snippet can be expanded to prevent infinite loops
 */
const MAX_EXPANSION_COUNT = 15;

/**
 * Expands hashtags in text recursively with loop detection
 *
 * @param text - The text containing hashtags to expand
 * @param registry - The snippet registry to look up hashtags
 * @param expansionCounts - Map tracking how many times each snippet has been expanded
 * @returns The text with all hashtags expanded
 */
export function expandHashtags(
  text: string,
  registry: SnippetRegistry,
  expansionCounts = new Map<string, number>(),
): string {
  let expanded = text;
  let hasChanges = true;

  // Keep expanding until no more hashtags are found
  while (hasChanges) {
    const previous = expanded;
    let loopDetected = false;

    // Reset regex state (global flag requires this)
    PATTERNS.HASHTAG.lastIndex = 0;

    expanded = expanded.replace(PATTERNS.HASHTAG, (match, name) => {
      const key = name.toLowerCase();

      const content = registry.get(key);
      if (content === undefined) {
        // Unknown snippet - leave as-is
        return match;
      }

      // Track expansion count to prevent infinite loops
      const count = (expansionCounts.get(key) || 0) + 1;
      if (count > MAX_EXPANSION_COUNT) {
        // Loop detected! Leave the hashtag as-is and stop expanding
        logger.warn(`Loop detected: snippet '#${key}' expanded ${count} times (max: ${MAX_EXPANSION_COUNT})`);
        loopDetected = true;
        return match; // Leave as-is instead of error message
      }

      expansionCounts.set(key, count);

      // Recursively expand any hashtags in the snippet content
      const result = expandHashtags(content, registry, expansionCounts);

      return result;
    });

    // Only continue if the text actually changed AND no loop was detected
    hasChanges = expanded !== previous && !loopDetected;
  }

  return expanded;
}
