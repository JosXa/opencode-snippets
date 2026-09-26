/** @jsxImportSource @opentui/solid */
import type { usePlugin } from "@opencode/plugin/tui";
import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { getSnippetForm } from "./fields.js";
import { serializeInvocation } from "./invocation.js";
import {
  copyLibrarySource,
  createLibrary,
  type LibraryFile,
  libraryRegistry,
  parseLibraryFile,
  snippetReferences,
  validateLibraryFile,
} from "./library.js";
import { SnippetForm } from "./tui-form.js";
import { filterSnippets } from "./tui-search.js";
import type { SnippetRegistry } from "./types.js";

type Context = ReturnType<typeof usePlugin>;
export interface LibraryState {
  selected?: string;
  drafts: Map<string, { file: LibraryFile; raw: string }>;
}

export function SnippetLibrary(props: {
  context: Context;
  directory: string;
  globalDirectory?: string;
  state: LibraryState;
  reload(): Promise<void>;
  close(): void;
}) {
  const library = createLibrary(props.directory, props.globalDirectory);
  const [files, setFiles] = createSignal<LibraryFile[]>([]);
  const [registry, setRegistry] = createSignal<SnippetRegistry>(new Map());
  const [selected, setSelected] = createSignal(props.state.selected ?? "");
  const [query, setQuery] = createSignal("");
  const [scope, setScope] = createSignal("all");
  const [raw, setRaw] = createSignal("");
  const [revision, setRevision] = createSignal(0);
  const [editing, setEditing] = createSignal(false);
  const [focus, setFocus] = createSignal("list");
  const [busy, setBusy] = createSignal(false);
  const [modal, setModal] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [width, setWidth] = createSignal(props.context.renderer.width);
  const [help, setHelp] = createSignal(false);
  let editor: TextareaRenderable | undefined;
  let list: ScrollBoxRenderable | undefined;
  const theme = () => props.context.theme;
  const filtered = createMemo(() =>
    filterSnippets(
      files().filter((file) => scope() === "all" || file.source === scope()),
      query(),
    ),
  );
  const original = () => {
    revision();
    return (
      props.state.drafts.get(selected())?.file ??
      files().find((file) => file.filePath === selected())
    );
  };
  const current = createMemo(() => {
    const file = original();
    return file ? parseLibraryFile(file.filePath, file.source, raw()) : undefined;
  });
  const dirty = (path = selected()) => {
    revision();
    const draft = props.state.drafts.get(path);
    return draft !== undefined && draft.raw !== draft.file.raw;
  };
  const changed = () => {
    setRevision((value) => value + 1);
  };
  const update = (value: string) => {
    const file = original();
    setRaw(value);
    if (file) props.state.drafts.set(file.filePath, { file, raw: value });
    changed();
  };
  const select = (file: LibraryFile) => {
    setSelected(file.filePath);
    props.state.selected = file.filePath;
    const value = props.state.drafts.get(file.filePath)?.raw ?? file.raw;
    setRaw(value);
    if (editor && editor.plainText !== value) editor.setText(value);
    setFocus("list");
    setError("");
    queueMicrotask(() => list?.scrollChildIntoView(`library-file-${files().indexOf(file)}`));
  };
  const load = async (path = selected()) => {
    const result = await library.list();
    setFiles(result.files);
    setRegistry(result.registry);
    const file =
      result.files.find((item) => item.filePath === path) ??
      filterSnippets(result.files, "").find((item) => item.active) ??
      result.files[0];
    if (file) select(file);
    if (!file) {
      setSelected("");
      setRaw("");
    }
  };
  const run = async (action: () => Promise<void>) => {
    if (busy() || modal()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const dialog = async <T,>(action: () => Promise<T>): Promise<T> => {
    setModal(true);
    try {
      return await action();
    } finally {
      setModal(false);
    }
  };
  const saveDraft = async (path: string) => {
    const draft = props.state.drafts.get(path);
    if (!draft || draft.raw === draft.file.raw) return;
    const parsed = parseLibraryFile(path, draft.file.source, draft.raw);
    validateLibraryFile(parsed, registry());
    await library.save(draft.file, draft.raw);
    props.state.drafts.delete(path);
    changed();
  };
  const save = () =>
    run(async () => {
      await saveDraft(selected());
      await load();
      await props.reload();
      setMessage("Saved. New submissions use this version.");
      if (editing()) setFocus("editor");
    });
  const leave = () =>
    run(async () => {
      const drafts = [...props.state.drafts.keys()].filter((path) => dirty(path));
      if (drafts.length) {
        const choice = await dialog(() =>
          props.context.ui.dialog.select({
            title: "Unsaved snippets",
            options: [
              { title: "Save all and return", value: "save" },
              { title: "Discard changes and return", value: "discard" },
              { title: "Keep editing", value: "cancel" },
            ],
          }),
        );
        if (!choice || choice === "cancel") return;
        if (choice === "save") {
          for (const path of drafts) await saveDraft(path);
          await props.reload();
        }
        if (choice === "discard") props.state.drafts.clear();
      }
      props.close();
    });
  const reload = () =>
    run(async () => {
      if (dirty()) {
        const confirmed = await dialog(() =>
          props.context.ui.dialog.confirm({
            title: "Reload this file?",
            message:
              "Discard this snippet's unsaved changes and read its current contents from disk?",
            label: { confirm: "Discard and reload", cancel: "Keep editing" },
          }),
        );
        if (!confirmed) return;
        props.state.drafts.delete(selected());
        changed();
      }
      await load();
      await props.reload();
      setMessage("Library reloaded.");
    });
  const edit = () => {
    setEditing(true);
    setFocus("editor");
  };
  const create = (duplicate = false) =>
    run(async () => {
      const file = current();
      if (duplicate && !file) return;
      const name = await dialog(() =>
        props.context.ui.dialog.prompt({
          title: duplicate ? "Duplicate snippet: new name" : "New snippet name",
          placeholder: duplicate ? `${file?.name}-copy` : "my-snippet",
        }),
      );
      if (!name) return;
      const source = await dialog(() =>
        props.context.ui.dialog.select({
          title: "Snippet scope",
          options: [
            { title: "Project", value: "project" as const, description: props.directory },
            {
              title: "Global",
              value: "global" as const,
              description: "Available in every project",
            },
          ],
        }),
      );
      if (!source) return;
      // A duplicate gets the full authored document, including fields and blocks.
      const path = await library.create(
        name,
        source,
        duplicate ? copyLibrarySource(raw()) : '---\ndescription: ""\naliases: []\n---\n\n',
      );
      await load(path);
      await props.reload();
      edit();
      setMessage(
        duplicate
          ? "Duplicated with fresh aliases."
          : "Created. Edit the source, then Ctrl+S to save.",
      );
    });
  const relocate = (move: boolean) =>
    run(async () => {
      const file = original();
      if (!file) return;
      if (dirty()) throw new Error("Save or reload this snippet before renaming or moving it.");
      const name = move
        ? file.name
        : await dialog(() =>
            props.context.ui.dialog.prompt({ title: "Rename snippet", placeholder: file.name }),
          );
      if (!name || (!move && name === file.name)) return;
      const source = move ? (file.source === "global" ? "project" : "global") : file.source;
      const confirmed = await dialog(() =>
        props.context.ui.dialog.confirm({
          title: move ? `Move to ${source}?` : `Rename #${file.name}?`,
          message: move
            ? "The snippet will use its new scope. An existing destination will not be overwritten."
            : `The old name #${file.name} will remain as an alias, so existing references still work.`,
          label: { confirm: move ? "Move" : "Rename", cancel: "Cancel" },
        }),
      );
      if (!confirmed) return;
      const path = await library.relocate(file, name, source);
      props.state.drafts.delete(file.filePath);
      await load(path);
      await props.reload();
      setMessage(move ? `Moved to ${source}.` : `Renamed to #${name}.`);
    });
  const remove = () =>
    run(async () => {
      const file = original();
      if (!file) return;
      const used = files()
        .filter((item) =>
          snippetReferences(item.content).some((name) =>
            [file.name, ...file.aliases].includes(name),
          ),
        )
        .map((item) => `#${item.name}`);
      const confirmed = await dialog(() =>
        props.context.ui.dialog.confirm({
          title: `Delete #${file.name}?`,
          message: `${file.filePath}\n${dirty() ? "Unsaved changes will be discarded.\n" : ""}${used.length ? `Used by: ${used.join(", ")}\n` : ""}Deleting an override can reveal a lower-priority definition.`,
          label: { confirm: "Delete file", cancel: "Cancel" },
        }),
      );
      if (!confirmed) return;
      await library.remove(file);
      props.state.drafts.delete(file.filePath);
      changed();
      await load("");
      await props.reload();
      setMessage("Snippet deleted.");
    });
  const copy = (value: string) => {
    const copied = props.context.renderer.copyToClipboardOSC52(value);
    setMessage(
      copied ? "Copied to the terminal clipboard." : `Clipboard unavailable. Reference: ${value}`,
    );
  };
  const form = () => {
    const file = current();
    if (!file) return;
    try {
      const form = getSnippetForm(file.name, libraryRegistry(file, registry()));
      if (!form.fields.length) {
        setMessage("This snippet has no fields.");
        return;
      }
      setModal(true);
      props.context.ui.dialog.set({ size: "large", centered: true });
      props.context.ui.dialog.show(
        () => (
          <SnippetForm
            context={props.context}
            name={file.name}
            fields={form.fields}
            values={form.values}
            cancel={() => props.context.ui.dialog.clear()}
            save={(values) => {
              copy(serializeInvocation(file.name, values));
              props.context.ui.dialog.clear();
            }}
          />
        ),
        () => setModal(false),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const find = () =>
    run(async () => {
      if (!editing()) edit();
      const needle = await dialog(() =>
        props.context.ui.dialog.prompt({ title: "Find in source", placeholder: "Text to find" }),
      );
      if (!needle) return;
      const offset = editor?.getTextRange(0, editor.cursorOffset).length ?? 0;
      const next = raw().indexOf(needle, offset + 1);
      const index = next < 0 ? raw().indexOf(needle) : next;
      if (index < 0) {
        setMessage("No match in this snippet.");
        return;
      }
      const prefix = raw().slice(0, index).split("\n");
      editor?.setCursor(prefix.length - 1, [...(prefix.at(-1) ?? "")].length);
      setFocus("editor");
      setMessage(`Found: ${needle}`);
    });
  const navigate = (name: string) => {
    const target = registry().get(name.toLowerCase());
    const file = files().find((file) => file.filePath === target?.filePath);
    if (!file) {
      setMessage(`Unresolved reference: #${name}`);
      return;
    }
    setQuery("");
    setScope("all");
    select(file);
  };
  const details = createMemo(() => {
    const file = current();
    if (!file) return { fields: [], error: "" };
    try {
      return {
        fields: getSnippetForm(file.name, libraryRegistry(file, registry())).fields,
        error: "",
      };
    } catch (error) {
      return { fields: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  const used = () =>
    files().filter((file) =>
      snippetReferences(file.content).some((name) =>
        [current()?.name, ...(current()?.aliases ?? [])].some(
          (key) => key?.toLowerCase() === name.toLowerCase(),
        ),
      ),
    );
  const actions = () => [
    "back",
    "all",
    "project",
    "global",
    "new",
    "reload",
    ...(current()
      ? [
          "inspect",
          "edit",
          "save",
          "duplicate",
          "rename",
          "move",
          "delete",
          "copy",
          "form",
          ...(!editing()
            ? [
                ...snippetReferences(current()?.content ?? "").map((name) => `include:${name}`),
                ...used().map((file) => `used:${file.filePath}`),
              ]
            : []),
        ]
      : []),
    "help",
  ];
  const invoke = (id: string) => {
    if (id.startsWith("include:")) return navigate(id.slice(8));
    if (id.startsWith("used:")) {
      const file = files().find((file) => file.filePath === id.slice(5));
      if (file) select(file);
      return;
    }
    if (id === "back") return void leave();
    if (["all", "project", "global"].includes(id)) {
      setScope(id);
      return;
    }
    if (id === "new") return void create();
    if (id === "reload") return void reload();
    if (id === "inspect") {
      setEditing(false);
      setFocus("list");
      return;
    }
    if (id === "edit") return edit();
    if (id === "save") return void save();
    if (id === "duplicate") return void create(true);
    if (id === "rename") return void relocate(false);
    if (id === "move") return void relocate(true);
    if (id === "delete") return void remove();
    if (id === "copy") return copy(`#${current()?.name}`);
    if (id === "form") return form();
    if (id === "help") setHelp((value) => !value);
  };
  const keys = (event: KeyEvent) => {
    if (modal() || props.context.keymap.mode.current() !== "base") return;
    const name = event.name.toLowerCase();
    if (busy()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (name === "escape") void leave();
    else if (event.ctrl && name === "s") void save();
    else if (event.ctrl && name === "n") void create();
    else if (event.ctrl && name === "f") void find();
    else if (event.ctrl && name === "r") void reload();
    else if (name === "tab") {
      const order = ["search", "list", ...(editing() ? ["editor"] : []), ...actions()];
      setFocus(
        order[(order.indexOf(focus()) + (event.shift ? -1 : 1) + order.length) % order.length],
      );
    } else if (focus() === "search" && ["return", "enter", "down"].includes(name)) {
      const file = filtered()[0];
      if (file) select(file);
    } else if (focus() === "editor" && ["return", "enter", "linefeed"].includes(name))
      editor?.newLine();
    else if (focus() === "editor" && event.ctrl && name === "z") editor?.undo();
    else if (focus() === "editor" && event.ctrl && name === "y") editor?.redo();
    else if (focus() === "list" && ["up", "down"].includes(name)) {
      const items = filtered();
      const index = items.findIndex((file) => file.filePath === selected());
      const item = items[(index + (name === "up" ? -1 : 1) + items.length) % items.length];
      if (item) select(item);
    } else if (focus() === "list" && ["return", "enter"].includes(name)) edit();
    else if (focus() !== "editor" && focus() !== "search" && name === "/") setFocus("search");
    else if (actions().includes(focus()) && ["return", "enter", "space"].includes(name))
      invoke(focus());
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  onMount(() => {
    props.context.renderer.keyInput.prependListener("keypress", keys);
    void run(() => load());
  });
  onCleanup(() => props.context.renderer.keyInput.removeListener("keypress", keys));

  const Button = (button: { id: string; label: string }) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI button, also reachable with Tab and Enter.
    <box
      id={`library-action-${button.id}`}
      flexShrink={0}
      onMouseUp={() => {
        if (!busy() && !modal()) {
          setFocus(button.id);
          invoke(button.id);
        }
      }}
    >
      <text
        fg={focus() === button.id ? theme().text.action.primary.focused : theme().text.base}
        bg={focus() === button.id ? theme().background.action.primary.focused : undefined}
      >{` ${button.label} `}</text>
    </box>
  );
  return (
    <box
      width="100%"
      height="100%"
      backgroundColor={theme().background.base}
      onSizeChange={() => setWidth(props.context.renderer.width)}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        border={["bottom"]}
        borderColor={theme().border.base}
        paddingX={1}
        flexShrink={0}
      >
        <text fg={theme().text.base} wrapMode="none">
          <b>SNIPPETS</b>
          {`  ${props.context.ui.format.path(props.directory)}`}
        </text>
        <Button id="back" label="Esc Back" />
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={1} paddingX={1} paddingY={1} flexShrink={0}>
        <box
          flexDirection="row"
          width={width() < 90 ? "100%" : "45%"}
          border
          borderColor={focus() === "search" ? theme().text.base : theme().border.base}
        >
          <text fg={theme().text.muted}> / </text>
          <input
            id="library-search"
            flexGrow={1}
            value={query()}
            focused={focus() === "search"}
            maxLength={Number.POSITIVE_INFINITY}
            placeholder="Name, alias or description"
            onMouseDown={() => setFocus("search")}
            onInput={setQuery}
            textColor={theme().text.base}
            backgroundColor={theme().background.base}
            focusedBackgroundColor={theme().background.base}
          />
        </box>
        <For each={["all", "project", "global"]}>
          {(id) => (
            <Button
              id={id}
              label={`${scope() === id ? "● " : ""}${id[0].toUpperCase()}${id.slice(1)}`}
            />
          )}
        </For>
        <Button id="new" label="+ New" />
        <Button id="reload" label="Reload" />
      </box>
      <box flexDirection={width() < 80 ? "column" : "row"} flexGrow={1} minHeight={0}>
        <scrollbox
          ref={list}
          width={width() < 80 ? "100%" : "32%"}
          height={width() < 80 ? 7 : undefined}
          flexShrink={0}
          border
          borderColor={focus() === "list" ? theme().text.base : theme().border.base}
        >
          <For
            each={filtered()}
            fallback={
              <text fg={theme().text.muted}>
                {files().length ? "No matching snippets." : "No snippets yet. Choose + New."}
              </text>
            }
          >
            {(file) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: Keyboard arrows select the same snippet rows.
              <box
                id={`library-file-${files().indexOf(file)}`}
                flexDirection="row"
                justifyContent="space-between"
                paddingX={1}
                flexShrink={0}
                backgroundColor={
                  selected() === file.filePath
                    ? theme().background.action.primary.focused
                    : undefined
                }
                onMouseUp={() => {
                  if (!busy() && !modal()) select(file);
                }}
              >
                <text
                  fg={
                    selected() === file.filePath
                      ? theme().text.action.primary.focused
                      : theme().text.base
                  }
                  wrapMode="none"
                >{`${selected() === file.filePath ? "›" : " "} #${file.name}${dirty(file.filePath) ? " *" : ""}`}</text>
                <text
                  fg={
                    selected() === file.filePath
                      ? theme().text.action.primary.focused
                      : theme().text.muted
                  }
                  wrapMode="none"
                >{`${file.source === "project" ? "P" : "G"}${file.active ? "" : " ↓"}`}</text>
              </box>
            )}
          </For>
        </scrollbox>
        <box flexGrow={1} minWidth={0} minHeight={0} paddingX={1}>
          <Show
            when={current()}
            fallback={<text fg={theme().text.muted}>Create a snippet to start your library.</text>}
          >
            <text fg={theme().text.base} flexShrink={0}>
              <b>#{current()?.name}</b>
              {dirty() ? "  * Unsaved" : ""}
            </text>
            <text
              fg={theme().text.muted}
              flexShrink={0}
              wrapMode="none"
            >{`${current()?.source} · ${props.context.ui.format.path(selected())}${original()?.active === false ? " · overridden" : ""}`}</text>
            <box flexDirection="row" flexWrap="wrap" flexShrink={0} marginY={1}>
              <Button id="inspect" label="Inspect" />
              <Button id="edit" label="Edit source" />
              <Button id="save" label="Save" />
              <Button id="duplicate" label="Duplicate" />
              <Button id="rename" label="Rename" />
              <Button id="move" label="Move" />
              <Button id="delete" label="Delete" />
              <Button id="copy" label="Copy #" />
              <Button id="form" label="Test form" />
            </box>
            <Show
              when={editing()}
              fallback={
                <scrollbox flexGrow={1} minHeight={0}>
                  <text fg={theme().text.muted}>SOURCE</text>
                  <For each={(current()?.content ?? "").split("\n")}>
                    {(line) => (
                      <box flexDirection="row" flexWrap="wrap" flexShrink={0} minHeight={1}>
                        <For each={line.split(/(#[a-z0-9][a-z0-9_-]*)/gi)}>
                          {(part) => {
                            const reference =
                              /^#[a-z0-9]/i.test(part) &&
                              registry().has(part.slice(1).toLowerCase());
                            return (
                              // biome-ignore lint/a11y/noStaticElementInteractions: Includes below supply the same navigation with keyboard-focusable controls.
                              <text
                                fg={
                                  reference ? theme().text.action.primary.base : theme().text.base
                                }
                                onMouseUp={() => {
                                  if (reference) navigate(part.slice(1));
                                }}
                              >
                                {part}
                              </text>
                            );
                          }}
                        </For>
                      </box>
                    )}
                  </For>
                  <text marginTop={1} fg={theme().text.muted}>
                    INCLUDES (static references)
                  </text>
                  <For
                    each={snippetReferences(current()?.content ?? "")}
                    fallback={<text fg={theme().text.muted}>None</text>}
                  >
                    {(name) => (
                      <Button
                        id={`include:${name}`}
                        label={`→ #${name}${registry().has(name.toLowerCase()) ? "" : " (unresolved)"}`}
                      />
                    )}
                  </For>
                  <text marginTop={1} fg={theme().text.muted}>
                    USED BY
                  </text>
                  <For each={used()} fallback={<text fg={theme().text.muted}>None</text>}>
                    {(file) => <Button id={`used:${file.filePath}`} label={`← #${file.name}`} />}
                  </For>
                  <text
                    marginTop={1}
                    fg={theme().text.muted}
                  >{`Aliases: ${current()?.aliases.join(", ") || "none"}`}</text>
                  <text fg={theme().text.muted}>{`Fields: ${
                    details()
                      .fields.map((field) => `${field.name} (${field.type})`)
                      .join(", ") || "none"
                  }`}</text>
                  <Show when={details().error}>
                    <text fg={theme().text.feedback.error.base}>{details().error}</text>
                  </Show>
                </scrollbox>
              }
            >
              <box
                flexGrow={1}
                minHeight={0}
                border
                borderColor={focus() === "editor" ? theme().text.base : theme().border.base}
              >
                <textarea
                  id="library-editor"
                  ref={editor}
                  initialValue={raw()}
                  focused={focus() === "editor"}
                  flexGrow={1}
                  height="100%"
                  wrapMode="word"
                  onMouseDown={() => setFocus("editor")}
                  onContentChange={() => update(editor?.plainText ?? raw())}
                  textColor={theme().text.base}
                  backgroundColor={theme().background.base}
                  focusedBackgroundColor={theme().background.base}
                  keyBindings={[
                    { name: "return", action: "newline" },
                    { name: "z", ctrl: true, action: "undo" },
                    { name: "y", ctrl: true, action: "redo" },
                  ]}
                />
              </box>
              <text fg={theme().text.muted} flexShrink={0}>
                Markdown + YAML · Enter newline · Ctrl+Z undo · Ctrl+Y redo · Ctrl+F find
              </text>
            </Show>
          </Show>
        </box>
      </box>
      <Show when={error()}>
        <text paddingX={1} fg={theme().text.feedback.error.base} flexShrink={0}>
          {error()}
        </text>
      </Show>
      <Show when={message() || busy()}>
        <text paddingX={1} fg={theme().text.muted} flexShrink={0}>
          {busy() ? "Working…" : message()}
        </text>
      </Show>
      <Show when={help()}>
        <text paddingX={1} fg={theme().text.muted} flexShrink={0}>
          P project · G global · ↓ overridden · * unsaved. Edit source includes aliases,
          description, fields and all block syntax. Test form copies a filled reference without
          executing it. Tab reaches actions; includes accept mouse or focus + Enter.
        </text>
      </Show>
      <box
        flexDirection="row"
        flexWrap="wrap"
        justifyContent="space-between"
        border={["top"]}
        borderColor={theme().border.base}
        paddingX={1}
        flexShrink={0}
      >
        <text fg={theme().text.muted}>
          ↑↓ browse · Enter edit · / search · Tab focus · Ctrl+S save · Esc back
        </text>
        <Button id="help" label="Help" />
      </box>
    </box>
  );
}
