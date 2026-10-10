export interface DollarSkillLoad {
  start: number;
  end: number;
  name: string;
}

const NAME = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*/;
const QUERY = new RegExp(`${NAME.source}:?`);
const ID = new RegExp(`${NAME.source}$`);

/** Prefer native IDs; display names and other host IDs retain the legacy form. */
export function formatSkillLoad(name: string): string {
  return ID.test(name) && /[a-z]/.test(name) ? `$${name}` : `#skill(${JSON.stringify(name)})`;
}

function literalEnd(text: string, start: number, token: string): number | undefined {
  if (text[start - 1] === "\\") return;
  if (token === "/") {
    if (start > 0 && !/[\s=([{"':,]/.test(text[start - 1])) return;
    if (!text[start + 1] || /[\s/]/.test(text[start + 1])) return;
    const regex = text
      .slice(start + 1)
      .match(/^(?:\\.|\[(?:\\.|[^\\\]\r\n])*\]|[^\\/\r\n[])+\/[dgimsuvy]*/);
    return regex ? start + 1 + regex[0].length : undefined;
  }
  const line = text.lastIndexOf("\n", start - 1) + 1;
  if (token.length >= 3 && /^ {0,3}$/.test(text.slice(line, start))) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) return text.length;
    const closing = new RegExp(`^ {0,3}${token[0]}{${token.length},}[\\t ]*(?:\\r?\\n|$)`, "gm");
    closing.lastIndex = newline + 1;
    const match = closing.exec(text);
    return match ? match.index + match[0].length : text.length;
  }
  if (token[0] === "`") {
    const closing = new RegExp(`(?<!\`)${token}(?!\`)`, "g");
    closing.lastIndex = start + token.length;
    const match = closing.exec(text);
    // An unfinished code span must not activate skills while it is being edited.
    return match ? match.index + token.length : text.length;
  }
  if (token !== "$") return;
  if (text.startsWith("$$", start)) {
    const closing = /(?<!\\)\$\$/g;
    closing.lastIndex = start + 2;
    const match = closing.exec(text);
    return match ? match.index + 2 : text.length;
  }
  if (!text[start + 1] || /\s/.test(text[start + 1])) return;
  const closing = text.slice(start + 1).match(/(?<!\\)\$/);
  if (!closing || closing.index === undefined) return;
  const end = start + 1 + closing.index;
  if (text.slice(start + 1, end).includes("\n")) return;
  if (/\s/.test(text[end - 1]) || /[\p{L}\p{N}_:$]/u.test(text[end + 1] ?? "")) return;
  return end + 1;
}

/** Dollar references load automatically, but code, math and escapes remain literal. */
export function findDollarSkillLoads(text: string, partial = false): DollarSkillLoad[] {
  const matches: DollarSkillLoad[] = [];
  const consumed = { end: 0 };
  for (const token of text.matchAll(/`+|~{3,}|\/|\$/g)) {
    const start = token.index;
    if (start < consumed.end) continue;
    const literal = literalEnd(text, start, token[0]);
    if (literal !== undefined) {
      consumed.end = literal;
      continue;
    }
    if (token[0] !== "$") continue;
    // Require a standalone token instead of accepting dollars within variables,
    // paths or regexes; a Markdown escape stays intact in the submitted text.
    if (start > 0 && !/[\s([{"']/.test(text[start - 1])) continue;
    const line = text.lastIndexOf("\n", start - 1) + 1;
    if (/^(?: {4}|\t)/.test(text.slice(line, start))) continue;
    const name = text.slice(start + 1).match(partial ? QUERY : NAME)?.[0] ?? "";
    if (!name && (!partial || (text[start + 1] && !/\s/.test(text[start + 1])))) continue;
    if (name && !/[a-z]/.test(name)) continue;
    const end = start + 1 + name.length;
    const suffix = text.slice(end);
    // A sentence-ending period or colon is punctuation, while .member, /path,
    // (arguments), [index] and unsupported qualification cannot be partial IDs.
    if (
      /^[\p{L}\p{N}_/\\([$-]/u.test(suffix) ||
      /^\.[\p{L}\p{N}_-]/u.test(suffix) ||
      /^:[^\s.,!?;)\]}]/.test(suffix)
    )
      continue;
    matches.push({ start, end, name });
    consumed.end = end;
  }
  return matches;
}
