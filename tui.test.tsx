import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { type JSX, render } from "@opentui/solid";
import plugin from "./tui.js";

let root: string | undefined;
let destroyRenderer: (() => void) | undefined;

afterEach(async () => {
  destroyRenderer?.();
  destroyRenderer = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("V2 TUI plugin", () => {
  test("threads the configured global directory through every management command", async () => {
    root = await mkdtemp(join(tmpdir(), "snippets-v2-tui-"));
    const project = join(root, "project");
    const globalDirectory = join(root, "isolated-global");
    const alerts: string[] = [];
    let commands: readonly { id?: string; run: (input?: string) => void | Promise<void> }[] = [];
    const screen = await createTestRenderer({ width: 80, height: 24 });
    destroyRenderer = () => screen.renderer.destroy();
    let footer: (input: { mode: "normal"; showDetails: boolean }) => JSX.Element = () => null;

    const dispose = await plugin.setup({
      location: { directory: project },
      options: { globalDirectory, homeDirectory: root },
      client: { skill: { list: async () => ({ data: [] }) } },
      ui: {
        slot: ({ render }: { render: typeof footer }) => {
          footer = render;
          return () => {};
        },
        dialog: {
          show: () => undefined,
          set: () => undefined,
          clear: () => undefined,
          select: async () => undefined,
          alert: async ({ message }: { message: string }) => {
            alerts.push(message);
          },
        },
      },
      keymap: {
        mode: { current: () => "base" },
        layer: (definition: () => { commands?: typeof commands }) => {
          commands = definition().commands ?? [];
        },
      },
      renderer: screen.renderer,
    } as never);
    await render(() => footer({ mode: "normal", showDetails: true }), screen.renderer);

    const manage = commands.find((command) => command.id === "snippets.manage");
    const reload = commands.find((command) => command.id === "snippets.reload");
    expect(manage).toBeDefined();
    expect(reload).toBeDefined();

    await manage?.run('add isolated "configured path"');
    expect(await Bun.file(join(globalDirectory, "isolated.md")).text()).toContain(
      "configured path",
    );
    await manage?.run("list");
    expect(alerts.at(-1)).toContain("#isolated\nconfigured path");
    await reload?.run();
    expect(alerts.at(-1)).toBe("Reloaded 1 snippet.");
    await manage?.run("delete isolated");
    expect(alerts.at(-1)).toContain("Deleted snippet #isolated");
    expect(await Bun.file(join(globalDirectory, "isolated.md")).exists()).toBe(false);
    dispose?.();
  });

  test("retains the configured global directory after unmatched-trigger creation reloads", async () => {
    root = await mkdtemp(join(tmpdir(), "snippets-v2-tui-unmatched-"));
    const project = join(root, "project");
    const globalDirectory = join(root, "isolated-global");
    await mkdir(project, { recursive: true });
    await mkdir(globalDirectory, { recursive: true });
    await writeFile(join(globalDirectory, "global-only.md"), "CUSTOM_GLOBAL");
    const alerts: string[] = [];
    let commands: readonly { id?: string; run: (input?: string) => void | Promise<void> }[] = [];
    const screen = await createTestRenderer({ width: 80, height: 24 });
    destroyRenderer = () => screen.renderer.destroy();
    const editor = new TextareaRenderable(screen.renderer, { id: "prompt", width: 80, height: 3 });
    editor.traits = { capture: ["tab"], ...{ owner: "opencode", role: "prompt" } };
    screen.renderer.root.add(editor);
    let footer: (input: { mode: "normal"; showDetails: boolean }) => JSX.Element = () => null;

    const dispose = await plugin.setup({
      location: { directory: project },
      options: { globalDirectory, homeDirectory: root },
      client: {
        skill: {
          list: async (input: unknown) => {
            expect(input).toEqual({ location: { directory: project } });
            return {
              data: [
                { id: "plugin:remote", name: "Human title", description: "Native plugin skill" },
              ],
            };
          },
        },
      },
      ui: {
        slot: ({ render }: { render: typeof footer }) => {
          footer = render;
          return () => {};
        },
        dialog: {
          show: () => undefined,
          set: () => undefined,
          clear: () => undefined,
          alert: async ({ message }: { message: string }) => alerts.push(message),
          confirm: async () => true,
        },
      },
      keymap: {
        mode: { current: () => "base" },
        layer: (definition: () => { commands?: typeof commands }) => {
          commands = definition().commands ?? [];
        },
      },
      renderer: screen.renderer,
    } as never);
    await render(() => footer({ mode: "normal", showDetails: true }), screen.renderer);
    editor.focus();
    await screen.mockInput.typeText("#fresh-project");
    await Bun.sleep(50);
    // Creation is an explicit acceptance of the inline action, never an idle modal.
    screen.mockInput.pressTab();
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await Bun.file(join(project, ".opencode", "snippet", "fresh-project.md")).exists()) break;
      await Bun.sleep(10);
    }
    expect(await Bun.file(join(project, ".opencode", "snippet", "fresh-project.md")).exists()).toBe(
      true,
    );
    await commands.find((command) => command.id === "snippets.manage")?.run("list");
    expect(alerts.at(-1)).toContain("#global-only\nCUSTOM_GLOBAL");
    editor.setText("#skill(plugin:rem");
    editor.gotoLineEnd();
    await Bun.sleep(50);
    screen.mockInput.pressTab();
    expect(editor.plainText).toBe("#skill(plugin:remote) ");
    dispose?.();
  });
});
