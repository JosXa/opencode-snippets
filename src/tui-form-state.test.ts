import { describe, expect, test } from "bun:test";
import { InputRenderable, PasteEvent, TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { type FieldDefinition, getSnippetForm } from "./fields.js";
import { serializeInvocation } from "./invocation.js";
import {
  createFormDraft,
  exactSnippetTrigger,
  findEditableInvocation,
  formAwareTrigger,
  moveFormFocus,
  nativeOffset,
  replaceReferenceRange,
  validateFormDraft,
} from "./tui-form-state.js";
import type { SnippetInfo, SnippetRegistry } from "./types.js";

const snippet = (name: string, content: string, fields?: unknown): SnippetInfo => ({
  name,
  content,
  aliases: [],
  filePath: `/tmp/${name}.md`,
  source: "project",
  ...(fields === undefined ? {} : { fields }),
});
const registry: SnippetRegistry = new Map([
  [
    "review",
    snippet("review", "{{count}}{{focus}}{{fix}}", {
      count: { type: "number", default: 1, min: 0, integer: true },
      focus: { type: "textarea" },
      fix: { type: "checkbox" },
    }),
  ],
  ["review-three", snippet("review-three", "#review(count=3, fix=yes)")],
  ["legacy", snippet("legacy", "literal body")],
]);
registry.set("rev", snippet("review", "{{count}}", { count: { type: "number", default: 1 } }));

describe("form transitions", () => {
  test("preserves typed zero, false, multiline Unicode, and preset defaults on reopen", () => {
    const { fields, values } = getSnippetForm("review-three", registry);
    expect(createFormDraft(fields, values)).toEqual({ count: "3", focus: "", fix: true });
    const supplied = { count: 0, focus: '中🙂\n"quoted", (text) #review', fix: false };
    const text = serializeInvocation("review-three", supplied);
    const found = findEditableInvocation(text, text.indexOf("quoted"), registry);
    if (!found) throw new Error("Invocation not found");
    const restored = getSnippetForm(found.name, registry, found.values);
    const result = validateFormDraft(
      restored.fields,
      createFormDraft(restored.fields, restored.values),
    );
    expect(result.errors).toEqual({});
    expect(result.values).toEqual(supplied);
    expect(serializeInvocation(found.name, result.values)).toBe(text);
  });

  test("distinguishes blank numeric input from zero and rejects unfinished or infinite numbers", () => {
    const fields: FieldDefinition[] = [
      { name: "n", label: "Count", type: "number", required: true, min: 0, max: 10, integer: true },
    ];
    expect(validateFormDraft(fields, { n: "" }).errors.n).toContain("required");
    expect(validateFormDraft(fields, { n: "0" })).toEqual({ values: { n: 0 }, errors: {} });
    for (const n of ["-", "1e", "Infinity", "1e999", "0x10", "abc"])
      expect(validateFormDraft(fields, { n }).errors.n).toContain("finite number");
    expect(validateFormDraft(fields, { n: "0.5" }).errors.n).toContain("integer");
    expect(validateFormDraft(fields, { n: "11" }).errors.n).toContain("10");
    expect(validateFormDraft([{ ...fields[0], required: false }], { n: " " })).toEqual({
      values: {},
      errors: {},
    });
  });

  test("validates native select and text values without silently truncating Unicode", () => {
    const fields: FieldDefinition[] = [
      { name: "task", label: "Task", type: "text", required: true, maxLength: 2 },
      {
        name: "mode",
        label: "Mode",
        type: "select",
        required: true,
        options: ["quick", "thorough"],
      },
      { name: "flag", label: "Flag", type: "checkbox", required: true },
    ];
    expect(validateFormDraft(fields, { task: "🙂中", mode: "quick", flag: false }).errors).toEqual(
      {},
    );
    const errors = validateFormDraft(fields, { task: "🙂中x", mode: "wrong", flag: false }).errors;
    expect(errors.task).toContain("2");
    expect(errors.mode).toContain("choose");
    expect(validateFormDraft(fields, { task: " ", mode: "", flag: false }).errors.task).toContain(
      "required",
    );
  });

  test("cycles through fields and both action buttons in both directions", () => {
    expect(moveFormFocus(0, 5, true)).toBe(4);
    expect(moveFormFocus(4, 5, false)).toBe(0);
    expect(moveFormFocus(2, 5, false)).toBe(3);
    expect(moveFormFocus(3, 5, true)).toBe(2);
  });
});

describe("form invocation targeting", () => {
  test("suppresses completion throughout an existing invocation name and retains Ctrl+G editing", () => {
    for (const suffix of ['(focus="Payroll #review")', "()", '(focus="unfinished']) {
      const prefix = "🙂 ";
      const text = `${prefix}#review${suffix}`;
      for (const position of [1, 2, 4, 7]) {
        const cursor = prefix.length + position;
        expect(formAwareTrigger(text, cursor, registry)).toBeUndefined();
        expect(exactSnippetTrigger(text, cursor, registry)).toBeUndefined();
        if (suffix.endsWith(")"))
          expect(findEditableInvocation(text, cursor, registry)?.start).toBe(prefix.length);
      }
    }
    for (const cursor of [1, 2, 4, 7]) {
      expect(formAwareTrigger("#review", cursor, registry)?.query).toBe(
        "review".slice(0, cursor - 1),
      );
    }
    expect(formAwareTrigger('#rev #review(focus="Payroll")', 4, registry)?.query).toBe("rev");
  });
  test("does not complete literal hashtags inside filled or unfinished answers", () => {
    for (const text of ['#review(focus="look #review")', '#review(focus="look #review']) {
      const cursor = text.lastIndexOf("#review") + 7;
      expect(formAwareTrigger(text, cursor, registry)).toBeUndefined();
      expect(exactSnippetTrigger(text, cursor, registry)).toBeUndefined();
    }
    const text = '#review(focus="#review") #rev';
    expect(formAwareTrigger(text, text.length, registry)?.query).toBe("rev");
    expect(formAwareTrigger("#skill(ex", 9, registry)?.query).toBe("skill(ex");
  });
  test("space accepts exact names and aliases, never partial, escaped, unknown, or filled tags", () => {
    for (const name of ["review", "rev", "REVIEW"]) {
      const text = `中🙂 #${name}`;
      expect(exactSnippetTrigger(text, text.length, registry)?.query).toBe(name);
    }
    for (const text of ["#re", "#reviews", "#_review", "#review(count=3)", "#unknown", "#review-"])
      expect(exactSnippetTrigger(text, text.length, registry)).toBeUndefined();
    expect(exactSnippetTrigger("#review-three", 7, registry)).toBeUndefined();
    expect(exactSnippetTrigger("#review(count=3)", 7, registry)).toBeUndefined();
    expect(exactSnippetTrigger("#review after", 7, registry)?.query).toBe("review");
  });

  test("locates the outer invocation when the cursor is inside a quoted hashtag", () => {
    const text = '🙂 #review(focus="look at #review-three, (now)") #review(count=0)';
    expect(findEditableInvocation(text, text.indexOf("#review-three") + 3, registry)?.start).toBe(
      3,
    );
    const last = text.lastIndexOf("#review");
    expect(findEditableInvocation(text, last + 8, registry)?.start).toBe(last);
    expect(findEditableInvocation(text, 0, registry)).toBeUndefined();
  });

  test("keeps fieldless parenthetical prose and escaped/unknown tags out of editing", () => {
    const text = "#legacy(parenthetical prose) #_review #unknown #review";
    expect(findEditableInvocation(text, 8, registry)).toBeUndefined();
    expect(findEditableInvocation(text, text.length, registry)?.name).toBe("review");
  });

  test("reports a malformed known invocation rather than editing a truncated prefix", () => {
    expect(() => findEditableInvocation('#review(focus="unfinished', 20, registry)).toThrow();
  });
});

describe("native input limits", () => {
  test("preserves long initial and pasted astral answers and validates without truncation", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 });
    const initial = "🙂中".repeat(501);
    const pasted = "🚀é".repeat(502);
    const input = new InputRenderable(renderer, {
      id: "unlimited-form-input",
      value: initial,
      maxLength: Number.POSITIVE_INFINITY,
    });
    try {
      expect(input.plainText).toBe(initial);
      input.gotoBufferEnd();
      input.handlePaste(new PasteEvent(new TextEncoder().encode(pasted)));
      const complete = initial + pasted;
      expect(input.plainText).toBe(complete);
      const field: FieldDefinition = {
        name: "answer",
        label: "Answer",
        type: "text",
        required: true,
      };
      expect(validateFormDraft([field], { answer: input.plainText })).toEqual({
        values: { answer: complete },
        errors: {},
      });
      const rejected = validateFormDraft([{ ...field, maxLength: 2 }], { answer: input.plainText });
      expect(rejected.errors.answer).toContain("2");
      expect(rejected.values.answer).toBe(complete);
      expect(input.plainText).toBe(complete);
      input.value = "🙂中";
      expect(
        validateFormDraft([{ ...field, maxLength: 2 }], { answer: input.plainText }).errors,
      ).toEqual({});
      input.gotoBufferEnd();
      input.handlePaste(new PasteEvent(new TextEncoder().encode("🚀")));
      expect(
        validateFormDraft([{ ...field, maxLength: 2 }], { answer: input.plainText }).errors.answer,
      ).toContain("2");
      expect(input.plainText).toBe("🙂中🚀");
    } finally {
      input.destroy();
      renderer.destroy();
    }
  });
});

