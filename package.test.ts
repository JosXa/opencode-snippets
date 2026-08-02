import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = import.meta.dir;
const packageJson = await Bun.file(join(root, "package.json")).json();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("package lifecycle", () => {
  test("ships the guarded prepare script", () => {
    expect(packageJson.scripts.prepare).toBe("node scripts/prepare.mjs");
    expect(packageJson.files).toContain("scripts/prepare.mjs");
  });

  test("prepare succeeds outside a Git checkout without resolving Husky", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-package-"));
    temporaryDirectories.push(directory);

    const child = Bun.spawn(["node", join(root, "scripts/prepare.mjs")], {
      cwd: directory,
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
    expect(await new Response(child.stdout).text()).toBe("");
  });
});
