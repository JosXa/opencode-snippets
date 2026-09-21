import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function fixture() {
  const cli = Bun.which(process.env.OPENCODE1_BIN ?? "opencode");
  assert.ok(cli, "Install OpenCode V1 or set OPENCODE1_BIN");
  const parent = join(tmpdir(), "opencode");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "snippets-v1-runtime-"));
  const directory = join(root, "project");
  const config = join(root, "config", "opencode");
  const snippets = join(directory, ".opencode", "snippet");
  const plugin = pathToFileURL(resolve(import.meta.dir, "..")).href;
  for (const path of [config, snippets, join(root, "home")]) await mkdir(path, { recursive: true });
  const requests: { messages: { role: string; content: unknown }[]; tools?: unknown[] }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await request.json());
      await Bun.write(join(root, "requests.json"), JSON.stringify(requests, null, 2));
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      return new Response(
        `${chunk({ role: "assistant", content: "RUNTIME_OK" })}${chunk({}, "stop")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_")),
  );
  const registry = Bun.spawnSync(["npm", "config", "get", "registry"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(registry.exitCode, 0);
  // Preserve registry routing when the isolated HOME hides the caller's npmrc.
  env.npm_config_registry = registry.stdout.toString().trim();
  Object.assign(env, {
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    PWD: directory,
  });
  await Bun.write(
    join(config, "opencode.json"),
    JSON.stringify({
      plugin: [plugin],
      model: "fixture/fixture",
      autoupdate: false,
      snapshot: false,
      provider: {
        fixture: {
          npm: "@ai-sdk/openai-compatible",
          name: "Fixture",
          options: { apiKey: "fixture", baseURL: `http://127.0.0.1:${server.port}/v1` },
          models: { fixture: { name: "fixture", limit: { context: 1000000, output: 1000 } } },
        },
      },
    }),
  );
  await Bun.write(join(config, "tui.json"), JSON.stringify({ plugin: [plugin] }));
  await Bun.write(join(snippets, "chosen.md"), "---\naliases: [cp]\n---\nPROJECT_CHOSEN");
  await Bun.write(join(snippets, "once.md"), "!`printf x >> count.txt; printf SHELL_PROOF`");
  await Bun.write(
    join(snippets, "config.jsonc"),
    JSON.stringify({
      experimental: { skillLoading: true, skillRendering: true, injectBlocks: true },
    }),
  );
  await Bun.write(
    join(directory, ".opencode", "skills", "local", "SKILL.md"),
    "---\nname: local\ndescription: Fixture\n---\nLOCAL_BODY #chosen",
  );
  const execute = async (args: string[]) => {
    const child = Bun.spawn([cli, ...args], {
      cwd: directory,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await Bun.write(join(root, "command.log"), `${out}\n${error}`);
    assert.equal(code, 0, `${out}\n${error}\nArtifacts: ${root}`);
    return out;
  };
  return {
    root,
    directory,
    config,
    snippets,
    cli,
    env,
    requests,
    execute,
    verify: async () => {
      assert.match((await execute(["--version"])).trim(), /^1\.18\.29$/);
      assert.ok((await execute(["debug", "config"])).includes(plugin));
    },
    run: async (prompt: string) => {
      const offset = requests.length;
      const out = await execute(["run", "--format", "json", "--model", "fixture/fixture", prompt]);
      assert.ok(out.includes("RUNTIME_OK"), out);
      const calls = requests.slice(offset).filter((request) => request.tools?.length);
      assert.ok(calls.length, "No main model request");
      return calls;
    },
    stop: () => server.stop(true),
  };
}

export async function withFixture(
  run: (host: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  const host = await fixture();
  try {
    await run(host);
    await rm(host.root, { recursive: true, force: true });
  } catch (error) {
    console.error(`V1 runtime artifacts retained: ${host.root}`);
    throw error;
  } finally {
    host.stop();
  }
}
