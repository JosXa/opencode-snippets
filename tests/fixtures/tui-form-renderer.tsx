/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { type CliRenderer, Renderable } from "@opentui/core";
import { testRender, useRenderer } from "@opentui/solid";
import type { FieldDefinition } from "../../src/fields.js";
import { SnippetForm } from "../../src/tui-form.js";

function context(renderer: CliRenderer) {
  // Only the renderer and semantic colors are consumed by this component.
  return {
    renderer,
    theme: {
      text: { danger: "#ff0000" },
      contextual: {
        overlay: {
          background: { default: "#000000", action: { primary: { focused: "#222222" } } },
          text: {
            default: "#ffffff",
            subdued: "#aaaaaa",
            action: { primary: { focused: "#ffffff" } },
          },
        },
      },
    },
  } as Parameters<typeof SnippetForm>[0]["context"];
}

function field(index: number): FieldDefinition {
  return { name: `field${index}`, label: `Field ${index}`, type: "textarea", required: false };
}

test("modal at row 16 keeps the last field and OK visible through tabs and terminal resizing", async () => {
  const view = await testRender(
    () => {
      const plugin = context(useRenderer());
      return (
        <box position="absolute" top={16} width="100%">
          <SnippetForm
            context={plugin}
            name="scroll-form"
            fields={Array.from({ length: 16 }, (_, i) => field(i + 1))}
            values={{}}
            save={() => {}}
            cancel={() => {}}
          />
        </box>
      );
    },
    { width: 90, height: 58 },
  );
  const visible = (index: number) => {
    const item = view.renderer.root.findDescendantById(`snippet-field-${index}`);
    if (!(item instanceof Renderable)) throw new Error("Missing field renderable");
    expect(item.y).toBeGreaterThanOrEqual(16);
    expect(item.y + item.height).toBeLessThanOrEqual(view.renderer.height);
  };
  try {
    await view.flush();
    for (let i = 0; i < 15; i++) {
      view.mockInput.pressTab();
      await view.flush();
    }
    visible(15);
    expect(view.captureCharFrame()).toContain("Field 16");
    view.mockInput.pressTab();
    await view.flush();
    visible(16);
    expect(view.captureCharFrame()).toContain("OK");
    view.resize(38, 42);
    await view.flush();
    visible(16);
    expect(view.captureCharFrame()).toContain("OK");
    view.mockInput.pressTab({ shift: true });
    await view.flush();
    visible(15);
    expect(view.captureCharFrame()).toContain("Field 16");
    view.resize(100, 64);
    await view.flush();
    visible(15);
  } finally {
    view.renderer.destroy();
  }
});

test("Enter confirms from the editor after validation and Ctrl+J still inserts newlines", async () => {
  const answers: unknown[] = [];
  const view = await testRender(
    () => {
      const plugin = context(useRenderer());
      return (
        <SnippetForm
          context={plugin}
          name="required"
          fields={[{ ...field(1), required: true }]}
          values={{}}
          save={(values) => answers.push(values)}
          cancel={() => {}}
        />
      );
    },
    { width: 80, height: 30 },
  );
  try {
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Ctrl+J");
    view.mockInput.pressEnter();
    await view.flush();
    expect(answers).toHaveLength(0);
    expect(view.captureCharFrame()).toContain("is required");
    await view.mockInput.typeText("First");
    view.mockInput.pressKey("j", { ctrl: true });
    await view.mockInput.typeText("Second");
    for (let i = 0; i < 3; i++) view.mockInput.pressTab();
    view.mockInput.pressEnter();
    await view.flush();
    expect(view.captureCharFrame()).toContain("Ctrl+J newline");
    expect(answers).toHaveLength(0);
    view.mockInput.pressKey(" ");
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Ctrl+J");
    view.mockInput.pressTab();
    view.mockInput.pressEnter();
    await view.flush();
    expect(answers).toEqual([{ field1: "First\nSecond" }]);
    expect(view.captureCharFrame()).not.toContain("Ctrl+J");
  } finally {
    view.renderer.destroy();
  }
});

test("small forms retain their natural compact height", async () => {
  const view = await testRender(
    () => {
      const plugin = context(useRenderer());
      return (
        <box id="modal" position="absolute" top={16} width="100%">
          <SnippetForm
            context={plugin}
            name="small-form"
            fields={[field(1)]}
            values={{}}
            save={() => {}}
            cancel={() => {}}
          />
        </box>
      );
    },
    { width: 90, height: 58 },
  );
  try {
    await view.flush();
    const modal = view.renderer.root.findDescendantById("modal");
    if (!(modal instanceof Renderable)) throw new Error("Missing modal");
    expect(modal.height).toBeLessThan(20);
    expect(view.captureCharFrame()).toContain("OK");
  } finally {
    view.renderer.destroy();
  }
});
