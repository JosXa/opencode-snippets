import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { importCjs } from "./cjs-interop.js";
import { getProjectPaths, PATHS } from "./constants.js";
import { getSnippetForm } from "./fields.js";
import { ensureSnippetsDir, loadSnippets, validateSnippetName } from "./loader.js";
import type { SnippetInfo, SnippetRegistry } from "./types.js";

const matter = await importCjs<typeof import("gray-matter")>("gray-matter");

export interface LibraryFile extends SnippetInfo {
  raw: string;
  active: boolean;
}

export function parseLibraryFile(
  path: string,
  source: "global" | "project",
  raw: string,
): LibraryFile {
  const base = { name: basename(path, ".md"), filePath: path, source, raw, active: true };
  try {
    const parsed = matter(raw, {});
    const aliases = parsed.data.aliases ?? parsed.data.alias ?? [];
    if (
      !(
        typeof aliases === "string" ||
        (Array.isArray(aliases) && aliases.every((x) => typeof x === "string"))
      )
    )
      throw new Error("Aliases must be text or a list of text values.");
    if (parsed.data.description !== undefined && typeof parsed.data.description !== "string")
      throw new Error("Description must be text.");
    return {
      ...base,
      content: parsed.content.trim(),
      aliases: typeof aliases === "string" ? [aliases] : aliases,
      description: parsed.data.description,
      ...(Object.hasOwn(parsed.data, "fields") ? { fields: parsed.data.fields } : {}),
    };
  } catch (error) {
    return {
      ...base,
      content: raw,
      aliases: [],
      metadataError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Static references only: inspecting a library must never run shells or load skills. */
export function snippetReferences(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(/#([a-z0-9][a-z0-9_-]*)/gi)]
        .map((match) => match[1])
        .filter((name) => name.toLowerCase() !== "skill"),
    ),
  ];
}

export function libraryRegistry(file: LibraryFile, registry: SnippetRegistry): SnippetRegistry {
  const next = new Map(registry);
  next.set(file.name.toLowerCase(), file);
  for (const alias of file.aliases) next.set(alias.toLowerCase(), file);
  return next;
}

/** Copies keep their own triggers; renamed files retain the previous trigger. */
export function copyLibrarySource(raw: string, alias?: string): string {
  const parsed = matter(raw, {});
  const data = { ...parsed.data };
  const aliases = data.aliases ?? data.alias ?? [];
  delete data.alias;
  data.aliases = alias
    ? [...new Set([...(Array.isArray(aliases) ? aliases : [aliases]), alias])]
    : [];
  return matter.stringify(parsed.content, data);
}

export function validateLibraryFile(file: LibraryFile, registry: SnippetRegistry): void {
  if (file.metadataError) throw new Error(file.metadataError);
  getSnippetForm(file.name, libraryRegistry(file, registry));
}

export function createLibrary(directory: string, globalDirectory?: string) {
  const project = getProjectPaths(directory);
  const roots = [
    ...(globalDirectory
      ? [{ path: globalDirectory, source: "global" as const }]
      : [PATHS.SNIPPETS_DIR_ALT, PATHS.SNIPPETS_DIR].map((path) => ({
          path,
          source: "global" as const,
        }))),
    ...[project.SNIPPETS_DIR_ALT, project.SNIPPETS_DIR].map((path) => ({
      path,
      source: "project" as const,
    })),
  ];
  const root = (path: string) => {
    const found = roots.find((item) => resolve(item.path) === resolve(dirname(path)));
    if (!found || !path.endsWith(".md")) throw new Error("File is outside the snippet library.");
    return found;
  };
  const check = async (path: string) => {
    const found = root(path);
    if (found.source === "project") {
      const [canonical, parent, details] = await Promise.all([
        realpath(directory),
        realpath(found.path),
        lstat(found.path),
      ]);
      const child = relative(canonical, parent);
      if (
        details.isSymbolicLink() ||
        isAbsolute(child) ||
        child === ".." ||
        child.startsWith("../") ||
        child.startsWith("..\\")
      )
        throw new Error(
          "Project snippet directory must be inside the project and cannot be a symbolic link.",
        );
    }
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink())
      throw new Error("Only regular snippet files can be edited.");
    return details;
  };
  const unchanged = async (file: LibraryFile) => {
    const details = await check(file.filePath);
    if ((await readFile(file.filePath, "utf8")) !== file.raw)
      throw new Error(
        "File changed on disk. Your draft is preserved. Reload the file before saving.",
      );
    return details;
  };
  const list = async () => {
    const registry = await loadSnippets(directory, globalDirectory);
    const files: LibraryFile[] = [];
    for (const entry of roots) {
      const names = await readdir(entry.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const name of names.sort()) {
        if (!name.endsWith(".md")) continue;
        const path = join(entry.path, name);
        // Follow the loader's project boundary; global symlink files are readable
        // but writes deliberately require a regular file.
        if (entry.source === "project") {
          try {
            await check(path);
          } catch {
            continue;
          }
        }
        const file = parseLibraryFile(path, entry.source, await readFile(path, "utf8"));
        file.active = registry.get(file.name.toLowerCase())?.filePath === path;
        files.push(file);
      }
    }
    return { files, registry };
  };
  const create = async (name: string, source: "global" | "project", raw: string) => {
    validateSnippetName(name);
    const target = await ensureSnippetsDir(
      source === "project" ? directory : undefined,
      globalDirectory,
    );
    const path = join(target, `${name}.md`);
    // Exclusive creation prevents a duplicate/rename from overwriting another snippet.
    await writeFile(path, raw, { encoding: "utf8", flag: "wx" });
    return path;
  };
  return {
    list,
    create,
    async save(file: LibraryFile, raw: string) {
      const details = await unchanged(file);
      const temporary = join(
        dirname(file.filePath),
        `.${basename(file.filePath)}.${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, raw, { encoding: "utf8", flag: "wx", mode: details.mode });
        await unchanged(file);
        await rename(temporary, file.filePath);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
    async relocate(file: LibraryFile, name: string, source: "global" | "project") {
      await unchanged(file);
      const path = await create(
        name,
        source,
        name === file.name ? file.raw : copyLibrarySource(file.raw, file.name),
      );
      // Do not remove a source which changed while the destination was created.
      try {
        await unchanged(file);
      } catch (error) {
        await unlink(path);
        throw error;
      }
      await unlink(file.filePath);
      return path;
    },
    async remove(file: LibraryFile) {
      await unchanged(file);
      await unlink(file.filePath);
    },
  };
}
