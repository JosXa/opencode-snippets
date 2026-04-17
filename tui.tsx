/** @jsxImportSource @opentui/solid */
import type {
  TuiDialogSelectOption,
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptInfo,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal } from "solid-js";
import { listSnippets, loadSnippets } from "./src/loader.js";
import {
  findTrailingHashtagTrigger,
  insertSnippetTag,
  truncateSnippetPreview,
} from "./src/tui-trigger.js";
import type { SnippetInfo } from "./src/types.js";

const id = "opencode-snippets:tui";

function sortSnippets(snippets: SnippetInfo[]): SnippetInfo[] {
  return [...snippets].sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === "project") return -1;
      return 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function matchesSnippet(snippet: SnippetInfo, query: string): boolean {
  if (!query) return true;

  const needle = query.toLowerCase();
  const haystack = [snippet.name, ...snippet.aliases, snippet.description || "", snippet.source]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function snippetDescription(snippet: SnippetInfo): string {
  const parts = [
    snippet.description,
    snippet.aliases.length ? `aliases: ${snippet.aliases.join(", ")}` : "",
    snippet.source,
  ];
  return parts.filter(Boolean).join(" | ");
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

function applySnippet(prompt: TuiPromptRef, name: string): void {
  setPromptInput(prompt, insertSnippetTag(prompt.current.input, name));
}

function SnippetPicker(props: {
  api: TuiPluginApi;
  prompt: TuiPromptRef;
  initialQuery: string;
  snippets: SnippetInfo[];
  onDone: (selected: boolean) => void;
}) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const options = createMemo<TuiDialogSelectOption<SnippetInfo>[]>(() => {
    return props.snippets
      .filter((snippet) => matchesSnippet(snippet, query().trim()))
      .map((snippet) => ({
        title: `#${snippet.name}`,
        value: snippet,
        category: snippet.source === "project" ? "Project snippets" : "Global snippets",
        description: snippetDescription(snippet),
        footer: truncateSnippetPreview(snippet.content),
      }));
  });

  return (
    <props.api.ui.DialogSelect
      title="Insert snippet"
      placeholder="Filter snippets"
      options={options()}
      skipFilter
      onFilter={setQuery}
      onSelect={(option) => {
        applySnippet(props.prompt, option.value.name);
        props.onDone(true);
        props.api.ui.dialog.clear();
      }}
    />
  );
}

async function getSnippets(api: TuiPluginApi): Promise<SnippetInfo[]> {
  const registry = await loadSnippets(api.state.path.directory);
  return sortSnippets(listSnippets(registry));
}

async function openSnippetPicker(
  api: TuiPluginApi,
  prompt: TuiPromptRef,
  initialQuery: string,
  onDone: (selected: boolean) => void,
): Promise<void> {
  const snippets = await getSnippets(api);
  if (snippets.length === 0) {
    api.ui.toast({
      variant: "info",
      message: "No snippets found in global or project snippet directories.",
    });
    onDone(false);
    return;
  }

  let finished = false;
  const done = (selected: boolean) => {
    if (finished) return;
    finished = true;
    onDone(selected);
    setTimeout(() => {
      prompt.focus();
    }, 0);
  };

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(
    () => (
      <SnippetPicker
        api={api}
        prompt={prompt}
        initialQuery={initialQuery}
        snippets={snippets}
        onDone={done}
      />
    ),
    () => {
      done(false);
    },
  );
}

function PromptWithSnippetPicker(props: {
  api: TuiPluginApi;
  bindPrompt: (ref: TuiPromptRef | undefined) => void;
  hostRef?: (ref: TuiPromptRef | undefined) => void;
  sessionID?: string;
  workspaceID?: string;
  visible?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  right?: unknown;
}) {
  const [prompt, setPrompt] = createSignal<TuiPromptRef>();
  const [pending, setPending] = createSignal(false);
  const [dismissed, setDismissed] = createSignal<string>();

  const bind = (ref: TuiPromptRef | undefined) => {
    setPrompt(ref);
    props.bindPrompt(ref);
    props.hostRef?.(ref);
  };

  createEffect(() => {
    const ref = prompt();
    const input = ref?.current.input || "";
    const match = findTrailingHashtagTrigger(input);

    if (!match) {
      if (dismissed()) setDismissed(undefined);
      return;
    }

    if (!ref?.focused) return;
    if (pending()) return;
    if (dismissed() === match.token) return;

    setPending(true);
    void openSnippetPicker(props.api, ref, match.query, (selected) => {
      setPending(false);
      if (selected) {
        setDismissed(undefined);
        return;
      }

      const next = findTrailingHashtagTrigger(ref.current.input);
      setDismissed(next?.token);
    });
  });

  return (
    <props.api.ui.Prompt
      sessionID={props.sessionID}
      workspaceID={props.workspaceID}
      visible={props.visible}
      disabled={props.disabled}
      onSubmit={props.onSubmit}
      ref={bind}
      right={props.right}
    />
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
      description: "Open a picker and insert a #snippet into the current prompt",
      category: "Prompt",
      hidden: !currentPrompt,
      onSelect() {
        if (!currentPrompt) return;

        const query = findTrailingHashtagTrigger(currentPrompt.current.input)?.query || "";
        void openSnippetPicker(api, currentPrompt, query, () => {});
      },
    },
  ]);

  api.slots.register({
    order: 100,
    slots: {
      home_prompt(_ctx, value) {
        return (
          <PromptWithSnippetPicker
            api={api}
            bindPrompt={bindPrompt}
            hostRef={value.ref}
            workspaceID={value.workspace_id}
            right={<api.ui.Slot name="home_prompt_right" workspace_id={value.workspace_id} />}
          />
        );
      },
      session_prompt(_ctx, value) {
        return (
          <PromptWithSnippetPicker
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
