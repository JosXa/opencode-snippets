/** @jsxImportSource @opentui/solid */
import { join } from "node:path";
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptInfo,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui";
import { RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Index,
  onCleanup,
  Show,
} from "solid-js";
import { CONFIG } from "./src/constants.js";
import { ensureSnippetsDir, listSnippets, loadSnippets } from "./src/loader.js";
import {
  filterSnippets,
  highlightMatches,
  matchedAliases,
  snippetDescription,
} from "./src/tui-search.js";
import {
  findTrailingHashtagTrigger,
  insertSnippetTag,
  insertSnippetTrigger,
  preferredSnippetTag,
} from "./src/tui-trigger.js";
import type { SnippetInfo } from "./src/types.js";

const id = "opencode-snippets:autocomplete";
const PROMPT_SYNC_MS = 50;
const MENU_MAX_HEIGHT = 10;
const MOUSE_HOVER_SUPPRESS_MS = 150;
const HOME_PLACEHOLDERS = {
  normal: [
    "Fix a TODO in the codebase",
    "What is the tech stack of this project?",
    "Fix broken tests",
  ],
  shell: ["ls -la", "git status", "pwd"],
};
const EMPTY_SNIPPET = `---
description: ""
---


`;
const INLINE_BORDER = {
  border: ["left", "right"] as Array<"left" | "right">,
  customBorderChars: {
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
  },
};

function sortSnippets(snippets: SnippetInfo[]): SnippetInfo[] {
  return [...snippets].sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === "project") return -1;
      return 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function selectedText(theme: TuiPluginApi["theme"]["current"]): RGBA {
  if (theme.background.a !== 0) return theme.background;

  const { r, g, b } = theme.primary;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255);
}

function renderHighlighted(text: string, query: string, fg: RGBA) {
  return highlightMatches(text, query).map((part) => {
    if (!part.match) return part.text;
    return (
      <span
        style={{
          fg,
          underline: true,
        }}
      >
        {part.text}
      </span>
    );
  });
}

function normalizeSnippetName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureSnippetDraft(name: string, projectDir?: string): Promise<string> {
  const dir = await ensureSnippetsDir(projectDir);
  const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);

  if (!(await Bun.file(filePath).exists())) {
    await Bun.write(filePath, EMPTY_SNIPPET);
  }

  return filePath;
}

