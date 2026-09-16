import { importCjs } from "./cjs-interop.js";
import { parseInvocation, validFieldName } from "./invocation.js";
import type { LiteralStore } from "./literals.js";
import type { SnippetInfo, SnippetRegistry } from "./types.js";

const Handlebars = await importCjs<typeof import("handlebars")>("handlebars");

export type FieldValue = string | number | boolean;
export type FieldValues = Record<string, FieldValue>;
export interface FieldDefinition {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "checkbox" | "select";
  required: boolean;
  default?: FieldValue;
  min?: number;
  max?: number;
  integer?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  options?: string[];
}

// A narrow view of the genuine Handlebars AST, shared by discovery and rendering.
interface Node {
  type: string;
  value?: FieldValue;
  original?: string;
  path?: Node;
  params?: Node[];
  hash?: { pairs: Array<{ key: string; value: Node }> };
  body?: Node[];
  program?: Node;
  inverse?: Node;
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.body ?? []) walk(child, visit);
  for (const child of node.params ?? []) walk(child, visit);
  for (const pair of node.hash?.pairs ?? []) walk(pair.value, visit);
  if (node.program) walk(node.program, visit);
  if (node.inverse) walk(node.inverse, visit);
}

function hasInlineSkill(content: string): boolean {
  // Only helper positions opt in. Quoted words, context paths and comments must
  // not turn legacy template examples (even malformed ones) into executable input.
  let end = 0;
  for (const match of content.matchAll(/\{\{/g)) {
    if (
      match.index < end ||
      (content[match.index - 1] === "\\" && content[match.index - 2] !== "\\")
    )
      continue;
    const start = match.index + 2;
    const comment = /^~?!/.test(content.slice(start));
    if (comment) {
      const close = (/^~?!--/.test(content.slice(start)) ? /--~?\}\}/ : /~?\}\}/).exec(
        content.slice(start),
      );
      end = close ? start + close.index + close[0].length : content.length;
      continue;
    }
    let head = true;
    const tokens =
      /"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|\}\}\}?|[A-Za-z_$][\w$-]*|[^\s]/g;
    for (const token of content.slice(start).matchAll(tokens)) {
      const value = token[0];
      if (value.startsWith("}}")) {
        end = start + token.index + value.length;
        break;
      }
      if (head && value === "skill") return true;
      if (head && ["~", "{", "#", "&"].includes(value)) continue;
      head = value === "(";
    }
  }
  return false;
}

function isInlineSkill(node: Node): boolean {
  return (
    node.path?.original === "skill" &&
    Boolean(
      node.params?.length ||
        node.hash?.pairs.length ||
        node.type === "BlockStatement" ||
        node.type === "SubExpression",
    )
  );
}

function ast({ content, ...metadata }: Pick<SnippetInfo, "content" | "fields">): Node | undefined {
  const declared = Object.hasOwn(metadata, "fields");
  if (!declared && !hasInlineSkill(content)) return;
  const tree = Handlebars.parse(content) as unknown as Node;
  let found = false;
  walk(tree, (node) => {
    if (isInlineSkill(node)) found = true;
  });
  return declared || found ? tree : undefined;
}

function mapping(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function declaration(name: string, metadata: unknown): Partial<FieldDefinition> & { name: string } {
  if (!validFieldName(name)) throw new Error(`Invalid field key '${name}'`);
  if (!mapping(metadata)) throw new Error(`${name}: field definition must be a mapping`);
  const result: Record<string, unknown> = { name };
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "options") {
      if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string"))
        throw new Error(`${name}: options must be a nonempty array of strings`);
      result.options = [...value];
      continue;
    }
    if (
      ![
        "label",
        "type",
        "default",
        "required",
        "min",
        "max",
        "integer",
        "minLength",
        "maxLength",
        "pattern",
      ].includes(key)
    )
      throw new Error(`${name}: unknown metadata '${key}'`);
    if (key === "default" && !["string", "number", "boolean"].includes(typeof value))
      throw new Error(`${name}: default must be text, a number, or a boolean`);
    if (["required", "integer"].includes(key) && typeof value !== "boolean")
      throw new Error(`${name}: ${key} must be boolean`);
    if (["label", "type", "pattern"].includes(key) && typeof value !== "string")
      throw new Error(`${name}: ${key} must be text`);
    if (
      ["min", "max", "minLength", "maxLength"].includes(key) &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      throw new Error(`${name}: ${key} must be finite`);
    result[key] = value;
  }
  return result as Partial<FieldDefinition> & { name: string };
}

