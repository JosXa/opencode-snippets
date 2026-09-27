/** @jsxImportSource @opentui/solid */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BoxRenderable, type KeyEvent, Renderable, RGBA, TextareaRenderable } from "@opentui/core";
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { testRender, useRenderer } from "@opentui/solid";
import { type Accessor, createSignal, type JSX, Show } from "solid-js";
import { type LibraryState, SnippetLibrary } from "../../src/tui-library.js";

export interface Seed {
  name: string;
  source?: "project" | "global";
  raw: string;
}

export const snippets: Seed[] = [
  { name: "base", raw: "TypeScript strict + JSDoc" },
  { name: "global", source: "global", raw: "Global instructions" },
  {
    name: "review",
    raw: "---\naliases: [rev]\ndescription: Inspect code\n---\nReview this code:\n#base\n#missing",
  },
];

interface Dialog {
  kind: "prompt" | "select" | "confirm";
  title: string;
  message?: string;
  placeholder?: string;
  label?: { confirm: string; cancel: string };
  options?: { title: string; value: unknown; description?: string }[];
  resolve(value: unknown): void;
}

const palette = {
  border: { base: "#555555" },
  background: {
    base: "#101820",
    raised: { base: "#182028", high: "#304050" },
    formfield: { focused: "#203040" },
    action: { primary: { focused: "#775511" } },
  },
  text: {
    base: "#eeeeee",
    muted: "#999999",
    action: { primary: { base: "#ffaa33", focused: "#ffffff", disabled: "#666666" } },
    formfield: { base: "#ddeeff", focused: "#aabbcc" },
    feedback: { error: { base: "#ff5555" } },
  },
};

