/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  BoxRenderable,
  Renderable,
  RGBA,
  ScrollBoxRenderable,
  TextareaRenderable,
} from "@opentui/core";
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { testRender, useRenderer } from "@opentui/solid";
import { createSignal, type JSX, Show } from "solid-js";
import { createLibrary } from "../../src/library.js";
import { type LibraryState, SnippetLibrary } from "../../src/tui-library.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(width = 120, height = 38, scroll = { speed: 3, acceleration: false }) {
  const previous = process.env.OPENCODE_CLI_CONFIG_CONTENT;
  process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({ scroll });
  cleanups.push(() => {
    if (previous === undefined) delete process.env.OPENCODE_CLI_CONFIG_CONTENT;
    if (previous !== undefined) process.env.OPENCODE_CLI_CONFIG_CONTENT = previous;
  });
  const directory = await mkdtemp("/tmp/opencode/library-render-");
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const globalDirectory = join(directory, "global");
  const library = createLibrary(directory, globalDirectory);
  await library.create("base", "project", "TypeScript strict + JSDoc");
  await library.create(
    "review",
    "project",
    "---\naliases: [rev]\ndescription: Inspect code\n---\nReview this code carefully:\n#base\n#missing",
  );
  await library.create("global", "global", "Global instructions");
  const answers: unknown[] = [];
  const calls: string[] = [];
  const clipboard: string[] = [];
  const state: LibraryState = {
    selected: join(directory, ".opencode/snippet/review.md"),
    drafts: new Map(),
  };
  let closed = false;
  const view = await testRender(
    () => {
      const renderer = useRenderer();
      renderer.copyToClipboardOSC52 = (text) => {
        clipboard.push(text);
        return true;
      };
      const [dialog, setDialog] = createSignal<() => JSX.Element>();
      let dismiss = () => {};
      const host = createDefaultOpenTuiKeymap(renderer);
      cleanups.push(
        registerManagedTextareaLayer(host, renderer, {
          bindings: [{ key: "return", cmd: "input.submit" }],
        }),
      );
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
          action: { primary: { base: "#ffaa33", focused: "#101010", disabled: "#666666" } },
          formfield: { base: "#ddeeff", focused: "#aabbcc" },
          feedback: { error: { base: "#ff5555" } },
        },
      };
      const context = {
        renderer,
        theme: { ...palette, surface: () => palette },
        keymap: { mode: { current: () => "base" } },
        ui: {
          format: { path: (value: string) => value.replace(directory, "project") },
          dialog: {
            ...Object.fromEntries(
              ["confirm", "prompt", "select"].map((name) => [
                name,
                async () => {
                  calls.push(name);
                  return answers.shift();
                },
              ]),
            ),
            set: () => {},
            show: (render: () => JSX.Element, close: () => void) => {
              dismiss = close;
              setDialog(() => render);
            },
            clear: () => {
              setDialog(undefined);
              dismiss();
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
            reload={async () => {}}
            close={() => {
              closed = true;
            }}
          />
          <Show when={dialog()}>
            {(render) => (
              <box
                position="absolute"
                left={10}
                top={3}
                width={80}
                height={28}
                backgroundColor="#101820"
              >
                {render()()}
              </box>
            )}
          </Show>
        </>
      );
    },
    { width, height },
  );
  cleanups.push(() => view.renderer.destroy());
  const settle = async () => {
    await Bun.sleep(50);
    await view.flush();
  };
  for (const _ of Array.from({ length: 40 })) {
    await settle();
    if (view.captureCharFrame().includes("Review this code carefully:")) break;
  }
  expect(view.captureCharFrame()).toContain("Review this code carefully:");
  const node = (id: string) => {
    const node = view.renderer.root.findDescendantById(id);
    if (!(node instanceof Renderable)) throw new Error(`Missing ${id}`);
    return node;
  };
  const click = async (id: string) => {
    const target = node(id);
    await view.mockMouse.click(target.x + 1, target.y);
    await settle();
  };
  const editor = () => {
    const target = node("library-editor");
    if (!(target instanceof TextareaRenderable)) throw new Error("Not an editor");
    return target;
  };
  return {
    ...view,
    library,
    directory,
    state,
    answers,
    calls,
    clipboard,
    node,
    click,
    editor,
    settle,
    path: () => {
      if (!state.selected) throw new Error("No selected snippet");
      return state.selected;
    },
    closed: () => closed,
  };
}

