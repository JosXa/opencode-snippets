import { join } from "node:path";
import { fixture } from "./v2-runtime.fixture";

// A disposable real TUI with a local deterministic provider, sharing the same
// built-plugin fixture as the server tests. No account or live model is needed.
const host = await fixture();
for await (const name of new Bun.Glob("*.md").scan(join(import.meta.dir, "../examples/forms"))) {
  await host.write(
    name.slice(0, -3),
    await Bun.file(join(import.meta.dir, "../examples/forms", name)).text(),
  );
}
await host.write(
  "form-demo",
  [
    "---",
    "fields:",
    "  prompt: {type: textarea, label: Prompt, required: true}",
    "  stop: {type: textarea, label: Stop conditions}",
    "  goal: {type: checkbox, label: Use goal}",
    "  count: {type: number, integer: true, min: 0, max: 10, default: 3}",
    "  mode: {type: select, options: [Quick, Normal, Thorough], default: Normal}",
    "---",
    "Prompt: {{prompt}}",
    "Stop: {{stop}}",
    "Goal: {{goal}}",
    "Count: {{count}}",
    "Mode: {{mode}}",
  ].join("\n"),
);
await Bun.write(
  join(host.root, "config/opencode/cli.json"),
  JSON.stringify({
    plugins: [host.plugin],
    keybinds: { "prompt.clear": "ctrl+u" },
  }),
);
await Bun.write(
  join(host.directory, "attachment.txt"),
  "ATTACHMENT_MARKER #chosen must stay literal",
);

const keys = [
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "OPENCODE_DB",
];
const overrides = Object.fromEntries(keys.map((key) => [key, host.env[key]]));
const launch = join(host.root, "launch.ts");
await Bun.write(
  launch,
  `const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_")));
Object.assign(env, ${JSON.stringify(overrides)}, { PWD: ${JSON.stringify(host.directory)}, OPENCODE_DISABLE_EXTERNAL_SKILLS: "1" });
const args = Bun.argv.slice(2);
const child = Bun.spawn([${JSON.stringify(host.cli)}, ...(args.length ? args : ${JSON.stringify([host.directory, "--standalone"])})], {cwd:${JSON.stringify(host.directory)},env,stdin:"inherit",stdout:"inherit",stderr:"inherit"});
process.exit(await child.exited);
`,
);
await Bun.write(
  join(host.root, "playground.json"),
  JSON.stringify({
    root: host.root,
    directory: host.directory,
    launch,
    cli: host.cli,
    plugin: host.plugin,
  }),
);
console.log(JSON.stringify({ root: host.root, launch, directory: host.directory }));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    host.stop();
    process.exit(0);
  });
}
