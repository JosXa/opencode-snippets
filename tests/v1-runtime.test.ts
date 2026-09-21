import { expect, test } from "bun:test";
import { join } from "node:path";
import { withFixture } from "./v1-runtime.fixture.js";

const native = test.skipIf(process.env.SNIPPETS_TEST_V1 !== "1");
native(
  "V1 loads the shared package and expands aliases and shell commands once",
  async () => {
    await withFixture(async (host) => {
      await host.verify();
      const calls = await host.run("#cp #once");
      const users = JSON.stringify(
        calls.flatMap((call) => call.messages.filter((message) => message.role === "user")),
      );
      expect(users).toContain("PROJECT_CHOSEN");
      expect(users).toContain("SHELL_PROOF");
      expect(await Bun.file(join(host.directory, "count.txt")).text()).toBe("x");
    });
  },
  120000,
);

native(
  "V1 preserves skill expansion from main with the shared package",
  async () => {
    await withFixture(async (host) => {
      const calls = await host.run("#skill(local)");
      expect(JSON.stringify(calls)).toContain("LOCAL_BODY PROJECT_CHOSEN");
    });
  },
  120000,
);
