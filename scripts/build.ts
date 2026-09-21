import { rmSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

rmSync("dist", { recursive: true, force: true });

const typecheck = Bun.spawnSync(["tsc", "-p", "tsconfig.build.json"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
if (typecheck.exitCode !== 0) process.exit(typecheck.exitCode);

const server = await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  target: "node",
  external: ["@opencode/plugin"],
});
if (!server.success) {
  for (const log of server.logs) console.error(log);
  process.exit(1);
}

const tui = await Bun.build({
  entrypoints: ["./tui.tsx", "./tui-v1.tsx", "./tui-v2.tsx"],
  splitting: true,
  outdir: "./dist",
  target: "node",
  external: ["@opencode/plugin/tui", "@opentui/core", "@opentui/solid", "solid-js"],
  plugins: [solidPlugin],
});
if (!tui.success) {
  for (const log of tui.logs) console.error(log);
  process.exit(1);
}
