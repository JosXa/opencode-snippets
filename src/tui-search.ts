import type { SkillInfo } from "./skill-loader.js";
import type { SnippetInfo } from "./types.js";

export interface HighlightPart {
  text: string;
  match: boolean;
}

function scoreSnippet(snippet: SnippetInfo, query: string): number {
  if (!query) return 0;

  const needle = query.toLowerCase();
  const name = snippet.name.toLowerCase();
  const aliases = snippet.aliases.map((alias) => alias.toLowerCase());
  const description = (snippet.description || "").toLowerCase();

  if (name === needle) return 0;
  if (aliases.includes(needle)) return 1;
  if (name.startsWith(needle)) return 2;
  if (aliases.some((alias) => alias.startsWith(needle))) return 3;
  if (name.includes(needle)) return 4;
  if (aliases.some((alias) => alias.includes(needle))) return 5;
  if (description.startsWith(needle)) return 6;
  if (description.includes(needle)) return 7;

  return Number.POSITIVE_INFINITY;
}

function sourceRank(item: { source: "global" | "project" }): number {
  return item.source === "project" ? 0 : 1;
}

function skillTag(skill: SkillInfo): string {
  return `skill(${skill.name})`;
}

function scoreSkill(skill: SkillInfo, query: string): number {
  if (!query) return 0;

  const needle = query.toLowerCase();
  const name = skill.name.toLowerCase();
  const tag = skillTag(skill).toLowerCase();
  const description = (skill.description || "").toLowerCase();

  if (name === needle) return 0;
  if (tag === needle) return 1;
  if (name.startsWith(needle)) return 2;
  if (tag.startsWith(needle)) return 3;
  if (name.includes(needle)) return 4;
  if (tag.includes(needle)) return 5;
  if (description.startsWith(needle)) return 6;
  if (description.includes(needle)) return 7;

  return Number.POSITIVE_INFINITY;
}

export function filterSnippets(snippets: SnippetInfo[], query: string): SnippetInfo[] {
  return [...snippets]
    .map((snippet) => ({
      snippet,
      score: scoreSnippet(snippet, query.trim()),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;

      const sourceDiff = sourceRank(a.snippet) - sourceRank(b.snippet);
      if (sourceDiff !== 0) return sourceDiff;

      return a.snippet.name.localeCompare(b.snippet.name);
    })
    .map((item) => item.snippet);
}

export function filterSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  return [...skills]
    .map((skill) => ({
      skill,
      score: scoreSkill(skill, query.trim()),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;

      const sourceDiff = sourceRank(a.skill) - sourceRank(b.skill);
      if (sourceDiff !== 0) return sourceDiff;

      return a.skill.name.localeCompare(b.skill.name);
    })
    .map((item) => item.skill);
}

export function matchedAliases(snippet: SnippetInfo, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return snippet.aliases.filter((alias) => alias.toLowerCase().includes(needle));
}

export function snippetDescription(snippet: SnippetInfo): string {
  return (snippet.description || snippet.content).replace(/\s+/g, " ").trim();
}

export function highlightMatches(input: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text: input, match: false }];

  const haystack = input.toLowerCase();
  const parts: HighlightPart[] = [];
  let start = 0;

  while (start < input.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) {
      parts.push({ text: input.slice(start), match: false });
      break;
    }

    if (index > start) {
      parts.push({ text: input.slice(start, index), match: false });
    }

    const end = index + needle.length;
    parts.push({ text: input.slice(index, end), match: true });
    start = end;
  }

  if (parts.length === 0) return [{ text: input, match: false }];
  return parts;
}
