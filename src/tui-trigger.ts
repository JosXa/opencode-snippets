import type { SkillInfo } from "./skill-loader.js";
import { matchesFuzzySearchText } from "./tui-search.js";
import type { SnippetInfo } from "./types.js";

export type TuiCompletion = { kind: "snippet" | "skill"; name: string };

export interface TuiCompletionOption {
  title: string;
  description: string;
  value: TuiCompletion;
}

export interface HashtagTriggerMatch {
  start: number;
  end: number;
  query: string;
  token: string;
}

/** OpenTUI's native cursorOffset is the canonical insertion offset. */
export function resolveCompletionCursor(text: string, cursorOffset: number): number {
  return Math.max(0, Math.min(cursorOffset, text.length));
}

const HASHTAG_TRIGGER = /(^|\s)#([^\s#]*)$/;

function compactTagText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findTrailingHashtagTrigger(input: string): HashtagTriggerMatch | undefined {
  const hit = input.match(HASHTAG_TRIGGER);
  if (!hit) return;

  const query = hit[2] || "";
  const token = `#${query}`;

  return {
    start: input.length - token.length,
    end: input.length,
    query,
    token,
  };
}

export function findHashtagTriggerAtCursor(
  input: string,
  cursor: number,
): HashtagTriggerMatch | undefined {
  return findTrailingHashtagTrigger(input.slice(0, Math.max(0, Math.min(cursor, input.length))));
}

export function replaceHashtagAtCursor(
  input: string,
  cursor: number,
  replacement: string,
): { text: string; cursor: number } | undefined {
  const match = findHashtagTriggerAtCursor(input, cursor);
  if (!match) return;
  const inserted = `${replacement} `;
  return {
    text: `${input.slice(0, match.start)}${inserted}${input.slice(cursor)}`,
    cursor: match.start + inserted.length,
  };
}

export function buildTuiCompletionOptions(
  snippets: Iterable<SnippetInfo>,
  skills: Iterable<Pick<SkillInfo, "name" | "description">>,
  query: string,
): TuiCompletionOption[] {
  const normalized = query.toLowerCase();
  const skillQuery = normalized.match(/^skill\(([^)]*)$/)?.[1];
  // Filesystem enumeration order differs across hosts. Keep keyboard selection
  // stable when the same snippets or skills are loaded on another machine.
  const snippetOptions = [...snippets]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter(() => skillQuery === undefined)
    .filter(
      (snippet) =>
        matchesFuzzySearchText(snippet.name, normalized) ||
        snippet.aliases.some((alias) => matchesFuzzySearchText(alias, normalized)),
    )
    .map((snippet) => ({
      title: `#${snippet.name}`,
      description: snippet.description || snippet.content.replace(/\s+/g, " ").slice(0, 100),
      value: { kind: "snippet" as const, name: snippet.name },
    }));
  const skillOptions = [...skills]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter(
      (skill) =>
        matchesFuzzySearchText(skill.name, skillQuery ?? normalized) ||
        skill.description?.toLowerCase().includes(skillQuery ?? normalized),
    )
    .map((skill) => ({
      title: `#skill(${skill.name})`,
      description: skill.description || "Load skill instructions",
      value: { kind: "skill" as const, name: skill.name },
    }));
  return [...snippetOptions, ...skillOptions];
}

export function normalizeUnmatchedTrigger(query: string): string | undefined {
  const name = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || undefined;
}

export function replaceTrailingHashtag(input: string, name: string): string | undefined {
  const match = findTrailingHashtagTrigger(input);
  if (!match) return;

  return `${input.slice(0, match.start)}#${name} `;
}

export function insertSnippetTag(input: string, name: string): string {
  const replaced = replaceTrailingHashtag(input, name);
  if (replaced) return replaced;

  if (!input) return `#${name} `;
  if (/\s$/.test(input)) return `${input}#${name} `;

  return `${input} #${name} `;
}

export function insertSkillLoad(input: string, name: string): string {
  const match = findTrailingHashtagTrigger(input);
  const load = `#skill(${name}) `;
  if (match) {
    return `${input.slice(0, match.start)}${load}`;
  }

  if (!input) return load;
  if (/\s$/.test(input)) return `${input}${load}`;

  return `${input} ${load}`;
}

export function preferredSnippetTag(
  input: string,
  item: Pick<SnippetInfo, "name" | "aliases">,
): string {
  const query = findTrailingHashtagTrigger(input)?.query.trim();
  if (!query) return item.name;

  const exact = item.aliases.find((alias) => alias === query);
  if (exact) return exact;

  const compact = compactTagText(query);
  if (!compact) return item.name;

  return item.aliases.find((alias) => compactTagText(alias) === compact) ?? item.name;
}

export function insertSnippetTrigger(input: string): string {
  if (findTrailingHashtagTrigger(input)) return input;

  if (!input) return "#";
  if (/\s$/.test(input)) return `${input}#`;

  return `${input} #`;
}

export function isReloadCommand(input: string): boolean {
  return input.trim() === "/snippets:reload";
}

export function isDialogInputBlocked(
  dialogOpen: boolean,
  dialogHandoffUntil: number,
  now = Date.now(),
): boolean {
  return dialogOpen || dialogHandoffUntil > now;
}

export function isAutocompleteNavUpKey(evt: {
  name?: string;
  raw?: string;
  sequence?: string;
}): boolean {
  const name = evt.name?.toLowerCase();
  return name === "up" || name === "arrowup" || evt.raw === "\x1b[A" || evt.sequence === "\x1b[A";
}

export function isAutocompleteNavDownKey(evt: {
  name?: string;
  raw?: string;
  sequence?: string;
}): boolean {
  const name = evt.name?.toLowerCase();
  return (
    name === "down" || name === "arrowdown" || evt.raw === "\x1b[B" || evt.sequence === "\x1b[B"
  );
}

export function stepSelection(current: number, total: number, delta: -1 | 1): number {
  if (total <= 0) return 0;

  const next = current + delta;
  if (next < 0) return 0;
  if (next >= total) return total - 1;

  return next;
}

export function truncateSnippetPreview(input: string, max = 140): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;

  return `${text.slice(0, max - 3).trimEnd()}...`;
}
