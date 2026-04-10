import { describe, expect, it } from "bun:test";
import { executeShellCommands } from "./shell.js";

describe("executeShellCommands", () => {
  it("captures stderr-only command output from opencode help", async () => {
    const text = await executeShellCommands("Before !`opencode run --help` After", {
      $: Bun.$,
    });

    expect(text).not.toContain("!`opencode run --help`");
    expect(text).toContain("run opencode with a message");
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
      "!`opencode run --help`",
      { $: Bun.$ },
      {
        hideCommandInOutput: true,
      },
    );

    expect(text).not.toContain("$ opencode run --help");
    expect(text).toContain("run opencode with a message");
  });
});
