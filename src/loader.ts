import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { CONFIG, PATHS } from "./constants.js";
import { logger } from "./logger.js";
import type { SnippetFrontmatter, SnippetRegistry } from "./types.js";

/**
 * Loads all snippets from global and project directories
 *
 * @param projectDir - Optional project directory path (from ctx.directory)
 * @param globalDir - Optional global snippets directory (for testing)
 * @returns A map of snippet keys (lowercase) to their content
 */
export async function loadSnippets(
  projectDir?: string,
  globalDir?: string,
): Promise<SnippetRegistry> {
  const snippets: SnippetRegistry = new Map();

  // Load from global directory first (use provided or default)
  const globalSnippetsDir = globalDir ?? PATHS.SNIPPETS_DIR;
  await loadFromDirectory(globalSnippetsDir, snippets, "global");

  // Load from project directory if provided (overrides global)
  if (projectDir) {
    const projectSnippetsDir = join(projectDir, ".opencode", "snippet");
    await loadFromDirectory(projectSnippetsDir, snippets, "project");
  }

  return snippets;
}

/**
 * Loads snippets from a specific directory
 *
 * @param dir - Directory to load snippets from
 * @param registry - Registry to populate
 * @param source - Source label for logging
 */
async function loadFromDirectory(
  dir: string,
  registry: SnippetRegistry,
  source: string,
): Promise<void> {
  try {
    const files = await readdir(dir);

    for (const file of files) {
      if (!file.endsWith(CONFIG.SNIPPET_EXTENSION)) continue;

      const snippet = await loadSnippetFile(dir, file);
      if (snippet) {
        registerSnippet(registry, snippet.name, snippet.content, snippet.aliases);
      }
    }

    logger.debug(`Loaded snippets from ${source} directory`, {
      path: dir,
      fileCount: files.length,
    });
  } catch (error) {
    // Snippets directory doesn't exist or can't be read - that's fine
    logger.debug(`${source} snippets directory not found or unreadable`, {
      path: dir,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Loads and parses a single snippet file
 *
 * @param dir - Directory containing the snippet file
 * @param filename - The filename to load (e.g., "my-snippet.md")
 * @returns The parsed snippet data, or null if parsing failed
 */
async function loadSnippetFile(dir: string, filename: string) {
  try {
    const name = basename(filename, CONFIG.SNIPPET_EXTENSION);
    const filePath = join(dir, filename);
    const fileContent = await readFile(filePath, "utf-8");
    const parsed = matter(fileContent);

    const content = parsed.content.trim();
    const frontmatter = parsed.data as SnippetFrontmatter;
    
    // Handle aliases as string or array
    let aliases: string[] = [];
    if (frontmatter.aliases) {
      if (Array.isArray(frontmatter.aliases)) {
        aliases = frontmatter.aliases;
      } else {
        aliases = [frontmatter.aliases];
      }
    }
    
    return { name, content, aliases };
  } catch (error) {
    // Failed to read or parse this snippet - skip it
    logger.warn("Failed to load snippet file", {
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Registers a snippet and its aliases in the registry
 *
 * @param registry - The snippet registry to update
 * @param name - The primary name of the snippet
 * @param content - The snippet content
 * @param aliases - Alternative names for the snippet
 */
function registerSnippet(
  registry: SnippetRegistry,
  name: string,
  content: string,
  aliases: string[],
) {
  // Register with primary name (lowercase)
  registry.set(name.toLowerCase(), content);

  // Register all aliases (lowercase)
  for (const alias of aliases) {
    registry.set(alias.toLowerCase(), content);
  }
}