export function validateFields(
  fields: FieldDefinition[],
  values: FieldValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    const error = (message: string) => {
      errors[field.name] = `${field.label}: ${message}`;
    };
    if (value === undefined) {
      if (field.required) error("is required");
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        error("must be a finite number");
        continue;
      }
      if (field.integer && !Number.isInteger(value)) error("must be an integer");
      if (field.min !== undefined && value < field.min) error(`must be at least ${field.min}`);
      if (field.max !== undefined && value > field.max) error(`must be at most ${field.max}`);
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof value !== "boolean") error("must be yes or no");
      continue;
    }
    if (typeof value !== "string") {
      error("must be text");
      continue;
    }
    if (field.required && !value.trim()) error("is required");
    const length = [...value].length;
    if (field.minLength !== undefined && length < field.minLength)
      error(`needs at least ${field.minLength} characters`);
    if (field.maxLength !== undefined && length > field.maxLength)
      error(`allows at most ${field.maxLength} characters`);
    if (field.pattern && !new RegExp(field.pattern).test(value))
      error(`must match pattern ${field.pattern}`);
    if (field.type === "select" && value !== "" && !field.options?.includes(value))
      error(`choose ${field.options?.join(", ")}`);
  }
  for (const key of Object.keys(values))
    if (!fields.some((field) => field.name === key)) errors[key] = `Unknown field '${key}'`;
  return errors;
}

export function getSnippetForm(
  name: string,
  registry: SnippetRegistry,
  supplied: FieldValues = {},
): { fields: FieldDefinition[]; values: FieldValues } {
  const definitions = new Map<string, Partial<FieldDefinition> & { name: string }>();
  const presets: FieldValues = {};
  const visit = (name: string, ancestors: string[]): boolean => {
    const snippet = registry.get(name.toLowerCase());
    if (!snippet || ancestors.includes(snippet.name) || ancestors.length >= 15) return false;
    if (snippet.metadataError)
      throw new Error(`#${snippet.name}: invalid frontmatter: ${snippet.metadataError}`);
    let found = false;
    if (Object.hasOwn(snippet, "fields")) {
      if (!mapping(snippet.fields)) throw new Error(`#${snippet.name}: fields must be a mapping`);
      for (const [key, metadata] of Object.entries(snippet.fields)) {
        found = true;
        const next = declaration(key, metadata);
        const prior = definitions.get(next.name) ?? { name: next.name };
        for (const key of Object.keys(next) as Array<keyof FieldDefinition>)
          if (prior[key] !== undefined && JSON.stringify(prior[key]) !== JSON.stringify(next[key]))
            throw new Error(`Conflicting definitions for '${next.name}' (${key})`);
        definitions.set(next.name, { ...prior, ...next });
      }
    }
    const tree = ast(snippet);
    const references = (text: string) => {
      const pattern = /#([a-z0-9][a-z0-9_-]*)/gi;
      let end = 0;
      for (const match of text.matchAll(pattern)) {
        if (match.index < end || match[1].toLowerCase() === "skill") continue;
        const child = registry.get(match[1].toLowerCase());
        if (!child) continue;
        const nested = visit(child.name, [...ancestors, snippet.name]);
        found ||= nested;
        // Parenthetical prose after fieldless legacy snippets remains prose.
        const hasArgs = /^\(\s*[A-Za-z][A-Za-z0-9_]*\s*=/.test(
          text.slice(match.index + match[0].length),
        );
        const invocation = nested || hasArgs ? parseInvocation(text, match.index) : undefined;
        if (invocation) {
          Object.assign(presets, invocation.values);
          end = invocation.end;
        }
      }
    };
    const inspect = (node: Node) => {
      if (
        node.path?.original === "skill" &&
        (node.type !== "MustacheStatement" ||
          node.params?.length !== 1 ||
          node.params[0].type !== "StringLiteral" ||
          node.hash?.pairs.length)
      )
        throw new Error('skill needs one literal name, for example {{skill "review"}}');
      if (node.type === "ContentStatement") references(String(node.value));
    };
    if (tree) walk(tree, inspect);
    if (!tree) references(snippet.content);
    return found;
  };
  if (!registry.has(name.toLowerCase())) throw new Error(`Unknown snippet '#${name}'`);
  visit(name, []);
  const fields: FieldDefinition[] = [...definitions.values()].map((item) => ({
    label: item.name
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase()),
    type: "text",
    required: false,
    ...item,
  }));
  for (const field of fields) {
    if (!["text", "textarea", "number", "checkbox", "select"].includes(field.type))
      throw new Error(`${field.name}: unknown field type`);
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        throw new Error(`${field.label}: invalid regular expression '${field.pattern}'`);
      }
    }
    for (const key of ["minLength", "maxLength"] as const) {
      const bound = field[key];
      if (bound !== undefined && (!Number.isInteger(bound) || bound < 0))
        throw new Error(`${field.label}: ${key} must be a nonnegative integer`);
    }
    if (
      (field.min !== undefined && field.max !== undefined && field.min > field.max) ||
      (field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength)
    )
      throw new Error(`${field.label}: minimum exceeds maximum`);
    if (field.type === "select" && !field.options?.length)
      throw new Error(`${field.label}: select needs options`);
    if (
      field.type !== "number" &&
      [field.min, field.max, field.integer].some((value) => value !== undefined)
    )
      throw new Error(`${field.label}: numeric constraints require type=number`);
    if (
      !["text", "textarea", "select"].includes(field.type) &&
      [field.minLength, field.maxLength, field.pattern].some((value) => value !== undefined)
    )
      throw new Error(`${field.label}: string constraints require text`);
    if (field.options && field.type !== "select")
      throw new Error(`${field.label}: options require type=select`);
    if (field.default !== undefined) {
      const errors = validateFields([field], { [field.name]: field.default });
      if (Object.keys(errors).length)
        throw new Error(`Invalid default: ${Object.values(errors).join("; ")}`);
    }
  }
  const values: FieldValues = {};
  for (const field of fields) {
    const value =
      supplied[field.name] ??
      presets[field.name] ??
      field.default ??
      (field.type === "checkbox" ? false : field.type === "number" ? undefined : "");
    if (value !== undefined) values[field.name] = value;
  }
  for (const key of [...Object.keys(presets), ...Object.keys(supplied)])
    if (!definitions.has(key)) throw new Error(`#${name}: unknown field '${key}'`);
  return { fields, values };
}

