import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Verifies that built dist files never use static ESM imports for CJS-only
 * packages. OpenCode's web mode (1.3.13+) loads plugins via Node.js ESM,
 * which does NOT reliably synthesize default/named exports for CJS modules.
 *
 * Broken patterns (compiled through tsc unchanged):
 *   import matter from "gray-matter"     -> Missing 'default' export
 *   import { parse } from "jsonc-parser" -> Export named 'parse' not found
 *   require("gray-matter")               -> require() async module unsupported
 *
 * The safe pattern is `await import("pkg")` with .default extraction,
 * which works across Bun, Node.js, and OpenCode's web ESM loader.
 *
 * This test builds the dist, then scans all emitted .js files to ensure
 * no CJS-only dependency is imported via static ESM import syntax.
 */

const ROOT = resolve(import.meta.dir, "..");

/** CJS-only packages used by this project that lack proper ESM exports */
const CJS_ONLY_PACKAGES = ["gray-matter", "jsonc-parser"];

/**
 * Match any static `import` from a CJS-only package:
 *   import X from "pkg"          (default import)
 *   import { X } from "pkg"      (named import)
 *   import X, { Y } from "pkg"   (mixed)
 *
 * These all fail in Node.js ESM because CJS modules don't expose
 * synthesized default/named exports. The safe pattern is dynamic import().
 */
function findBrokenImports(code: string, file: string) {
  const violations: string[] = [];
  for (const pkg of CJS_ONLY_PACKAGES) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Matches: import <anything> from "pkg" or 'pkg'
    const pattern = new RegExp(`^import\\s+.+?\\s+from\\s+["']${escaped}["']`, "gm");
    const match = code.match(pattern);
    if (match) {
      violations.push(`${file}: static ESM import of CJS package "${pkg}" -> ${match[0]}`);
    }
  }
  return violations;
}

describe("ESM compatibility", () => {
  it("dist files must not use static ESM imports for CJS-only packages", () => {
    const build = Bun.spawnSync(["bun", "run", "build"], { cwd: ROOT });
    expect(build.exitCode, `Build failed: ${build.stderr.toString()}`).toBe(0);

    const distDir = resolve(ROOT, "dist");
    const files = readdirSync(distDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".js"));

    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const code = readFileSync(resolve(distDir, file), "utf-8");
      violations.push(...findBrokenImports(code, file));
    }

    expect(violations).toEqual([]);
  });
});
