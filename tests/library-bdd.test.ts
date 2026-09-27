import { expect, test } from "bun:test";

test("snippets library BDD journeys", async () => {
  // Solid's browser condition enables reactivity; isolate it from other test mocks.
  const child = Bun.spawn([process.execPath, "run", "test:bdd"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, output: code ? stdout + stderr : "" }).toEqual({ code: 0, output: "" });
}, 125_000);
