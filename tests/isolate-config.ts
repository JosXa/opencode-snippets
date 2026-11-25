import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = mkdtempSync(join(tmpdir(), "snippets-test-config-"));
process.env.OPENCODE_CONFIG_DIR = config;

afterAll(() => rmSync(config, { recursive: true, force: true }));
