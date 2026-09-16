/** @jsxImportSource @opentui/solid */
import type { usePlugin } from "@opencode/plugin/tui";
import type {
  KeyEvent,
  ScrollBoxRenderable,
  SelectRenderable,
  TextareaRenderable,
} from "@opentui/core";
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { FieldDefinition, FieldValues } from "./fields.js";
import { createFormDraft, moveFormFocus, validateFormDraft } from "./tui-form-state.js";

export function SnippetForm(props: {
  context: ReturnType<typeof usePlugin>;
  name: string;
  fields: FieldDefinition[];
  values: FieldValues;
  save(values: FieldValues): void;
  cancel(): void;
}) {
  const [focus, setFocus] = createSignal(0);
  const [draft, setDraft] = createSignal(createFormDraft(props.fields, props.values));
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [attempted, setAttempted] = createSignal(false);
  const [help, setHelp] = createSignal(false);
  let scroll: ScrollBoxRenderable | undefined;
  const editors = new Map<number, TextareaRenderable>();
  const selects = new Map<number, SelectRenderable>();
  const palette = () => props.context.theme.contextual.overlay;
  const colors = () => ({
    backgroundColor: palette().background.default,
    focusedBackgroundColor: palette().background.default,
    textColor: palette().text.default,
    focusedTextColor: palette().text.default,
  });
  const move = (index: number) => {
    setFocus(index);
    scroll?.scrollChildIntoView(`snippet-field-${index}`);
  };
  const update = (name: string, value: string | boolean) => {
    const next = { ...draft(), [name]: value };
    setDraft(next);
    if (attempted()) setErrors(validateFormDraft(props.fields, next).errors);
  };
  const toggleHelp = () => {
    setHelp((value) => !value);
    move(props.fields.length + 2);
    queueMicrotask(() => scroll?.scrollChildIntoView(`snippet-field-${props.fields.length + 2}`));
  };
  const save = () => {
    const result = validateFormDraft(props.fields, draft());
    setAttempted(true);
    setErrors(result.errors);
    const invalid = props.fields.findIndex((field) => result.errors[field.name]);
    if (invalid !== -1) return move(invalid);
    props.save(result.values);
  };
  const keys = (event: KeyEvent) => {
    const name = event.name.toLowerCase();
    const field = props.fields[focus()];
    const enter = ["return", "enter", "linefeed"].includes(name);
    const newline = (event.ctrl && name === "j") || name === "linefeed";
    if (name === "escape") props.cancel();
    else if (name === "tab") move(moveFormFocus(focus(), props.fields.length + 3, event.shift));
    else if (enter && event.ctrl && !newline) save();
    else if (newline && field?.type === "textarea") editors.get(focus())?.newLine();
    else if (enter) {
      if (focus() === props.fields.length + 1) props.cancel();
      else if (focus() === props.fields.length + 2) toggleHelp();
      else save();
    } else if (name === "space" && field?.type === "checkbox")
      update(field.name, !draft()[field.name]);
    else if (name === "space" && !field) {
      if (focus() === props.fields.length) save();
      else if (focus() === props.fields.length + 2) toggleHelp();
      else props.cancel();
    } else return;
    // Consume confirmation even when validation fails; host Enter submits prompts.
    event.preventDefault();
    event.stopPropagation();
  };
  onMount(() => props.context.renderer.keyInput.prependListener("keypress", keys));
  onCleanup(() => props.context.renderer.keyInput.removeListener("keypress", keys));

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
      gap={1}
      maxHeight={props.context.renderer.height}
      renderBefore={function () {
        // The host positions its dialog below the terminal top. Bound the whole
        // form at that actual position; Yoga accounts for wrapped hints and padding.
        const available = Math.max(0, props.context.renderer.height - this.y);
        if (this.maxHeight !== available) this.maxHeight = available;
      }}
    >
      <text flexShrink={0} fg={palette().text.default}>
        <b>Fields for #{props.name}</b>
      </text>
      <scrollbox
        ref={scroll}
        flexShrink={1}
        minHeight={0}
        contentOptions={{ minHeight: 0 }}
        onSizeChange={() => {
          // Layout settles after resize before we reveal the focused field again.
          queueMicrotask(() => scroll?.scrollChildIntoView(`snippet-field-${focus()}`));
        }}
      >
        <box gap={1}>
          <For each={props.fields}>
            {(field, index) => {
              const initial = String(props.values[field.name] ?? "");
              const label = () =>
                `${focus() === index() ? "› " : "  "}${field.label}${field.required ? " *" : ""}`;
              return (
                <box id={`snippet-field-${index()}`} flexShrink={0}>
                  <Show when={field.type !== "checkbox"}>
                    <text
                      fg={focus() === index() ? palette().text.default : palette().text.subdued}
                    >
                      {label()}
                    </text>
                  </Show>
                  <Switch>
                    <Match when={field.type === "textarea"}>
                      <textarea
                        {...colors()}
                        initialValue={initial}
                        height={4}
                        focused={focus() === index()}
                        ref={(editor) => editors.set(index(), editor)}
                        onMouseDown={() => move(index())}
                        onContentChange={() =>
                          update(field.name, editors.get(index())?.plainText ?? "")
                        }
                      />
                    </Match>
                    <Match when={field.type === "select"}>
                      <select
                        {...colors()}
                        focused={focus() === index()}
                        height={Math.min(4, (field.options?.length ?? 0) + 1)}
                        ref={(select) => selects.set(index(), select)}
                        itemSpacing={0}
                        options={[
                          {
                            name: field.required ? "(choose)" : "(none)",
                            description: "",
                            value: "",
                          },
                          ...(field.options ?? []).map((value) => ({
                            name: value,
                            description: "",
                            value,
                          })),
                        ]}
                        selectedIndex={(field.options ?? []).indexOf(initial) + 1}
                        selectedBackgroundColor={palette().background.action.primary.focused}
                        selectedTextColor={palette().text.action.primary.focused}
                        showDescription={false}
                        onMouseDown={(event) => {
                          move(index());
                          const select = selects.get(index());
                          if (!select) return;
                          // Native Select scrolls around its selected row. With
                          // one line per item this maps visible mouse rows exactly.
                          const offset = Math.max(
                            0,
                            Math.min(
                              select.getSelectedIndex() - Math.floor(select.height / 2),
                              (field.options?.length ?? 0) + 1 - select.height,
                            ),
                          );
                          select.setSelectedIndex(offset + event.y - select.y);
                          event.preventDefault();
                        }}
                        onChange={(_index, option) => {
                          if (typeof option?.value === "string") update(field.name, option.value);
                        }}
                      />
                    </Match>
                    <Match when={field.type === "checkbox"}>
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: Native OpenTUI checkbox; Space and mouse share one value. */}
                      <box
                        onMouseDown={() => {
                          move(index());
                          update(field.name, !draft()[field.name]);
                        }}
                      >
                        <text
                          fg={focus() === index() ? palette().text.default : palette().text.subdued}
                        >
                          {`${label()}  [${draft()[field.name] ? "x" : " "}]`}
                        </text>
                      </box>
                    </Match>
                    <Match when={field.type === "text" || field.type === "number"}>
                      {/* Native Input defaults to a 1000 UTF-16-unit cap. Keep all text;
                          field validation applies Unicode-point constraints without truncation. */}
                      <input
                        {...colors()}
                        maxLength={Number.POSITIVE_INFINITY}
                        value={initial}
                        focused={focus() === index()}
                        placeholder={field.type === "number" ? "Enter a number" : ""}
                        onMouseDown={() => move(index())}
                        onInput={(value) => update(field.name, value)}
                      />
                    </Match>
                  </Switch>
                  <Show when={errors()[field.name]}>
                    <text fg={props.context.theme.text.danger}>⚠ {errors()[field.name]}</text>
                  </Show>
                </box>
              );
            }}
          </For>
          <Show when={help()}>
            <box flexShrink={0}>
              <text fg={palette().text.subdued}>Enter confirms · Escape cancels</text>
              <text fg={palette().text.subdued}>
                Tab / Shift+Tab move · arrows choose · Space toggles · Ctrl+J newline
              </text>
              <text fg={palette().text.subdued}>
                Ctrl+G edits fields in the composer · * Required
              </text>
            </box>
          </Show>
          <box flexDirection="row" gap={3} flexShrink={0}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Native OpenTUI buttons also accept keyboard Enter or Space. */}
            <box id={`snippet-field-${props.fields.length}`} onMouseUp={save}>
              <text
                fg={
                  focus() === props.fields.length
                    ? palette().text.action.primary.focused
                    : palette().text.default
                }
                bg={
                  focus() === props.fields.length
                    ? palette().background.action.primary.focused
                    : undefined
                }
              >
                {" "}
                OK{" "}
              </text>
            </box>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Native OpenTUI buttons also accept keyboard Enter or Space. */}
            <box id={`snippet-field-${props.fields.length + 1}`} onMouseUp={props.cancel}>
              <text
                fg={
                  focus() === props.fields.length + 1
                    ? palette().text.action.primary.focused
                    : palette().text.subdued
                }
                bg={
                  focus() === props.fields.length + 1
                    ? palette().background.action.primary.focused
                    : undefined
                }
              >
                {" "}
                Cancel{" "}
              </text>
            </box>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Native OpenTUI button accepts Enter, Space and mouse. */}
            <box id={`snippet-field-${props.fields.length + 2}`} onMouseUp={toggleHelp}>
              <text
                fg={
                  focus() === props.fields.length + 2
                    ? palette().text.action.primary.focused
                    : palette().text.subdued
                }
                bg={
                  focus() === props.fields.length + 2
                    ? palette().background.action.primary.focused
                    : undefined
                }
              >
                {" "}
                Help{" "}
              </text>
            </box>
          </box>
        </box>
      </scrollbox>
    </box>
  );
}
