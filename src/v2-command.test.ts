import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SnippetRegistry } from "./types.js";
import { executeV2SnippetCommand } from "./v2-command.js";

let home: string | undefined;

afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = undefined;
});

describe("V2 snippet commands", () => {
  test.each([
    false,
    true,
  ])("planned global links preserve write/read/unlink semantics with a linked directory=%s", async (linkedDir) => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-links-"));
    const globalDir = join(home, "global");
    const targetDir = linkedDir ? join(home, "dotfiles", "snippets") : globalDir;
    await Bun.write(join(targetDir, "bar.md"), "OLD");
    if (linkedDir) await symlink(targetDir, globalDir);
    const target = linkedDir ? join(targetDir, "bar.md") : "bar.md";
    await symlink(target, join(globalDir, "foo.md"));
    await symlink(
      linkedDir ? join(targetDir, "projected.md") : "projected.md",
      join(globalDir, "pending.md"),
    );
    const overlay = new Map<string, string | null>();
    const planned: SnippetRegistry = new Map();
    const actual: SnippetRegistry = new Map();
    const commands = [
      '/snippets add foo "NEW"',
      '/snippets add bar "REVERSE"',
      "/snippets delete bar",
      '/snippets add foo "REVIVED"',
      "/snippets delete foo",
      '/snippets add foo "REPLACEMENT"',
      '/snippets add pending "PROJECTED"',
      "/snippets delete projected",
      "/snippets delete pending",
    ];
    const results: Array<{ output: string | undefined; registry: SnippetRegistry }> = [];
    for (const command of commands)
      results.push({
        output: await executeV2SnippetCommand(command, planned, home, globalDir, overlay),
        registry: new Map(planned),
      });
    expect(results[0].registry.get("bar")?.content).toBe("NEW");
    expect(results[1].registry.get("foo")?.content).toBe("REVERSE");
    expect(results[2].registry.has("foo")).toBe(false);
    expect(results[3].registry.get("bar")?.content).toBe("REVIVED");
    expect(results[4].registry.get("bar")?.content).toBe("REVIVED");
    expect(results[4].registry.has("foo")).toBe(false);
    expect(results[5].registry.get("foo")?.content).toBe("REPLACEMENT");
    expect(results[5].registry.get("bar")?.content).toBe("REVIVED");
    expect(results[6].registry.get("pending")?.content).toBe("PROJECTED");
    expect(results[6].registry.get("projected")?.content).toBe("PROJECTED");
    expect(await Bun.file(join(globalDir, "bar.md")).text()).toBe("OLD");
    expect(await readlink(join(globalDir, "foo.md"))).toBe(target);
    expect(await Bun.file(join(globalDir, "projected.md")).exists()).toBe(false);
    for (const [index, command] of commands.entries()) {
      expect(await executeV2SnippetCommand(command, actual, home, globalDir)).toBe(
        results[index].output,
      );
      expect(actual).toEqual(results[index].registry);
    }
  });
  test("virtual commands match actual metadata, aliases and reloads before any directories exist", async () => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-plan-"));
    const globalDir = join(home, "global");
    const planned: SnippetRegistry = new Map();
    const actual: SnippetRegistry = new Map();
    const overlay = new Map<string, string | null>();
    const commands = [
      '/snippets add proof "GLOBAL" --aliases g --desc "Global description"',
      '/snippets add proof "---\nfields:\n  answer: {}\n---\n#untouched {{answer}}" --project --aliases p --desc "Project description"',
      "/snippets list",
      "/snippets:reload",
      '/snippets add proof "UPDATED" --project --aliases updated',
      "/snippets delete proof",
      "/snippets list",
      "/snippets delete proof",
      "/snippets delete proof",
    ];
    const results: Array<{ output: string | undefined; registry: SnippetRegistry }> = [];
    for (const command of commands) {
      results.push({
        output: await executeV2SnippetCommand(command, planned, home, globalDir, overlay),
        registry: new Map(planned),
      });
    }
    expect(await Bun.file(join(globalDir, "proof.md")).exists()).toBe(false);
    expect(results[1].registry.get("p")?.fields).toEqual({ answer: {} });
    expect(results[1].registry.get("p")?.content).toBe("#untouched {{answer}}");
    expect(await Bun.file(join(home, ".opencode", "snippet", "proof.md")).exists()).toBe(false);
    for (const [index, command] of commands.entries()) {
      expect(await executeV2SnippetCommand(command, actual, home, globalDir)).toBe(
        results[index].output,
      );
      expect(actual).toEqual(results[index].registry);
    }
  });
  test("planning a write through a project link does not admit that link into the registry", async () => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-project-link-"));
    const dir = join(home, ".opencode", "snippet");
    const globalDir = join(home, "global");
    await Bun.write(join(dir, "target.md"), "OLD");
    await symlink("target.md", join(dir, "linked.md"));
    const planned: SnippetRegistry = new Map();
    const actual: SnippetRegistry = new Map();
    const command = '/snippets add linked "NEW" --project';
    await executeV2SnippetCommand(command, planned, home, globalDir, new Map());
    expect(planned.has("linked")).toBe(false);
    expect(planned.get("target")?.content).toBe("NEW");
    expect(await Bun.file(join(dir, "target.md")).text()).toBe("OLD");
    await executeV2SnippetCommand(command, actual, home, globalDir);
    expect(actual).toEqual(planned);
  });
  test("adds, lists, reloads, and deletes only in an explicit isolated directory", async () => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-"));
    const globalDir = join(home, ".config", "opencode", "snippet");
    const registry: SnippetRegistry = new Map();

    expect(
      await executeV2SnippetCommand(
        '/snippets add proof "from v2" --aliases p',
        registry,
        undefined,
        globalDir,
      ),
    ).toContain("Added global snippet #proof");
    expect(await Bun.file(join(globalDir, "proof.md")).text()).toBe(
      "---\naliases:\n  - p\n---\nfrom v2\n",
    );
    expect(
      await executeV2SnippetCommand("/snippets list", registry, undefined, globalDir),
    ).toContain("#proof (aliases: p)\nfrom v2");
    expect(await executeV2SnippetCommand("/snippets:reload", registry, undefined, globalDir)).toBe(
      "Reloaded 1 snippet.",
    );
    expect(
      await executeV2SnippetCommand("/snippets delete proof", registry, undefined, globalDir),
    ).toContain("Deleted snippet #proof");
    expect(registry.size).toBe(0);
  });

  test("ignores ordinary prompts without consulting a static global path", async () => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-ignore-"));
    const globalDir = join(home, ".config", "opencode", "snippet");
    expect(
      await executeV2SnippetCommand("explain /snippets", new Map(), undefined, globalDir),
    ).toBeUndefined();
  });

  test.each([
    "--alias --project",
    "--aliases --project",
    "--desc --project",
    "--description --project",
    "--project --alias",
    "--project --aliases",
    "--project --desc",
    "--project --description",
  ])("ignores missing option values and preserves project routing: %s", async (options) => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-options-"));
    const globalDir = join(home, "global", "snippet");
    const directory = join(home, "project");
    const registry: SnippetRegistry = new Map();
    await mkdir(directory);

    expect(
      await executeV2SnippetCommand(
        `/snippets add audit "body" ${options}`,
        registry,
        directory,
        globalDir,
      ),
    ).toContain("Added project snippet #audit");
    expect(registry.get("audit")).toMatchObject({
      aliases: [],
      description: undefined,
      source: "project",
    });
    expect(await Bun.file(join(directory, ".opencode", "snippet", "audit.md")).text()).toBe("body");
    expect(await Bun.file(join(globalDir, "audit.md")).exists()).toBe(false);
  });

  test.each([
    '--alias --aliases="a, b" --desc --description="final description"',
    '--aliases --alias "a, b" --description --desc "final description"',
    '--alias=old --aliases "a, b" --desc=old --description "final description"',
    '--aliases old --alias="a, b" --description old --desc="final description"',
    '--alias="a, b" --aliases --desc="final description" --description',
    '--aliases "a, b" --alias --description "final description" --desc',
  ])("uses the last valid value with mixed option syntax: %s", async (options) => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-repeated-"));
    const globalDir = join(home, "global", "snippet");
    const directory = join(home, "project");
    const registry: SnippetRegistry = new Map();
    await mkdir(directory);

    expect(
      await executeV2SnippetCommand(
        `/snippets add audit "body" ${options}`,
        registry,
        directory,
        globalDir,
      ),
    ).toContain("Added global snippet #audit");
    expect(registry.get("audit")).toMatchObject({
      aliases: ["a", "b"],
      description: "final description",
      source: "global",
      filePath: join(globalDir, "audit.md"),
    });
    expect(registry.get("a")).toBe(registry.get("audit"));
    expect(registry.get("b")).toBe(registry.get("audit"));
    expect(await Bun.file(join(directory, ".opencode", "snippet", "audit.md")).exists()).toBe(
      false,
    );
  });

  test("preserves valid metadata when routing to the project directory", async () => {
    home = await mkdtemp(join(tmpdir(), "snippets-v2-command-project-"));
    const globalDir = join(home, "global", "snippet");
    const directory = join(home, "project");
    const registry: SnippetRegistry = new Map();
    await mkdir(directory);

    await executeV2SnippetCommand(
      '/snippets add audit "body" --aliases=a,b --description "project description" --project',
      registry,
      directory,
      globalDir,
    );
    expect(registry.get("audit")).toMatchObject({
      aliases: ["a", "b"],
      description: "project description",
      source: "project",
      filePath: join(directory, ".opencode", "snippet", "audit.md"),
    });
    expect(await Bun.file(join(globalDir, "audit.md")).exists()).toBe(false);
  });
});