describe("native reference edits", () => {
  test("replaces only the reference and relocates attachment extmarks around Unicode", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 });
    const before = "[image] 👩‍💻 中é\t\n";
    const reference = '#review(focus="🙂old")';
    const after = " café [file]";
    const editor = new TextareaRenderable(renderer, {
      id: "range-test",
      initialValue: before + reference + after,
    });
    const range = { start: before.length, end: before.length + reference.length };
    const first = editor.extmarks.create({
      start: 0,
      end: 7,
      virtual: true,
      data: { id: "image-payload" },
    });
    const offset = nativeOffset(editor, editor.plainText.indexOf("[file]"));
    const last = editor.extmarks.create({
      start: offset,
      end: offset + 6,
      virtual: true,
      data: { id: "file-payload" },
    });
    try {
      const replacement = '#review(count=0, focus="new \\n 中🙂", fix=no)';
      replaceReferenceRange(editor, range, replacement);
      expect(editor.plainText).toBe(before + replacement + after);
      expect(editor.extmarks.get(first)?.data).toEqual({ id: "image-payload" });
      expect(editor.extmarks.get(last)?.data).toEqual({ id: "file-payload" });
      const moved = editor.extmarks.get(last);
      if (!moved) throw new Error("Attachment extmark was removed");
      expect(editor.getTextRange(moved.start, moved.end)).toBe("[file]");
      expect(editor.getTextRange(0, editor.cursorOffset)).toBe(before + replacement);
    } finally {
      editor.destroy();
      renderer.destroy();
    }
  });
});
