import { describe, expect, it } from "bun:test";
import { executeShellCommands } from "./shell.js";

describe("executeShellCommands", () => {
  it("captures stderr-only command output", async () => {
    const text = await executeShellCommands(
      "Before !`bun -e \"console.error('stderr-only output')\"` After",
      {
        $: Bun.$,
      },
    );

    expect(text).not.toContain("!`bun -e \"console.error('stderr-only output')\"`");
    expect(text).toContain("stderr-only output");
    expect(text).toContain("Before");
    expect(text).toContain("After");
  });

  it("merges stdout and stderr in order", async () => {
    const text = await executeShellCommands("!`demo`", {
      $() {
        return {
          quiet() {
            return {
              async nothrow() {
                return {
                  stdout: { toString: () => "out" },
                  stderr: { toString: () => "err" },
                };
              },
            };
          },
        };
      },
    });

    expect(text).toContain("--> outerr");
  });

  it("hides the command prefix when requested", async () => {
    const text = await executeShellCommands(
      "!`bun -e \"console.error('stderr-only output')\"`",
      { $: Bun.$ },
      {
        hideCommandInOutput: true,
      },
    );

    expect(text).not.toContain("$ bun -e \"console.error('stderr-only output')\"");
    expect(text).toContain("stderr-only output");
  });
});
