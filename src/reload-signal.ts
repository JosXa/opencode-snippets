import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "./constants.js";
import { logger } from "./logger.js";

type ReloadSignalState = Record<string, number>;

function statePath(): string {
  return join(PATHS.CONFIG_DIR, "state", "snippet-reload.json");
}

function scopeKey(workspaceDir?: string): string {
  return workspaceDir || "__global__";
}

function normalizeState(value: unknown): ReloadSignalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, stamp]) => typeof stamp === "number" && Number.isFinite(stamp))
      .map(([key, stamp]) => [key, stamp as number]),
  );
}

async function readState(): Promise<ReloadSignalState> {
  const file = Bun.file(statePath());
  if (!(await file.exists())) return {};

  try {
    return normalizeState(JSON.parse(await file.text()));
  } catch (error) {
    logger.warn("Failed to read snippet reload signal", {
      error: error instanceof Error ? error.message : String(error),
      path: statePath(),
    });
    return {};
  }
}

async function writeState(state: ReloadSignalState): Promise<void> {
  await mkdir(join(PATHS.CONFIG_DIR, "state"), { recursive: true });
  await Bun.write(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export async function markSnippetReloadRequested(workspaceDir?: string): Promise<void> {
  const key = scopeKey(workspaceDir);
  const state = await readState();
  state[key] = Date.now();
  await writeState(state);
}

export async function consumeSnippetReloadRequest(workspaceDir?: string): Promise<boolean> {
  const key = scopeKey(workspaceDir);
  const state = await readState();
  if (typeof state[key] !== "number") return false;

  delete state[key];
  await writeState(state);
  return true;
}
