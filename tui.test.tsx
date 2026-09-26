import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RGBA, TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { type JSX, render } from "@opentui/solid";
import plugin from "./tui.js";

let root: string | undefined;
let destroyRenderer: (() => void) | undefined;
const environment = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
const color = RGBA.fromHex("#808080");
const theme = {
  background: { base: color, raised: { high: color }, action: { primary: { focused: color } } },
  text: { base: color, muted: color, action: { primary: { focused: color } } },
  border: { base: color },
};

afterEach(async () => {
  destroyRenderer?.();
  destroyRenderer = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  for (const key of ["VISUAL", "EDITOR"] as const) {
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
  }
});

describe("V2 TUI plugin", () => {
  for (const phase of ["confirmation", "reload", "editor"] as const) {
    test(`a different prompt keeps focus during delayed ${phase}`, async () => {
      root = await mkdtemp(join(tmpdir(), "snippets-focus-"));
      const globalDirectory = join(root, "snippets");
      const script = join(root, "editor.mjs");
      const started = join(root, "started");
      const released = join(root, "released");
      await Bun.write(
        script,
        `await Bun.write(${JSON.stringify(started)}, "started"); ${phase === "editor" ? `while (!await Bun.file(${JSON.stringify(released)}).exists()) await Bun.sleep(5);` : ""} await Bun.write(process.argv[2], "saved");`,
      );
      process.env.VISUAL = `"${process.execPath}" "${script}"`;
      const screen = await createTestRenderer({ width: 80, height: 24 });
      destroyRenderer = () => screen.renderer.destroy();
      const original = new TextareaRenderable(screen.renderer, {
        id: "original",
        width: 80,
        height: 2,
      });
      const replacement = new TextareaRenderable(screen.renderer, {
        id: "replacement",
        width: 80,
        height: 2,
      });
      for (const editor of [original, replacement]) {
        editor.traits = { capture: ["tab"], ...{ owner: "opencode", role: "prompt" } };
        screen.renderer.root.add(editor);
      }
      const gate = Promise.withResolvers<void>();
      let waiting = false;
      let loads = 0;
      let footer: (input: { mode: "normal"; showDetails: boolean }) => JSX.Element = () => null;
      const dispose = await plugin.setup({
        location: { directory: root },
        theme,
        options: { globalDirectory },
        renderer: screen.renderer,
        client: {
          skill: {
            list: async () => {
              loads++;
              if (phase === "reload" && loads > 1) {
                waiting = true;
                await gate.promise;
              }
              return { data: [] };
            },
          },
        },
        keymap: { mode: { current: () => "base" }, layer() {} },
        ui: {
          router: {
            register: () => () => {},
            current: () => ({ type: "home" }),
            navigate: () => {},
          },
          toast: { show() {} },
          slot: ({ render }: { render: typeof footer }) => {
            footer = render;
            return () => {};
          },
          dialog: {
            confirm: async () => {
              if (phase === "confirmation") {
                waiting = true;
                await gate.promise;
              }
              return true;
            },
          },
        },
      } as never);
      await render(() => footer({ mode: "normal", showDetails: true }), screen.renderer);
      original.focus();
      original.insertText("#new-draft");
      screen.mockInput.pressTab();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (waiting || (phase === "editor" && (await Bun.file(started).exists()))) break;
        await Bun.sleep(10);
      }
      expect(phase === "editor" ? await Bun.file(started).exists() : waiting).toBe(true);
      replacement.focus();
      replacement.insertText("different prompt");
      gate.resolve();
      await Bun.write(released, "release");
      await Bun.sleep(150);
      expect(screen.renderer.currentFocusedEditor?.id).toBe(replacement.id);
      expect(original.plainText).toBe("#new-draft");
      expect(replacement.plainText).toBe("different prompt");
      dispose?.();
    });
  }
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
      theme,
      options: { globalDirectory, homeDirectory: root },
      client: { skill: { list: async () => ({ data: [] }) } },
      ui: {
        router: { register: () => () => {}, current: () => ({ type: "home" }), navigate: () => {} },
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

  for (const outcome of [
    "saved",
    "cancelled",
    "missing",
    "failed",
    "collision",
    "invalid",
  ] as const) {
    test(`unmatched-trigger editor workflow: ${outcome}`, async () => {
      root = await mkdtemp(join(tmpdir(), "snippets-v2-tui-unmatched-"));
      const project = join(root, "project");
      const globalDirectory = join(root, "isolated-global");
      await mkdir(project, { recursive: true });
      await mkdir(globalDirectory, { recursive: true });
      await writeFile(join(globalDirectory, "global-only.md"), "CUSTOM_GLOBAL");
      const script = join(root, "fake editor.mjs");
      const opened = join(root, "opened.txt");
      await Bun.write(
        script,
        `await Bun.write(${JSON.stringify(opened)}, process.argv[2]);\n${outcome === "failed" ? 'await Bun.write(process.argv[2], "Saved before failure"); process.exit(7);' : 'await Bun.write(process.argv[2], "Written in external editor");'}`,
      );
      const invalid = "---\naliases: [unterminated\n---\nSaved draft body";
      if (outcome === "invalid") {
        await Bun.write(
          script,
          `await Bun.write(${JSON.stringify(opened)}, process.argv[2]); await Bun.write(process.argv[2], ${JSON.stringify(invalid)});`,
        );
      }
      process.env.EDITOR = "must-not-run-fallback-editor";
      process.env.VISUAL = `"${process.execPath}" "${script}"`;
      if (outcome === "missing") {
        delete process.env.VISUAL;
        delete process.env.EDITOR;
      }
      const alerts: string[] = [];
      const toasts: string[] = [];
      const confirmations: string[] = [];
      let commands: readonly { id?: string; run: (input?: string) => void | Promise<void> }[] = [];
      const screen = await createTestRenderer({ width: 80, height: 24 });
      destroyRenderer = () => screen.renderer.destroy();
      const editor = new TextareaRenderable(screen.renderer, {
        id: "prompt",
        width: 80,
        height: 3,
      });
      editor.traits = { capture: ["tab"], ...{ owner: "opencode", role: "prompt" } };
      screen.renderer.root.add(editor);
      let footer: (input: { mode: "normal"; showDetails: boolean }) => JSX.Element = () => null;

      const dispose = await plugin.setup({
        location: { directory: project },
        theme,
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
          router: {
            register: () => () => {},
            current: () => ({ type: "home" }),
            navigate: () => {},
          },
          toast: { show: ({ message }: { message: string }) => toasts.push(message) },
          slot: ({ render }: { render: typeof footer }) => {
            footer = render;
            return () => {};
          },
          dialog: {
            show: () => undefined,
            set: () => undefined,
            clear: () => undefined,
            alert: async ({ message }: { message: string }) => alerts.push(message),
            confirm: async ({ message }: { message: string }) => {
              confirmations.push(message);
              if (outcome === "collision")
                await Bun.write(join(globalDirectory, "fresh-global.md"), "Concurrent draft");
              return outcome !== "cancelled";
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
      editor.focus();
      editor.insertText("中 #fresh-global");
      const cursor = editor.cursorOffset;
      editor.insertText(" tail");
      editor.cursorOffset = cursor;
      const marks = editor.editorView.extmarks;
      const mark = marks.create({
        start: cursor + 1,
        end: cursor + 5,
        virtual: true,
        data: { payload: "native attachment" },
      });
      const before = { ...marks.get(mark) };
      await Bun.sleep(50);
      // Creation is an explicit acceptance of the inline action, never an idle modal.
      screen.mockInput.pressTab();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (outcome === "saved" && editor.plainText === "中 #fresh-global  tail") break;
        if (outcome === "cancelled" && confirmations.length) break;
        if (toasts.length) break;
        await Bun.sleep(10);
      }
      const file = Bun.file(join(globalDirectory, "fresh-global.md"));
      expect(
        await Bun.file(join(project, ".opencode", "snippet", "fresh-global.md")).exists(),
      ).toBe(false);
      expect(confirmations.length).toBe(outcome === "missing" ? 0 : 1);
      expect(await file.exists()).toBe(
        ["saved", "failed", "collision", "invalid"].includes(outcome),
      );
      expect(await Bun.file(opened).exists()).toBe(
        ["saved", "failed", "invalid"].includes(outcome),
      );
      if (outcome === "saved") {
        expect(await file.text()).toBe("Written in external editor");
        expect(await Bun.file(opened).text()).toBe(file.name);
        expect(editor.plainText).toBe("中 #fresh-global  tail");
        expect(toasts).toEqual([]);
      }
      if (outcome !== "saved") expect(editor.plainText).toBe("中 #fresh-global tail");
      if (outcome === "missing") expect(toasts[0]).toContain("VISUAL or EDITOR");
      if (outcome === "failed") expect(toasts[0]).toContain("7");
      if (outcome === "collision") {
        expect(await file.text()).toBe("Concurrent draft");
        expect(toasts[0]).toContain("Failed to create snippet");
      }
      expect(screen.renderer.currentFocusedEditor).toBe(editor);
      const delta = outcome === "saved" ? 1 : 0;
      expect(marks.get(mark)).toEqual({
        ...before,
        start: (before.start ?? 0) + delta,
        end: (before.end ?? 0) + delta,
      });
      if (outcome === "saved") {
        // Acceptance must see the reloaded registry before a management command
        // performs its own reload; otherwise this partial tag starts another draft.
        editor.setText("#fresh-g");
        editor.gotoLineEnd();
        screen.mockInput.pressTab();
        expect(editor.plainText).toBe("#fresh-global ");
        expect(confirmations).toHaveLength(1);
      }
      if (outcome === "failed") {
        expect(await file.text()).toBe("Saved before failure");
        await Bun.write(
          script,
          'const content = await Bun.file(process.argv[2]).text(); await Bun.write(process.argv[2], content + " recovered");',
        );
        screen.mockInput.pressTab();
        for (let attempt = 0; attempt < 100; attempt++) {
          if (editor.plainText === "中 #fresh-global  tail" || toasts.length > 1) break;
          await Bun.sleep(10);
        }
        expect(toasts).toHaveLength(1);
        expect(confirmations).toHaveLength(2);
        expect(await Bun.file(file.name).text()).toBe("Saved before failure recovered");
        expect(editor.plainText).toBe("中 #fresh-global  tail");
      }
      if (outcome === "invalid") {
        expect(await file.text()).toBe(invalid);
        expect(toasts[0]).toContain("could not be loaded");
        expect(toasts[0]).toContain("reopen");
        await Bun.write(
          script,
          `const content = await Bun.file(process.argv[2]).text(); if (content !== ${JSON.stringify(invalid)}) process.exit(9); await Bun.write(process.argv[2], content.replace("aliases: [unterminated", "aliases: []"));`,
        );
        screen.mockInput.pressTab();
        for (let attempt = 0; attempt < 100; attempt++) {
          if (editor.plainText === "中 #fresh-global  tail" || toasts.length > 1) break;
          await Bun.sleep(10);
        }
        expect(toasts).toHaveLength(1);
        expect(confirmations).toHaveLength(2);
        expect(await Bun.file(file.name).text()).toBe(
          invalid.replace("aliases: [unterminated", "aliases: []"),
        );
        expect(editor.plainText).toBe("中 #fresh-global  tail");
      }
      await commands.find((command) => command.id === "snippets.manage")?.run("list");
      expect(alerts.at(-1)).toContain("#global-only\nCUSTOM_GLOBAL");
      if (outcome === "saved") expect(alerts.at(-1)).toContain("Written in external editor");
      editor.setText("#skill(plugin:rem");
      editor.gotoLineEnd();
      await Bun.sleep(50);
      screen.mockInput.pressTab();
      expect(editor.plainText).toBe("#skill(plugin:remote) ");
      dispose?.();
    });
  }
});
