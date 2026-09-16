import { expect, test } from "bun:test";

test("native form layout with Solid's reactive runtime", async () => {
  // The default Node export is Solid's server runtime. Isolate the browser
  // condition so this rendered test cannot change other tests' module resolution.
  const child = Bun.spawn(
    [process.execPath, "test", "--conditions=browser", "./tests/fixtures/tui-form-renderer.tsx"],
    { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
}, 15_000);
