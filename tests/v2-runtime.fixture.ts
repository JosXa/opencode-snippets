import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Message = { role: string; content: string | Array<{ type: string; text?: string }> | null };
type Request = {
  messages: Message[];
  tools?: Array<{ function: { name: string } }>;
};
type SavedMessage = {
  id: string;
  type: string;
  text?: string;
  files?: unknown[];
  metadata?: Record<string, { text: string; hidden: string[]; injections: unknown[] }>;
};
type Export = { info: { id: string; outcome: string }; messages: SavedMessage[] };

export function text(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content?.map((part) => part.text ?? "").join("\n") ?? "";
}

export async function fixture() {
  const cli = Bun.which(process.env.OPENCODE2_BIN ?? process.env.OPENCODE_BIN ?? "opencode2");
  assert.ok(cli, "Install opencode2 or set OPENCODE2_BIN before running test:v2");
  const temporary = join(tmpdir(), "opencode");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, "snippets-v2-runtime-"));
  const directory = join(root, "project");
  const config = join(root, "config", "opencode");
  const snippets = join(directory, ".opencode", "snippet");
  const plugin = pathToFileURL(resolve(import.meta.dir, "..")).href;
  assert.ok(await Bun.file(new URL(`${plugin}/dist/index.js`)).exists(), "Run bun run build first");
  await Promise.all([
    mkdir(snippets, { recursive: true }),
    mkdir(config, { recursive: true }),
    mkdir(join(root, "home"), { recursive: true }),
    mkdir(join(directory, ".opencode", "skills", "local"), { recursive: true }),
    mkdir(join(root, "native"), { recursive: true }),
  ]);
  const requests: Request[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: Request = await request.json();
      requests.push(body);
      await Bun.write(join(root, "requests.json"), JSON.stringify(requests, null, 2));
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "runtime", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const tool =
        body.tools?.some((item) => item.function.name === "skill") &&
        body.messages.some(
          (message) => message.role === "user" && text(message).includes("USE_NATIVE_TOOL"),
        ) &&
        !body.messages.some((message) => message.role === "tool");
      const response = tool
        ? chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_fixture",
                type: "function",
                function: { name: "skill", arguments: JSON.stringify({ id: "host:tool" }) },
              },
            ],
          }) + chunk({}, "tool_calls")
        : chunk({ role: "assistant", content: "RUNTIME_OK" }) + chunk({}, "stop");
      return new Response(`${response}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_")),
  );
  Object.assign(env, {
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    OPENCODE_DB: join(root, "opencode.db"),
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  });
  const commands: string[][] = [];
  const execute = async (args: string[], cwd = directory) => {
    const index = commands.push(args);
    await Bun.write(join(root, "commands.json"), JSON.stringify(commands, null, 2));
    const child = Bun.spawn([cli, ...args], {
      cwd,
      // OC2 resolves location from PWD as well as the process working directory.
      env: { ...env, PWD: cwd },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await Bun.write(join(root, `${index}.log`), `${out}\n${error}`);
    assert.equal(code, 0, `${args.join(" ")} failed: ${out}\n${error}\nArtifacts: ${root}`);
    return out;
  };
  const api = async <T>(operation: string, args: string[] = []) =>
    JSON.parse(await execute(["api", "--standalone", operation, ...args])) as T;
  const exported = async (sessionID: string) =>
    (await api<{ data: Export }>("v2.session.export", ["--param", `sessionID=${sessionID}`])).data;
  const start = async () => {
    const process = Bun.spawn([cli, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: directory,
      env: { ...env, PWD: directory },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 90_000,
    });
    const ready = Promise.withResolvers<{ url: string; password: string }>();
    const output: string[] = [];
    const stdout = (async () => {
      for await (const chunk of process.stdout) {
        output.push(new TextDecoder().decode(chunk));
        const log = output.join("");
        const url = log.match(/server listening on (http:\/\/\S+)/)?.[1];
        const password = log.match(/server password (\S+)/)?.[1];
        if (url && password) ready.resolve({ url, password });
      }
      ready.reject(new Error(`Server exited before readiness: ${output.join("")}`));
    })().catch(ready.reject);
    const stderr = new Response(process.stderr).text();
    const endpoint = await ready.promise;
    const request = async <T>(
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) => {
      const response = await fetch(`${endpoint.url}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const value = await response.text();
      assert.ok(response.ok, `${method} ${path}: ${response.status} ${value}`);
      return (value ? JSON.parse(value) : undefined) as T;
    };
    return {
      request,
      stop: async () => {
        process.kill("SIGTERM");
        await process.exited;
        await stdout;
        await Bun.write(
          join(root, `server-${process.pid}.log`),
          `${output.join("")}\n${await stderr}`,
        );
      },
    };
  };
  const submit = async (
    prompt: string,
    options: {
      session?: string;
      fork?: boolean;
      file?: string;
      directory?: string;
      skills?: string[];
    } = {},
  ) => {
    const native = await start();
    try {
      const origin =
        options.session ??
        (
          await native.request<{ data: { id: string } }>("/api/session", {
            location: { directory: options.directory ?? directory },
            model: { providerID: "fixture", id: "fixture" },
          })
        ).data.id;
      const session = options.fork
        ? (
            await native.request<{ data: { id: string } }>(`/api/session/${origin}/fork`, {
              boundary: { type: "through" },
            })
          ).data.id
        : origin;
      const offset = requests.length;
      await native.request(`/api/session/${session}/prompt`, {
        text: prompt,
        files: options.file ? [{ uri: pathToFileURL(options.file).href }] : [],
        skills: options.skills?.map((id) => ({ id })),
      });
      await native.request(`/api/session/${session}/wait`, {});
      const saved = (await native.request<{ data: Export }>(`/api/session/${session}/export`)).data;
      await Bun.write(join(root, `export-${session}.json`), JSON.stringify(saved, null, 2));
      const user = saved.messages.findLast((message) => message.type === "user");
      assert.ok(user, `No persisted user message: ${root}`);
      assert.equal(
        saved.info.outcome,
        "succeeded",
        `Agent did not finish: ${JSON.stringify(saved)}`,
      );
      const calls = requests.slice(offset).filter((request) => request.tools?.length);
      assert.ok(calls.length, `No main model request captured: ${root}`);
      return { session, user, saved, calls };
    } finally {
      await native.stop();
    }
  };
  const run = async (
    prompt: string,
    options: { session?: string; fork?: boolean; file?: string; directory?: string } = {},
  ) => {
    const offset = requests.length;
    const output = await execute(
      [
        "run",
        "--standalone",
        "--format",
        "json",
        "--model",
        "fixture/fixture",
        ...(options.session ? ["--session", options.session] : []),
        ...(options.fork ? ["--fork"] : []),
        ...(options.file ? ["--file", options.file] : []),
        prompt,
      ],
      options.directory,
    );
    const events = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const event = events.find((item) => item.type === "text" && item.part?.text === "RUNTIME_OK");
    assert.ok(event?.sessionID, `CLI did not complete: ${output}\nArtifacts: ${root}`);
    const calls = requests.slice(offset).filter((request) => request.tools?.length);
    assert.ok(calls.length, `No main model request captured: ${root}`);
    const saved = await exported(event.sessionID);
    const user = saved.messages.findLast((message) => message.type === "user");
    assert.ok(user, `No persisted user message: ${root}`);
    return { session: event.sessionID as string, user, saved, calls };
  };
  const write = (name: string, content: string) => Bun.write(join(snippets, `${name}.md`), content);
  const configure = (enabled: boolean) =>
    Bun.write(
      join(snippets, "config.jsonc"),
      JSON.stringify({
        injectRecencyMessages: 2,
        experimental: { skillLoading: enabled, skillRendering: enabled, injectBlocks: enabled },
      }),
    );
  await Promise.all([
    write("chosen", "---\naliases: [cp]\n---\nPROJECT_CHOSEN"),
    write("nested", "#cp"),
    write("once", "!`printf x >> count.txt; printf SHELL_PROOF`"),
    write("persist", "VISIBLE_PERSIST<inject>PERSISTENT_CONTEXT</inject>"),
    write("tool-output", "TOOL_BEGIN #chosen <inject>TOOL_INJECTION</inject> TOOL_END"),
    configure(true),
    Bun.write(join(root, "home", ".config", "opencode", "snippet", "chosen.md"), "GLOBAL_CHOSEN"),
    Bun.write(
      join(directory, ".opencode", "skills", "local", "SKILL.md"),
      "---\nname: local\ndescription: Local fixture\n---\nLOCAL_BODY #chosen !`printf BAD`",
    ),
    Bun.write(join(root, "native", "SKILL.md"), "DISK_BODY_MUST_NOT_LOAD"),
    Bun.write(
      join(root, "native", "index.js"),
      `import { Plugin } from ${JSON.stringify(import.meta.resolve("@opencode/plugin"))};
export default Plugin.define({id:"runtime-fixture",async setup(ctx){
  await ctx.skill.transform(editor => {
    editor.add({id:"host:proof",name:"Host proof",description:"Native registry fixture",location:${JSON.stringify(join(root, "native", "SKILL.md"))},content:"HOST_BODY #chosen"});
    editor.add({id:"host:tool",name:"Host tool",description:"Tool fixture",location:${JSON.stringify(join(root, "native", "SKILL.md"))},content:"#tool-output"});
  });
}});`,
    ),
    Bun.write(
      join(config, "opencode.json"),
      JSON.stringify({
        plugins: [plugin, pathToFileURL(join(root, "native")).href],
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { apiKey: "fixture", baseURL: `http://127.0.0.1:${server.port}/v1` },
            models: {
              fixture: {
                name: "fixture",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 1_000_000, output: 1000 },
              },
            },
          },
        },
        model: "fixture/fixture",
        agents: { build: { model: "fixture/fixture" }, title: { model: "fixture/fixture" } },
        update: "disable",
        snapshots: false,
      }),
    ),
  ]);
  return {
    root,
    cli,
    env,
    directory,
    snippets,
    plugin,
    run,
    submit,
    start,
    requests,
    api,
    exported,
    write,
    configure,
    verify: async () => {
      const version = (await execute(["--version"])).trim();
      const config = await api<unknown>("v2.config.get");
      assert.ok(JSON.stringify(config).includes(plugin), "Resolved config did not load built dist");
      await Bun.write(
        join(root, "runtime.json"),
        JSON.stringify({ cli, version, config }, null, 2),
      );
    },
    stop: () => server.stop(true),
  };
}

export async function withFixture(
  run: (host: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  const host = await fixture();
  await run(host)
    .then(
      () => rm(host.root, { recursive: true, force: true }),
      (error: unknown) => {
        console.error(`V2 runtime artifacts retained: ${host.root}`);
        throw error;
      },
    )
    .finally(() => host.stop());
}