test("uses native foreground/background pairs for selection, actions and focused search", async () => {
  const view = await fixture();
  const span = (text: string) => {
    const found = view
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((item) => item.text.includes(text));
    if (!found) throw new Error(`Missing rendered text: ${text}`);
    return found;
  };
  expect(span("› #review").fg).toEqual(RGBA.fromHex("#101010"));
  expect(span("› #review").bg).toEqual(RGBA.fromHex("#775511"));
  const row = view
    .captureSpans()
    .lines.find((line) => line.spans.some((item) => item.text.includes("› #review")));
  expect(row?.spans.find((item) => item.text.includes("P"))?.fg).toEqual(RGBA.fromHex("#101010"));
  view.mockInput.pressTab();
  view.mockInput.pressTab();
  view.mockInput.pressTab();
  await view.settle();
  expect(span("› #review").fg).toEqual(RGBA.fromHex("#999999"));
  expect(span("› #review").bg).toEqual(RGBA.fromHex("#304050"));
  expect(span("● all").fg).toEqual(RGBA.fromHex("#101010"));
  expect(span("● all").bg).toEqual(RGBA.fromHex("#775511"));
  view.mockInput.pressKey("/");
  await view.mockInput.typeText("review");
  await view.settle();
  expect(span("review").fg).toEqual(RGBA.fromHex("#aabbcc"));
  expect(span("review").bg).toEqual(RGBA.fromHex("#203040"));
});

test("matches the split layout; click source includes, search aliases, filter and select rows", async () => {
  const view = await fixture();
  expect(view.captureCharFrame()).toContain("Review this code carefully:");
  expect(view.captureCharFrame()).toContain("#missing (unresolved)");
  expect(view.node("library-action-new").y).toBe(view.node("library-search").y);
  expect(view.captureCharFrame()).toContain("edit source enter");
  expect(view.captureCharFrame()).toContain("more :");
  expect(view.captureCharFrame()).not.toContain("[ Edit source ]");
  const button = view.node("library-action-edit");
  if (!(button instanceof BoxRenderable)) throw new Error("Not a button");
  const background = button.backgroundColor;
  await view.mockMouse.moveTo(button.x + 1, button.y);
  await view.settle();
  expect(button.backgroundColor).not.toEqual(background);
  await view.click("library-action-include:base");
  expect(view.state.selected).toEndWith("base.md");
  expect(view.captureCharFrame()).not.toContain("Includes");
  expect(view.captureCharFrame()).not.toContain("Aliases:");
  expect(view.captureCharFrame()).not.toContain("Fields:");
  await view.click(`library-action-used:${join(view.directory, ".opencode/snippet/review.md")}`);
  expect(view.state.selected).toEndWith("review.md");
  view.mockInput.pressKey("/");
  await view.mockInput.typeText("rev");
  await view.settle();
  expect(view.captureCharFrame()).not.toContain("#global");
  await view.mockInput.typeText("q");
  await view.settle();
  expect(view.captureCharFrame()).toContain("revq");
  expect(view.closed()).toBe(false);
  await view.click("library-action-global");
  expect(view.captureCharFrame()).toContain("No matching snippets.");
  view.mockInput.pressKey("q");
  await view.settle();
  expect(view.closed()).toBe(true);
});

