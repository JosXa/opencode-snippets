import { expect, test } from "bun:test";

test("native snippet library interactions with the reactive Solid runtime", async () => {
  const child = Bun.spawn(
    [process.execPath, "test", "--conditions=browser", "./tests/fixtures/tui-library-renderer.tsx"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, output: code ? stdout + stderr : "" }).toEqual({ code: 0, output: "" });
}, 30000);
