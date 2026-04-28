import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PATTERNS } from "./constants.js";
import { logger } from "./logger.js";
import { getSkill, type SkillInfo, type SkillRegistry } from "./skill-loader.js";
import { expandSkillTags } from "./skill-renderer.js";
import type { SnippetRegistry } from "./types.js";

const SKILL_FILE_LIMIT = 10;

export interface SkillLoadResult {
  text: string;
  payloads: string[];
}

function visibleSkillLoad(skill: SkillInfo): string {
  return `↳ Loaded ${skill.name}`;
}

function pluginNote(skill: SkillInfo, marker: string): string {
  return `Plugin note: \`${marker}\` is not instruction. Do not call \`skill\` again for ${skill.name}.`;
}

export async function expandSkillLoads(
  text: string,
  registry: SkillRegistry,
  snippets: SnippetRegistry,
  options: {
    expandSkillTagsInContent: boolean;
    extractInject: boolean;
  },
): Promise<SkillLoadResult> {
  PATTERNS.SKILL_LOAD.lastIndex = 0;
  const matches = [...text.matchAll(PATTERNS.SKILL_LOAD)];
  if (matches.length === 0) {
    return { text, payloads: [] };
  }

  let result = "";
  let lastIndex = 0;
  const payloads: string[] = [];

  for (const match of matches) {
    const index = match.index ?? 0;
    const token = match[0];
    const parsed = parseSkillName(match[1]);

    result += text.slice(lastIndex, index);
    lastIndex = index + token.length;

    if (!parsed) {
      result += token;
      continue;
    }

    const skill = getSkill(registry, parsed);
    if (!skill) {
      logger.warn(`Skill not found: '${parsed}', leaving syntax unchanged`);
      result += token;
      continue;
    }

    const marker = visibleSkillLoad(skill);
    payloads.push(await buildSkillPayload(skill, registry, snippets, marker, options));
    result += marker;
  }

  result += text.slice(lastIndex);
  return { text: result, payloads };
}

export async function buildSkillPayloadsFromVisibleText(
  text: string,
  registry: SkillRegistry,
  snippets: SnippetRegistry,
  options: {
    expandSkillTagsInContent: boolean;
    extractInject: boolean;
  },
): Promise<string[]> {
  if (!text.includes("↳ Loaded ")) {
    return [];
  }

  const matches: Array<{ start: number; end: number; skill: SkillInfo; marker: string }> = [];
  const skills = [...registry.values()]
    .map((skill) => ({ skill, marker: visibleSkillLoad(skill) }))
    .toSorted((a, b) => b.marker.length - a.marker.length);

  for (const entry of skills) {
    let from = 0;

    while (from < text.length) {
      const start = text.indexOf(entry.marker, from);
      if (start === -1) {
        break;
      }

      const end = start + entry.marker.length;
      const overlaps = matches.some((match) => start < match.end && end > match.start);
      if (!overlaps) {
        matches.push({ start, end, skill: entry.skill, marker: entry.marker });
        break;
      }

      from = start + 1;
    }
  }

  if (matches.length === 0) {
    return [];
  }

  matches.sort((a, b) => a.start - b.start);

  return Promise.all(
    matches.map((match) =>
      buildSkillPayload(match.skill, registry, snippets, match.marker, options),
    ),
  );
}

function parseSkillName(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    const inner = trimmed.slice(1, -1).trim();
    return inner || null;
  }

  return trimmed;
}

async function buildSkillPayload(
  skill: SkillInfo,
  registry: SkillRegistry,
  _snippets: SnippetRegistry,
  marker: string,
  options: {
    expandSkillTagsInContent: boolean;
    extractInject: boolean;
  },
): Promise<string> {
  const dir = dirname(skill.filePath);
  const base = pathToFileURL(dir).href;
  const files = await listSkillFiles(dir, SKILL_FILE_LIMIT);
  const content = renderSkillContent(skill.content, registry, options);

  return [
    `<skill_content name="${skill.name}">`,
    // User requirement: repeat the exact visible marker in hidden context so the
    // model treats `↳ Loaded ...` as already-resolved state, not as a new tool request.
    pluginNote(skill, marker),
    "",
    `# Skill: ${skill.name}`,
    "",
    content,
    "",
    `Base directory for this skill: ${base}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    files.map((file) => `<file>${file}</file>`).join("\n"),
    "</skill_files>",
    "</skill_content>",
  ].join("\n");
}

function renderSkillContent(
  content: string,
  registry: SkillRegistry,
  options: {
    expandSkillTagsInContent: boolean;
  },
): string {
  let processed = content;
  if (options.expandSkillTagsInContent) {
    processed = expandSkillTags(processed, registry);
  }

  return processed;
}

async function listSkillFiles(dir: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  await walkSkillFiles(dir, files, limit);
  return files;
}

async function walkSkillFiles(dir: string, files: string[], limit: number): Promise<void> {
  if (files.length >= limit) return;

  const entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" }).catch(() => null);
  if (!entries) return;

  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= limit) return;

    const filePath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSkillFiles(filePath, files, limit);
      continue;
    }

    if (!entry.isFile()) continue;
    if (filePath.includes("SKILL.md")) continue;
    files.push(filePath);
  }
}