test("search Enter selects the result; find, copy and form testing use the unsaved source", async () => {
  const view = await fixture();
  view.mockInput.pressKey("/");
  await view.mockInput.typeText("base");
  view.mockInput.pressEnter();
  await view.settle();
  expect(view.path()).toEndWith("base.md");
  view.mockInput.pressEnter();
  await view.settle();
  view
    .editor()
    .setText("---\nfields:\n  target:\n    type: text\n    default: src\n---\nReview {{target}}");
  await view.settle();
  view.answers.push("Review");
  view.mockInput.pressKey("f", { ctrl: true });
  await view.settle();
  expect(view.captureCharFrame()).toContain("Found: Review");
  view.answers.push("copy");
  await view.click("library-action-more");
  expect(view.clipboard).toEqual(["#base"]);
  view.answers.push("form");
  view.mockInput.pressKey(":");
  await view.settle();
  expect(view.captureCharFrame()).toContain("Target");
  view.mockInput.pressEnter();
  await view.settle();
  expect(view.clipboard).toEqual(["#base", '#base(target="src")']);
  expect(view.state.drafts.size).toBe(1);
  expect(await Bun.file(view.path()).text()).toBe("TypeScript strict + JSDoc");
});

test("native editor enters multiline text under host submit bindings, saves, undoes, and preserves drafts across selection", async () => {
  const view = await fixture();
  view.mockInput.pressEnter();
  await view.settle();
  view.editor().gotoBufferEnd();
  view.mockInput.pressEnter();
  await view.mockInput.pasteBracketedText("中😀 New line");
  await view.settle();
  expect(view.editor().plainText).toEndWith("\n中😀 New line");
  view.mockInput.pressKey("z", { ctrl: true });
  await view.settle();
  expect(view.editor().plainText).not.toContain("New line");
  view.mockInput.pressKey("y", { ctrl: true });
  await view.settle();
  expect(view.editor().plainText).toEndWith("\n中😀 New line");
  expect(view.captureCharFrame()).toContain("Unsaved");
  view.mockInput.pressKey("s", { ctrl: true });
  await view.settle();
  expect(await Bun.file(view.path()).text()).toEndWith("\n中😀 New line");
  expect(view.captureCharFrame()).not.toContain("Unsaved");
  await view.mockInput.typeText("Draftq");
  expect(view.closed()).toBe(false);
  await view.settle();
  await view.click("library-file-1");
  await view.click("library-file-2");
  expect(view.editor().plainText).toEndWith("New lineDraftq");
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.closed()).toBe(false);
  expect(view.renderer.root.findDescendantById("library-editor")).toBeUndefined();
  view.answers.push("cancel");
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.calls).toEqual(["select"]);
  expect(view.closed()).toBe(false);
  view.answers.push("save");
  view.mockInput.pressEscape();
  // Saving files can continue after the renderer goes idle.
  for (const _ of Array.from({ length: 100 })) {
    if (view.closed()) break;
    await Bun.sleep(10);
  }
  expect(view.closed()).toBe(true);
  expect(await Bun.file(view.path()).text()).toEndWith("New lineDraftq");
});

test("Escape leaves the editor in one step, then unwinds help and search before closing", async () => {
  const view = await fixture();
  view.mockInput.pressKey("/");
  await view.mockInput.typeText("rev");
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.node("library-search").focused).toBe(false);
  expect(view.closed()).toBe(false);
  view.mockInput.pressEnter();
  await view.settle();
  expect(view.editor().focused).toBe(true);
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.renderer.root.findDescendantById("library-editor")).toBeUndefined();
  expect(view.captureCharFrame()).toContain("select j/k");
  expect(view.closed()).toBe(false);
  view.mockInput.pressKey("F1");
  await view.settle();
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.renderer.root.findDescendantById("library-editor")).toBeUndefined();
  expect(view.closed()).toBe(false);
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.captureCharFrame()).toContain("#global");
  expect(view.closed()).toBe(false);
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.closed()).toBe(true);
});

