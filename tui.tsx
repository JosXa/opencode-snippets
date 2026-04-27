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
import { addPendingDraft } from "./src/pending-drafts.js";
import { markSnippetReloadRequested } from "./src/reload-signal.js";
import { loadSkills, type SkillInfo } from "./src/skill-loader.js";
import {
  filterSkills,
  filterSnippets,
  highlightMatches,
  matchedAliases,
  snippetDescription,
} from "./src/tui-search.js";
import {
  findTrailingHashtagTrigger,
  insertSkillLoad,
  insertSnippetTag,
  insertSnippetTrigger,
  isDialogInputBlocked,
  isReloadCommand,
  preferredSnippetTag,
  stepSelection,
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

function sortSkills(skills: SkillInfo[]): SkillInfo[] {
  return [...skills].sort((a, b) => {
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

function resolveExternalEditor() {
  const visual = Bun.env.VISUAL?.trim();
  if (visual) {
    return {
      command: visual,
      env: "VISUAL" as const,
    };
  }

  const editor = Bun.env.EDITOR?.trim();
  if (editor) {
    return {
      command: editor,
      env: "EDITOR" as const,
    };
  }
}

function editorBinary(editor: NonNullable<ReturnType<typeof resolveExternalEditor>>): string {
  return editor.command.trim().split(/\s+/)[0] || "";
}

function usesTerminalUi(editor: NonNullable<ReturnType<typeof resolveExternalEditor>>): boolean {
  const bin = editorBinary(editor).split(/[\\/]/).pop()?.toLowerCase();

  if (!bin) return true;

  return ![
    "code",
    "code-insiders",
    "cursor",
    "windsurf",
    "subl",
    "zed",
    "mate",
    "idea",
    "webstorm",
    "pycharm",
    "goland",
    "clion",
    "rubymine",
    "fleet",
    "notepad",
    "notepad++",
    "open",
  ].includes(bin);
}

async function ensureSnippetDraft(name: string, projectDir?: string): Promise<string> {
  const dir = await ensureSnippetsDir(projectDir);
  const filePath = join(dir, `${name}${CONFIG.SNIPPET_EXTENSION}`);

  if (!(await Bun.file(filePath).exists())) {
    await Bun.write(filePath, EMPTY_SNIPPET);
  }

  return filePath;
}

async function openExternalEditor(
  api: TuiPluginApi,
  filePath: string,
  editor: ReturnType<typeof resolveExternalEditor>,
): Promise<boolean> {
  if (!editor) return false;

  const interactive = usesTerminalUi(editor);

  if (interactive) {
    api.renderer.suspend();
    api.renderer.currentRenderBuffer.clear();
  }

  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", `${editor.command} "${filePath.replace(/"/g, '\\"')}"`]
        : [...editor.command.split(" "), filePath];
    const proc = Bun.spawn(cmd, {
      stdin: interactive ? "inherit" : "ignore",
      stdout: interactive ? "inherit" : "ignore",
      stderr: interactive ? "inherit" : "ignore",
    });
    await proc.exited;
    return true;
  } finally {
    if (interactive) {
      api.renderer.currentRenderBuffer.clear();
      api.renderer.resume();
    }

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

async function reloadSnippetsInTui(api: TuiPluginApi): Promise<number> {
  const registry = await loadSnippets(api.state.path.directory);
  await markSnippetReloadRequested(api.state.path.directory);
  return listSnippets(registry).length;
}

function executeReloadInPrompt(
  api: TuiPluginApi,
  ref: TuiPromptRef,
  clear: () => void,
  refresh: () => Promise<unknown> | undefined,
) {
  void (async () => {
    const count = await reloadSnippetsInTui(api);
    await refresh();
    clear();
    ref.focus();
    api.renderer.requestRender();
    setTimeout(() => {
      api.ui.toast({
        variant: "success",
        title: "Snippets reloaded",
        message: `Reloaded ${count} snippet${count === 1 ? "" : "s"}.`,
        duration: 3000,
      });
      api.renderer.requestRender();
    }, 0);
  })();
}

async function getSkills(api: TuiPluginApi): Promise<SkillInfo[]> {
  const registry = await loadSkills(api.state.path.directory);
  return sortSkills([...registry.values()]);
}

function skillDescription(skill: SkillInfo): string {
  return (skill.description || skill.content).replace(/\s+/g, " ").trim();
}

type AutocompleteItem =
  | {
      kind: "snippet";
      id: string;
      label: string;
      description: string;
      aliases: string[];
      snippet: SnippetInfo;
    }
  | {
      kind: "skill";
      id: string;
      label: string;
      description: string;
      aliases: string[];
      skill: SkillInfo;
    };

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
  const [lastMousePos, setLastMousePos] = createSignal<{ x: number; y: number }>();
  const [input, setInput] = createSignal("");
  const [syncingPrompt, setSyncingPrompt] = createSignal(false);
  const [menuEpoch, setMenuEpoch] = createSignal(0);
  const [creating, setCreating] = createSignal(false);
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [dialogHandoffUntil, setDialogHandoffUntil] = createSignal(0);
  const [snippets, { refetch: refetchSnippets }] = createResource(
    () => props.api.state.path.directory,
    () => getSnippets(props.api),
    {
      initialValue: [] as SnippetInfo[],
    },
  );
  const [skills] = createResource(
    () => props.api.state.path.directory,
    () => getSkills(props.api),
    {
      initialValue: [] as SkillInfo[],
    },
  );

  const bind = (ref: TuiPromptRef | undefined) => {
    setPrompt(ref);
    props.bindPrompt(ref);
    props.hostRef?.(ref);
  };

  const refreshSnippetOptions = async () => {
    await refetchSnippets();
  };

  let pendingPromptSync: ReturnType<typeof setTimeout> | undefined;
  let pendingPromptFocus: ReturnType<typeof setTimeout> | undefined;
  let pendingDialogHandoff: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (pendingPromptSync) clearTimeout(pendingPromptSync);
    if (pendingPromptFocus) clearTimeout(pendingPromptFocus);
    if (pendingDialogHandoff) clearTimeout(pendingDialogHandoff);
  });

  const lockKeyboardSelection = () => {
    setInputMode("keyboard");
    setIgnoreMouseUntil(Date.now() + MOUSE_HOVER_SUPPRESS_MS);
  };

  const allowMouseHover = () => Date.now() >= ignoreMouseUntil();
  const dialogBlockingInput = () => isDialogInputBlocked(dialogOpen(), dialogHandoffUntil());
  const beginDialogHandoff = () => {
    if (pendingDialogHandoff) clearTimeout(pendingDialogHandoff);
    setDialogHandoffUntil(Date.now() + 150);
    pendingDialogHandoff = setTimeout(() => {
      pendingDialogHandoff = undefined;
      setDialogHandoffUntil(0);
      props.api.renderer.requestRender();
    }, 175);
  };
  const handlePromptSubmit = () => {
    if (dialogBlockingInput()) {
      return;
    }

    const ref = prompt();
    if (ref && isReloadCommand(ref.current.input)) {
      executeReloadInPrompt(
        props.api,
        ref,
        () => {
          syncPromptInput(ref, "");
          setDismissed(undefined);
        },
        refreshSnippetOptions,
      );
      return;
    }

    props.onSubmit?.();
  };

  const recordMouseMove = (x: number, y: number) => {
    const last = lastMousePos();
    if (last?.x === x && last.y === y) {
      return false;
    }

    setLastMousePos({ x, y });
    return true;
  };

  const restorePromptFocus = (ref: TuiPromptRef) => {
    if (pendingPromptFocus) clearTimeout(pendingPromptFocus);
    pendingPromptFocus = setTimeout(() => {
      pendingPromptFocus = undefined;
      ref.focus();
    }, 175);
  };

  const syncPromptInput = (ref: TuiPromptRef, nextInput: string) => {
    setPromptInput(ref, nextInput);
    setInput(nextInput);
    setSyncingPrompt(false);
  };

  const optionsForQuery = (value: string) => {
    const snippetOptions = filterSnippets(snippets(), value).map((snippet) => ({
      kind: "snippet" as const,
      id: `snippet:${snippet.name}`,
      label: `#${snippet.name}`,
      description: snippetDescription(snippet),
      aliases: matchedAliases(snippet, value),
      snippet,
    }));
    const skillOptions = filterSkills(skills(), value).map((skill) => ({
      kind: "skill" as const,
      id: `skill:${skill.name}`,
      label: `#skill(${skill.name})`,
      description: skillDescription(skill),
      aliases: [],
      skill,
    }));

    return [...snippetOptions, ...skillOptions];
  };

  const canCreateForQuery = (value: string) => {
    const q = value.trim();
    if (snippets.loading || skills.loading) return false;
    if (!q) return false;
    if (!normalizeSnippetName(q)) return false;
    return optionsForQuery(q).length === 0;
  };

  const schedulePromptSync = () => {
    const ref = prompt();
    if (!ref) return;
    if (dialogBlockingInput()) return;

    const prev = input();
    setSyncingPrompt(true);
    setMenuEpoch((n) => n + 1);
    if (pendingPromptSync) clearTimeout(pendingPromptSync);
    pendingPromptSync = setTimeout(() => {
      pendingPromptSync = undefined;
      const next = ref.current.input;
      setInput((prev) => (prev === next ? prev : next));
      if (next !== prev) {
        setSyncingPrompt(false);
      }
      props.api.renderer.requestRender();
    }, 0);
  };

  createEffect(() => {
    const ref = prompt();
    if (!ref) {
      setInput("");
      setSyncingPrompt(false);
      return;
    }

    // The prompt ref exposes current state but not an onInput hook, so mirror it.
    const sync = () => {
      const next = ref.current.input;
      setInput((prev) => {
        if (prev === next) return prev;
        setSyncingPrompt(false);
        return next;
      });
    };

    sync();
    const timer = setInterval(sync, PROMPT_SYNC_MS);
    onCleanup(() => clearInterval(timer));
  });

  const match = createMemo(() => {
    if (props.disabled || props.visible === false) return;
    return findTrailingHashtagTrigger(input());
  });
  const query = createMemo(() => match()?.query.trim() || "");

  const options = createMemo<AutocompleteItem[]>(() => {
    const next = match();
    if (!next) return [];

    return optionsForQuery(next.query.trim());
  });
  const draftName = createMemo(() => normalizeSnippetName(query()));

  const visible = createMemo(() => {
    const next = match();
    if (!next) return false;
    if (syncingPrompt()) return false;
    return dismissed() !== next.token;
  });

  const canCreate = createMemo(() => {
    if (snippets.loading || skills.loading) return false;
    if (options().length > 0) return false;
    return !!query() && !!draftName();
  });

  const optionKey = createMemo(() =>
    options()
      .map((item) => item.id)
      .join("\n"),
  );
  const menuHeight = createMemo(() =>
    Math.min(MENU_MAX_HEIGHT, Math.max(1, options().length || 1)),
  );
  const activeRowId = createMemo(() => {
    if (options().length > 0) return options()[selected()]?.id;
    if (canCreate()) return "create-snippet";
    return undefined;
  });
  let scroll: ScrollBoxRenderable | undefined;

  createEffect(() => {
    menuEpoch();
    if (visible()) {
      scroll = undefined;
    }
  });

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
        const first = options()[0]?.id;
        if (first) {
          // Query changes can keep the same first row id, so force the scrollbox back to top.
          scroll?.scrollChildIntoView(first);
        }
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

  const chooseItem = (item: AutocompleteItem) => {
    const ref = prompt();
    if (!ref) return;

    const nextInput =
      item.kind === "skill"
        ? insertSkillLoad(ref.current.input, item.skill.name)
        : insertSnippetTag(ref.current.input, preferredSnippetTag(ref.current.input, item.snippet));
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
          title: "Reload snippets",
          value: "snippets.reload",
          description: "Reload snippet files from disk",
          category: "Prompt",
          slash: { name: "snippets:reload" },
          onSelect() {
            executeReloadInPrompt(
              props.api,
              ref,
              () => {
                syncPromptInput(ref, "");
                setDismissed(undefined);
              },
              refreshSnippetOptions,
            );
          },
        },
        {
          title: "Accept snippet autocomplete",
          value: "snippets.accept",
          keybind: "input_submit",
          category: "Prompt",
          hidden: true,
          enabled: ref.focused,
          onSelect() {
            if (isReloadCommand(ref.current.input)) {
              executeReloadInPrompt(
                props.api,
                ref,
                () => {
                  syncPromptInput(ref, "");
                  setDismissed(undefined);
                },
                refreshSnippetOptions,
              );
              return;
            }

            if (dialogBlockingInput()) {
              return;
            }

            const current = findTrailingHashtagTrigger(ref.current.input);
            if (!current || dismissed() === current.token) {
              ref.submit();
              return;
            }

            const live = optionsForQuery(current.query.trim());
            const index = Math.min(selected(), Math.max(live.length - 1, 0));

            if (syncingPrompt()) {
              if (live.length > 0) {
                chooseItem(live[index] ?? live[0]);
                return;
              }

              if (canCreateForQuery(current.query)) {
                void createSnippetDraft(current.query);
                return;
              }

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
            }

            if (snippets.loading || skills.loading) {
              return;
            }

            if (live.length > 0) {
              chooseItem(live[index] ?? live[0]);
              return;
            }

            if (canCreateForQuery(current.query)) {
              void createSnippetDraft(current.query);
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

  const createSnippetDraft = async (rawQuery?: string) => {
    const ref = prompt();
    const name = normalizeSnippetName(rawQuery ?? query());
    if (!ref || !name || creating()) return;
    const current = findTrailingHashtagTrigger(ref.current.input);
    const nextInput = current ? `${ref.current.input.slice(0, current.start)}#${name}` : `#${name}`;
    const dismissedToken = `#${name}`;

    const editor = resolveExternalEditor();
    if (!editor) {
      props.api.ui.toast({
        variant: "warning",
        message: "Set VISUAL or EDITOR to create snippets from the TUI.",
      });
      return;
    }

    props.api.ui.dialog.setSize("medium");
    setDialogOpen(true);
    props.api.ui.dialog.replace(() => (
      <props.api.ui.DialogConfirm
        title={`Create snippet #${name}?`}
        message={`This will create the snippet draft and open it in $${editor.env} (${editor.command}).`}
        onCancel={() => {
          setDialogOpen(false);
          beginDialogHandoff();
          props.api.ui.dialog.clear();
          restorePromptFocus(ref);
        }}
        onConfirm={() => {
          setDialogOpen(false);
          beginDialogHandoff();
          props.api.ui.dialog.clear();

          void (async () => {
            setCreating(true);

            try {
              syncPromptInput(ref, nextInput);

              const filePath = await ensureSnippetDraft(name);
              await addPendingDraft(props.api.state.path.directory, name);
              setDismissed(dismissedToken);
              setCreating(false);
              const opened = await openExternalEditor(props.api, filePath, editor);
              if (!opened) return;
            } catch (error) {
              props.api.ui.toast({
                variant: "error",
                message: `Failed to create snippet: ${error instanceof Error ? error.message : String(error)}`,
              });
              syncPromptInput(ref, nextInput);
              setDismissed(undefined);
            } finally {
              setCreating(false);
              restorePromptFocus(ref);
            }
          })();
        }}
      />
    ));
  };

  useKeyboard((evt) => {
    const ref = prompt();
    const name = evt.name?.toLowerCase();

    if (ref && isReloadCommand(ref.current.input) && (name === "return" || name === "enter")) {
      executeReloadInPrompt(
        props.api,
        ref,
        () => {
          syncPromptInput(ref, "");
          setDismissed(undefined);
        },
        refreshSnippetOptions,
      );
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (dialogBlockingInput()) return;
    if (!visible()) return;

    const total = options().length;
    const actionable = total > 0 || canCreate();
    const isNavUp = name === "up";
    const isNavDown = name === "down";

    if (isNavUp) {
      if (!actionable) return;
      lockKeyboardSelection();
      if (total > 0) {
        setSelected(stepSelection(selected(), total, -1));
      }
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (isNavDown) {
      if (!actionable) return;
      lockKeyboardSelection();
      if (total > 0) {
        setSelected(stepSelection(selected(), total, 1));
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
      return;
    }

    // Mirror the host prompt state right after normal typing so stale matches disappear.
    schedulePromptSync();
  });

  const emptyLabel = createMemo(() => {
    if ((snippets.loading || skills.loading) && options().length === 0) {
      return "Loading snippets and skills...";
    }

    if (snippets().length === 0 && skills().length === 0) return "No snippets or skills found";
    return "No matching snippets or skills";
  });

  const addSnippetLabel = createMemo(() => {
    if (creating()) return "Creating snippet...";
    return `Add new Snippet: #${draftName()}`;
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
                    onMouseMove={(event) => {
                      if (!allowMouseHover()) return;
                      if (!recordMouseMove(event.x, event.y)) return;
                      setInputMode("mouse");
                    }}
                    onMouseDown={() => {
                      setInputMode("mouse");
                      setLastMousePos(undefined);
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
                // biome-ignore lint/a11y/useKeyWithMouseEvents: OpenTUI boxes do not expose DOM-style focus events.
                <box
                  id={option().id}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    index === selected() ? props.api.theme.current.primary : undefined
                  }
                  flexDirection="row"
                  onMouseMove={(event) => {
                    if (!allowMouseHover()) return;
                    // User requirement: ignore synthetic hover churn when the list scrolls under a stationary mouse.
                    if (!recordMouseMove(event.x, event.y)) return;
                    setInputMode("mouse");
                  }}
                  onMouseOver={() => {
                    if (!allowMouseHover()) return;
                    if (inputMode() !== "mouse") return;
                    setSelected(index);
                  }}
                  onMouseDown={() => {
                    setInputMode("mouse");
                    setLastMousePos(undefined);
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
                      option().label,
                      query(),
                      index === selected() ? selectedFg() : props.api.theme.current.text,
                    )}
                  </text>
                  <Show when={option().aliases.length > 0}>
                    <text
                      fg={index === selected() ? selectedFg() : props.api.theme.current.textMuted}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {renderHighlighted(
                        `  ${option().aliases.length === 1 ? "alias" : "aliases"}: ${option().aliases.join(", ")}`,
                        query(),
                        index === selected() ? selectedFg() : props.api.theme.current.textMuted,
                      )}
                    </text>
                  </Show>
                  <Show when={option().description}>
                    <text
                      fg={index === selected() ? selectedFg() : props.api.theme.current.textMuted}
                      wrapMode="none"
                    >
                      {renderHighlighted(
                        `  ${option().description}`,
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
        disabled={props.disabled || dialogBlockingInput()}
        onSubmit={handlePromptSubmit}
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
