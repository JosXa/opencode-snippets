import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./skill-loader.js";

async function writeSkill(base: string, name: string, content: string): Promise<void> {
  const dir = join(base, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content);
}

describe("loadSkills", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `snippets-skill-loader-${Date.now()}`);
    homeDir = join(tempDir, "home");
    await mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads documented global skill locations and keeps singular opencode path as compatibility", async () => {
    await writeSkill(join(homeDir, ".config", "opencode", "skill"), "compat-only", "compat skill");
    await writeSkill(join(homeDir, ".config", "opencode", "skill"), "shared", "compat shared");
    await writeSkill(join(homeDir, ".config", "opencode", "skills"), "shared", "official shared");
    await writeSkill(join(homeDir, ".claude", "skills"), "claude-global", "claude skill");
    await writeSkill(join(homeDir, ".agents", "skills"), "agents-global", "agents skill");

    const skills = await loadSkills(undefined, { homeDir });

    expect(skills.get("compat-only")?.content).toBe("compat skill");
    expect(skills.get("shared")?.content).toBe("official shared");
    expect(skills.get("claude-global")?.content).toBe("claude skill");
    expect(skills.get("agents-global")?.content).toBe("agents skill");
  });

  it("walks upward to the git worktree so nearer project skills override farther ones", async () => {
    const repo = join(tempDir, "repo");
    const cwd = join(repo, "apps", "web", "src");

    await mkdir(cwd, { recursive: true });
    await writeFile(join(repo, ".git"), "gitdir: ./.git/worktrees/test\n");
    await writeSkill(join(repo, ".opencode", "skill"), "shared", "repo compat shared");
    await writeSkill(join(repo, ".opencode", "skills"), "shared", "repo official shared");
    await writeSkill(join(repo, ".opencode", "skills"), "repo-only", "repo skill");
    await writeSkill(join(repo, "apps", ".agents", "skills"), "shared", "apps override");
    await writeSkill(join(repo, "apps", "web", ".claude", "skills"), "web-only", "web skill");
    await writeSkill(
      join(repo, "apps", "web", "src", ".opencode", "skill"),
      "local-only",
      "local skill",
    );

    const skills = await loadSkills(cwd, { homeDir });

    expect(skills.get("shared")?.content).toBe("apps override");
    expect(skills.get("repo-only")?.content).toBe("repo skill");
    expect(skills.get("web-only")?.content).toBe("web skill");
    expect(skills.get("local-only")?.content).toBe("local skill");
  });

  it("stops at the git worktree instead of reading parent directories above the repo", async () => {
    const repo = join(tempDir, "repo");
    const cwd = join(repo, "packages", "app");

    await mkdir(cwd, { recursive: true });
    await writeFile(join(repo, ".git"), "gitdir: ./.git/worktrees/test\n");
    await writeSkill(join(tempDir, ".agents", "skills"), "outside", "outside skill");
    await writeSkill(join(repo, ".agents", "skills"), "inside", "inside skill");

    const skills = await loadSkills(cwd, { homeDir });

    expect(skills.get("inside")?.content).toBe("inside skill");
    expect(skills.get("outside")).toBeUndefined();
  });
});