test("q closes directly from a focused action and keeps unsaved drafts", async () => {
  const view = await fixture();
  view.mockInput.pressEnter();
  await view.settle();
  view.editor().setText("Retain this draft");
  await view.click("library-action-help");
  view.mockInput.pressKey("q");
  await view.settle();
  expect(view.closed()).toBe(true);
  expect(view.calls).toEqual([]);
  expect(view.state.drafts.get(view.path())?.raw).toBe("Retain this draft");
  expect(await Bun.file(view.path()).text()).not.toBe("Retain this draft");
});

test("external changes retain the draft and reload asks before discarding", async () => {
  const view = await fixture();
  view.mockInput.pressEnter();
  await view.settle();
  view.editor().gotoBufferEnd();
  await view.mockInput.typeText("Draft");
  await Bun.write(view.path(), "External version");
  view.mockInput.pressKey("s", { ctrl: true });
  await view.settle();
  expect(view.captureCharFrame()).toContain("changed on disk");
  expect(view.editor().plainText).toEndWith("Draft");
  view.answers.push(false);
  await view.click("library-action-reload");
  expect(view.editor().plainText).toEndWith("Draft");
  view.answers.push(true);
  await view.click("library-action-reload");
  expect(view.editor().plainText).toBe("External version");
});

for (const choice of ["clean", "split", "save", "discard", "cancel", "failure", "unconfigured"]) {
  test(`Shift+Enter opens the selected file through VISUAL: ${choice}`, async () => {
    const view = await fixture();
    const previous = {
      VISUAL: process.env.VISUAL,
      EDITOR: process.env.EDITOR,
      OPENCODE_SNIPPETS_EDITOR_TMUX: process.env.OPENCODE_SNIPPETS_EDITOR_TMUX,
      TMUX: process.env.TMUX,
    };
    cleanups.push(() => {
      for (const key of ["VISUAL", "EDITOR", "OPENCODE_SNIPPETS_EDITOR_TMUX", "TMUX"] as const) {
        if (previous[key] === undefined) delete process.env[key];
        if (previous[key] !== undefined) process.env[key] = previous[key];
      }
    });
    const lifecycle: string[] = [];
    view.renderer.suspend = () => {
      lifecycle.push("suspend");
    };
    view.renderer.resume = () => {
      lifecycle.push("resume");
    };
    const path = view.path();
    const before = await Bun.file(path).text();
    const record = join(view.directory, "opened.json");
    const script = join(view.directory, "editor with spaces.ts");
    await Bun.write(
      script,
      `
      const path = Bun.argv[2];
      const content = await Bun.file(path).text();
      await Bun.write(${JSON.stringify(record)}, JSON.stringify({ path, content }));
      await Bun.write(path, content + "\\nEXTERNAL_EDIT");
      process.exit(${choice === "failure" ? 7 : 0});
    `,
    );
    process.env.VISUAL = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    process.env.EDITOR = "this-editor-must-not-run";
    delete process.env.OPENCODE_SNIPPETS_EDITOR_TMUX;
    if (choice === "split") {
      process.env.OPENCODE_SNIPPETS_EDITOR_TMUX = "1";
      process.env.TMUX = "test-socket";
    }
    if (choice === "unconfigured") {
      delete process.env.VISUAL;
      delete process.env.EDITOR;
    }
    if (["save", "discard", "cancel"].includes(choice)) {
      view.mockInput.pressEnter();
      await view.settle();
      view.editor().setText("INLINE_DRAFT");
      await view.settle();
      view.answers.push(choice);
    }
    view.mockInput.pressKey("\x1b[13;2u");
    for (const _ of Array.from({ length: 100 })) {
      await view.settle();
      if (
        choice === "cancel" ||
        /External editor closed|exited with|Set VISUAL/.test(view.captureCharFrame())
      )
        break;
    }
    if (choice === "cancel" || choice === "unconfigured") {
      expect(await Bun.file(record).exists()).toBe(false);
      expect(await Bun.file(path).text()).toBe(before);
      expect(lifecycle).toEqual([]);
      if (choice === "cancel") expect(view.editor().plainText).toBe("INLINE_DRAFT");
      if (choice === "unconfigured")
        expect(view.captureCharFrame()).toContain("Set VISUAL or EDITOR");
      return;
    }
    const content = choice === "save" ? "INLINE_DRAFT" : before;
    expect(await Bun.file(record).json()).toEqual({ path, content });
    expect(await Bun.file(path).text()).toBe(`${content}\nEXTERNAL_EDIT`);
    expect(view.captureCharFrame()).toContain("EXTERNAL_EDIT");
    expect(view.state.drafts.get(path)?.raw).toBe(view.state.drafts.get(path)?.file.raw);
    expect(view.captureCharFrame()).not.toContain("Unsaved");
    expect(lifecycle).toEqual(choice === "split" ? [] : ["suspend", "resume"]);
    if (choice === "failure") expect(view.captureCharFrame()).toContain("code 7");
  });
}

