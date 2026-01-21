import { PATTERNS } from "./constants.js";
import type { SnippetRegistry } from "./types.js";

/**
 * Expands hashtags in text recursively with loop detection
 *
 * @param text - The text containing hashtags to expand
 * @param registry - The snippet registry to look up hashtags
 * @param visited - Set of already-visited snippet keys (for loop detection)
 * @returns The text with all hashtags expanded
 */
export function expandHashtags(
  text: string,
  registry: SnippetRegistry,
  visited = new Set<string>(),
): string {
  let expanded = text;
  let hasChanges = true;

  // Keep expanding until no more hashtags are found
  while (hasChanges) {
    hasChanges = false;

    // Reset regex state (global flag requires this)
    PATTERNS.HASHTAG.lastIndex = 0;

    expanded = expanded.replace(PATTERNS.HASHTAG, (match, name) => {
      const key = name.toLowerCase();

      // Check if we've already expanded this snippet in the current chain
      if (visited.has(key)) {
        // Loop detected! Leave the hashtag unchanged to prevent infinite recursion
        return match;
      }

      const content = registry.get(key);
      if (!content) {
        // Unknown snippet - leave as-is
        return match;
      }

      // Mark this snippet as visited and expand it
      visited.add(key);
      hasChanges = true;

      // Recursively expand any hashtags in the snippet content
      const result = expandHashtags(content, registry, new Set(visited));

      // Remove from visited set after expansion (allows reuse in different branches)
      visited.delete(key);

      return result;
    });
  }

  return expanded;
}
