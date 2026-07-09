import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

rmSync("dist", { recursive: true, force: true });

const typecheck = spawnSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

const server = await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  target: "node",
  external: ["@opencode-ai/plugin"],
});
if (!server.success) {
  for (const log of server.logs) console.error(log);
  process.exit(1);
}

const tui = await Bun.build({
  entrypoints: ["./tui.tsx"],
  outdir: "./dist",
  target: "node",
  external: ["@opencode-ai/plugin/tui", "@opentui/core", "@opentui/solid", "solid-js"],
  plugins: [solidPlugin],
});
if (!tui.success) {
  for (const log of tui.logs) console.error(log);
  process.exit(1);
}
