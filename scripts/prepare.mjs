import { existsSync } from "node:fs";

// Package managers run prepare in a clean pack directory without devDependencies.
// Only a developer checkout has .git and needs Husky to install its hooks.
if (existsSync(".git")) {
  const { default: husky } = await import("husky");
  const message = husky();

  if (message) process.stdout.write(message);
}
