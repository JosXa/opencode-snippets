import { readdir, readFile } from "node:fs/promises"
import { join, basename } from "node:path"
import matter from "gray-matter"
import type { SnippetRegistry, SnippetFrontmatter } from "./types.js"
import { PATHS, CONFIG } from "./constants.js"
import { logger } from "./logger.js"

/**
 * Loads all snippets from the snippets directory
 * 
 * @returns A map of snippet keys (lowercase) to their content
 */
export async function loadSnippets(): Promise<SnippetRegistry> {
  const snippets: SnippetRegistry = new Map()
  
  try {
    const files = await readdir(PATHS.SNIPPETS_DIR)
    
    for (const file of files) {
      if (!file.endsWith(CONFIG.SNIPPET_EXTENSION)) continue
      
      const snippet = await loadSnippetFile(file)
      if (snippet) {
        registerSnippet(snippets, snippet.name, snippet.content, snippet.aliases)
      }
    }
  } catch (error) {
    // Snippets directory doesn't exist or can't be read - that's fine
    logger.info("Snippets directory not found or unreadable", { 
      path: PATHS.SNIPPETS_DIR,
      error: error instanceof Error ? error.message : String(error)
    })
    // Return empty registry
  }
  
  return snippets
}

/**
 * Loads and parses a single snippet file
 * 
 * @param filename - The filename to load (e.g., "my-snippet.md")
 * @returns The parsed snippet data, or null if parsing failed
 */
async function loadSnippetFile(filename: string) {
  try {
    const name = basename(filename, CONFIG.SNIPPET_EXTENSION)
    const filePath = join(PATHS.SNIPPETS_DIR, filename)
    const fileContent = await readFile(filePath, "utf-8")
    const parsed = matter(fileContent)
    
    const content = parsed.content.trim()
    const frontmatter = parsed.data as SnippetFrontmatter
    const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : []
    
    return { name, content, aliases }
  } catch (error) {
    // Failed to read or parse this snippet - skip it
    logger.warn("Failed to load snippet file", { 
      filename,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
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
  aliases: string[]
) {
  // Register with primary name (lowercase)
  registry.set(name.toLowerCase(), content)
  
  // Register all aliases (lowercase)
  for (const alias of aliases) {
    registry.set(alias.toLowerCase(), content)
  }
}
