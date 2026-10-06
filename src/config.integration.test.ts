import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCliScroll, loadConfig } from "./config.js";

describe("Config Integration", () => {
  let tempDir: string;
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `snippets-config-int-${Date.now()}`);
    globalDir = join(tempDir, "global", ".config", "opencode", "snippet");
    projectDir = join(tempDir, "project");

    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".opencode", "snippet"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads CLI scroll preferences and merges the environment overlay per setting", async () => {
    const path = join(tempDir, "cli.json");
    expect(loadCliScroll(path, "{}")).toEqual({ speed: 3, acceleration: false });
    await Bun.write(path, '{ // CLI preferences\n"scroll": {"speed": 5, "acceleration": true,},}');
    expect(loadCliScroll(path, "{}")).toEqual({ speed: 5, acceleration: true });
    expect(loadCliScroll(path, '{"scroll":{"acceleration":false}}')).toEqual({
      speed: 5,
      acceleration: false,
    });
    expect(loadCliScroll(path, '{"scroll":{"speed":0.5}}')).toEqual({
      speed: 0.5,
      acceleration: true,
    });
    await Bun.write(path, '{"scroll":{"speed":-1,"acceleration":"yes"}}');
    expect(loadCliScroll(path, "{}")).toEqual({ speed: 3, acceleration: false });
  });

  it("merges partial project settings while preserving omitted global settings", async () => {
    const global = join(globalDir, "config.jsonc");
    await Bun.write(
      global,
      JSON.stringify({
        logging: { debug: false },
        experimental: { skillRendering: true, skillLoading: true, injectBlocks: true },
        injectRecencyMessages: 9,
      }),
    );
    await Bun.write(
      join(projectDir, ".opencode", "snippet", "config.jsonc"),
      JSON.stringify({ logging: { debug: true }, experimental: { skillRendering: false } }),
    );

    expect(loadConfig(projectDir, global)).toEqual({
      logging: { debug: true },
      experimental: { skillRendering: false, skillLoading: true, injectBlocks: true },
      injectRecencyMessages: 9,
    });
  });
});
