import type { FieldValues } from "./fields.js";

export const validFieldName = (name: string): boolean =>
  /^[A-Za-z][A-Za-z0-9_]*$/.test(name) &&
  name !== "prototype" &&
  !Object.hasOwn(Object.prototype, name);

export interface Invocation {
  name: string;
  start: number;
  end: number;
  values: FieldValues;
  parameterized: boolean;
}

/** Parse one complete invocation. Offsets refer to JavaScript UTF-16 strings. */
export function parseInvocation(text: string, start: number): Invocation | undefined {
  const match = /^#([a-z0-9][a-z0-9_-]*)/i.exec(text.slice(start));
  if (!match) return;
  const name = match[1];
  let end = start + match[0].length;
  const values: FieldValues = {};
  if (text[end] !== "(") return { name, start, end, values, parameterized: false };
  const fail = (message: string): never => {
    throw new Error(`#${name}: ${message}`);
  };
  end++;
  const space = () => {
    while (/\s/.test(text[end] ?? "") && end < text.length) end++;
  };
  space();
  if (text[end] === ")") return { name, start, end: end + 1, values, parameterized: true };
  while (end < text.length) {
    const key = /^[A-Za-z][A-Za-z0-9_]*/.exec(text.slice(end))?.[0];
    if (!key || !validFieldName(key)) return fail("expected a valid field name");
    const field = key;
    if (Object.hasOwn(values, field)) fail(`duplicate field '${field}'`);
    end += field.length;
    space();
    if (text[end++] !== "=") fail(`expected '=' after '${field}'`);
    space();
    if (text[end] === '"') {
      const begin = end++;
      while (end < text.length && text[end] !== '"') {
        if (text[end] === "\\") end++;
        end++;
      }
      if (text[end] !== '"') fail(`unterminated string for '${field}'`);
      try {
        values[field] = JSON.parse(text.slice(begin, ++end));
      } catch {
        fail(`invalid JSON string for '${field}'`);
      }
    } else {
      const literal = /^[^\s,)]+/.exec(text.slice(end))?.[0] ?? "";
      end += literal.length;
      if (["yes", "true", "no", "false"].includes(literal))
        values[field] = literal === "yes" || literal === "true";
      else if (
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(literal) &&
        Number.isFinite(Number(literal))
      )
        values[field] = Number(literal);
      else fail(`'${field}' needs a quoted string, finite number, or yes/no`);
    }
    space();
    if (text[end] === ")") return { name, start, end: end + 1, values, parameterized: true };
    if (text[end++] !== ",") fail("expected ',' or ')' after value");
    space();
  }
  return fail("incomplete argument list; expected ')'");
}

export function serializeInvocation(name: string, values: FieldValues): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error("Invalid snippet name");
  const args = Object.entries(values).map(([key, value]) => {
    if (!validFieldName(key) || (typeof value === "number" && !Number.isFinite(value)))
      throw new Error(`Invalid field '${key}'`);
    return `${key}=${typeof value === "boolean" ? (value ? "yes" : "no") : JSON.stringify(value)}`;
  });
  return `#${name}(${args.join(", ")})`;
}
