/** @jsxImportSource @opentui/solid */
import { join } from "node:path";
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptInfo,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui";
import { RGBA } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Index,
  onCleanup,
  onMount,
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
} from "./src/tui-trigger.js";
import type { SnippetInfo } from "./src/types.js";

const id = "opencode-snippets:tui";
const PROMPT_SYNC_MS = 50;
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

  createEffect((prev?: string) => {
    const next = match();
    if (!next) {
      if (dismissed()) setDismissed(undefined);
      return "";
    }

    const key = `${next.token}\n${optionKey()}`;
    if (key !== prev) {
      setSelected(0);
      setInputMode("keyboard");
    }
    return key;
  });

  onMount(() => {
    const dispose = props.api.command.register(() => [
      {
        title: "Accept snippet autocomplete",
        value: "snippets.accept",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        enabled: visible(),
        onSelect() {
          const total = options().length;
          if (total > 0) {
            choose(selected());
            return;
          }

          if (canCreate()) {
            void createSnippetDraft();
          }
        },
      },
    ]);

    onCleanup(dispose);
  });

  const choose = (index = selected()) => {
    const ref = prompt();
    const item = options()[index];
    if (!ref || !item) return;

    const nextInput = insertSnippetTag(ref.current.input, item.name);
    syncPromptInput(ref, nextInput);
    ref.focus();

    setDismissed(undefined);
  };

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
    const ctrlOnly = evt.ctrl && !evt.meta && !evt.shift;
    const isNavUp = name === "up" || (ctrlOnly && name === "p");
    const isNavDown = name === "down" || (ctrlOnly && name === "n");

    if (isNavUp) {
      setInputMode("keyboard");
      if (total > 0) {
        setSelected((selected() - 1 + total) % total);
      }
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (isNavDown) {
      setInputMode("keyboard");
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
    <box flexDirection="column">
      <Show when={visible()}>
        <box
          width="100%"
          backgroundColor={props.api.theme.current.backgroundMenu}
          borderColor={props.api.theme.current.border}
          {...INLINE_BORDER}
        >
          <box flexDirection="column" width="100%">
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
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={props.api.theme.current.primary}
                    onMouseMove={() => {
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
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    index === selected() ? props.api.theme.current.primary : undefined
                  }
                  flexDirection="row"
                  onMouseMove={() => {
                    setInputMode("mouse");
                  }}
                  onMouseOver={() => {
                    if (inputMode() !== "mouse") return;
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
          </box>
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
