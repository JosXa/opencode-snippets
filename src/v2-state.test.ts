import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DurableStore } from "./v2-state.js";

const output = {
  patches: [{ start: 0, end: 6, replacement: "expanded" }],
  hidden: [],
  injections: [],
};

describe("V2 durable processing state", () => {
  test("an explicit home stays isolated from the process XDG data directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-home-isolation-"));
    const previous = process.env.XDG_DATA_HOME;
    const xdg = join(root, "ambient-xdg");
    process.env.XDG_DATA_HOME = xdg;
    try {
      const home = join(root, "configured-home");
      const store = new DurableStore(join(root, "project-home-isolation"), {
        homeDirectory: home,
      });
      await store.process("session", "message", async () => ({ value: "ok" }));
      expect(store.directory).toBe(
        join(home, ".local", "share", "opencode", "opencode-snippets", "v2"),
      );
      expect(await Bun.file(store.path).exists()).toBe(true);
      expect(await Bun.file(xdg).exists()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
  test("coordinates two processes and replays exactly once after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-race-"));
    const project = join(root, "project");
    const data = join(root, "data");
    const marker = join(root, "effects.txt");
    const script = join(root, "worker.ts");
    await mkdir(project);
    const module = pathToFileURL(join(import.meta.dir, "v2-state.ts")).href;
    await writeFile(
      script,
      `import { appendFile } from "node:fs/promises";
import { DurableStore } from ${JSON.stringify(module)};
const [project, data, marker] = process.argv.slice(2);
const store = new DurableStore(project, { dataDirectory: data });
await store.process("session", "message", async () => {
  await appendFile(marker, "x");
  await Bun.sleep(100);
  return ${JSON.stringify(output)};
});`,
    );

    try {
      const run = () => Bun.spawn([process.execPath, script, project, data, marker]);
      const first = run();
      const second = run();
      expect(await Promise.all([first.exited, second.exited])).toEqual([0, 0]);
      expect(await readFile(marker, "utf8")).toBe("x");

      const restarted = run();
      expect(await restarted.exited).toBe(0);
      expect(await readFile(marker, "utf8")).toBe("x");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses private minimized files and prunes a deleted session", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-private-"));
    const project = join(root, "project");
    const data = join(root, "data");
    await mkdir(project);
    const store = new DurableStore(project, { dataDirectory: data });
    try {
      await store.process("secret-session", "hashed-message", async () => output);
      expect((await stat(data)).mode & 0o777).toBe(0o700);
      expect((await stat(store.path)).mode & 0o777).toBe(0o600);
      const raw = await readFile(store.path, "utf8");
      expect(raw).not.toContain("raw private prompt");
      expect(raw).not.toContain(project);
      expect(raw).not.toContain("secret-session");
      expect(raw).not.toContain("hashed-message");
      expect(raw).toContain('"patches"');

      await store.deleteSession("secret-session");
      expect(JSON.parse(await readFile(store.path, "utf8")).sessions).toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails closed before side effects when state cannot be persisted", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-closed-"));
    const project = join(root, "project");
    const data = join(root, "data");
    await mkdir(project);
    await writeFile(data, "not a directory");
    await chmod(data, 0o400);
    let effects = 0;
    try {
      const store = new DurableStore(project, { dataDirectory: data });
      await expect(
        store.process("session", "message", async () => {
          effects++;
          return output;
        }),
      ).rejects.toThrow();
      expect(effects).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("retains a pending safety reservation when a 101st session is recorded", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-pending-retention-"));
    const store = new DurableStore(join(root, "project"), { dataDirectory: join(root, "data") });
    let effects = 0;
    try {
      await expect(
        store.process("pending-session", "message", async () => {
          effects++;
          throw new Error("interrupted after side effect");
        }),
      ).rejects.toThrow("interrupted after side effect");
      for (let index = 0; index < 100; index++) {
        await store.process(`completed-${index}`, "message", async () => output);
      }
      await expect(
        store.process("pending-session", "message", async () => {
          effects++;
          return output;
        }),
      ).rejects.toThrow("refusing to repeat side effects");
      expect(effects).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recovers an orphaned lock owned by a dead process", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-orphan-lock-"));
    const store = new DurableStore(join(root, "project"), { dataDirectory: join(root, "data") });
    try {
      await mkdir(store.directory, { recursive: true });
      await writeFile(`${store.path}.lock`, JSON.stringify({ pid: 99_999_999, token: "orphan" }));
      expect(await store.process("session", "message", async () => output)).toEqual(output);
      expect(await Bun.file(`${store.path}.lock`).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recovers a crashed queue contender without touching a live lock owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-live-lock-"));
    const project = join(root, "project");
    const data = join(root, "data");
    const ready = join(root, "ready");
    const script = join(root, "holder.ts");
    await mkdir(project);
    const store = new DurableStore(project, { dataDirectory: data });
    await mkdir(`${store.path}.lock.contenders`, { recursive: true });
    await writeFile(
      join(`${store.path}.lock.contenders`, "dead-contender.json"),
      JSON.stringify({ pid: 99_999_999, token: "dead-contender", choosing: true, ticket: 0 }),
    );
    await writeFile(
      script,
      `import { readFile, unlink, writeFile } from "node:fs/promises";
const [lock, ready] = process.argv.slice(2);
const owner = JSON.stringify({ pid: process.pid, token: "live-owner" });
await writeFile(lock, owner, { flag: "wx" });
await writeFile(ready, "ready");
await Bun.sleep(250);
if (await readFile(lock, "utf8") !== owner) process.exit(2);
await unlink(lock);`,
    );

    try {
      const holder = Bun.spawn([process.execPath, script, `${store.path}.lock`, ready]);
      while (!(await Bun.file(ready).exists())) await Bun.sleep(1);
      expect(await store.process("session", "message", async () => output)).toEqual(output);
      expect(await holder.exited).toBe(0);
      expect(await Bun.file(`${store.path}.lock.contenders/dead-contender.json`).exists()).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serializes 64 contenders while recovering a seeded stale lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "snippets-v2-stale-contention-"));
    const project = join(root, "project");
    const data = join(root, "data");
    const events = join(root, "events.txt");
    const start = join(root, "start");
    const script = join(root, "worker.ts");
    await mkdir(project);
    const store = new DurableStore(project, { dataDirectory: data });
    await mkdir(store.directory, { recursive: true });
    await writeFile(`${store.path}.lock`, JSON.stringify({ pid: 99_999_999, token: "stale" }));
    const module = pathToFileURL(join(import.meta.dir, "v2-state.ts")).href;
    await writeFile(
      script,
      `import { appendFile } from "node:fs/promises";
import { DurableStore } from ${JSON.stringify(module)};
const [project, data, events, start, id] = process.argv.slice(2);
while (!(await Bun.file(start).exists())) await Bun.sleep(1);
const store = new DurableStore(project, { dataDirectory: data });
await store.process("session-" + id, "message", async () => {
  await appendFile(events, "start " + id + "\\n");
  await Bun.sleep(20);
  await appendFile(events, "end " + id + "\\n");
  return ${JSON.stringify(output)};
});`,
    );

    try {
      const workers = Array.from({ length: 64 }, (_, id) =>
        Bun.spawn([process.execPath, script, project, data, events, start, String(id)]),
      );
      await Bun.sleep(100);
      await writeFile(start, "go");
      expect(await Promise.all(workers.map((worker) => worker.exited))).toEqual(
        Array.from({ length: 64 }, () => 0),
      );
      const lines = (await readFile(events, "utf8")).trim().split("\n");
      const active = new Set<string>();
      for (const line of lines) {
        const [event, id] = line.split(" ");
        if (event === "start") {
          expect(active.size).toBe(0);
          active.add(id);
        } else {
          expect(active.delete(id)).toBe(true);
        }
      }
      expect(active.size).toBe(0);
      expect(lines).toHaveLength(128);
      expect(await Bun.file(`${store.path}.lock`).exists()).toBe(false);
      expect(
        (await readdir(store.directory)).some((entry) => entry.includes(".lock.recovering.")),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
