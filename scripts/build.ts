import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";

const destination = resolve("dist");
mkdirSync(".tmp", { recursive: true });
const output = mkdtempSync(resolve(".tmp", "build-"));

function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1));
}

function installOrder(file: string) {
  if (file.includes("/")) return 0;
  if (file.startsWith("chunk-")) return 1;
  if (file === "index.js" || file === "tui.js") return 3;
  return 2;
}

try {
  const typecheck = Bun.spawnSync(["tsc", "-p", "tsconfig.build.json", "--outDir", output], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (typecheck.exitCode !== 0) throw new Error(`tsc exited with ${typecheck.exitCode}`);

  const server = await Bun.build({
    entrypoints: ["./index.ts"],
    outdir: output,
    target: "node",
    external: ["@opencode/plugin"],
  });
  if (!server.success) throw new AggregateError(server.logs, "server build failed");

  const tui = await Bun.build({
    entrypoints: ["./tui.tsx", "./tui-v1.tsx", "./tui-v2.tsx"],
    splitting: true,
    outdir: output,
    target: "node",
    external: ["@opencode/plugin/tui", "@opentui/core", "@opentui/solid", "solid-js"],
    plugins: [solidPlugin],
  });
  if (!tui.success) throw new AggregateError(tui.logs, "TUI build failed");

  const built = files(output).sort((a, b) => installOrder(a) - installOrder(b));
  for (const file of built) {
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    renameSync(join(output, file), join(destination, file));
  }
  const current = new Set(built);
  for (const file of files(destination)) {
    if (!current.has(file)) rmSync(join(destination, file));
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