export function renderSnippet(
  snippet: Pick<SnippetInfo, "content" | "fields">,
  values: FieldValues,
  literals: LiteralStore,
  skill?: (name: string) => string,
): string {
  const tree = ast(snippet);
  if (!tree) return snippet.content;
  const engine = Handlebars.create();
  // Handlebars' legacy Error subclass cannot capture a stack after OpenTUI
  // initializes Bun's renderer. Keep missing-helper diagnostics readable.
  engine.registerHelper("helperMissing", (...args: unknown[]) => {
    if (args.length === 1) return;
    const options = args.at(-1) as { name: string };
    throw new Error(`Missing helper: "${options.name}"`);
  });
  engine.registerHelper("eq", (a, b) => a === b);
  engine.registerHelper("gt", (a, b) => a > b);
  engine.registerHelper("plural", (count, one, many) => (count === 1 ? one : many));
  engine.registerHelper("skill", (name: string) => {
    if (!skill) throw new Error(`Inline skill '${name}' is unavailable`);
    return skill(name);
  });
  engine.registerHelper("__literal", (value: unknown) =>
    literals.protect(typeof value === "boolean" ? (value ? "yes" : "no") : String(value ?? "")),
  );
  // Wrap output expressions, never condition operands: 0/false retain native truthiness.
  const rewrite = (node: Node) => {
    for (const statement of node.body ?? []) {
      if (statement.type === "MustacheStatement" && !isInlineSkill(statement)) {
        const expression: Node =
          statement.params?.length ||
          statement.hash?.pairs.length ||
          ["eq", "gt", "plural"].includes(statement.path?.original ?? "")
            ? { ...statement, type: "SubExpression" }
            : (statement.path as Node);
        const wrapper = Handlebars.parse("{{__literal value}}").body[0] as unknown as Node;
        statement.path = wrapper.path;
        statement.params = [expression];
        statement.hash = wrapper.hash;
      }
      if (statement.program) rewrite(statement.program);
      if (statement.inverse) rewrite(statement.inverse);
    }
  };
  rewrite(tree);
  return engine.compile(tree as unknown as Parameters<typeof engine.compile>[0], {
    noEscape: true,
  })(values);
}