test("create, duplicate, rename, move and delete operate on real files", async () => {
  const view = await fixture();
  view.answers.push("new-snippet", "project");
  await view.click("library-action-new");
  expect(view.state.selected).toEndWith("new-snippet.md");
  view.editor().gotoBufferEnd();
  await view.mockInput.typeText("New body");
  view.mockInput.pressKey("s", { ctrl: true });
  await view.settle();
  view.answers.push("duplicate", "copy", "global");
  await view.click("library-action-more");
  expect(view.state.selected).toEndWith("global/copy.md");
  view.answers.push("rename", "renamed", true);
  await view.click("library-action-more");
  expect(view.state.selected).toEndWith("renamed.md");
  expect((await view.library.list()).registry.get("copy")?.name).toBe("renamed");
  view.answers.push("move", true);
  await view.click("library-action-more");
  expect(view.state.selected).toEndWith(".opencode/snippet/renamed.md");
  const deleted = view.path();
  view.answers.push("delete", true);
  await view.click("library-action-more");
  expect(await Bun.file(deleted).exists()).toBe(false);
  expect((await view.library.list()).registry.get("new-snippet")?.content).toBe("New body");
});

test("compact terminal keeps footer, editor and save action visible after resizing", async () => {
  const view = await fixture(72, 32);
  expect(view.captureCharFrame()).toContain("back esc");
  await view.click("library-action-edit");
  const editor = view.editor();
  expect(editor.height).toBeGreaterThan(2);
  expect(editor.y + editor.height).toBeLessThan(view.renderer.height);
  view.resize(130, 45);
  await view.settle();
  expect(view.captureCharFrame()).toContain("edit source");
  expect(view.captureCharFrame()).toContain("back esc");
});

test.each([
  false,
  true,
])("list, source and editor follow CLI scrolling (acceleration=%s)", async (acceleration) => {
  const speed = acceleration ? 99 : 5;
  const view = await fixture(120, 38, { speed, acceleration });
  for (const index of Array.from({ length: 60 }, (_, index) => index)) {
    await view.library.create(`item-${index}`, "project", "Body");
  }
  await Bun.write(
    view.path(),
    Array.from({ length: 100 }, (_, index) => `Line ${index}`).join("\n"),
  );
  await view.click("library-action-reload");
  for (const id of ["library-list", "library-preview"]) {
    const box = view.node(id);
    if (!(box instanceof ScrollBoxRenderable)) throw new Error("Not a scrollbox");
    box.scrollTo(0);
    await view.settle();
    await view.mockMouse.scroll(box.x + 2, box.y + 2, "down");
    await view.settle();
    if (!acceleration) expect(box.scrollTop).toBe(speed);
    if (acceleration) {
      expect(box.scrollTop).toBeGreaterThan(0);
      expect(box.scrollTop).toBeLessThan(speed);
    }
  }
  await view.click("library-action-edit");
  const editor = view.editor();
  await view.mockMouse.scroll(editor.x + 2, editor.y + 2, "down");
  await view.settle();
  if (!acceleration) expect(editor.scrollY).toBe(speed);
  if (acceleration) {
    expect(editor.scrollY).toBeGreaterThan(0);
    expect(editor.scrollY).toBeLessThan(speed);
  }
});
