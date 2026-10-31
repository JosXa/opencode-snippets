import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSnippetDirectories } from "./constants.js";
import { loadSnippets } from "./loader.js";
import { watchSnippets } from "./snippet-watcher.js";
import type { SnippetRegistry } from "./types.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "snippets-watch-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const global = join(root, "config", "snippet");
  const projects = [join(root, "first"), join(root, "second")];
  await Promise.all(projects.map((path) => mkdir(path)));
  const clients = projects.map((project) => {
    const client = { registry: new Map() as SnippetRegistry, updates: 0 };
    cleanups.push(
      watchSnippets(project, global, async () => {
        client.registry = await loadSnippets(project, global);
        client.updates++;
      }),
    );
    return client;
  });
  return { root, global, projects, clients };
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  expect(condition()).toBe(true);
}

test("global files refresh independent clients on create, edit, atomic save, rename and delete", async () => {
  const view = await fixture();
  const file = join(view.global, "houseplant.md");
  await mkdir(view.global, { recursive: true });
  await Bun.write(file, "---\naliases: [plant]\n---\nOriginal");
  await until(() =>
    view.clients.every((client) => client.registry.get("plant")?.content === "Original"),
  );
  await Bun.write(file, "---\naliases: [green]\nfields:\n  color: {}\n---\n{{color}}");
  await until(() =>
    view.clients.every((client) => client.registry.has("green") && !client.registry.has("plant")),
  );
  expect(view.clients[0].registry.get("green")?.fields).toEqual({ color: {} });
  await Bun.write(join(view.global, ".save"), "Atomic save");
  await rename(join(view.global, ".save"), file);
  await until(() =>
    view.clients.every((client) => client.registry.get("houseplant")?.content === "Atomic save"),
  );
  await rename(file, join(view.global, "renamed.md"));
  await until(() =>
    view.clients.every(
      (client) => client.registry.has("renamed") && !client.registry.has("houseplant"),
    ),
  );
  await rm(join(view.global, "renamed.md"));
  await until(() => view.clients.every((client) => !client.registry.has("renamed")));
});

test("new project directories, plural directories, precedence and directory recreation stay live", async () => {
  const view = await fixture();
  await mkdir(view.global, { recursive: true });
  await Bun.write(join(view.global, "plant.md"), "Global");
  await until(() => view.clients.every((client) => client.registry.has("plant")));
  const plural = join(view.projects[0], ".opencode", "snippets");
  const singular = join(view.projects[0], ".opencode", "snippet");
  await mkdir(plural, { recursive: true });
  await Bun.write(join(plural, "plant.md"), "Plural");
  await until(() => view.clients[0].registry.get("plant")?.content === "Plural");
  expect(view.clients[1].registry.get("plant")?.content).toBe("Global");
  await mkdir(singular);
  await Bun.write(join(singular, "plant.md"), "Singular");
  await until(() => view.clients[0].registry.get("plant")?.content === "Singular");
  await rm(join(view.projects[0], ".opencode"), { recursive: true });
  await until(() => view.clients[0].registry.get("plant")?.content === "Global");
  await mkdir(singular, { recursive: true });
  await Bun.write(join(singular, "plant.md"), "Recreated");
  await until(() => view.clients[0].registry.get("plant")?.content === "Recreated");
});

test("ignores unrelated files, coalesces saves and stops watching on disposal", async () => {
  const view = await fixture();
  await mkdir(view.global, { recursive: true });
  await Bun.write(join(view.global, "plant.md"), "Ready");
  await until(() => view.clients.every((client) => client.registry.has("plant")));
  const before = view.clients.map((client) => client.updates);
  await Bun.write(join(view.root, "unrelated.md"), "Ignore");
  await Bun.sleep(150);
  expect(view.clients.map((client) => client.updates)).toEqual(before);
  await Promise.all(
    Array.from({ length: 10 }, (_, index) => Bun.write(join(view.global, `${index}.md`), "Burst")),
  );
  await until(() => view.clients.every((client) => client.registry.has("9")));
  expect(view.clients.map((client) => client.updates)).toEqual(before.map((value) => value + 1));
  for (const stop of cleanups.slice(1)) await stop();
  const stopped = view.clients.map((client) => client.updates);
  await Bun.write(join(view.global, "plant.md"), "After disposal");
  await Bun.sleep(150);
  expect(view.clients.map((client) => client.updates)).toEqual(stopped);
});

test("watching and loading share the documented directory order", () => {
  expect(getSnippetDirectories("/project", "/custom")).toEqual([
    { path: "/custom", source: "global" },
    { path: "/project/.opencode/snippets", source: "project" },
    { path: "/project/.opencode/snippet", source: "project" },
  ]);
});
