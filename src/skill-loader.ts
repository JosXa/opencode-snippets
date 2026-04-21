import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { importCjs } from "./cjs-interop.js";

const matter = await importCjs<typeof import("gray-matter")>("gray-matter");

import { logger } from "./logger.js";

/**
 * Loaded skill info
 */
export interface SkillInfo {
  /** The skill name */
  name: string;
  /** The skill content body (markdown, excluding frontmatter) */
  content: string;
  /** Optional description from frontmatter */
  description?: string;
  /** Where the skill was loaded from */
  source: "global" | "project";
  /** Full path to the skill file */
  filePath: string;
}

/**
 * Skill registry that maps skill names to their info
 */
export type SkillRegistry = Map<string, SkillInfo>;

/**
 * Loader options used by tests to point skill discovery at temp homes.
 */
export interface LoadSkillsOptions {
  homeDir?: string;
}

/**
 * OpenCode skill directory patterns.
 *
 * User requirement: keep behavior aligned with current OpenCode skill discovery.
 * During the 2026-04 parity audit, the archived `opencode-ai/opencode` repo did not
 * contain the modern skill loader, so the authoritative reference was the live docs:
 * https://opencode.ai/docs/skills/
 *
 * Official paths from current OpenCode docs:
 * - ~/.config/opencode/skills/<name>/SKILL.md
 * - ~/.claude/skills/<name>/SKILL.md
 * - ~/.agents/skills/<name>/SKILL.md
 * - .opencode/skills/<name>/SKILL.md
 * - .claude/skills/<name>/SKILL.md
 * - .agents/skills/<name>/SKILL.md
 *
 * Compatibility paths we intentionally keep because this repo and local setup still use them:
 * - ~/.config/opencode/skill/<name>/SKILL.md
 * - .opencode/skill/<name>/SKILL.md
 *
 * Compatibility paths are loaded before the official `.opencode/skills` variants so the
 * documented OpenCode locations still win if both singular and plural exist side by side.
 */
function getGlobalSkillDirs(homeDir = homedir()): string[] {
  return [
    join(homeDir, ".config", "opencode", "skill"),
    join(homeDir, ".config", "opencode", "skills"),
    join(homeDir, ".claude", "skills"),
    join(homeDir, ".agents", "skills"),
  ];
}

function getProjectSkillDirs(projectDir: string): string[] {
  return [
    join(projectDir, ".opencode", "skill"),
    join(projectDir, ".opencode", "skills"),
    join(projectDir, ".claude", "skills"),
    join(projectDir, ".agents", "skills"),
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * OpenCode walks upward from the current working directory until the git worktree.
 * We mirror that so nested apps can inherit repo-root skills while still allowing
 * closer directories to override farther ones.
 */
async function getProjectSearchRoots(projectDir: string): Promise<string[]> {
  const roots: string[] = [];
  let dir = resolve(projectDir);

  while (true) {
    roots.push(dir);

    if (await exists(join(dir, ".git"))) {
      break;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return roots.reverse();
}

/**
 * Loads all skills from global and project directories
 *
 * @param projectDir - Optional project directory path
 * @param options - Test-only overrides for discovery roots
 * @returns A map of skill names (lowercase) to their SkillInfo
 */
export async function loadSkills(
  projectDir?: string,
  options: LoadSkillsOptions = {},
): Promise<SkillRegistry> {
  const skills: SkillRegistry = new Map();

  // Load from global directories first
  for (const dir of getGlobalSkillDirs(options.homeDir)) {
    await loadFromDirectory(dir, skills, "global");
  }

  // Load from project directories from git root -> cwd so nearer paths override farther ones.
  if (projectDir) {
    for (const root of await getProjectSearchRoots(projectDir)) {
      for (const dir of getProjectSkillDirs(root)) {
        await loadFromDirectory(dir, skills, "project");
      }
    }
  }

  logger.debug("Skills loaded", { count: skills.size });
  return skills;
}

/**
 * Loads skills from a specific directory
 */
async function loadFromDirectory(
  dir: string,
  registry: SkillRegistry,
  source: "global" | "project",
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = await loadSkill(dir, entry.name, source);
      if (skill) {
        registry.set(skill.name.toLowerCase(), skill);
      }
    }

    logger.debug(`Loaded skills from ${source} directory`, { path: dir });
  } catch {
    // Directory doesn't exist or can't be read - that's fine
    logger.debug(`${source} skill directory not found`, { path: dir });
  }
}

/**
 * Loads a single skill from its directory
 *
 * @param baseDir - Base skill directory
 * @param skillName - Name of the skill (directory name)
 * @param source - Whether this is a global or project skill
 * @returns The parsed skill info, or null if not found/invalid
 */
async function loadSkill(
  baseDir: string,
  skillName: string,
  source: "global" | "project",
): Promise<SkillInfo | null> {
  const filePath = join(baseDir, skillName, "SKILL.md");

  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return null;
    }

    const fileContent = await file.text();
    const parsed = matter(fileContent);

    const content = parsed.content.trim();
    const frontmatter = parsed.data as { name?: string; description?: string };

    // Use frontmatter name if available, otherwise use directory name
    const name = frontmatter.name || skillName;

    return {
      name,
      content,
      description: frontmatter.description,
      source,
      filePath,
    };
  } catch (error) {
    logger.warn("Failed to load skill", {
      skillName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Gets a skill by name from the registry
 *
 * @param registry - The skill registry
 * @param name - The skill name (case-insensitive)
 * @returns The skill info, or undefined if not found
 */
export function getSkill(registry: SkillRegistry, name: string): SkillInfo | undefined {
  return registry.get(name.toLowerCase());
}
