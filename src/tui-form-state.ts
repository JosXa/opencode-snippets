import {
  type FieldDefinition,
  type FieldValues,
  getSnippetForm,
  validateFields,
} from "./fields.js";
import { parseInvocation } from "./invocation.js";
import { findHashtagTriggerAtCursor } from "./tui-trigger.js";
import type { SnippetRegistry } from "./types.js";

export type FormDraft = Record<string, string | boolean>;

export function createFormDraft(fields: FieldDefinition[], values: FieldValues): FormDraft {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.type === "checkbox" ? values[field.name] === true : String(values[field.name] ?? ""),
    ]),
  );
}

/** Keep unfinished numbers as text until validation; blank must never become zero. */
export function validateFormDraft(fields: FieldDefinition[], draft: FormDraft) {
  const values: FieldValues = {};
  const numeric: Record<string, string> = {};
  for (const field of fields) {
    const value = draft[field.name];
    if (field.type !== "number") {
      values[field.name] = value ?? (field.type === "checkbox" ? false : "");
      continue;
    }
    const text = String(value ?? "").trim();
    if (!text) continue;
    const number = Number(text);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) || !Number.isFinite(number)) {
      numeric[field.name] = `${field.label} must be a finite number.`;
      continue;
    }
    values[field.name] = number;
  }
  return { values, errors: { ...validateFields(fields, values), ...numeric } };
}

export function moveFormFocus(current: number, count: number, backwards: boolean): number {
  return (current + (backwards ? count - 1 : 1)) % count;
}

export function formAwareTrigger(text: string, cursor: number, registry: SnippetRegistry) {
  const match = findHashtagTriggerAtCursor(text, cursor);
  if (!match) return;
  if (match.query.includes("(") && !/^skill\([^)]*$/.test(match.query)) return;
  // Existing invocations are edited through Ctrl+G, including their name and
  // literal hashtags in answers. Completing a name prefix would leave old args.
  for (const tag of text.matchAll(
    /#([a-z0-9][a-z0-9_-]*)(?=\(\s*(?:[A-Za-z][A-Za-z0-9_]*\s*=|\)))/gi,
  )) {
    if (tag.index > match.start) break;
    if (!registry.has(tag[1].toLowerCase())) continue;
    try {
      const invocation = parseInvocation(text, tag.index);
      if (invocation && invocation.end >= cursor) return;
    } catch {
      // Argument lists are temporarily incomplete while users edit them.
      return;
    }
  }
  return match;
}

export function exactSnippetTrigger(text: string, cursor: number, registry: SnippetRegistry) {
  const match = formAwareTrigger(text, cursor, registry);
  if (!match || !registry.has(match.query.toLowerCase())) return;
  if (/[\w(-]/.test(text[match.end] ?? "")) return;
  return match;
}

/** Parse entire invocations so hashtags inside quoted answers cannot become edit targets. */
export function findEditableInvocation(text: string, cursor: number, registry: SnippetRegistry) {
  const tags = /(^|\s)#([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;
  for (let tag = tags.exec(text); tag; tag = tags.exec(text)) {
    const start = tag.index + tag[1].length;
    if (start > cursor) return;
    if (!registry.has(tag[2].toLowerCase())) continue;
    // Fieldless snippets retain legacy parenthetical prose, not argument syntax.
    if (!getSnippetForm(tag[2], registry).fields.length) continue;
    const invocation = parseInvocation(text, start);
    if (!invocation) continue;
    if (cursor >= invocation.start && cursor <= invocation.end) return invocation;
    tags.lastIndex = invocation.end;
  }
}

/** Ask the native buffer to map UTF-16 ranges; display width is host-configured. */
export function nativeOffset(
  editor: { getTextRange(start: number, end: number): string },
  utf16: number,
): number {
  let start = 0;
  let end = Math.max(1, utf16);
  while (editor.getTextRange(0, end).length < utf16) end *= 2;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (editor.getTextRange(0, middle).length < utf16) start = middle + 1;
    else end = middle;
  }
  return start;
}

export function replaceReferenceRange(
  editor: {
    getTextRange(start: number, end: number): string;
    setSelection(start: number, end: number): void;
    deleteSelection(): boolean;
    insertText(text: string): void;
  },
  range: { start: number; end: number },
  replacement: string,
) {
  const start = nativeOffset(editor, range.start);
  const end = nativeOffset(editor, range.end);
  editor.setSelection(start, end);
  editor.deleteSelection();
  editor.insertText(replacement);
}
