import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
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
 * OpenCode skill directory patterns (in order of priority)
 *
 * Global paths:
 * - ~/.config/opencode/skill/<name>/SKILL.md
 * - ~/.config/opencode/skills/<name>/SKILL.md
 *
 * Project paths (higher priority):
 * - .opencode/skill/<name>/SKILL.md
 * - .opencode/skills/<name>/SKILL.md
 * - .claude/skills/<name>/SKILL.md (Claude Code compatibility)
 */
const GLOBAL_SKILL_DIRS = [
  join(homedir(), ".config", "opencode", "skill"),
  join(homedir(), ".config", "opencode", "skills"),
];

function getProjectSkillDirs(projectDir: string): string[] {
  return [
    join(projectDir, ".opencode", "skill"),
    join(projectDir, ".opencode", "skills"),
    join(projectDir, ".claude", "skills"),
  ];
}

/**
 * Loads all skills from global and project directories
 *
 * @param projectDir - Optional project directory path
 * @returns A map of skill names (lowercase) to their SkillInfo
 */
export async function loadSkills(projectDir?: string): Promise<SkillRegistry> {
  const skills: SkillRegistry = new Map();

  // Load from global directories first
  for (const dir of GLOBAL_SKILL_DIRS) {
    await loadFromDirectory(dir, skills, "global");
  }

  // Load from project directories (overrides global)
  if (projectDir) {
    for (const dir of getProjectSkillDirs(projectDir)) {
      await loadFromDirectory(dir, skills, "project");
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
