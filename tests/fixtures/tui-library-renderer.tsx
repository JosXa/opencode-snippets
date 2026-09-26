/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Renderable, TextareaRenderable } from "@opentui/core";
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
async function fixture(width = 120, height = 38) {
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
        background: { base: "#101820", action: { primary: { focused: "#775511" } } },
        text: {
          base: "#eeeeee",
          muted: "#999999",
          action: { primary: { base: "#ffaa33", focused: "#ffffff" } },
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
  await settle();
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

test("matches the split layout; click source includes, search aliases, filter and select rows", async () => {
  const view = await fixture();
  expect(view.captureCharFrame()).toContain("Review this code carefully:");
  expect(view.captureCharFrame()).toContain("#missing (unresolved)");
  await view.click("library-action-include:base");
  expect(view.state.selected).toEndWith("base.md");
  await view.click(`library-action-used:${join(view.directory, ".opencode/snippet/review.md")}`);
  expect(view.state.selected).toEndWith("review.md");
  view.mockInput.pressKey("/");
  await view.mockInput.typeText("rev");
  await view.settle();
  expect(view.captureCharFrame()).not.toContain("#global");
  await view.click("library-action-global");
  expect(view.captureCharFrame()).toContain("No matching snippets.");
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
  await view.click("library-action-copy");
  expect(view.clipboard).toEqual(["#base"]);
  await view.click("library-action-form");
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
  await view.mockInput.typeText("Draft");
  await view.settle();
  await view.click("library-file-1");
  await view.click("library-file-2");
  expect(view.editor().plainText).toEndWith("New lineDraft");
  view.answers.push("cancel");
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.closed()).toBe(false);
  view.answers.push("save");
  view.mockInput.pressEscape();
  await view.settle();
  expect(view.closed()).toBe(true);
  expect(await Bun.file(view.path()).text()).toEndWith("New lineDraft");
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

test("create, duplicate, rename, move and delete operate on real files", async () => {
  const view = await fixture();
  view.answers.push("new-snippet", "project");
  await view.click("library-action-new");
  expect(view.state.selected).toEndWith("new-snippet.md");
  view.editor().gotoBufferEnd();
  await view.mockInput.typeText("New body");
  view.mockInput.pressKey("s", { ctrl: true });
  await view.settle();
  view.answers.push("copy", "global");
  await view.click("library-action-duplicate");
  expect(view.state.selected).toEndWith("global/copy.md");
  view.answers.push("renamed", true);
  await view.click("library-action-rename");
  expect(view.state.selected).toEndWith("renamed.md");
  expect((await view.library.list()).registry.get("copy")?.name).toBe("renamed");
  view.answers.push(true);
  await view.click("library-action-move");
  expect(view.state.selected).toEndWith(".opencode/snippet/renamed.md");
  const deleted = view.path();
  view.answers.push(true);
  await view.click("library-action-delete");
  expect(await Bun.file(deleted).exists()).toBe(false);
  expect((await view.library.list()).registry.get("new-snippet")?.content).toBe("New body");
});

test("compact terminal keeps footer, editor and save action visible after resizing", async () => {
  const view = await fixture(72, 32);
  expect(view.captureCharFrame()).toContain("Esc back");
  await view.click("library-action-edit");
  const editor = view.editor();
  expect(editor.height).toBeGreaterThan(2);
  expect(editor.y + editor.height).toBeLessThan(view.renderer.height);
  view.resize(130, 45);
  await view.settle();
  expect(view.captureCharFrame()).toContain("Edit source");
  expect(view.captureCharFrame()).toContain("Esc back");
});
