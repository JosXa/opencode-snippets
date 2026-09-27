import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfiguration, loadSources, runCucumber } from "@cucumber/cucumber/api";

const artifacts = resolve(process.env.SNIPPETS_BDD_ARTIFACTS ?? ".tmp/bdd");
await mkdir(artifacts, { recursive: true });
// Keep local preferences and editor commands outside this deterministic host double.
process.env.OPENCODE_CONFIG_DIR = join(artifacts, "config");
process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({
  scroll: { speed: 3, acceleration: false },
});
delete process.env.VISUAL;
delete process.env.EDITOR;
const config = await loadConfiguration({ file: "cucumber.mjs", provided: Bun.argv.slice(2) });
const sources = await loadSources(config.runConfiguration.sources);
assert.deepEqual(sources.errors, [], "Gherkin must parse without errors");
assert.ok(sources.plan.length > 0, "No BDD scenarios matched");
const result = await runCucumber(config.runConfiguration);
process.exitCode = result.success ? 0 : 1;
