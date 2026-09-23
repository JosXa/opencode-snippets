/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type {
  BoxRenderable,
  EditBufferRenderable,
  KeyEvent,
  Renderable,
  ScrollBoxRenderable,
} from "@opentui/core";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { type FieldValues, getSnippetForm } from "./src/fields.js";
import { serializeInvocation } from "./src/invocation.js";
import { createSnippet, listSnippets, loadSnippets } from "./src/loader.js";
import { SnippetForm } from "./src/tui-form.js";
import {
  exactSnippetTrigger,
  findEditableInvocation,
  formAwareTrigger,
  replaceReferenceRange,
} from "./src/tui-form-state.js";
import {
  buildTuiCompletionOptions,
  type findHashtagTriggerAtCursor,
  isAutocompleteNavDownKey,
  isAutocompleteNavUpKey,
  normalizeUnmatchedTrigger,
  stepSelection,
  type TuiCompletionOption,
} from "./src/tui-trigger.js";
import type { SnippetRegistry } from "./src/types.js";
import { executeV2SnippetCommand } from "./src/v2-command.js";

function promptTrigger(editor: EditBufferRenderable, snippets: SnippetRegistry) {
  // Native offsets count display columns, not UTF-16 units. Let OpenTUI decode
  // the prefix so wide glyphs, combining marks and newlines use its own rules.
  const prefix = editor.getTextRange(0, editor.cursorOffset);
  return formAwareTrigger(editor.plainText, prefix.length, snippets);
}

function isHostPrompt(
  editor: EditBufferRenderable | null | undefined,
): editor is EditBufferRenderable {
  if (!editor || editor.isDestroyed) return false;
  const traits = editor.traits;
  // These identity fields are host extensions to OpenTUI's core EditorTraits.
  // Do not gate on suspend: OC2's keymap adapter sets it on every managed
  // textarea to take over built-in bindings, including the editable prompt.
  return (
    "owner" in traits && traits.owner === "opencode" && "role" in traits && traits.role === "prompt"
  );
}

