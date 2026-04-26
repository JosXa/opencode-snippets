import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PATHS, PATTERNS } from "./constants.js";
import { logger } from "./logger.js";
import type { SnippetRegistry } from "./types.js";

type PendingDraftState = Record<string, string[]>;

function statePath(): string {
  return join(PATHS.CONFIG_DIR, "state", "pending-drafts.json");
}

function scopeKey(workspaceDir?: string): string {
  return workspaceDir || "__global__";
}

function normalizeNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
}

function normalizeState(value: unknown): PendingDraftState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, names]) => Array.isArray(names))
      .map(([key, names]) => [
        key,
        normalizeNames(
          (names as unknown[]).filter((name): name is string => typeof name === "string"),
        ),
      ])
      .filter(([, names]) => names.length > 0),
  );
}

async function readState(): Promise<PendingDraftState> {
  const file = Bun.file(statePath());
  if (!(await file.exists())) return {};

  try {
    return normalizeState(JSON.parse(await file.text()));
  } catch (error) {
    logger.warn("Failed to read pending draft state", {
      error: error instanceof Error ? error.message : String(error),
      path: statePath(),
    });
    return {};
  }
}

async function writeState(state: PendingDraftState): Promise<void> {
  await mkdir(join(PATHS.CONFIG_DIR, "state"), { recursive: true });
  await Bun.write(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

function usedHashtags(text: string): Set<string> {
  const used = new Set<string>();
  const pattern = new RegExp(PATTERNS.HASHTAG);

  for (const match of text.matchAll(pattern)) {
    const token = match[0] || "";
    const name = match[1]?.toLowerCase();
    const index = match.index ?? -1;
    if (!name || index < 0) continue;
    if (name === "skill" && text[index + token.length] === "(") continue;
    used.add(name);
  }

  return used;
}

export async function addPendingDraft(
  workspaceDir: string | undefined,
  name: string,
): Promise<void> {
  const key = scopeKey(workspaceDir);
  const state = await readState();
  const next = normalizeNames([...(state[key] || []), name]);
  if (next.length === 0) return;
  state[key] = next;
  await writeState(state);
}

export async function getPendingDrafts(workspaceDir?: string): Promise<string[]> {
  const state = await readState();
  return state[scopeKey(workspaceDir)] || [];
}

export async function removePendingDrafts(
  workspaceDir: string | undefined,
  names: string[],
): Promise<void> {
  const key = scopeKey(workspaceDir);
  const remove = new Set(normalizeNames(names));
  if (remove.size === 0) return;

  const state = await readState();
  const next = (state[key] || []).filter((name) => !remove.has(name));
  if (next.length > 0) {
    state[key] = next;
  } else {
    delete state[key];
  }
  await writeState(state);
}

export async function refreshPendingDraftsForText(
  text: string,
  registry: SnippetRegistry,
  workspaceDir: string | undefined,
  reload: () => Promise<void>,
): Promise<void> {
  const pending = await getPendingDrafts(workspaceDir);
  if (pending.length === 0) return;

  const used = usedHashtags(text);
  const matched = pending.filter((name) => used.has(name));
  if (matched.length === 0) return;

  // User requirement: keep retrying draft snippet reloads until the created snippet
  // contains non-empty inline or block content and can safely replace its hashtag.
  await reload();

  const resolved = matched.filter((name) => {
    const snippet = registry.get(name);
    return !!snippet?.content.trim();
  });
  if (resolved.length === 0) return;

  await removePendingDrafts(workspaceDir, resolved);
}
