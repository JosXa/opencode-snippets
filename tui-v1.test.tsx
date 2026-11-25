import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TuiDialogConfirmProps,
  TuiPromptProps,
  TuiPromptRef,
} from "@opencode-ai/plugin-v1/tui";
import { RGBA, type TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { type JSX, render } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import plugin from "./tui-v1.js";

const cleanups: Array<() => unknown> = [];
const environment = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const key of ["VISUAL", "EDITOR"] as const) {
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
  }
});

async function mount() {
  const root = await mkdtemp(join(tmpdir(), "snippets-v1-tui-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const screen = await createTestRenderer({ width: 80, height: 24 });
  cleanups.push(() => screen.renderer.destroy());
  const color = RGBA.fromInts(128, 128, 128, 255);
  const [stack, setStack] = createSignal<{ element: () => JSX.Element; onClose?: () => void }[]>(
    [],
  );
  let focus: { focus(): void; blur(): void; isDestroyed: boolean } | null = null;
  // Mirrors the OpenCode V1 host dialog stack (ui/dialog.tsx): replace() blurs the
  // focused prompt, clear() runs every onClose, and Escape pops the top dialog,
  // runs its onClose and refocuses the prompt.
  const dialog = {
    replace(element: () => JSX.Element, onClose?: () => void) {
      if (stack().length === 0) {
        focus = screen.renderer.currentFocusedRenderable;
        focus?.blur();
      }
      for (const item of stack()) item.onClose?.();
      setStack([{ element, onClose }]);
    },
    clear() {
      for (const item of stack()) item.onClose?.();
      setStack([]);
      refocus();
    },
    setSize() {},
    size: "medium",
    get depth() {
      return stack().length;
    },
    get open() {
      return stack().length > 0;
    },
  };
  const refocus = () =>
    setTimeout(() => {
      if (focus && !focus.isDestroyed) focus.focus();
    }, 1);
  screen.renderer.keyInput.prependListener("keypress", (event) => {
    if (event.name !== "escape" || stack().length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    stack().at(-1)?.onClose?.();
    setStack(stack().slice(0, -1));
    refocus();
  });
  // Mirrors the host DialogConfirm: it renders the title and message the user reads.
  const DialogConfirm = (props: TuiDialogConfirmProps) => (
    <box>
      <text>{props.title}</text>
      <text>{props.message}</text>
    </box>
  );
  // Mirrors the host Prompt: a disabled prompt swallows every key the user types.
  const Prompt = (props: TuiPromptProps) => {
    let area: TextareaRenderable | undefined;
    const ref: TuiPromptRef = {
      get focused() {
        return !!area?.focused;
      },
      get current() {
        return { input: area?.plainText ?? "", mode: "normal" as const, parts: [] };
      },
      set(prompt) {
        area?.setText(prompt.input);
        area?.gotoLineEnd();
      },
      reset() {
        area?.setText("");
      },
      blur() {
        area?.blur();
      },
      focus() {
        area?.focus();
      },
      submit() {},
    };
    return (
      <textarea
        ref={(value: TextareaRenderable) => {
          area = value;
          props.ref?.(ref);
        }}
        width={80}
        height={3}
        onKeyDown={(event: { preventDefault(): void }) => {
          if (props.disabled) event.preventDefault();
        }}
      />
    );
  };
  let slots: Record<string, (context: unknown, value: object) => JSX.Element> = {};
  let prompt: TuiPromptRef | undefined;
  await plugin.tui(
    {
      state: { path: { directory: root }, config: {} },
      client: { app: { skills: async () => ({ data: [] }) } },
      theme: {
        current: {
          background: color,
          border: color,
          backgroundMenu: color,
          primary: color,
          text: color,
          textMuted: color,
        },
      },
      renderer: screen.renderer,
      slots: {
        register: (value: { slots: typeof slots }) => {
          slots = value.slots;
          return "snippets";
        },
      },
      ui: { Prompt, DialogConfirm, Slot: () => null, toast() {}, dialog },
    } as never,
    undefined,
    {} as never,
  );
  await render(
    () => (
      <box paddingTop={12}>
        {slots.home_prompt?.(
          {},
          {
            ref: (value: TuiPromptRef | undefined) => {
              prompt = value;
            },
          },
        )}
        <Show when={stack().at(-1)}>{(item) => item().element()}</Show>
      </box>
    ),
    screen.renderer,
  );
  prompt?.focus();
  const settle = async () => {
    await Bun.sleep(300);
    await screen.renderOnce();
  };
  await settle();
  return { ...screen, settle, input: () => prompt?.current.input };
}

test("dismissing the create-snippet confirmation with Escape returns the prompt to normal typing", async () => {
  process.env.VISUAL = "must-not-run-editor";
  const ui = await mount();

  // The user types a hashtag for a snippet that does not exist yet and accepts the
  // "Add new Snippet" row, which asks for confirmation before creating a draft.
  await ui.mockInput.typeText("#zqxv-draft");
  await ui.settle();
  expect(ui.captureCharFrame()).toContain("Add new Snippet: #zqxv-draft");
  ui.mockInput.pressEnter();
  await ui.settle();
  expect(ui.captureCharFrame()).toContain("Create snippet #zqxv-draft?");

  // The user changes their mind and dismisses the confirmation with Escape, the
  // host's standard way to close a dialog.
  ui.mockInput.pressEscape();
  await ui.settle();
  expect(ui.captureCharFrame()).not.toContain("Create snippet #zqxv-draft?");

  // The prompt accepts typing again as it did before the dialog opened.
  await ui.mockInput.typeText("x");
  await ui.settle();
  expect(ui.input()).toBe("#zqxv-draftx");

  // The completion menu follows the edited hashtag again.
  expect(ui.captureCharFrame()).toContain("Add new Snippet: #zqxv-draftx");
});
