import { PATTERNS } from "./constants.js";
import { logger } from "./logger.js";
import type { SkillRegistry } from "./skill-loader.js";

/**
 * Expands skill tags in text, replacing them with the skill's content body
 *
 * Supports two formats:
 * 1. Self-closing: <skill name="skill-name" />
 * 2. Block format: <skill>skill-name</skill>
 *
 * @param text - The text containing skill tags to expand
 * @param registry - The skill registry to look up skills
 * @returns The text with skill tags replaced by their content
 */
export function expandSkillTags(text: string, registry: SkillRegistry): string {
  let expanded = text;

  // Expand self-closing tags: <skill name="skill-name" />
  PATTERNS.SKILL_TAG_SELF_CLOSING.lastIndex = 0;
  expanded = expanded.replace(PATTERNS.SKILL_TAG_SELF_CLOSING, (match, name) => {
    const key = name.trim().toLowerCase();
    const skill = registry.get(key);

    if (!skill) {
      logger.warn(`Skill not found: '${name}', leaving tag unchanged`);
      return match;
    }

    logger.debug(`Expanded skill tag: ${name}`, { source: skill.source });
    return skill.content;
  });

  // Expand block tags: <skill>skill-name</skill>
  PATTERNS.SKILL_TAG_BLOCK.lastIndex = 0;
  expanded = expanded.replace(PATTERNS.SKILL_TAG_BLOCK, (match, name) => {
    const key = name.trim().toLowerCase();
    const skill = registry.get(key);

    if (!skill) {
      logger.warn(`Skill not found: '${name}', leaving tag unchanged`);
      return match;
    }

    logger.debug(`Expanded skill tag: ${name}`, { source: skill.source });
    return skill.content;
  });

  return expanded;
}
