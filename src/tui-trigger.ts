import type { SnippetInfo } from "./types.js";

export interface HashtagTriggerMatch {
  start: number;
  end: number;
  query: string;
  token: string;
}

const HASHTAG_TRIGGER = /(^|\s)#([^\s#]*)$/;

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

export function preferredSnippetTag(
  input: string,
  item: Pick<SnippetInfo, "name" | "aliases">,
): string {
  const query = findTrailingHashtagTrigger(input)?.query.trim();
  if (!query) return item.name;

  return item.aliases.find((alias) => alias === query) ?? item.name;
}

export function insertSnippetTrigger(input: string): string {
  if (findTrailingHashtagTrigger(input)) return input;

  if (!input) return "#";
  if (/\s$/.test(input)) return `${input}#`;

  return `${input} #`;
}

export function truncateSnippetPreview(input: string, max = 140): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;

  return `${text.slice(0, max - 3).trimEnd()}...`;
}
