import { spawn } from "node:child_process";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CliRenderer } from "@opentui/core";
import { ensureSnippetsDir, validateSnippetName } from "./loader.js";

export function resolveExternalEditor(environment: NodeJS.ProcessEnv = process.env) {
  for (const env of ["VISUAL", "EDITOR"] as const) {
    const command = environment[env]?.trim();
    if (command) return { command, env };
  }
}

export async function ensureSnippetDraft(
  name: string,
  globalDirectory?: string,
  owned = new Set<string>(),
): Promise<string> {
  validateSnippetName(name);
  // Unknown hashtags create personal drafts, as in V1. Exclusive creation also
  // refuses existing files and symlinks if another session creates the same name.
  const directory = await ensureSnippetsDir(undefined, globalDirectory);
  const path = join(directory, `${name}.md`);
  if (owned.has(path)) {
    const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (details?.isFile()) return path;
    if (details) throw new Error(`Draft is no longer a regular file: ${path}`);
  }
  await writeFile(path, '---\ndescription: ""\n---\n\n', { encoding: "utf8", flag: "wx" });
  owned.add(path);
  return path;
}

export function editorInvocation(
  command: string,
  path: string,
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
) {
  // Let each OS parse its editor command: POSIX escapes and Windows literal
  // backslashes have different semantics. The draft path is always separate data.
  if (platform === "win32") {
    if (/["\r\n\0]/.test(path)) throw new Error("Invalid Windows draft path.");
    // cmd expands this variable once inside quotes. Disable delayed expansion
    // so literal '!' in the configured path or editor command survives too.
    return {
      command: environment.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/v:off", "/c", `"${command} "%OPENCODE_SNIPPET_EDITOR_FILE%""`],
      options: {
        windowsVerbatimArguments: true,
        env: { ...environment, OPENCODE_SNIPPET_EDITOR_FILE: path },
      },
    };
  }
  return {
    command: "/bin/sh",
    args: ["-c", `exec ${command} "$1"`, "opencode-snippets-editor", path],
    options: { env: environment },
  };
}

export async function openExternalEditor(
  renderer: Pick<CliRenderer, "suspend" | "resume" | "requestRender">,
  path: string,
  editor: NonNullable<ReturnType<typeof resolveExternalEditor>>,
): Promise<void> {
  const invocation = editorInvocation(editor.command, path);
  renderer.suspend();
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        ...invocation.options,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) return resolve();
        reject(
          new Error(`External editor exited with ${signal ? `signal ${signal}` : `code ${code}`}.`),
        );
      });
    });
  } finally {
    renderer.resume();
    renderer.requestRender();
  }
}
