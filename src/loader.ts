import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

async function resolveWritableSnippetDir(projectDir?: string, globalDir?: string): Promise<string> {
  if (!projectDir && globalDir) return globalDir;
  const paths = projectDir
    ? getProjectPaths(projectDir)
    : { SNIPPETS_DIR: PATHS.SNIPPETS_DIR, SNIPPETS_DIR_ALT: PATHS.SNIPPETS_DIR_ALT };

  // Support both snippet/ and snippets/. Reuse an existing directory first, then default to snippet/.
  for (const dir of [paths.SNIPPETS_DIR, paths.SNIPPETS_DIR_ALT]) {
    if (await pathExists(dir)) return dir;
  }

  return paths.SNIPPETS_DIR;
}

const SNIPPET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function validateSnippetName(name: string): void {
  if (!SNIPPET_NAME.test(name)) {
    throw new Error(
      `Invalid snippet name "${name}". Use letters, numbers, underscores, or hyphens.`,
    );
  }
}

function isContained(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith("../") && !child.startsWith("..\\"))
  );
}

async function assertContainedSnippetPath(dir: string, filePath: string): Promise<void> {
  const resolvedDir = await realpath(dir);
  let resolvedFile: string;
  try {
    resolvedFile = await realpath(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    resolvedFile = join(resolvedDir, basename(filePath));
  }
  if (!isContained(resolvedDir, resolvedFile)) {
    throw new Error(`Snippet path escapes its configured directory: ${filePath}`);
  }
}

async function assertProjectSnippetDirectory(projectDir: string, dir: string): Promise<boolean> {
  let projectRoot: string;
  try {
    projectRoot = await realpath(projectDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (details.isSymbolicLink()) {
    throw new Error(`Project snippet directory must not be a symbolic link: ${dir}`);
  }
  const resolvedDir = await realpath(dir);
  if (!isContained(projectRoot, resolvedDir)) {
    throw new Error(`Project snippet directory escapes the canonical project root: ${dir}`);
  }
  return true;
}

async function assertProjectSnippetCreationTarget(projectDir: string, dir: string): Promise<void> {
  const projectRoot = await realpath(projectDir);
  if (!isContained(resolve(projectDir), resolve(dir))) {
    throw new Error(`Project snippet directory escapes the project path: ${dir}`);
  }
  let ancestor = dirname(dir);
  while (true) {
    try {
      const resolvedAncestor = await realpath(ancestor);
      if (!isContained(projectRoot, resolvedAncestor)) {
        throw new Error(`Project snippet directory escapes the canonical project root: ${dir}`);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
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
      if (!(await assertProjectSnippetDirectory(projectDir, dir))) continue;
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
    if (source === "project") {
      const details = await lstat(filePath);
      if (details.isSymbolicLink()) {
        throw new Error(`Project snippet file must not be a symbolic link: ${filePath}`);
      }
      const [resolvedDir, resolvedFile] = await Promise.all([realpath(dir), realpath(filePath)]);
      if (!isContained(resolvedDir, resolvedFile)) {
        throw new Error(`Project snippet file escapes its configured directory: ${filePath}`);
      }
    }
    const fileContent = await readFile(filePath, "utf8");
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
export async function ensureSnippetsDir(projectDir?: string, globalDir?: string): Promise<string> {
  const dir = await resolveWritableSnippetDir(projectDir, globalDir);
  if (projectDir) await assertProjectSnippetCreationTarget(projectDir, dir);
  await mkdir(dir, { recursive: true });
  if (projectDir) await assertProjectSnippetDirectory(projectDir, dir);
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
  globalDir?: string,
): Promise<string> {
  validateSnippetName(name);
  const dir = await ensureSnippetsDir(projectDir, globalDir);
  const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);
  await assertContainedSnippetPath(dir, filePath);

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

  await writeFile(filePath, fileContent, "utf8");
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
export async function deleteSnippet(
  name: string,
  projectDir?: string,
  globalDir?: string,
): Promise<string | null> {
  validateSnippetName(name);
  // Try project directory first if provided
  if (projectDir) {
    const paths = getProjectPaths(projectDir);
    for (const dir of [paths.SNIPPETS_DIR, paths.SNIPPETS_DIR_ALT]) {
      const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);
      try {
        if (!(await assertProjectSnippetDirectory(projectDir, dir))) continue;
        await assertContainedSnippetPath(dir, filePath);
        await unlink(filePath);
        logger.info("Deleted project snippet", { name, path: filePath });
        return filePath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  // Try global directory
  for (const dir of globalDir ? [globalDir] : [PATHS.SNIPPETS_DIR, PATHS.SNIPPETS_DIR_ALT]) {
    const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);
    try {
      await assertContainedSnippetPath(dir, filePath);
      await unlink(filePath);
      logger.info("Deleted global snippet", { name, path: filePath });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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
  globalDir?: string,
): Promise<void> {
  registry.clear();
  const fresh = await loadSnippets(projectDir, globalDir);
  for (const [key, value] of fresh) {
    registry.set(key, value);
  }
}
