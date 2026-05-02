import { describe, expect, it } from "bun:test";
import { executeShellCommands } from "./shell.js";

const ctx = {
  $: Bun.$ as Parameters<typeof executeShellCommands>[1]["$"],
};

describe("executeShellCommands", () => {
  it("captures stderr-only command output", async () => {
    const text = await executeShellCommands(
      "Before !`bun -e \"console.error('stderr-only output')\"` After",
      ctx,
    );

    expect(text).not.toContain("!`bun -e \"console.error('stderr-only output')\"`");
    expect(text).toContain("stderr-only output");
    expect(text).not.toContain("$ bun -e \"console.error('stderr-only output')\"");
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

    expect(text).toBe("outerr");
  });

  it("shows the command prefix for !> syntax", async () => {
    const text = await executeShellCommands("!>`demo`", {
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

    expect(text).toBe("$ demo\n--> outerr");
  });
});
