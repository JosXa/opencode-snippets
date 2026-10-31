import { type FSWatcher, statSync, watch } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { getSnippetDirectories } from "./constants.js";
import { logger } from "./logger.js";

export function watchSnippets(
  projectDir: string,
  globalDir: string | undefined,
  changed: () => Promise<void>,
): () => void {
  const directories = getSnippetDirectories(projectDir, globalDir).map((dir) => resolve(dir.path));
  const watchers: FSWatcher[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending
        .then(async () => {
          if (stopped) return;
          reconcile();
          await changed();
        })
        .catch((error: unknown) => {
          logger.warn("Failed to reload snippet files", { error: String(error) });
        });
    }, 75);
  };

  const reconcile = () => {
    for (const watcher of watchers.splice(0)) watcher.close();
    const plan = new Map<string, { snippets: boolean; names: Set<string> }>();
    const add = (path: string, name?: string) => {
      const target = plan.get(path) ?? { snippets: false, names: new Set<string>() };
      if (name === undefined) target.snippets = true;
      if (name !== undefined) target.names.add(name);
      plan.set(path, target);
    };
    for (const directory of directories) {
      let ancestor = directory;
      while (!statSync(ancestor, { throwIfNoEntry: false })?.isDirectory()) {
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      if (ancestor !== directory) {
        add(ancestor, relative(ancestor, directory).split(sep)[0]);
        continue;
      }
      add(directory);
      add(dirname(directory), basename(directory));
      add(dirname(dirname(directory)), basename(dirname(directory)));
    }
    for (const [path, target] of plan) {
      try {
        const watcher = watch(path, { persistent: false }, (_event, file) => {
          if (file === null || target.names.has(file) || target.snippets) schedule();
        });
        watcher.on("error", (error) => {
          logger.warn("Snippet file watcher failed", { path, error: String(error) });
        });
        watchers.push(watcher);
      } catch (error) {
        logger.warn("Cannot watch snippet directory", { path, error: String(error) });
      }
    }
  };

  reconcile();
  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers.splice(0)) watcher.close();
  };
}
