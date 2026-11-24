const NAME_CHARS = String.raw`\p{L}\p{N}\p{M}_-`;

export const SNIPPET_NAME_SOURCE = String.raw`[\p{L}\p{N}][${NAME_CHARS}]*`;

export const SNIPPET_NAME = new RegExp(`^${SNIPPET_NAME_SOURCE}$`, "u");

export const SNIPPET_TAG = new RegExp(`#(${SNIPPET_NAME_SOURCE})`, "gu");

export const SNIPPET_NAME_CHAR = new RegExp(`[${NAME_CHARS}]`, "u");

export function slugifySnippetName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(new RegExp(`[^${NAME_CHARS}]+`, "gu"), "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function compactSearchText(input: string): string {
  return input.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
