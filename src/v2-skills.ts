import type { SkillInfo } from "@opencode-ai/client";
import type { SkillRegistry } from "./skill-loader.js";

/** Use the host's resolved skills, including configured sources and plugin transforms. */
export function nativeSkillRegistry(skills: readonly SkillInfo[]): SkillRegistry {
  const entries = skills.map((skill) => ({
    id: skill.id.toLowerCase(),
    info: {
      name: skill.name,
      description: skill.description,
      content: skill.content,
      filePath: skill.location,
      source: "project" as const,
    },
  }));
  const registry: SkillRegistry = new Map(
    entries.map(({ info }) => [info.name.toLowerCase(), info]),
  );
  // IDs disambiguate skills with the same display name.
  for (const { id, info } of entries) registry.set(id, info);
  return registry;
}
