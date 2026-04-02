/**
 * Safely import a CJS-only package from ESM context.
 *
 * OpenCode web mode (1.3.13+) loads plugins via an ESM loader where:
 *   - Static `import X from "cjs-pkg"` fails: "Missing 'default' export"
 *   - Static `import { X } from "cjs-pkg"` fails: "Export named 'X' not found"
 *   - `createRequire()(...)` fails: "require() async module is unsupported"
 *   - Dynamic `await import("cjs-pkg")` works but the shape varies by runtime
 *
 * This helper normalizes the result across Bun, Node.js, and OpenCode web.
 */
export async function importCjs<T>(pkg: string): Promise<T> {
  // biome-ignore lint/suspicious/noExplicitAny: CJS interop shape is runtime-dependent
  let val: any = await import(pkg);

  // Unwrap nested .default until we reach the actual CJS exports.
  // Some ESM loaders wrap CJS in Module { default: Module { default: fn } }.
  // We keep unwrapping .default as long as it exists and is either:
  //   - a function (CJS module.exports = fn, e.g. gray-matter)
  //   - a plain object with no further .default (CJS module.exports = {...})
  for (let i = 0; i < 4; i++) {
    if (val == null || typeof val === "function") break;
    if (!("default" in val) || val.default === undefined) break;
    val = val.default;
  }

  return val;
}
