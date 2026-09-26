import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  editorInvocation,
  ensureSnippetDraft,
  openExternalEditor,
  resolveExternalEditor,
} from "./tui-editor.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(import.meta.dir, ".test-editor-"));
  directories.push(directory);
  return directory;
}

test("editor selection prefers nonempty VISUAL and falls back to EDITOR", () => {
  expect(resolveExternalEditor({ VISUAL: " code --wait ", EDITOR: "vi" })).toEqual({
    env: "VISUAL",
    command: "code --wait",
  });
  expect(resolveExternalEditor({ VISUAL: "  ", EDITOR: " vi " })).toEqual({
    env: "EDITOR",
    command: "vi",
  });
  expect(resolveExternalEditor({})).toBeUndefined();
});

test("draft creation refuses existing files and symlinks without overwriting content", async () => {
  const directory = await fixture();
  const path = await ensureSnippetDraft("draft", directory);
  await Bun.write(path, "keep me");
  await expect(ensureSnippetDraft("draft", directory)).rejects.toThrow();
  expect(await Bun.file(path).text()).toBe("keep me");
  await symlink(path, join(directory, "linked.md"));
  await expect(ensureSnippetDraft("linked", directory)).rejects.toThrow();
  expect(await Bun.file(path).text()).toBe("keep me");
  await expect(ensureSnippetDraft("../escape", directory)).rejects.toThrow();
});

for (const command of [
  "code --wait",
  '"C:\\Program Files\\Editor\\code.cmd" --wait',
  '"C:\\Editor\\edit.bat"',
]) {
  test(`Windows invokes ${command} through cmd while keeping the filename out of shell source`, () => {
    const path = "C:\\Users\\A & B %PATH% !bang!\\snippet\\draft.md";
    const invocation = editorInvocation(command, path, "win32", {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(invocation.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(invocation.args).toEqual([
      "/d",
      "/s",
      "/v:off",
      "/c",
      `"${command} "%OPENCODE_SNIPPET_EDITOR_FILE%""`,
    ]);
    expect(invocation.options.env.OPENCODE_SNIPPET_EDITOR_FILE).toBe(path);
    expect(invocation.options).toHaveProperty("windowsVerbatimArguments", true);
    expect(invocation.args.join(" ")).not.toContain(path);
  });
}

test("an unchanged owned draft can reopen after editor failure without EEXIST", async () => {
  const directory = await fixture();
  const owned = new Set<string>();
  const path = await ensureSnippetDraft("retry", directory, owned);
  const renderer = { suspend() {}, resume() {}, requestRender() {} };
  await expect(
    openExternalEditor(renderer, path, { env: "EDITOR", command: "/bin/sh -c 'exit 7'" }),
  ).rejects.toThrow();
  expect(await ensureSnippetDraft("retry", directory, owned)).toBe(path);
  const script = join(directory, "recover.mjs");
  await Bun.write(script, 'await Bun.write(process.argv[2], "recovered");');
  await openExternalEditor(renderer, path, {
    env: "EDITOR",
    command: `"${process.execPath}" "${script}"`,
  });
  expect(await Bun.file(path).text()).toBe("recovered");
  await rm(path);
  await symlink(script, path);
  await expect(ensureSnippetDraft("retry", directory, owned)).rejects.toThrow("regular file");
});

test("the editor accepts POSIX escaped spaces and quotes without interpreting the draft path", async () => {
  const directory = await fixture();
  const script = join(directory, "Visual Studio Code.mjs");
  const path = join(directory, "draft $(touch SHOULD_NOT_EXIST).md");
  await Bun.write(script, "await Bun.write(process.argv[3], process.argv[2]);");
  await openExternalEditor({ suspend() {}, resume() {}, requestRender() {} }, path, {
    env: "EDITOR",
    command: `${process.execPath} ${script.replaceAll(" ", "\\ ")} "say \\"hello\\""`,
  });
  expect(await Bun.file(path).text()).toBe('say "hello"');
});

for (const failure of [false, true]) {
  test(`external editor resumes and redraws the renderer after ${failure ? "spawn failure" : "saving a quoted file path"}`, async () => {
    const directory = await fixture();
    const path = join(directory, "draft with spaces.md");
    const script = join(directory, "fake editor.mjs");
    await Bun.write(script, 'await Bun.write(process.argv[2], "saved");');
    const events: string[] = [];
    const renderer = {
      suspend: () => {
        events.push("suspend");
      },
      resume: () => {
        events.push("resume");
      },
      requestRender: () => {
        events.push("render");
      },
    };
    const result = openExternalEditor(renderer, path, {
      command: failure ? join(directory, "absent") : `"${process.execPath}" "${script}"`,
      env: "EDITOR",
    });
    if (failure) await expect(result).rejects.toThrow();
    if (!failure) {
      await result;
      expect(await Bun.file(path).text()).toBe("saved");
    }
    expect(events).toEqual(["suspend", "resume", "render"]);
  });
}