async function openExternalEditor(api: TuiPluginApi, filePath: string): Promise<boolean> {
  const editor = Bun.env.VISUAL || Bun.env.EDITOR;
  if (!editor) return false;

  api.renderer.suspend();
  api.renderer.currentRenderBuffer.clear();

  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", `${editor} "${filePath.replace(/"/g, '\\"')}"`]
        : [...editor.split(" "), filePath];
    const proc = Bun.spawn(cmd, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
    return true;
  } finally {
    api.renderer.currentRenderBuffer.clear();
    api.renderer.resume();
    api.renderer.requestRender();
  }
}

function toPromptInfo(prompt: TuiPromptRef, input: string): TuiPromptInfo {
  const current = prompt.current;
  return {
    input,
    mode: current.mode,
    parts: [...current.parts],
  };
}

function setPromptInput(prompt: TuiPromptRef, input: string): void {
  prompt.set(toPromptInfo(prompt, input));
}

async function getSnippets(api: TuiPluginApi): Promise<SnippetInfo[]> {
  const registry = await loadSnippets(api.state.path.directory);
  return sortSnippets(listSnippets(registry));
}

function PromptWithSnippetAutocomplete(props: {
  api: TuiPluginApi;
  bindPrompt: (ref: TuiPromptRef | undefined) => void;
  hostRef?: (ref: TuiPromptRef | undefined) => void;
  sessionID?: string;
  workspaceID?: string;
  visible?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  placeholders?: {
    normal?: string[];
    shell?: string[];
  };
  right?: unknown;
}) {
  const [prompt, setPrompt] = createSignal<TuiPromptRef>();
  const [dismissed, setDismissed] = createSignal<string>();
  const [selected, setSelected] = createSignal(0);
  const [inputMode, setInputMode] = createSignal<"keyboard" | "mouse">("keyboard");
  const [ignoreMouseUntil, setIgnoreMouseUntil] = createSignal(0);
  const [input, setInput] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [snippets, { refetch: refetchSnippets }] = createResource(
    () => props.api.state.path.directory,
    () => getSnippets(props.api),
    {
      initialValue: [] as SnippetInfo[],
    },
  );

  const bind = (ref: TuiPromptRef | undefined) => {
    setPrompt(ref);
    props.bindPrompt(ref);
    props.hostRef?.(ref);
  };

  const lockKeyboardSelection = () => {
    setInputMode("keyboard");
    setIgnoreMouseUntil(Date.now() + MOUSE_HOVER_SUPPRESS_MS);
  };

  const allowMouseHover = () => Date.now() >= ignoreMouseUntil();

  const syncPromptInput = (ref: TuiPromptRef, nextInput: string) => {
    setPromptInput(ref, nextInput);
    setInput(nextInput);
  };

  createEffect(() => {
    const ref = prompt();
    if (!ref) {
      setInput("");
      return;
    }

    // The prompt ref exposes current state but not an onInput hook, so mirror it.
    const sync = () => {
      const next = ref.current.input;
      setInput((prev) => (prev === next ? prev : next));
    };

    sync();
    const timer = setInterval(sync, PROMPT_SYNC_MS);
    onCleanup(() => clearInterval(timer));
  });

  const match = createMemo(() => {
    if (props.disabled || props.visible === false) return;
    return findTrailingHashtagTrigger(input());
  });

  const options = createMemo(() => {
    const next = match();
    if (!next) return [];
    return filterSnippets(snippets(), next.query.trim());
  });
  const query = createMemo(() => match()?.query.trim() || "");
  const draftName = createMemo(() => normalizeSnippetName(query()));

  const visible = createMemo(() => {
    const next = match();
    if (!next) return false;
    return dismissed() !== next.token;
  });

  const canCreate = createMemo(() => {
    if (snippets.loading) return false;
    if (options().length > 0) return false;
    return !!query() && !!draftName();
  });

  const optionKey = createMemo(() =>
    options()
      .map((item) => item.name)
      .join("\n"),
  );
  const menuHeight = createMemo(() =>
    Math.min(MENU_MAX_HEIGHT, Math.max(1, options().length || 1)),
  );
  const activeRowId = createMemo(() => {
    if (options().length > 0) return options()[selected()]?.name;
    if (canCreate()) return "create-snippet";
    return undefined;
  });
  let scroll: ScrollBoxRenderable | undefined;

  createEffect((prev?: string) => {
    const next = match();
    if (!next) {
      if (dismissed()) setDismissed(undefined);
      return "";
    }

    const key = `${next.token}\n${optionKey()}`;
    if (key !== prev) {
      setSelected(0);
      // Keep filtered keyboard navigation from getting stolen by synthetic mouse events.
      lockKeyboardSelection();
      setTimeout(() => {
        scroll?.scrollTo(0);
      }, 0);
    }
    return key;
  });

  createEffect(() => {
    const row = activeRowId();
    if (!visible() || !row) return;

    setTimeout(() => {
      scroll?.scrollChildIntoView(row);
    }, 0);
  });

  const choose = (index = selected()) => {
    const item = options()[index];
    if (!item) return;
    chooseItem(item);
  };

  const chooseItem = (item: SnippetInfo) => {
    const ref = prompt();
    if (!ref) return;

    const nextInput = insertSnippetTag(
      ref.current.input,
      preferredSnippetTag(ref.current.input, item),
    );
    syncPromptInput(ref, nextInput);
    ref.focus();

    setDismissed(undefined);
  };

  createEffect(() => {
    const ref = prompt();
    if (!ref) return;

    let dispose: (() => void) | undefined;
    const timer = setTimeout(() => {
      dispose = props.api.command.register(() => [
        {
          title: "Accept snippet autocomplete",
          value: "snippets.accept",
          keybind: "input_submit",
          category: "Prompt",
          hidden: true,
          enabled: ref.focused,
          onSelect() {
            const current = findTrailingHashtagTrigger(ref.current.input);
            if (!current || dismissed() === current.token) {
              ref.submit();
              return;
            }

            // Prefer the rendered dropdown state so Enter follows what the user can see.
            if (visible()) {
              const rendered = options();
              if (rendered.length > 0) {
                const index = Math.min(selected(), rendered.length - 1);
                chooseItem(rendered[index] ?? rendered[0]);
                return;
              }

              if (canCreate()) {
                void createSnippetDraft();
                return;
              }
            }

            if (snippets.loading) {
              return;
            }

            const query = current.query.trim();
            const live = filterSnippets(snippets(), query);
            if (live.length > 0) {
              const index = Math.min(selected(), live.length - 1);
              chooseItem(live[index] ?? live[0]);
              return;
            }

            if (normalizeSnippetName(query)) {
              void createSnippetDraft();
              return;
            }

            ref.submit();
          },
        },
      ]);
    }, 0);

    onCleanup(() => {
      clearTimeout(timer);
      dispose?.();
    });
  });

  const createSnippetDraft = async () => {
    const ref = prompt();
    const name = draftName();
    if (!ref || !name || creating()) return;
    const current = findTrailingHashtagTrigger(ref.current.input);
    const nextInput = current ? `${ref.current.input.slice(0, current.start)}#${name}` : `#${name}`;

    const editor = Bun.env.VISUAL || Bun.env.EDITOR;
    if (!editor) {
      props.api.ui.toast({
        variant: "warning",
        message: "Set VISUAL or EDITOR to create snippets from the TUI.",
      });
      return;
    }

    setCreating(true);

    try {
      syncPromptInput(ref, nextInput);

      const filePath = await ensureSnippetDraft(name);
      const opened = await openExternalEditor(props.api, filePath);
      if (!opened) {
        syncPromptInput(ref, nextInput);
        return;
      }

      await refetchSnippets();
      syncPromptInput(ref, nextInput);
      setDismissed(undefined);
    } catch (error) {
      props.api.ui.toast({
        variant: "error",
        message: `Failed to create snippet: ${error instanceof Error ? error.message : String(error)}`,
      });
      syncPromptInput(ref, nextInput);
    } finally {
      setCreating(false);
      ref.focus();
    }
  };

  useKeyboard((evt) => {
    if (!visible()) return;

    const name = evt.name?.toLowerCase();
    const total = options().length;
    const actionable = total > 0 || canCreate();
    const isNavUp = name === "up";
    const isNavDown = name === "down";

    if (isNavUp) {
      if (!actionable) return;
      lockKeyboardSelection();
      if (total > 0) {
        setSelected((selected() - 1 + total) % total);
      }
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (isNavDown) {
      if (!actionable) return;
      lockKeyboardSelection();
      if (total > 0) {
        setSelected((selected() + 1) % total);
      }
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (name === "escape") {
      setDismissed(match()?.token);
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (name === "tab") {
      if (!actionable) return;
      if (total > 0) {
        choose(selected());
      } else if (canCreate()) {
        void createSnippetDraft();
      }
      evt.preventDefault();
      evt.stopPropagation();
    }
  });

  const emptyLabel = createMemo(() => {
    if (snippets.loading && snippets().length === 0) return "Loading snippets...";
    if (snippets().length === 0) return "No snippets found";
    return "No matching snippets";
  });

  const addSnippetLabel = createMemo(() => {
    if (creating()) return "Creating snippet...";
    return `Add new Snippet  #${draftName()}`;
  });

  const selectedFg = createMemo(() => selectedText(props.api.theme.current));

  return (
    <box>
      <Show when={visible()}>
        <box
          position="absolute"
          top={-menuHeight()}
          left={0}
          right={0}
          zIndex={100}
          borderColor={props.api.theme.current.border}
          {...INLINE_BORDER}
        >
          <scrollbox
            ref={(r: ScrollBoxRenderable) => {
              scroll = r;
            }}
            backgroundColor={props.api.theme.current.backgroundMenu}
            height={menuHeight()}
            scrollbarOptions={{ visible: false }}
          >
            <Index
              each={options()}
              fallback={
                <Show
                  when={canCreate()}
                  fallback={
                    <box paddingLeft={1} paddingRight={1}>
                      <text fg={props.api.theme.current.textMuted}>{emptyLabel()}</text>
                    </box>
                  }
                >
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI rows intentionally handle mouse selection. */}
                  <box
                    id="create-snippet"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={props.api.theme.current.primary}
                    onMouseMove={() => {
                      if (!allowMouseHover()) return;
                      setInputMode("mouse");
                    }}
                    onMouseDown={() => {
                      setInputMode("mouse");
                    }}
                    onMouseUp={() => {
                      void createSnippetDraft();
                    }}
                  >
                    <text fg={selectedFg()}>{addSnippetLabel()}</text>
                  </box>
                </Show>
              }
            >
              {(option, index) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI rows intentionally handle mouse selection.
                // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard navigation is handled by the prompt-level key handler above.
                <box
                  id={option().name}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    index === selected() ? props.api.theme.current.primary : undefined
                  }
                  flexDirection="row"
                  onMouseMove={() => {
                    if (!allowMouseHover()) return;
                    setInputMode("mouse");
                  }}
                  onMouseOver={() => {
                    if (inputMode() !== "mouse" || !allowMouseHover()) return;
                    setSelected(index);
                  }}
                  onMouseDown={() => {
                    setInputMode("mouse");
                    setSelected(index);
                  }}
                  onMouseUp={() => choose(index)}
                >
                  <text
                    fg={index === selected() ? selectedFg() : props.api.theme.current.text}
                    flexShrink={0}
                    wrapMode="none"
                  >
                    {renderHighlighted(
                      `#${option().name}`,
                      query(),
                      index === selected() ? selectedFg() : props.api.theme.current.text,
                    )}
                  </text>
                  <Show when={matchedAliases(option(), query()).length > 0}>
                    <text
                      fg={index === selected() ? selectedFg() : props.api.theme.current.textMuted}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {renderHighlighted(
                        `  ${matchedAliases(option(), query()).length === 1 ? "alias" : "aliases"}: ${matchedAliases(option(), query()).join(", ")}`,
                        query(),
                        index === selected() ? selectedFg() : props.api.theme.current.textMuted,
                      )}
                    </text>
                  </Show>
                  <Show when={snippetDescription(option())}>
                    <text
                      fg={index === selected() ? selectedFg() : props.api.theme.current.textMuted}
                      wrapMode="none"
                    >
                      {renderHighlighted(
                        `  ${snippetDescription(option())}`,
                        query(),
                        index === selected() ? selectedFg() : props.api.theme.current.textMuted,
                      )}
                    </text>
                  </Show>
                </box>
              )}
            </Index>
          </scrollbox>
        </box>
      </Show>
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        workspaceID={props.workspaceID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        placeholders={props.placeholders}
        ref={bind}
        right={props.right}
      />
    </box>
  );
}

const tui: TuiPlugin = async (api) => {
  let currentPrompt: TuiPromptRef | undefined;

  const bindPrompt = (ref: TuiPromptRef | undefined) => {
    currentPrompt = ref;
  };

  api.command.register(() => [
    {
      title: "Insert snippet",
      value: "snippets.insert",
      description: "Insert a # trigger into the current prompt",
      category: "Prompt",
      hidden: !currentPrompt,
      onSelect() {
        if (!currentPrompt) return;

        setPromptInput(currentPrompt, insertSnippetTrigger(currentPrompt.current.input));
        currentPrompt.focus();
      },
    },
  ]);

  api.slots.register({
    order: 100,
    slots: {
      home_prompt(_ctx, value) {
        return (
          <PromptWithSnippetAutocomplete
            api={api}
            bindPrompt={bindPrompt}
            hostRef={value.ref}
            workspaceID={value.workspace_id}
            placeholders={HOME_PLACEHOLDERS}
            right={<api.ui.Slot name="home_prompt_right" workspace_id={value.workspace_id} />}
          />
        );
      },
      session_prompt(_ctx, value) {
        return (
          <PromptWithSnippetAutocomplete
            api={api}
            bindPrompt={bindPrompt}
            hostRef={value.ref}
            sessionID={value.session_id}
            visible={value.visible}
            disabled={value.disabled}
            onSubmit={value.on_submit}
            right={<api.ui.Slot name="session_prompt_right" session_id={value.session_id} />}
          />
        );
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default plugin;