const plugin = Plugin.define({
  id: "opencode-snippets:autocomplete",
  async setup(context) {
    const directory = context.location?.directory ?? process.cwd();
    const globalDirectory =
      typeof context.options.globalDirectory === "string"
        ? context.options.globalDirectory
        : undefined;
    const loadSkills = async () =>
      (await context.client.skill.list({ location: { directory } })).data.map((skill) => ({
        name: skill.id,
        description: skill.description,
      }));
    let snippets = await loadSnippets(directory, globalDirectory);
    let skills = await loadSkills();
    const forms = new Map<string, boolean>();
    const hasForm = (name: string) => {
      const cached = forms.get(name);
      if (cached !== undefined) return cached;
      try {
        const result = getSnippetForm(name, snippets).fields.length > 0;
        forms.set(name, result);
        return result;
      } catch {
        // Invalid definitions report their error when invoked, not while browsing.
        forms.set(name, false);
        return false;
      }
    };

    const reload = async () => {
      snippets = await loadSnippets(directory, globalDirectory);
      forms.clear();
      skills = await loadSkills();
    };

    const runCommand = async (input: string) => {
      const output = await executeV2SnippetCommand(input, snippets, directory, globalDirectory);
      await reload();
      if (output) await context.ui.dialog.alert({ title: "Snippets", message: output });
    };

    const dispose = context.ui.slot({
      append: "prompt.footer",
      render: (footer) => {
        const [dismissed, setDismissed] = createSignal<string>();
        const [dialogOpen, setDialogOpen] = createSignal(false);
        const [options, setOptions] = createSignal<TuiCompletionOption[]>([]);
        const [trigger, setTrigger] = createSignal<ReturnType<typeof findHashtagTriggerAtCursor>>();
        const [selected, setSelected] = createSignal(0);
        const [position, setPosition] = createSignal({ top: 0, left: 0, width: 1 });
        let anchor: BoxRenderable | undefined;
        let scroll: ScrollBoxRenderable | undefined;
        let ignoreMouseUntil = 0;
        let lastMouse = "";
        let lastKey = "";
        let prompt: EditBufferRenderable | undefined;
        let handoff = false;

        const activePrompt = () => {
          const focused = context.renderer.currentFocusedEditor;
          // A dialog can leave the prompt focused (e.g. confirmation dialogs).
          // Respect the host input mode as well as the focused editor's identity.
          if (footer.mode !== "normal" || context.keymap.mode.current() !== "base") return;
          if (isHostPrompt(focused)) {
            prompt = focused;
            return focused;
          }
        };

        context.keymap.layer(() => ({
          mode: "global",
          bindings: ["snippets.edit-fields"],
          commands: [
            {
              id: "snippets.edit-fields",
              title: "Edit snippet fields",
              description: "Edit the snippet invocation under the composer cursor",
              palette: true,
              slash: { name: "snippets:edit" },
              bind: "ctrl+g",
              run: (_input, event) => {
                if (event && !activePrompt()) return false;
                editFields();
              },
            },
            {
              id: "snippets.manage",
              title: "Manage snippets",
              description: "List, add, or delete snippets",
              palette: true,
              slash: { name: "snippets", arguments: true },
              run: (input) => runCommand(`/snippets ${input ?? ""}`),
            },
            {
              id: "snippets.reload",
              title: "Reload snippets",
              palette: true,
              slash: { name: "snippets:reload" },
              run: () => runCommand("/snippets:reload"),
            },
          ],
        }));

        const sync = () => {
          if (dialogOpen()) {
            setTrigger(undefined);
            return;
          }
          const focused = activePrompt();
          if (!focused) {
            setTrigger(undefined);
            return;
          }
          const cursor = focused.cursorOffset;
          const match = promptTrigger(focused, snippets);
          if (!match || dismissed() === match.token) {
            setTrigger(undefined);
            if (!match) setDismissed(undefined);
            lastKey = "";
            return;
          }
          const next = buildTuiCompletionOptions(
            listSnippets(snippets),
            skills.values(),
            match.query,
          );
          const key = `${focused.plainText}\n${cursor}\n${next.map((item) => item.title).join("\n")}`;
          if (key !== lastKey) {
            lastKey = key;
            setOptions(next);
            setSelected(0);
            ignoreMouseUntil = Date.now() + 150;
            scroll?.scrollTo(0);
            if (dismissed() && dismissed() !== match.token) setDismissed(undefined);
          }
          setTrigger(match);
          if (anchor) {
            // Main overlays the entire Prompt wrapper, not its padded textarea.
            // OC2's footer and editor share that wrapper; use their common ancestor
            // so host padding, multiline growth and other footer slots remain intact.
            const ancestors = new Set<Renderable>();
            for (let parent = anchor.parent; parent; parent = parent.parent) ancestors.add(parent);
            let container: Renderable = focused;
            while (container.parent && !ancestors.has(container)) {
              container = container.parent;
            }
            setPosition({
              top: container.y - anchor.y - Math.min(10, Math.max(1, next.length)),
              left: container.x - anchor.x,
              width: container.width,
            });
          }
        };

        const closeMenu = () => {
          setTrigger(undefined);
        };

        const report = (error: unknown) =>
          context.ui.toast.show({
            title: "Snippet fields",
            message: error instanceof Error ? error.message : String(error),
            variant: "error",
          });

        const openForm = (
          focused: EditBufferRenderable,
          name: string,
          range: { start: number; end: number },
          supplied: FieldValues = {},
          suffix = "",
        ) => {
          try {
            const form = getSnippetForm(name, snippets, supplied);
            if (!form.fields.length) return false;
            // Leave the original range intact until Save. Escape, outside clicks,
            // and host dialog dismissal all preserve the exact prior answers.
            const original = focused.plainText;
            setDialogOpen(true);
            closeMenu();
            context.ui.dialog.set({ size: "large", centered: true });
            context.ui.dialog.show(
              () => (
                <SnippetForm
                  context={context}
                  name={name}
                  fields={form.fields}
                  values={form.values}
                  cancel={() => context.ui.dialog.clear()}
                  save={(values) => {
                    if (!isHostPrompt(focused)) return context.ui.dialog.clear();
                    if (focused.plainText !== original) {
                      report(
                        new Error(
                          "The composer changed while the form was open. Cancel and reopen the fields.",
                        ),
                      );
                      return;
                    }
                    replaceReferenceRange(
                      focused,
                      range,
                      `${serializeInvocation(name, values)}${suffix}`,
                    );
                    context.ui.dialog.clear();
                  }}
                />
              ),
              () => {
                setDialogOpen(false);
                // Closing a dialog can restore focus during the confirming key's
                // dispatch. Do not interpret that same event as a composer key.
                handoff = true;
                queueMicrotask(() => {
                  handoff = false;
                });
                setDismissed(original.slice(range.start, range.end));
                if (isHostPrompt(focused)) focused.focus();
                queueMicrotask(sync);
              },
            );
            return true;
          } catch (error) {
            report(error);
            return true;
          }
        };

        const editFields = () => {
          if (dialogOpen()) return;
          // Palette actions run while the palette is handing focus back. Keep
          // the last verified host prompt rather than using the palette input.
          const focused = activePrompt() ?? prompt;
          if (!isHostPrompt(focused) || footer.mode !== "normal") return;
          try {
            const cursor = focused.getTextRange(0, focused.cursorOffset).length;
            const invocation = findEditableInvocation(focused.plainText, cursor, snippets);
            if (invocation && openForm(focused, invocation.name, invocation, invocation.values))
              return;
            context.ui.toast.show({
              message: "Place the cursor in a snippet reference with fields, then press Ctrl+G.",
              variant: "info",
            });
          } catch (error) {
            report(error);
          }
        };

        const insert = (
          choice: TuiCompletionOption["value"],
          confirmedPrompt?: EditBufferRenderable,
        ) => {
          const focused = confirmedPrompt ?? activePrompt();
          if (!isHostPrompt(focused) || footer.mode !== "normal") return;
          const match = promptTrigger(focused, snippets);
          if (!match) return;
          const tag = choice.kind === "skill" ? `#skill(${choice.name})` : `#${choice.name}`;
          if (choice.kind === "snippet" && openForm(focused, choice.name, match, {}, " ")) return;
          // Replacing the whole buffer clears host extmarks and their payload IDs.
          // Only edit the hashtag; native edits relocate unrelated marks for us.
          replaceReferenceRange(focused, match, `${tag} `);
          focused.focus();
          setDismissed(undefined);
          closeMenu();
        };

        const createUnmatched = async () => {
          const focused = activePrompt();
          if (!focused) return;
          const match = promptTrigger(focused, snippets);
          const name = normalizeUnmatchedTrigger(match?.query ?? "");
          if (!name) return;
          setDialogOpen(true);
          closeMenu();
          try {
            const confirmed = await context.ui.dialog.confirm({
              title: `Create #${name}?`,
              message: "No matching snippet or skill exists. Create an empty project snippet?",
              label: { confirm: "Create", cancel: "Cancel" },
            });
            if (!confirmed) return;
            await createSnippet(name, "", {}, directory);
            await reload();
            insert({ kind: "snippet", name }, focused);
          } finally {
            setDialogOpen(false);
            if (!focused.isDestroyed) focused.focus();
            queueMicrotask(sync);
          }
        };

        const keypress = (event: KeyEvent) => {
          if (dialogOpen() || handoff) return;
          // Read the editor before dispatch too: fast typing must not accept an
          // option from the previous polling tick or leak Enter to host submission.
          sync();
          const focused = activePrompt();
          // Space accepts exact registry names/aliases only, even if the menu
          // was dismissed. Partial names must stay ordinary composer text.
          if (focused && event.name === "space" && !event.ctrl && !event.meta) {
            const match = exactSnippetTrigger(
              focused.plainText,
              focused.getTextRange(0, focused.cursorOffset).length,
              snippets,
            );
            if (match && openForm(focused, match.query, match, {}, " ")) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
          if (trigger()) {
            const name = event.name?.toLowerCase();
            const up = isAutocompleteNavUpKey(event);
            const down = isAutocompleteNavDownKey(event);
            if ((up || down) && options().length) {
              ignoreMouseUntil = Date.now() + 150;
              setSelected(stepSelection(selected(), options().length, up ? -1 : 1));
              scroll?.scrollChildIntoView(`snippet-option-${selected()}`);
            } else if (name === "escape") {
              setDismissed(trigger()?.token);
              closeMenu();
            } else if (["tab", "return", "enter", "linefeed"].includes(name)) {
              const item = options()[selected()];
              if (item) insert(item.value);
              else if (normalizeUnmatchedTrigger(trigger()?.query ?? "")) void createUnmatched();
              else return;
            } else {
              queueMicrotask(sync);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          queueMicrotask(sync);
        };

        const timer = setInterval(sync, 25);
        onMount(() => context.renderer.keyInput.prependListener("keypress", keypress));
        onCleanup(() => {
          clearInterval(timer);
          context.renderer.keyInput.removeListener("keypress", keypress);
          closeMenu();
        });

        const height = () => Math.min(10, Math.max(1, options().length));
        // Match native autocomplete's raised background and
        // focused action foreground. Neither agent colors nor custom contrast
        // calculations belong here; read reactively so an open menu follows theme changes.
        const palette = () => context.theme;
        const primary = () => palette().background.action.primary.focused;
        const text = () => palette().text.base;
        const muted = () => palette().text.muted;
        const menuBackground = () => palette().background.raised.high;
        const selectedText = () => palette().text.action.primary.focused;
        return (
          <box ref={anchor} width={0} height={0}>
            <Show when={trigger()}>
              <box
                position="absolute"
                top={position().top}
                left={position().left}
                width={position().width}
                height={height()}
                zIndex={100}
                backgroundColor={menuBackground()}
                border={["left", "right"]}
                borderColor={palette().border.base}
                customBorderChars={{
                  topLeft: "",
                  bottomLeft: "",
                  vertical: "┃",
                  topRight: "",
                  bottomRight: "",
                  horizontal: " ",
                  bottomT: "",
                  topT: "",
                  cross: "",
                  leftT: "",
                  rightT: "",
                }}
              >
                <scrollbox
                  ref={scroll}
                  height={height()}
                  backgroundColor={menuBackground()}
                  scrollbarOptions={{ visible: false }}
                >
                  <For
                    each={options()}
                    fallback={
                      // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI rows handle mouse selection; the prompt owns keyboard input.
                      <box
                        paddingLeft={1}
                        backgroundColor={
                          normalizeUnmatchedTrigger(trigger()?.query ?? "")
                            ? primary()
                            : menuBackground()
                        }
                        onMouseUp={() => {
                          if (normalizeUnmatchedTrigger(trigger()?.query ?? ""))
                            void createUnmatched();
                        }}
                      >
                        <text
                          fg={
                            normalizeUnmatchedTrigger(trigger()?.query ?? "")
                              ? selectedText()
                              : muted()
                          }
                        >
                          {normalizeUnmatchedTrigger(trigger()?.query ?? "")
                            ? `Add new Snippet: #${normalizeUnmatchedTrigger(trigger()?.query ?? "")}`
                            : "No snippets or skills found"}
                        </text>
                      </box>
                    }
                  >
                    {(item, index) => (
                      // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI rows handle mouse selection; the prompt owns keyboard input.
                      <box
                        id={`snippet-option-${index()}`}
                        paddingLeft={1}
                        paddingRight={1}
                        flexDirection="row"
                        backgroundColor={selected() === index() ? primary() : menuBackground()}
                        onMouseMove={(event) => {
                          const point = `${event.x},${event.y}`;
                          if (Date.now() < ignoreMouseUntil || point === lastMouse) return;
                          lastMouse = point;
                          setSelected(index());
                        }}
                        onMouseUp={() => insert(item.value)}
                      >
                        <text
                          fg={selected() === index() ? selectedText() : text()}
                          flexShrink={0}
                          wrapMode="none"
                        >
                          {item.title}
                          {item.value.kind === "snippet" && hasForm(item.value.name) ? " ☷" : ""}
                        </text>
                        <text
                          fg={selected() === index() ? selectedText() : muted()}
                          wrapMode="none"
                        >{`  ${item.description}`}</text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </box>
            </Show>
          </box>
        );
      },
    });

    return dispose;
  },
});

export default plugin;
