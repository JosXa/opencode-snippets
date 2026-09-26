import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  copyLibrarySource,
  createLibrary,
  parseLibraryFile,
  snippetReferences,
  validateLibraryFile,
} from "./library.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp("/tmp/opencode/snippets-library-");
  roots.push(root);
  const global = join(root, "global");
  await mkdir(global);
  const library = createLibrary(root, global);
  const file = async (name: string) => {
    const found = (await library.list()).files.find((file) => file.name === name);
    if (!found) throw new Error(`Missing fixture: ${name}`);
    return found;
  };
  return { root, global, library, file };
}

test("inventory retains global and plural definitions overridden by project singular", async () => {
  const { root, library } = await fixture();
  await library.create("review", "global", "Global");
  const path = await library.create("review", "project", "Project");
  await Bun.write(join(root, ".opencode/snippets/review.md"), "Plural");
  const result = await library.list();
  expect(result.files).toHaveLength(3);
  expect(result.files.filter((file) => file.active).map((file) => file.filePath)).toEqual([path]);
});

test("save preserves raw Unicode, blocks, frontmatter, and mode without leaving temporary files", async () => {
  const { library, file, global } = await fixture();
  await library.create("review", "global", "Original\r\n");
  const raw =
    "---\naliases: [rev]\nfields:\n  text: {type: textarea}\n---\n中😀 {{text}}\n<append>\n#other\n</append>\n";
  await library.save(await file("review"), raw);
  expect(await Bun.file(join(global, "review.md")).text()).toBe(raw);
  expect(await readdir(global)).toEqual(["review.md"]);
});

test("external edits prevent save, rename, move and delete", async () => {
  const { library, file } = await fixture();
  const path = await library.create("review", "project", "Before");
  const original = await file("review");
  await Bun.write(path, "Changed externally");
  await expect(library.save(original, "Draft")).rejects.toThrow("changed on disk");
  await expect(library.relocate(original, "renamed", "project")).rejects.toThrow("changed on disk");
  await expect(library.relocate(original, "review", "global")).rejects.toThrow("changed on disk");
  await expect(library.remove(original)).rejects.toThrow("changed on disk");
  expect(await Bun.file(path).text()).toBe("Changed externally");
});

test("exclusive creation and relocation never overwrite an existing destination", async () => {
  const { library, file } = await fixture();
  await library.create("review", "global", "Global");
  const path = await library.create("review", "project", "Project");
  await expect(library.create("review", "project", "Lost")).rejects.toThrow("EEXIST");
  const project = (await library.list()).files.find((file) => file.filePath === path);
  if (!project) throw new Error("Missing project fixture");
  await expect(library.relocate(project, "review", "global")).rejects.toThrow("EEXIST");
  expect((await file("review")).raw).toBe("Global");
  expect(await Bun.file(path).text()).toBe("Project");
});

test("rename keeps old name as alias; duplicate clears aliases; move preserves source", async () => {
  const { library, file } = await fixture();
  const raw = "---\naliases: [rev]\nfields:\n  text: {type: text}\n---\n{{text}}\n";
  await library.create("review", "project", raw);
  const renamed = await library.relocate(await file("review"), "inspect", "project");
  expect((await library.list()).registry.get("review")?.filePath).toBe(renamed);
  expect((await library.list()).registry.get("rev")?.filePath).toBe(renamed);
  const saved = await file("inspect");
  const moved = await library.relocate(saved, "inspect", "global");
  expect(await Bun.file(moved).text()).toBe(saved.raw);
  expect(await Bun.file(renamed).exists()).toBe(false);
  expect(parseLibraryFile("copy.md", "global", copyLibrarySource(raw)).aliases).toEqual([]);
  await library.remove(await file("inspect"));
  expect((await library.list()).files).toHaveLength(0);
});

test("rejects traversal and symlink writes, including a symlinked project directory", async () => {
  const { library, root, global, file } = await fixture();
  await expect(library.create("../escape", "global", "Bad")).rejects.toThrow(
    "Invalid snippet name",
  );
  const target = join(root, "target.md");
  await Bun.write(target, "Original");
  await symlink(target, join(global, "link.md"));
  await expect(library.save(await file("link"), "Bad")).rejects.toThrow("regular snippet");
  await mkdir(join(root, ".opencode"));
  await symlink(global, join(root, ".opencode/snippet"));
  await expect(library.create("escape", "project", "Bad")).rejects.toThrow();
  expect(await Bun.file(target).text()).toBe("Original");
});

test("malformed files remain editable; validation reports YAML and field errors without effects", async () => {
  const { library, file, root } = await fixture();
  const marker = join(root, "must-not-exist");
  await library.create("broken", "project", "---\nfields: [\n---\nBody");
  const broken = await file("broken");
  expect(broken.metadataError).toBeTruthy();
  expect(() => validateLibraryFile(broken, new Map())).toThrow();
  const invalid = parseLibraryFile(
    "test.md",
    "project",
    "---\nfields:\n  mode: {type: select}\n---\n{{mode}}",
  );
  expect(() => validateLibraryFile(invalid, new Map())).toThrow();
  const effects = parseLibraryFile(
    "safe.md",
    "project",
    `!\`touch ${marker}\` #skill(private) #_literal #missing`,
  );
  validateLibraryFile(effects, new Map());
  expect(snippetReferences(effects.content)).toEqual(["missing"]);
  expect(await Bun.file(marker).exists()).toBe(false);
});
