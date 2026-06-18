import { describe, expect, it } from "bun:test";
import { executeShellCommands } from "./shell.js";

const ctx = {};

describe("executeShellCommands", () => {
  it("captures stderr-only command output", async () => {
    const text = await executeShellCommands(
      "Before !`node -e \"console.error('stderr-only output')\"` After",
      ctx,
    );

    expect(text).not.toContain("!`node -e \"console.error('stderr-only output')\"`");
    expect(text).toContain("stderr-only output");
    expect(text).not.toContain("$ node -e \"console.error('stderr-only output')\"");
    expect(text).toContain("Before");
    expect(text).toContain("After");
  });

  it("merges stdout and stderr in order", async () => {
    const text = await executeShellCommands("!`printf out; printf err >&2`", ctx);

    expect(text).toBe("outerr");
  });

  it("shows the command prefix for !> syntax", async () => {
    const text = await executeShellCommands("!>`printf out; printf err >&2`", ctx);

    expect(text).toBe("$ printf out; printf err >&2\n--> outerr");
  });
});