/** Real terminal input/rendering and disk; only the surrounding OpenCode services are doubles. */
export async function open(
  options: { seeds?: Seed[]; selected?: string; width?: number; height?: number } = {},
) {
  const parent = join(tmpdir(), "opencode");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "snippets-bdd-"));
  const globalDirectory = join(directory, "global");
  const path = (name: string, source = "project") =>
    join(
      source === "global" ? globalDirectory : join(directory, ".opencode/snippet"),
      `${name}.md`,
    );
  for (const seed of options.seeds ?? snippets) {
    await Bun.write(path(seed.name, seed.source), seed.raw);
  }
  const state: LibraryState = {
    selected: path(options.selected ?? "review"),
    drafts: new Map(),
  };
  const trace: string[] = [];
  const frames: string[] = [];
  const clipboard: string[] = [];
  const host = {
    closed: false,
    reloads: 0,
    submits: 0,
    mode: "base",
    clipboard: true,
    dialog: undefined as Dialog | undefined,
  };
  const cleanups: (() => void)[] = [];
  const view = await testRender(
    () => {
      const renderer = useRenderer();
      renderer.copyToClipboardOSC52 = (text) => {
        if (host.clipboard) clipboard.push(text);
        return host.clipboard;
      };
      const keymap = createDefaultOpenTuiKeymap(renderer);
      cleanups.push(
        registerManagedTextareaLayer(keymap, renderer, {
          bindings: [{ key: "return", cmd: "input.submit" }],
        }),
      );
      const submit = (event: KeyEvent) => {
        if (event.name === "return" && !event.defaultPrevented) host.submits++;
      };
      renderer.keyInput.on("keypress", submit);
      cleanups.push(() => renderer.keyInput.removeListener("keypress", submit));
      const [form, setForm] = createSignal<() => JSX.Element>();
      const dismiss = { run: () => {} };
      const request = (kind: Dialog["kind"], input: Omit<Dialog, "kind" | "resolve">) =>
        new Promise<unknown>((resolve) => {
          if (host.dialog) throw new Error("A dialog is already open");
          host.dialog = { ...input, kind, resolve };
        });
      const context = {
        renderer,
        theme: { ...palette, surface: () => palette },
        keymap: { mode: { current: () => host.mode } },
        ui: {
          format: { path: (value: string) => value.replace(directory, "project") },
          dialog: {
            prompt: (input: Omit<Dialog, "kind" | "resolve">) => request("prompt", input),
            select: (input: Omit<Dialog, "kind" | "resolve">) => request("select", input),
            confirm: (input: Omit<Dialog, "kind" | "resolve">) => request("confirm", input),
            set: () => {},
            show: (render: () => JSX.Element, close: () => void) => {
              dismiss.run = close;
              setForm(() => render);
            },
            clear: () => {
              setForm(undefined);
              dismiss.run();
            },
          },
        },
      } as unknown as Parameters<typeof SnippetLibrary>[0]["context"];
      return (
        <>
          <SnippetLibrary
            context={context}
            directory={directory}
            globalDirectory={globalDirectory}
            state={state}
            reload={async () => {
              host.reloads++;
            }}
            close={() => {
              host.closed = true;
            }}
          />
          <Show when={form()}>
            {(render: Accessor<() => JSX.Element>) => (
              <box
                position="absolute"
                left={2}
                top={2}
                width="90%"
                backgroundColor={palette.background.base}
              >
                {render()()}
              </box>
            )}
          </Show>
        </>
      );
    },
    { width: options.width ?? 120, height: options.height ?? 40, kittyKeyboard: true },
  );

  const frame = () => view.captureCharFrame();
  const flush = async () => {
    await view.flush();
  };
  const until = async (assertion: () => void | Promise<void>) => {
    const deadline = Date.now() + 2000;
    for (;;) {
      await flush();
      try {
        await assertion();
        return;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
      // Filesystem promises can outlive render-idle. Retry assertions, not fixed UX sleeps.
      await Bun.sleep(10);
    }
  };
  const node = (id: string) => {
    const target = view.renderer.root.findDescendantById(id);
    if (!(target instanceof Renderable))
      throw new Error(`Missing visible control: ${id}\n${frame()}`);
    return target;
  };
  const visible = (id: string) => {
    const target = node(id);
    assert.ok(target.width > 0 && target.height > 0, `${id} has no area`);
    assert.ok(target.x >= 0 && target.y >= 0, `${id} is above or left of the viewport`);
    assert.ok(target.x + target.width <= view.renderer.width, `${id} is right of the viewport`);
    assert.ok(target.y + target.height <= view.renderer.height, `${id} is below the viewport`);
  };
  const focused = (id: string) => {
    const target = node(id);
    visible(id);
    if (id.startsWith("library-action-")) {
      assert.ok(target instanceof BoxRenderable);
      assert.deepEqual(
        target.backgroundColor,
        RGBA.fromHex(palette.background.action.primary.focused),
      );
      return;
    }
    if (id === "library-list") {
      assert.ok(target instanceof BoxRenderable);
      assert.deepEqual(target.borderColor, RGBA.fromHex(palette.text.base));
      return;
    }
    assert.equal(target.focused, true, `${id} is not focused`);
  };
  const record = (label: string) => {
    trace.push(label);
    frames.push(`${label}\n${frame()}`);
  };
  const press = async (key: string) => {
    trace.push(`press ${key}`);
    const parts = key.split("+");
    const name = parts.at(-1) ?? key;
    const names: Record<string, string> = {
      Enter: "RETURN",
      Escape: "ESCAPE",
      Tab: "TAB",
      Backspace: "BACKSPACE",
      Up: "ARROW_UP",
      Down: "ARROW_DOWN",
      Left: "ARROW_LEFT",
      Right: "ARROW_RIGHT",
      Home: "HOME",
      End: "END",
      PageUp: "\x1b[5~",
      PageDown: "\x1b[6~",
      F1: "F1",
      Space: " ",
      Delete: "DELETE",
    };
    view.mockInput.pressKey(names[name] ?? name.toLowerCase(), {
      ctrl: parts.includes("Ctrl"),
      shift: parts.includes("Shift") || /^[A-Z]$/.test(name),
      meta: parts.includes("Alt"),
    });
    await flush();
  };
  const type = async (text: string) => {
    trace.push(`type ${JSON.stringify(text)}`);
    // OpenTUI's typeText splits UTF-16 units; terminals send whole Unicode points.
    await view.mockInput.pressKeys([...text]);
    await flush();
  };
  const paste = async (text: string) => {
    trace.push(`paste ${JSON.stringify(text)}`);
    await view.mockInput.pasteBracketedText(text);
    await flush();
  };
  const click = async (id: string) => {
    trace.push(`click ${id}`);
    visible(id);
    const target = node(id);
    await view.mockMouse.click(target.x + Math.min(1, target.width - 1), target.y);
    // Remove hover so focus assertions cannot accidentally pass on a hovered button.
    await view.mockMouse.moveTo(0, 0);
    await flush();
  };
  const dialog = async (title: string) => {
    await until(() => assert.equal(host.dialog?.title, title));
    return host.dialog as Dialog;
  };
  const answer = async (title: string, value: unknown) => {
    const pending = await dialog(title);
    trace.push(`host ${pending.kind} ${title}: ${JSON.stringify(value)}`);
    host.dialog = undefined;
    pending.resolve(value);
    await until(() => assert.ok(host.dialog || !frame().includes("Working…")));
  };
  const choose = async (title: string, label: string) => {
    const pending = await dialog(title);
    const option = pending.options?.find((option) => option.title === label);
    if (!option) throw new Error(`No option ${label} in ${title}`);
    await answer(title, option.value);
  };
  const editor = () => {
    const target = node("library-editor");
    if (!(target instanceof TextareaRenderable)) throw new Error("Expected a native editor");
    return target;
  };
  await until(() => assert.ok(!frame().includes("Working…")));
  return {
    host,
    clipboard,
    directory,
    state,
    path,
    frame,
    node,
    focused,
    visible,
    until,
    press,
    type,
    paste,
    click,
    dialog,
    answer,
    choose,
    editor,
    record,
    async resize(width: number, height: number) {
      view.resize(width, height);
      await flush();
    },
    async artifacts(name: string, error: unknown) {
      const root = resolve(process.env.SNIPPETS_BDD_ARTIFACTS ?? ".tmp/bdd");
      const file = join(root, name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
      await Bun.write(
        `${file}.txt`,
        `${String(error)}\n\n${trace.join("\n")}\n\n${frames.join("\n\n")}\n\nFailure frame\n${frame()}`,
      );
      await Bun.write(
        `${file}.json`,
        JSON.stringify({ trace, dialog: host.dialog, selected: state.selected }, null, 2),
      );
      console.error(`BDD failure artifacts: ${file}.{txt,json}`);
    },
    async dispose() {
      host.dialog?.resolve(undefined);
      for (const cleanup of cleanups.reverse()) cleanup();
      view.renderer.destroy();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export type Driver = Awaited<ReturnType<typeof open>>;
