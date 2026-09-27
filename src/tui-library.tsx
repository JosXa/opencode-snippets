/** @jsxImportSource @opentui/solid */
import type { usePlugin } from "@opencode/plugin/tui";
import {
  type KeyEvent,
  MacOSScrollAccel,
  type ScrollBoxRenderable,
  TextAttributes,
  type TextareaRenderable,
} from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { loadCliScroll } from "./config.js";
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
import { Action, ActionBar } from "./tui-action.js";
import { openExternalEditor, resolveExternalEditor } from "./tui-editor.js";
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
  const scroll = loadCliScroll();
  // Match OpenCode: acceleration takes precedence over a fixed scroll speed.
  const acceleration = () =>
    scroll.acceleration ? new MacOSScrollAccel() : { tick: () => scroll.speed, reset() {} };
  const editorScroll = acceleration();
  const remainder = { x: 0, y: 0 };
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
  const [command, setCommand] = createSignal("");
  const [direction, setDirection] = createSignal(1);
  const history = { paths: [] as string[], index: -1 };
  createEffect(() => {
    focus();
    setCommand("");
  });
  let editor: TextareaRenderable | undefined;
  let list: ScrollBoxRenderable | undefined;
  let preview: ScrollBoxRenderable | undefined;
  const theme = () => props.context.theme.surface("dialog");
  // Like DialogSelect, retain selection with muted colors while an action owns focus.
  const listFocused = () => focus() === "list" || focus() === "search";
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
  const select = (file: LibraryFile, jump = false) => {
    if (jump && selected() && selected() !== file.filePath) {
      history.paths.splice(history.index + 1);
      if (history.paths[history.index] !== selected()) history.paths.push(selected());
      history.paths.push(file.filePath);
      history.index = history.paths.length - 1;
    }
    setCommand("");
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
    if (!current()) return;
    setEditing(true);
    setFocus("editor");
  };
  const external = () =>
    run(async () => {
      const file = original();
      if (!file) return;
      const command = resolveExternalEditor();
      if (!command) throw new Error("Set VISUAL or EDITOR to open an external editor.");
      if (dirty()) {
        const choice = await dialog(() =>
          props.context.ui.dialog.select({
            title: "Open in external editor",
            options: [
              { title: "Save changes and open", value: "save" },
              { title: "Discard changes and open", value: "discard" },
              { title: "Keep editing here", value: "cancel" },
            ],
          }),
        );
        if (!choice || choice === "cancel") return;
        if (choice === "save") await saveDraft(file.filePath);
      }
      // Open the selected file, and reread it even if the editor saves then exits with an error.
      try {
        await openExternalEditor(props.context.renderer, file.filePath, command);
      } finally {
        props.state.drafts.delete(file.filePath);
        changed();
        await load(file.filePath);
        await props.reload();
        if (editing()) setFocus("editor");
      }
      setMessage("External editor closed. Snippet reloaded.");
    });
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
    select(file, true);
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
          "more",
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
  const back = () => {
    // Leaving the active editor also activates list navigation in one step.
    if (focus() === "editor") {
      setHelp(false);
      setEditing(false);
      setFocus("list");
      return;
    }
    if (help()) return setHelp(false);
    if (focus() !== "list") return setFocus("list");
    if (editing()) return setEditing(false);
    if (query()) return setQuery("");
    void leave();
  };
  const invoke = (id: string) => {
    if (id.startsWith("include:")) return navigate(id.slice(8));
    if (id.startsWith("used:")) {
      const file = files().find((file) => file.filePath === id.slice(5));
      if (file) select(file, true);
      return;
    }
    if (id === "back") return back();
    if (["all", "project", "global"].includes(id)) {
      setScope(id);
      const items = filtered();
      if (!items.some((file) => file.filePath === selected()) && items[0]) select(items[0]);
      setFocus(id);
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
    if (id === "external") return void external();
    if (id === "save") return void save();
    if (id === "more") return void more();
    if (id === "duplicate") return void create(true);
    if (id === "rename") return void relocate(false);
    if (id === "move") return void relocate(true);
    if (id === "delete") return void remove();
    if (id === "copy") return copy(`#${current()?.name}`);
    if (id === "form") return form();
    if (id === "help") setHelp((value) => !value);
  };
  const more = async () => {
    const action = await dialog(() =>
      props.context.ui.dialog.select({
        title: current() ? `Actions for #${current()?.name}` : "Library actions",
        options: [
          { title: "New snippet", value: "new" },
          { title: "Reload library", value: "reload" },
          { title: "Help", value: "help", description: "F1" },
          ...(current()
            ? [
                {
                  title: "Open in external editor",
                  value: "external",
                  description: "VISUAL or EDITOR · Shift+Enter",
                },
                {
                  title: "Duplicate",
                  value: "duplicate",
                  description: "Create a copy with fresh aliases",
                },
                { title: "Rename", value: "rename", description: "Keep the old name as an alias" },
                {
                  title: "Move",
                  value: "move",
                  description: `Move to ${current()?.source === "project" ? "global" : "project"}`,
                },
                { title: "Delete", value: "delete", description: "Delete this snippet file" },
                { title: "Copy reference", value: "copy", description: `#${current()?.name}` },
                {
                  title: "Test form",
                  value: "form",
                  description: "Fill fields and copy an invocation",
                },
              ]
            : []),
        ],
      }),
    );
    if (action) invoke(action);
  };
  // Navigation owns only non-input focus. The source editor has its own keymap.
  const motion = (event: KeyEvent) => {
    if (focus() === "editor" || focus() === "search" || event.meta) {
      setCommand("");
      return false;
    }
    const name = event.name.toLowerCase();
    const key = event.shift && name.length === 1 ? name.toUpperCase() : name;
    const pending = command();
    const count = Number.parseInt(pending, 10) || 1;
    const prefix = pending.replace(/^\d+/, "");
    setCommand("");
    if (name === "escape" && pending) return true;
    if (!event.ctrl && /^\d$/.test(key) && !prefix && (key !== "0" || pending)) {
      setCommand(`${pending}${key}`);
      return true;
    }
    const pane = (right: boolean) => {
      if (!right) return setFocus("list");
      if (current()) setFocus(editing() ? "editor" : "preview");
    };
    if (prefix === "^w") {
      if (["h", "k", "left", "up"].includes(name)) pane(false);
      if (["l", "j", "right", "down"].includes(name)) pane(true);
      if (name === "w") pane(focus() === "list");
      return true;
    }
    if (event.ctrl && name === "w") {
      setCommand("^w");
      return true;
    }
    if (event.ctrl && ["o", "i"].includes(name)) {
      const delta = name === "o" ? -1 : 1;
      for (const _ of Array.from({ length: Math.min(count, history.paths.length) })) {
        const index = history.index + delta;
        if (index < 0 || index >= history.paths.length) break;
        history.index = index;
        const file = files().find((file) => file.filePath === history.paths[index]);
        if (!file) continue;
        setQuery("");
        setScope("all");
        select(file);
      }
      return true;
    }
    if (!event.ctrl && ["h", "left", "l", "right"].includes(key)) {
      pane(key === "l" || key === "right");
      return true;
    }
    if (!event.ctrl && ["/", "?"].includes(key)) {
      setDirection(key === "/" ? 1 : -1);
      setQuery("");
      setFocus("search");
      return true;
    }
    if (!event.ctrl && key === ":") {
      void more();
      return true;
    }
    if (key === "f1") {
      invoke("help");
      return true;
    }
    const items = filtered();
    const index = items.findIndex((file) => file.filePath === selected());
    const position = (index: number, jump = false) => {
      const file = items[Math.max(0, Math.min(items.length - 1, index))];
      if (file) select(file, jump);
    };
    if (!event.ctrl && ["n", "N"].includes(key)) {
      if (items.length && query()) {
        const delta = direction() * (key === "N" ? -1 : 1) * count;
        position((((index + delta) % items.length) + items.length) % items.length, true);
      }
      return true;
    }
    if (
      !event.ctrl &&
      !event.shift &&
      ["i", "enter", "return"].includes(key) &&
      focus() === "list"
    ) {
      if (index >= 0) edit();
      return true;
    }
    const box = focus() === "preview" ? preview : list;
    const height = Math.max(1, box?.viewport.height ?? 1);
    if (!event.ctrl && key === "g" && prefix !== "g") {
      setCommand(`${pending}g`);
      return true;
    }
    if (
      !event.ctrl &&
      (key === "G" || (key === "g" && prefix === "g") || ["home", "end"].includes(key))
    ) {
      const last = key === "G" || key === "end";
      const target = /^\d/.test(pending) ? count - 1 : last ? Number.MAX_SAFE_INTEGER : 0;
      if (focus() === "preview") box?.scrollTo(target);
      if (focus() !== "preview") position(target, true);
      return true;
    }
    if (!event.ctrl && ["H", "M", "L"].includes(key)) {
      if (focus() !== "preview") {
        const top = list?.scrollTop ?? 0;
        const bottom = Math.min(items.length - 1, top + height - 1);
        position(
          key === "H"
            ? Math.min(bottom, top + count - 1)
            : key === "L"
              ? Math.max(top, bottom - count + 1)
              : Math.floor((top + bottom) / 2),
        );
      }
      return true;
    }
    if (!event.ctrl && key === "z" && !prefix) {
      setCommand("z");
      return true;
    }
    if (!event.ctrl && prefix === "z" && ["t", "z", "b"].includes(key)) {
      if (focus() === "list" && index >= 0)
        list?.scrollTo(
          index - (key === "t" ? 0 : key === "z" ? Math.floor((height - 1) / 2) : height - 1),
        );
      return true;
    }
    const step = event.ctrl
      ? {
          n: 1,
          p: -1,
          d: Math.max(1, Math.floor(height / 2)),
          u: -Math.max(1, Math.floor(height / 2)),
          f: height,
          b: -height,
          e: 1,
          y: -1,
        }[name]
      : { j: 1, k: -1, down: 1, up: -1, pagedown: height, pageup: -height }[key];
    if (step !== undefined) {
      if (focus() === "preview" || (event.ctrl && ["e", "y"].includes(name))) {
        box?.scrollBy(step * count);
        // Keep the selected row inside the viewport when scrolling the list.
        if (focus() !== "preview") {
          const top = box?.scrollTop ?? 0;
          position(Math.max(top, Math.min(index, top + height - 1)));
        }
      } else if (
        actions().includes(focus()) &&
        !event.ctrl &&
        ["j", "k", "up", "down"].includes(key)
      ) {
        const order = actions();
        const next =
          order[Math.max(0, Math.min(order.length - 1, order.indexOf(focus()) + step * count))];
        setFocus(next);
        queueMicrotask(() => preview?.scrollChildIntoView(`library-action-${next}`));
      } else position(index < 0 ? (step < 0 ? items.length - 1 : 0) : index + step * count);
      return true;
    }
    // A prefix followed by an unrelated key must not leak into a later motion.
    return false;
  };
  const keys = (event: KeyEvent) => {
    if (modal() || props.context.keymap.mode.current() !== "base") return;
    const name = event.name.toLowerCase();
    if (busy()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (motion(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (name === "escape") back();
    else if (
      name === "q" &&
      !event.ctrl &&
      !event.meta &&
      !event.shift &&
      focus() !== "search" &&
      focus() !== "editor"
    )
      props.close();
    else if (event.ctrl && name === "s") void save();
    else if (focus() === "editor" && event.ctrl && name === "n") void create();
    else if (focus() === "editor" && event.ctrl && name === "f") void find();
    else if (focus() === "editor" && event.ctrl && name === "r") void reload();
    else if (focus() === "editor" && event.ctrl && name === "o") void more();
    else if (event.shift && !event.ctrl && !event.meta && ["return", "enter"].includes(name))
      void external();
    else if (name === "tab") {
      const order = [
        "search",
        "list",
        ...(current() ? [editing() ? "editor" : "preview"] : []),
        ...actions(),
      ];
      const next =
        order[(order.indexOf(focus()) + (event.shift ? -1 : 1) + order.length) % order.length];
      // Enter must act on a visible result after Tab leaves a filtered search.
      if (next === "list" && !filtered().some((file) => file.filePath === selected())) {
        const file = filtered()[0];
        if (file) select(file);
      }
      setFocus(next);
      if (next.startsWith("include:") || next.startsWith("used:"))
        queueMicrotask(() => preview?.scrollChildIntoView(`library-action-${next}`));
    } else if (focus() === "search" && ["return", "enter", "down"].includes(name)) {
      const file = direction() === 1 ? filtered()[0] : filtered().at(-1);
      if (file) select(file, true);
    } else if (focus() === "editor" && ["return", "enter", "linefeed"].includes(name))
      editor?.newLine();
    // OpenCode suspends the textarea's native bindings while its keymap owns input.
    else if (focus() === "editor" && event.ctrl && name === "home")
      editor?.gotoBufferHome({ select: event.shift });
    else if (focus() === "editor" && event.ctrl && name === "end")
      editor?.gotoBufferEnd({ select: event.shift });
    else if (focus() === "editor" && event.ctrl && name === "z") editor?.undo();
    else if (focus() === "editor" && event.ctrl && name === "y") editor?.redo();
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

  const Button = (button: { id: string; label: string; shortcut?: string }) => (
    <Action
      id={`library-action-${button.id}`}
      theme={theme()}
      label={button.label}
      shortcut={button.shortcut}
      focused={focus() === button.id}
      selected={
        scope() === button.id ||
        (button.id === "inspect" && !editing()) ||
        (button.id === "edit" && editing())
      }
      disabled={busy() || modal()}
      run={() => {
        // Back acts on the current focus, just like Escape.
        if (button.id !== "back") setFocus(button.id);
        invoke(button.id);
      }}
    />
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
        paddingX={2}
        paddingTop={1}
        flexShrink={0}
      >
        <text fg={theme().text.base} wrapMode="none">
          <b>Snippets</b>
          <span
            style={{ fg: theme().text.muted }}
          >{`  ${props.context.ui.format.path(props.directory)}`}</span>
        </text>
        <Button id="back" label="" shortcut="esc" />
      </box>
      <box
        flexDirection="row"
        flexWrap="wrap"
        alignItems="center"
        gap={1}
        paddingX={2}
        paddingY={1}
        flexShrink={0}
      >
        <box flexDirection="row" width={width() < 90 ? "100%" : "45%"}>
          <input
            id="library-search"
            flexGrow={1}
            value={query()}
            focused={focus() === "search"}
            maxLength={Number.POSITIVE_INFINITY}
            placeholder="Search names, aliases or descriptions"
            placeholderColor={theme().text.muted}
            onMouseDown={() => setFocus("search")}
            onInput={setQuery}
            textColor={theme().text.base}
            focusedTextColor={theme().text.formfield.focused}
            cursorColor={theme().text.formfield.focused}
            backgroundColor={theme().background.base}
            focusedBackgroundColor={theme().background.formfield.focused}
          />
        </box>
        <ActionBar>
          <For each={["all", "project", "global"]}>
            {(id) => <Button id={id} label={`${scope() === id ? "● " : ""}${id}`} />}
          </For>
          <Button id="new" label="new" shortcut={focus() === "editor" ? "ctrl+n" : undefined} />
          <Button
            id="reload"
            label="reload"
            shortcut={focus() === "editor" ? "ctrl+r" : undefined}
          />
        </ActionBar>
      </box>
      <box flexDirection={width() < 80 ? "column" : "row"} flexGrow={1} minHeight={0}>
        <scrollbox
          id="library-list"
          scrollAcceleration={acceleration()}
          scrollbarOptions={{ visible: false }}
          ref={list}
          width={width() < 80 ? "100%" : "32%"}
          height={width() < 80 ? (editing() ? 5 : 7) : undefined}
          flexShrink={0}
          border={width() < 80 ? ["bottom"] : ["right"]}
          borderColor={focus() === "list" ? theme().text.base : theme().border.base}
        >
          <For
            each={filtered()}
            fallback={
              <text fg={theme().text.muted}>
                {files().length ? "No matching snippets." : "No snippets yet. Use new or :."}
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
                    ? listFocused()
                      ? theme().background.action.primary.focused
                      : theme().background.raised.high
                    : undefined
                }
                onMouseUp={() => {
                  if (!busy() && !modal()) select(file);
                }}
              >
                <text
                  fg={
                    selected() === file.filePath
                      ? listFocused()
                        ? theme().text.action.primary.focused
                        : theme().text.muted
                      : theme().text.base
                  }
                  attributes={
                    selected() === file.filePath && listFocused() ? TextAttributes.BOLD : undefined
                  }
                  wrapMode="none"
                >{`${selected() === file.filePath ? "›" : " "} #${file.name}${dirty(file.filePath) ? " *" : ""}`}</text>
                <text
                  fg={
                    selected() === file.filePath && listFocused()
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
            <box flexShrink={0} marginY={1}>
              <ActionBar>
                <Button id="inspect" label="inspect" />
                <Button
                  id="edit"
                  label="edit source"
                  shortcut={!editing() && focus() === "list" ? "enter" : undefined}
                />
                <Button id="save" label="save" shortcut="ctrl+s" />
                <Button id="more" label="more" shortcut={focus() === "editor" ? "ctrl+o" : ":"} />
              </ActionBar>
            </box>
            <Show
              when={editing()}
              fallback={
                // biome-ignore lint/a11y/noStaticElementInteractions: This terminal scrollbox is reachable with Tab and h/l.
                <scrollbox
                  id="library-preview"
                  ref={preview}
                  focused={focus() === "preview"}
                  onMouseDown={() => setFocus("preview")}
                  scrollAcceleration={acceleration()}
                  flexGrow={1}
                  minHeight={0}
                >
                  <Show when={snippetReferences(current()?.content ?? "").length}>
                    <text marginTop={1} fg={theme().text.muted}>
                      Includes (static references)
                    </text>
                    <For each={snippetReferences(current()?.content ?? "")}>
                      {(name) => (
                        <Button
                          id={`include:${name}`}
                          label={`→ #${name}${registry().has(name.toLowerCase()) ? "" : " (unresolved)"}`}
                        />
                      )}
                    </For>
                  </Show>
                  <Show when={used().length}>
                    <text marginTop={1} fg={theme().text.muted}>
                      Used by
                    </text>
                    <For each={used()}>
                      {(file) => <Button id={`used:${file.filePath}`} label={`← #${file.name}`} />}
                    </For>
                  </Show>
                  <Show when={current()?.aliases.length}>
                    <text
                      marginTop={1}
                      fg={theme().text.muted}
                    >{`Aliases: ${current()?.aliases.join(", ")}`}</text>
                  </Show>
                  <Show when={details().fields.length}>
                    <text fg={theme().text.muted}>{`Fields: ${details()
                      .fields.map((field) => `${field.name} (${field.type})`)
                      .join(", ")}`}</text>
                  </Show>
                  <Show when={details().error}>
                    <text fg={theme().text.feedback.error.base}>{details().error}</text>
                  </Show>
                  <text marginTop={1} fg={theme().text.muted}>
                    {focus() === "preview" ? "Source · preview focused" : "Source"}
                  </text>
                  <For each={(current()?.content ?? "").split("\n")}>
                    {(line) => (
                      <box flexDirection="row" flexWrap="wrap" flexShrink={0} minHeight={1}>
                        <For each={line.split(/(#[a-z0-9][a-z0-9_-]*)/gi)}>
                          {(part) => {
                            const reference =
                              /^#[a-z0-9]/i.test(part) &&
                              registry().has(part.slice(1).toLowerCase());
                            return (
                              // biome-ignore lint/a11y/noStaticElementInteractions: Includes above supply the same navigation with keyboard-focusable controls.
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
                  onMouseScroll={(event) => {
                    if (!event.scroll) return;
                    const direction = event.scroll.direction;
                    const axis = direction === "up" || direction === "down" ? "y" : "x";
                    const sign = direction === "up" || direction === "left" ? -1 : 1;
                    remainder[axis] += sign * event.scroll.delta * editorScroll.tick();
                    const delta = Math.trunc(remainder[axis]);
                    remainder[axis] -= delta;
                    event.scroll.delta = Math.abs(delta);
                  }}
                  onContentChange={() => update(editor?.plainText ?? raw())}
                  textColor={theme().text.formfield.base}
                  focusedTextColor={theme().text.formfield.base}
                  cursorColor={theme().text.base}
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
          executing it. j/k or ↑↓ move; counts repeat (3j). gg/G first/last; 5G row 5. H/M/L select
          viewport top/middle/bottom; zt/zz/zb align the selected row. Ctrl+D/U half page; Ctrl+F/B
          full page; Ctrl+E/Y scroll a line; Ctrl+N/P next/previous. h/l or ←/→ switch list and
          preview; Ctrl+W h/j/k/l/w switches panes. / searches forward, ? backward; n/N
          repeat/reverse. Ctrl+O/I jump back/forward. : opens actions; F1 toggles help; i or Enter
          edits. Tab reaches actions; includes accept mouse or focus + Enter. Ctrl+Home / Ctrl+End
          move to source boundaries; add Shift to select.
        </text>
      </Show>
      <box
        flexDirection="row"
        flexWrap="wrap"
        justifyContent="space-between"
        paddingX={2}
        paddingY={1}
        flexShrink={0}
      >
        <ActionBar>
          <text fg={theme().text.base}>
            {focus() === "editor" ? "find" : "search"}
            <span style={{ fg: theme().text.muted }}>
              {focus() === "editor" ? " ctrl+f" : " / ?"}
            </span>
          </text>
          <text fg={theme().text.base}>
            external<span style={{ fg: theme().text.muted }}> shift+enter</span>
          </text>
          <text fg={theme().text.base}>
            focus<span style={{ fg: theme().text.muted }}> tab / shift+tab</span>
          </text>
          <Show when={focus() === "list" || focus() === "preview"}>
            <text fg={theme().text.base}>
              {focus() === "list" ? "select" : "scroll"}
              <span style={{ fg: theme().text.muted }}> j/k ↑↓</span>
            </text>
          </Show>
          <Show when={focus() === "list" || focus() === "preview"}>
            <text fg={theme().text.base}>
              panes<span style={{ fg: theme().text.muted }}> h/l</span>
            </text>
          </Show>
          <text fg={theme().text.base}>
            back<span style={{ fg: theme().text.muted }}> esc</span>
          </text>
          <Show when={focus() !== "search" && focus() !== "editor"}>
            <text fg={theme().text.base}>
              quit<span style={{ fg: theme().text.muted }}> q</span>
            </text>
          </Show>
        </ActionBar>
        <Button
          id="help"
          label="help"
          shortcut={focus() !== "search" && focus() !== "editor" ? "f1" : undefined}
        />
        <Show when={command()}>
          <text fg={theme().text.muted}>{`pending ${command()}`}</text>
        </Show>
      </box>
    </box>
  );
}
