/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui";
import type {
  BoxRenderable,
  EditBufferRenderable,
  KeyEvent,
  Renderable,
  ScrollBoxRenderable,
} from "@opentui/core";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createSnippet, listSnippets, loadSnippets } from "./src/loader.js";
import {
  buildTuiCompletionOptions,
  findHashtagTriggerAtCursor,
  isAutocompleteNavDownKey,
  isAutocompleteNavUpKey,
  normalizeUnmatchedTrigger,
  stepSelection,
  type TuiCompletionOption,
} from "./src/tui-trigger.js";
import { executeV2SnippetCommand } from "./src/v2-command.js";

function promptTrigger(editor: EditBufferRenderable) {
  // Native offsets count display columns, not UTF-16 units. Let OpenTUI decode
  // the prefix so wide glyphs, combining marks and newlines use its own rules.
  const prefix = editor.getTextRange(0, editor.cursorOffset);
  return findHashtagTriggerAtCursor(prefix, prefix.length);
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

    const reload = async () => {
      snippets = await loadSnippets(directory, globalDirectory);
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

        const activePrompt = () => {
          const focused = context.renderer.currentFocusedEditor;
          // A dialog can leave the prompt focused (e.g. confirmation dialogs).
          // Respect the host input mode as well as the focused editor's identity.
          if (footer.mode !== "normal" || context.keymap.mode.current() !== "base") return;
          if (isHostPrompt(focused)) return focused;
        };

        context.keymap.layer(() => ({
          mode: "global",
          commands: [
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
          const match = promptTrigger(focused);
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

        const insert = (
          choice: TuiCompletionOption["value"],
          confirmedPrompt?: EditBufferRenderable,
        ) => {
          const focused = confirmedPrompt ?? activePrompt();
          if (!isHostPrompt(focused) || footer.mode !== "normal") return;
          const match = promptTrigger(focused);
          if (!match) return;
          const cursor = focused.cursorOffset;
          const tag = choice.kind === "skill" ? `#skill(${choice.name})` : `#${choice.name}`;
          // Locate the ASCII '#' boundary in native display coordinates. Do not
          // measure Unicode independently of the editor's configured width rules.
          let start = 0;
          let end = cursor;
          while (start < end) {
            const middle = Math.floor((start + end) / 2);
            if (focused.getTextRange(0, middle).length < match.start) start = middle + 1;
            else end = middle;
          }
          // Replacing the whole buffer clears host extmarks and their payload IDs.
          // Only edit the hashtag; native edits relocate unrelated marks for us.
          focused.setSelection(start, cursor);
          focused.deleteSelection();
          focused.insertText(`${tag} `);
          focused.focus();
          setDismissed(undefined);
          closeMenu();
        };

        const createUnmatched = async () => {
          const focused = activePrompt();
          if (!focused) return;
          const match = promptTrigger(focused);
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
          if (dialogOpen()) return;
          // Read the editor before dispatch too: fast typing must not accept an
          // option from the previous polling tick or leak Enter to host submission.
          sync();
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
        // Native slash autocomplete uses the overlay context, including its
        // focused action foreground. Neither agent colors nor custom contrast
        // calculations belong here; read reactively so an open menu follows theme changes.
        const palette = () => context.theme?.contextual?.overlay;
        const primary = () => palette()?.background.action.primary.focused;
        const text = () => palette()?.text.default;
        const muted = () => palette()?.text.subdued;
        const menuBackground = () => palette()?.background.default;
        const selectedText = () => palette()?.text.action.primary.focused;
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
                border={["left", "right"]}
                borderColor={palette()?.border.default}
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
                          normalizeUnmatchedTrigger(trigger()?.query ?? "") ? primary() : undefined
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
                        backgroundColor={selected() === index() ? primary() : undefined}
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
