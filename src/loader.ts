import { access, mkdir, readdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { importCjs } from "./cjs-interop.js";

const matter = await importCjs<typeof import("gray-matter")>("gray-matter");

import { CONFIG, getProjectPaths, PATHS } from "./constants.js";
import { logger } from "./logger.js";
import type { SnippetFrontmatter, SnippetInfo, SnippetRegistry } from "./types.js";

function getGlobalSnippetDirs(globalDir?: string): string[] {
  if (globalDir) return [globalDir];

  return [PATHS.SNIPPETS_DIR_ALT, PATHS.SNIPPETS_DIR];
}

function getProjectSnippetDirs(projectDir: string): string[] {
  const paths = getProjectPaths(projectDir);
  return [paths.SNIPPETS_DIR_ALT, paths.SNIPPETS_DIR];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveWritableSnippetDir(projectDir?: string): Promise<string> {
  const paths = projectDir
    ? getProjectPaths(projectDir)
    : { SNIPPETS_DIR: PATHS.SNIPPETS_DIR, SNIPPETS_DIR_ALT: PATHS.SNIPPETS_DIR_ALT };

  // Support both snippet/ and snippets/. Reuse an existing directory first, then default to snippet/.
  for (const dir of [paths.SNIPPETS_DIR, paths.SNIPPETS_DIR_ALT]) {
    if (await pathExists(dir)) return dir;
  }

  return paths.SNIPPETS_DIR;
}

/**
 * Loads all snippets from global and project directories
 *
 * @param projectDir - Optional project directory path (from ctx.directory)
 * @param globalDir - Optional global snippets directory (for testing)
 * @returns A map of snippet keys (lowercase) to their SnippetInfo
 */
export async function loadSnippets(
  projectDir?: string,
  globalDir?: string,
): Promise<SnippetRegistry> {
  const snippets: SnippetRegistry = new Map();

  // Support both snippet/ and snippets/. Load plural first so existing snippet/ files still win.
  for (const dir of getGlobalSnippetDirs(globalDir)) {
    await loadFromDirectory(dir, snippets, "global");
  }

  // Load from project directory if provided (overrides global)
  if (projectDir) {
    for (const dir of getProjectSnippetDirs(projectDir)) {
      await loadFromDirectory(dir, snippets, "project");
    }
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
  source: "global" | "project",
): Promise<void> {
  try {
    const files = await readdir(dir);

    for (const file of files) {
      if (!file.endsWith(CONFIG.SNIPPET_EXTENSION)) continue;

      const snippet = await loadSnippetFile(dir, file, source);
      if (snippet) {
        registerSnippet(registry, snippet);
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
 * @param source - Whether this is a global or project snippet
 * @returns The parsed snippet info, or null if parsing failed
 */
async function loadSnippetFile(
  dir: string,
  filename: string,
  source: "global" | "project",
): Promise<SnippetInfo | null> {
  try {
    const name = basename(filename, CONFIG.SNIPPET_EXTENSION);
    const filePath = join(dir, filename);
    const fileContent = await Bun.file(filePath).text();
    const parsed = matter(fileContent);

    const content = parsed.content.trim();
    const frontmatter = parsed.data as SnippetFrontmatter;

    // Handle aliases: accept both 'aliases' (plural) and 'alias' (singular)
    // Prefer 'aliases' if both are present
    let aliases: string[] = [];
    const aliasSource = frontmatter.aliases ?? frontmatter.alias;
    if (aliasSource) {
      if (Array.isArray(aliasSource)) {
        aliases = aliasSource;
      } else {
        aliases = [aliasSource];
      }
    }

    return {
      name,
      content,
      aliases,
      description: frontmatter.description,
      filePath,
      source,
    };
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
 * @param registry - The registry to add the snippet to
 * @param snippet - The snippet info to register
 */
function registerSnippet(registry: SnippetRegistry, snippet: SnippetInfo): void {
  const key = snippet.name.toLowerCase();

  // If snippet with same name exists, remove its old aliases first
  const existing = registry.get(key);
  if (existing) {
    for (const alias of existing.aliases) {
      registry.delete(alias.toLowerCase());
    }
  }

  // Register the snippet under its name
  registry.set(key, snippet);

  // Register under all aliases (pointing to the same snippet info)
  for (const alias of snippet.aliases) {
    registry.set(alias.toLowerCase(), snippet);
  }
}

/**
 * Lists all unique snippets (by name) from the registry
 *
 * @param registry - The snippet registry
 * @returns Array of unique snippet info objects
 */
export function listSnippets(registry: SnippetRegistry): SnippetInfo[] {
  const seen = new Set<string>();
  const snippets: SnippetInfo[] = [];

  for (const snippet of registry.values()) {
    if (!seen.has(snippet.name)) {
      seen.add(snippet.name);
      snippets.push(snippet);
    }
  }

  return snippets;
}

/**
 * Ensures the snippets directory exists
 */
export async function ensureSnippetsDir(projectDir?: string): Promise<string> {
  const dir = await resolveWritableSnippetDir(projectDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Creates a new snippet file
 *
 * @param name - The snippet name (without extension)
 * @param content - The snippet content
 * @param options - Optional metadata (aliases, description)
 * @param projectDir - If provided, creates in project directory; otherwise global
 * @returns The path to the created snippet file
 */
export async function createSnippet(
  name: string,
  content: string,
  options: { aliases?: string[]; description?: string } = {},
  projectDir?: string,
): Promise<string> {
  const dir = await ensureSnippetsDir(projectDir);
  const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);

  // Build frontmatter if we have metadata
  const frontmatter: SnippetFrontmatter = {};
  if (options.aliases?.length) {
    frontmatter.aliases = options.aliases;
  }
  if (options.description) {
    frontmatter.description = options.description;
  }

  // Create file content with frontmatter if needed
  let fileContent: string;
  if (Object.keys(frontmatter).length > 0) {
    fileContent = matter.stringify(content, frontmatter);
  } else {
    fileContent = content;
  }

  await Bun.write(filePath, fileContent);
  logger.info("Created snippet", { name, path: filePath });

  return filePath;
}

/**
 * Deletes a snippet file
 *
 * @param name - The snippet name (without extension)
 * @param projectDir - If provided, looks in project directory first; otherwise global
 * @returns The path of the deleted file, or null if not found
 */
export async function deleteSnippet(name: string, projectDir?: string): Promise<string | null> {
  // Try project directory first if provided
  if (projectDir) {
    const paths = getProjectPaths(projectDir);
    for (const dir of [paths.SNIPPETS_DIR, paths.SNIPPETS_DIR_ALT]) {
      const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);
      try {
        await unlink(filePath);
        logger.info("Deleted project snippet", { name, path: filePath });
        return filePath;
      } catch {
        // Not found in this project directory, keep looking.
      }
    }
  }

  // Try global directory
  for (const dir of [PATHS.SNIPPETS_DIR, PATHS.SNIPPETS_DIR_ALT]) {
    const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);
    try {
      await unlink(filePath);
      logger.info("Deleted global snippet", { name, path: filePath });
      return filePath;
    } catch {
      // Not found in this global directory, keep looking.
    }
  }

  logger.warn("Snippet not found for deletion", { name });
  return null;
}

/**
 * Reloads snippets into the registry from disk
 */
export async function reloadSnippets(
  registry: SnippetRegistry,
  projectDir?: string,
): Promise<void> {
  registry.clear();
  const fresh = await loadSnippets(projectDir);
  for (const [key, value] of fresh) {
    registry.set(key, value);
  }
}
