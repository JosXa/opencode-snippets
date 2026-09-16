/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BoxRenderable,
  type ExtmarksController,
  RGBA,
  TextareaRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { render } from "@opentui/solid";
import { createStore } from "solid-js/store";
import plugin from "./tui.js";

type Context = Parameters<typeof plugin.setup>[0];
type SlotClaim = Parameters<Context["ui"]["slot"]>[0];

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(background = RGBA.fromHex("#101820"), files: Record<string, string> = {}) {
  const directory = await mkdtemp(join(import.meta.dir, ".test-inline-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const globalDirectory = join(directory, "global");
  await mkdir(globalDirectory);
  for (const name of ["review", "release", "zebra"]) {
    await writeFile(
      join(globalDirectory, `${name}.md`),
      `${name === "review" ? '---\naliases: ["中rev", "rév"]\n---\n' : ""}Description for ${name}`,
    );
  }
  for (const [name, content] of Object.entries(files)) {
    await Bun.write(join(globalDirectory, `${name}.md`), content);
  }
  const screen = await createTestRenderer({ width: 80, height: 24 });
  cleanups.push(() => screen.renderer.destroy());
  // Native OC2 routes editing through this adapter. It sets traits.suspend=true
  // on focused editors to disable duplicate built-in bindings, not user input.
  const hostKeymap = createDefaultOpenTuiKeymap(screen.renderer);
  cleanups.push(
    registerManagedTextareaLayer(hostKeymap, screen.renderer, {
      bindings: [{ key: "return", cmd: "input.submit" }],
    }),
  );
  let submissions = 0;
  const prompt = new TextareaRenderable(screen.renderer, {
    id: "host-prompt",
    width: "100%",
    height: 3,
    keyBindings: [{ name: "return", action: "submit" }],
    onSubmit: () => {
      submissions++;
    },
  });
  // OpenCode extends the core traits with these identity fields at runtime.
  prompt.traits = { capture: ["tab"], ...{ owner: "opencode", role: "prompt" } };
  const footer = { mode: "normal" as "normal" | "shell", showDetails: true };
  let hostMode = "base";
  let claim: SlotClaim | undefined;
  const dialogs: string[] = [];
  const [theme, setTheme] = createStore({
    hue: { accent: { 500: RGBA.fromHex("#bb44ff") } },
    border: { default: RGBA.fromHex("#607080") },
    background: { default: background, surface: { overlay: RGBA.fromHex("#202830") } },
    text: { default: RGBA.fromHex("#eeeeee"), subdued: RGBA.fromHex("#909090") },
    contextual: {
      overlay: {
        border: { default: RGBA.fromHex("#a08060") },
        background: {
          default: RGBA.fromHex("#182838"),
          action: { primary: { focused: RGBA.fromHex("#486878") } },
        },
        text: {
          default: RGBA.fromHex("#d0e0f0"),
          subdued: RGBA.fromHex("#8090a0"),
          action: { primary: { focused: RGBA.fromHex("#f0e0c0") } },
        },
      },
    },
  });
  const dispose = await plugin.setup({
    location: { directory },
    options: { globalDirectory, homeDirectory: directory },
    client: { skill: { list: async () => ({ data: [] }) } },
    renderer: screen.renderer,
    theme,
    keymap: { layer: () => {}, mode: { current: () => hostMode } },
    ui: {
      slot: (value: SlotClaim) => {
        claim = value;
        return () => {};
      },
      dialog: Object.fromEntries(
        ["show", "set", "select", "confirm", "prompt", "alert", "clear"].map((name) => [
          name,
          () => {
            dialogs.push(name);
            return Promise.resolve(undefined);
          },
        ]),
      ),
    },
  } as unknown as Context);
  cleanups.push(() => dispose?.());
  expect(claim).toBeDefined();
  let frame: BoxRenderable | undefined;
  let promptBorder: BoxRenderable | undefined;
  // Match beta19157: prompt wrapper contains the left-bordered padded editor,
  // bottom strip and shared footer. Textarea coordinates are NOT wrapper bounds.
  await render(
    () => (
      <box paddingTop={12} paddingLeft={6} width={80}>
        <box ref={frame} width={70}>
          <box ref={promptBorder} width="100%" border={["left"]} borderColor="#40c890">
            <box
              paddingTop={1}
              paddingLeft={2}
              paddingRight={2}
              flexGrow={1}
              flexShrink={0}
              width="100%"
            >
              {prompt}
              <box paddingTop={1}>
                <text>Build · Model</text>
              </box>
            </box>
          </box>
          <box height={1} />
          <box flexDirection="row" justifyContent="space-between" gap={2} height={1}>
            <text>Host footer</text>
            {claim?.render(footer as never)}
          </box>
        </box>
      </box>
    ),
    screen.renderer,
  );
  prompt.focus();
  const settle = async () => {
    await Bun.sleep(350);
    await screen.renderOnce();
  };
  await settle();
  if (!frame || !promptBorder) throw new Error("Native prompt fixture did not mount");
  return {
    ...screen,
    prompt,
    dialogs,
    settle,
    footer,
    frame,
    promptBorder,
    theme,
    setHostMode: (mode: string) => {
      hostMode = mode;
    },
    submissions: () => submissions,
    setTheme,
  };
}

test("INLINE marks direct and nested forms without marking ordinary snippets", async () => {
  const ui = await setup(undefined, {
    "form-direct": "---\nfields:\n  name: {}\n---\n{{name}}",
    "form-preset": '#form-direct(name="preset")',
    "form-plain": "Ordinary snippet",
  });
  await ui.mockInput.typeText("#form-");
  await ui.settle();
  const frame = ui.captureCharFrame();
  expect(frame).toContain("#form-direct ☷");
  expect(frame).toContain("#form-preset ☷");
  expect(frame).toContain("#form-plain");
  expect(frame).not.toContain("#form-plain ☷");
  expect(ui.submissions()).toBe(0);
});

test("INLINE popover aligns with the entire prompt container above its padding, including after resize and multiline growth", async () => {
  const ui = await setup();
  await ui.mockInput.typeText("#re");
  await ui.settle();
  const assertBounds = () => {
    const lines = ui.captureCharFrame().split("\n");
    const rows = lines.flatMap((line, y) =>
      line.includes("┃") && line.includes("#") ? [{ line, y }] : [],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Like main's wrapper-relative left=0/right=0/top=-height, neither border
    // may inherit the editor's inset, and no row may occupy prompt top padding.
    for (const { line } of rows) {
      expect(line.indexOf("┃")).toBe(ui.frame.x);
      expect(line.lastIndexOf("┃")).toBe(ui.frame.x + ui.frame.width - 1);
      expect(line.indexOf("#")).toBe(ui.frame.x + 2);
    }
    expect(rows.at(-1)?.y).toBe(ui.frame.y - 1);
    expect(ui.prompt.y).toBeGreaterThan(ui.frame.y);
    expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
  };
  assertBounds();
  ui.frame.width = 58;
  ui.prompt.height = 5;
  await ui.settle();
  assertBounds();
});

for (const transparent of [false, true]) {
  test(`INLINE suggestions use the native slash autocomplete overlay palette (${transparent ? "transparent" : "opaque"} application background)`, async () => {
    const ui = await setup(RGBA.fromHex(transparent ? "#00000000" : "#101820"));
    await ui.mockInput.typeText("#re");
    await ui.settle();
    const assertPalette = (selected: string) => {
      const palette = ui.theme.contextual.overlay;
      for (const name of ["release", "review"]) {
        const row = ui
          .captureSpans()
          .lines.find((line) => line.spans.some((span) => span.text.includes(`#${name}`)));
        if (!row) throw new Error(`Missing visible #${name} row`);
        const title = row.spans.find((span) => span.text.includes(`#${name}`));
        const description = row.spans.find((span) => span.text.includes(`Description for ${name}`));
        const active = name === selected;
        const bg = active ? palette.background.action.primary.focused : palette.background.default;
        // beta19157 bae() calls Ot("overlay"): both selected text elements use
        // text.action.primary.focused; unselected rows inherit background.default.
        // Distinct root, overlay, accent and agent colors detect the wrong context.
        expect(
          title?.fg.equals(active ? palette.text.action.primary.focused : palette.text.default),
        ).toBe(true);
        expect(
          description?.fg.equals(
            active ? palette.text.action.primary.focused : palette.text.subdued,
          ),
        ).toBe(true);
        expect(title?.bg.equals(bg)).toBe(true);
        expect(description?.bg.equals(bg)).toBe(true);
        for (const border of row.spans.filter((span) => span.text.includes("┃"))) {
          expect(border.fg.equals(palette.border.default)).toBe(true);
        }
      }
    };
    assertPalette("release");
    ui.mockInput.pressArrow("down");
    await ui.settle();
    assertPalette("review");
    // Theme changes must repaint the open menu without reopening or typing.
    ui.setTheme("contextual", "overlay", {
      border: { default: RGBA.fromHex("#507090") },
      background: {
        default: RGBA.fromHex("#283018"),
        action: { primary: { focused: RGBA.fromHex("#887050") } },
      },
      text: {
        default: RGBA.fromHex("#f0d0b0"),
        subdued: RGBA.fromHex("#b0a090"),
        action: { primary: { focused: RGBA.fromHex("#182028") } },
      },
    });
    await ui.settle();
    assertPalette("review");
    expect(ui.submissions()).toBe(0);
    expect(ui.dialogs).toEqual([]);
  });
}

test("accepting an INLINE hashtag preserves tracked file, native skill and collapsed paste marks and payloads", async () => {
  const ui = await setup();
  await ui.mockInput.typeText("[file] #rev [skill] [paste]");
  const marks: ExtmarksController = ui.prompt.editorView.extmarks;
  const tracked = [
    [0, 6, "file"],
    [12, 19, "skill"],
    [20, 27, "paste"],
  ] as const;
  const ids = tracked.map(([start, end, kind]) =>
    marks.create({
      start,
      end,
      virtual: true,
      typeId: marks.registerType(kind),
      data: { kind, payload: `original ${kind} payload` },
      metadata: { kind },
    }),
  );
  const before = ids.map((id) => {
    const mark = marks.get(id);
    if (!mark) throw new Error("Host mark was not created");
    return { ...mark };
  });
  ui.prompt.cursorOffset = 11;
  await ui.settle();
  expect(ui.captureCharFrame()).toContain("#review");
  ui.mockInput.pressTab();
  await ui.settle();
  expect(ui.prompt.plainText).toBe("[file] #review  [skill] [paste]");
  // Host payload maps key by mark ID; retaining only the visible text loses them.
  for (const [index, id] of ids.entries()) {
    const mark = before[index];
    const delta = index === 0 ? 0 : 4;
    expect(marks.get(id)).toEqual({ ...mark, start: mark.start + delta, end: mark.end + delta });
    expect(marks.getMetadataFor(id)).toEqual({ kind: tracked[index][2] });
  }
  expect(ui.submissions()).toBe(0);
});

for (const traits of [
  {},
  { owner: "other", role: "prompt" },
  { owner: "opencode", role: "search" },
  { owner: "opencode", role: "rename" },
]) {
  test(`non-prompt editor ${JSON.stringify(traits)} keeps its own Enter behavior and receives no INLINE suggestions`, async () => {
    const ui = await setup();
    let submitted = 0;
    const external = new TextareaRenderable(ui.renderer, {
      id: "external",
      width: 60,
      height: 1,
      keyBindings: [{ name: "return", action: "submit" }],
      onSubmit: () => {
        submitted++;
      },
    });
    external.traits = { capture: ["tab"], ...traits };
    ui.renderer.root.add(external);
    external.focus();
    await ui.mockInput.typeText("#rev");
    await ui.settle();
    expect(ui.captureCharFrame()).not.toContain("#review");
    ui.mockInput.pressEnter();
    await ui.settle();
    expect(external.plainText).toBe("#rev");
    expect(submitted).toBe(1);
    expect(ui.renderer.currentFocusedEditor).toBe(external);
    expect(ui.dialogs).toEqual([]);
  });
}

for (const state of ["shell", "modal", "menu", "composer", "unfocused"] as const) {
  test(`${state} suspends INLINE suggestions and leaves Enter to the host`, async () => {
    const ui = await setup();
    await ui.mockInput.typeText("#rev");
    await ui.settle();
    expect(ui.captureCharFrame()).toContain("#review");
    if (state === "shell") ui.footer.mode = "shell";
    if (["modal", "menu", "composer"].includes(state)) ui.setHostMode(state);
    if (state === "unfocused") ui.prompt.blur();
    await ui.settle();
    expect(ui.captureCharFrame()).not.toContain("#review");
    ui.mockInput.pressEnter();
    await ui.settle();
    expect(ui.prompt.plainText).toBe("#rev");
    expect(ui.submissions()).toBe(state === "unfocused" ? 0 : 1);
    ui.footer.mode = "normal";
    ui.setHostMode("base");
    ui.prompt.focus();
    await ui.settle();
    expect(ui.captureCharFrame()).toContain("#review");
  });
}

for (const [prefix, tag] of [
  ["中 ", "#rev"],
  ["é ", "#rev"],
  ["👩‍💻 ", "#rev"],
  ["first\n中 é ", "#rev"],
  ["中 ", "#中rev"],
  ["é ", "#rév"],
]) {
  test(`INLINE completion respects native Unicode cursor ranges in ${JSON.stringify(`${prefix}${tag} tail`)}`, async () => {
    const ui = await setup();
    // Real edits determine the native cursor offset; JS string length is not it.
    ui.prompt.insertText(prefix + tag);
    const cursor = ui.prompt.cursorOffset;
    ui.prompt.insertText(" tail");
    ui.prompt.cursorOffset = cursor;
    await ui.settle();
    expect(ui.captureCharFrame()).toContain("#review");
    ui.mockInput.pressEnter();
    await ui.settle();
    expect(ui.prompt.plainText).toBe(`${prefix}#review  tail`);
    expect(ui.prompt.getTextRange(0, ui.prompt.cursorOffset)).toBe(`${prefix}#review `);
    expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
    expect(ui.submissions()).toBe(0);
    expect(ui.dialogs).toEqual([]);
  });
}

test("typing # shows INLINE suggestions while the prompt retains focus; continued typing filters without a modal or submission", async () => {
  const ui = await setup();
  await ui.mockInput.typeText("please #");
  await ui.settle();
  let frame = ui.captureCharFrame();
  expect(frame).toContain("#review");
  expect(frame).toContain("#zebra");
  expect(frame.indexOf("#review")).toBeLessThan(frame.indexOf("please #"));
  expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
  expect(ui.dialogs).toEqual([]);
  await ui.mockInput.typeText("rev");
  await ui.settle();
  frame = ui.captureCharFrame();
  expect(ui.prompt.plainText).toBe("please #rev");
  expect(frame).toContain("#review");
  expect(frame).not.toContain("#zebra");
  expect(frame).not.toContain("#release");
  expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
  expect(ui.dialogs).toEqual([]);
  expect(ui.submissions()).toBe(0);
});

test("native keymap-managed prompt shows INLINE suggestions despite mapping suspension and accepts without submitting", async () => {
  const ui = await setup();
  // Assert the adapter produced the host state rather than manually faking it.
  expect(ui.prompt.traits.suspend).toBe(true);
  await ui.mockInput.typeText("#rev");
  await ui.settle();
  expect(ui.prompt.plainText).toBe("#rev");
  expect(ui.captureCharFrame()).toContain("#review");
  expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
  ui.mockInput.pressEnter();
  await ui.settle();
  expect(ui.prompt.plainText).toBe("#review ");
  expect(ui.submissions()).toBe(0);
  expect(ui.dialogs).toEqual([]);
  ui.mockInput.pressEnter();
  await ui.settle();
  expect(ui.submissions()).toBe(1);
});

for (const key of ["Tab", "Enter"] as const) {
  test(`${key} accepts the highlighted INLINE hashtag without opening a modal or submitting the prompt`, async () => {
    const ui = await setup();
    await ui.mockInput.typeText("please #re");
    await ui.settle();
    expect(ui.captureCharFrame()).toContain("#release");
    expect(ui.captureCharFrame()).toContain("#review");
    const backgroundOf = (label: string) =>
      ui
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(label))?.bg;
    const highlighted = backgroundOf("#release");
    if (!highlighted) throw new Error("The initial inline suggestion was not rendered");
    expect(backgroundOf("#review")?.equals(highlighted)).toBe(false);
    // Move off the initial row: acceptance must use the highlighted suggestion.
    ui.mockInput.pressArrow("down");
    await ui.settle();
    expect(backgroundOf("#review")?.equals(highlighted)).toBe(true);
    expect(backgroundOf("#release")?.equals(highlighted)).toBe(false);
    if (key === "Tab") ui.mockInput.pressTab();
    else ui.mockInput.pressEnter();
    await ui.settle();
    expect(ui.prompt.plainText).toBe("please #review ");
    expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
    expect(ui.captureCharFrame()).not.toContain("Description for");
    expect(ui.dialogs).toEqual([]);
    expect(ui.submissions()).toBe(0);
    // The host submit path remains functional once autocomplete has closed.
    ui.mockInput.pressEnter();
    await ui.settle();
    expect(ui.submissions()).toBe(1);
  });
}

test("Escape dismisses INLINE suggestions without changing the prompt, and typing reopens filtered suggestions", async () => {
  const ui = await setup();
  await ui.mockInput.typeText("#re");
  await ui.settle();
  expect(ui.captureCharFrame()).toContain("#review");
  ui.mockInput.pressEscape();
  await ui.settle();
  expect(ui.captureCharFrame()).not.toContain("#review");
  expect(ui.prompt.plainText).toBe("#re");
  await ui.mockInput.typeText("v");
  // Accept immediately after typing, before the next polling interval.
  ui.mockInput.pressTab();
  await ui.settle();
  expect(ui.prompt.plainText).toBe("#review ");
  expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
  expect(ui.dialogs).toEqual([]);
  expect(ui.submissions()).toBe(0);
});

test("INLINE suggestions stay above a resized multiline prompt without covering its text or footer", async () => {
  const ui = await setup();
  ui.prompt.height = 5;
  ui.prompt.width = 54;
  await ui.mockInput.typeText("first line");
  ui.mockInput.pressEnter({ shift: true });
  await ui.mockInput.typeText("please #");
  await ui.settle();
  const rows = ui.captureCharFrame().split("\n");
  const menu = rows.findIndex((row) => row.includes("#review"));
  const prompt = rows.findIndex((row) => row.includes("first line"));
  expect(menu).toBeGreaterThanOrEqual(0);
  expect(menu).toBeLessThan(prompt);
  expect(rows.some((row) => row.includes("please #"))).toBe(true);
  expect(rows.some((row) => row.includes("Host footer"))).toBe(true);
  expect(ui.renderer.currentFocusedEditor).toBe(ui.prompt);
  expect(ui.dialogs).toEqual([]);
});
