import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveSnippetDir } from "./constants.js";

test("config paths respect host overrides, XDG, and the default home in fresh processes", async () => {
  const home = "/tmp/opencode/snippets-path-home";
  const xdg = "/tmp/opencode/snippets-path-xdg";
  const custom = "/tmp/opencode/snippets-path-custom";
  for (const [override, configHome, expected] of [
    [custom, xdg, custom],
    ["", xdg, join(xdg, "opencode")],
    ["", "", join(home, ".config", "opencode")],
  ]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        'import { PATHS } from "./src/constants.ts"; console.log(JSON.stringify(PATHS))',
      ],
      {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          OPENCODE_CONFIG_DIR: override,
          XDG_CONFIG_HOME: configHome,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const paths = await new Response(child.stdout).json();
    expect(await child.exited).toBe(0);
    expect(paths).toEqual({
      CONFIG_DIR: expected,
      SNIPPETS_DIR: join(expected, "snippet"),
      SNIPPETS_DIR_ALT: join(expected, "snippets"),
    });
  }
});

describe("resolveSnippetDir", () => {
  const root = join("/tmp/opencode", "resolve-snippet-dir-test");
  const preferred = join(root, "snippet");
  const alt = join(root, "snippets");

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("returns the preferred directory when neither exists", () => {
    expect(resolveSnippetDir(preferred, alt)).toBe(preferred);
  });

  test("returns the alternate directory when only it exists", () => {
    mkdirSync(alt);
    expect(resolveSnippetDir(preferred, alt)).toBe(alt);
  });

  test("returns the preferred directory when only it exists", () => {
    mkdirSync(preferred);
    expect(resolveSnippetDir(preferred, alt)).toBe(preferred);
  });

  test("returns the preferred directory when both exist", () => {
    mkdirSync(preferred);
    mkdirSync(alt);
    expect(resolveSnippetDir(preferred, alt)).toBe(preferred);
  });
});
