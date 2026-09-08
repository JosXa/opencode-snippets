import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
});
