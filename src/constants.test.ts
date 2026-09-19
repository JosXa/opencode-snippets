import { expect, test } from "bun:test";
import { join } from "node:path";

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
      CONFIG_FILE_GLOBAL: join(expected, "snippet", "config.jsonc"),
    });
  }
});
