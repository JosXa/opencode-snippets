/** @jsxImportSource @opentui/solid */
import type { usePlugin } from "@opencode/plugin/tui";
import { RGBA, TextAttributes } from "@opentui/core";
import { createSignal, type JSX, Show } from "solid-js";

type Theme = Pick<ReturnType<typeof usePlugin>["theme"], "background" | "text">;

// Match OpenCode's dialog footer: action text, muted shortcut, and a focus fill.
// The parent owns keyboard bindings and focus order; this supplies mouse parity.
export function Action(props: {
  id?: string;
  theme: Theme;
  label: string;
  shortcut?: string;
  focused?: boolean;
  selected?: boolean;
  disabled?: boolean;
  run(): void;
}) {
  const [hovered, setHovered] = createSignal(false);
  const highlighted = () => !props.disabled && (props.focused || hovered());
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithMouseEvents: Native OpenTUI actions share mouse highlighting with the parent's keyboard focus.
    <box
      id={props.id}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={
        highlighted() ? props.theme.background.action.primary.focused : RGBA.fromInts(0, 0, 0, 0)
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        if (!props.disabled) props.run();
      }}
    >
      <Show when={props.label}>
        <text
          fg={
            props.disabled
              ? props.theme.text.action.primary.disabled
              : highlighted()
                ? props.theme.text.action.primary.focused
                : props.theme.text.base
          }
          attributes={highlighted() || props.selected ? TextAttributes.BOLD : undefined}
        >
          {props.label}
        </text>
      </Show>
      <Show when={props.shortcut}>
        <text
          fg={
            props.disabled
              ? props.theme.text.action.primary.disabled
              : highlighted()
                ? props.theme.text.action.primary.focused
                : props.theme.text.muted
          }
        >
          {`${props.label ? " " : ""}${props.shortcut}`}
        </text>
      </Show>
    </box>
  );
}

export function ActionBar(props: { children: JSX.Element }) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0} alignItems="center">
      {props.children}
    </box>
  );
}
