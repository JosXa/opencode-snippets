import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const VERSION = 2;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_SESSIONS = 100;
const MAX_RECORDS_PER_SESSION = 1_000;
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 30_000;
const INCOMPLETE_LOCK_GRACE_MS = 1_000;

export type TextPatch = {
  start: number;
  end: number;
  replacement: string;
};

export type Processed = {
  patches: TextPatch[];
  hidden: string[];
  injections: Array<{ name: string; content: string }>;
};

type RecordState =
  | { status: "pending"; updatedAt: number }
  | { status: "completed"; updatedAt: number; result: Processed };

type DurableState = {
  version: typeof VERSION;
  sessions: Record<string, Record<string, RecordState>>;
};

type LockContender = {
  pid: number;
  token: string;
  choosing: boolean;
  ticket: number;
};

export interface DurableStoreOptions {
  dataDirectory?: string;
  homeDirectory?: string;
}

export type PreparedOperation<T> = {
  /** Read and validate only. A failure here must remain safe to retry. */
  prepare: () => Promise<T>;
  execute: (prepared: T) => Promise<Processed>;
};

export class DurableStore {
  readonly path: string;
  readonly directory: string;

  constructor(projectDirectory: string, options: DurableStoreOptions) {
    // Explicit user homes must stay isolated from the launching process's XDG
    // environment (portable installs and tests rely on this boundary).
    const dataHome = options.homeDirectory
      ? join(options.homeDirectory, ".local", "share")
      : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const root = options.dataDirectory ?? join(dataHome, "opencode", "opencode-snippets", "v2");
    const project = createHash("sha256").update(projectDirectory).digest("hex").slice(0, 32);
    this.directory = root;
    this.path = join(root, `${project}.json`);
  }

  async process<T>(
    sessionID: string,
    key: string,
    operation: (() => Promise<Processed>) | PreparedOperation<T>,
  ): Promise<Processed> {
    return this.lock(async () => {
      const state = await this.read();
      const durableSessionID = stateKey(sessionID);
      const durableKey = stateKey(key);
      const record = state.sessions[durableSessionID]?.[durableKey];
      if (record?.status === "completed") return record.result;
      if (record?.status === "pending") {
        throw new Error(
          "Snippet processing was previously reserved but did not complete; refusing to repeat side effects.",
        );
      }

      // Cached and interrupted operations skip preparation. Only new work may
      // validate without a reservation; every effect still follows durable pending.
      const execute =
        typeof operation === "function"
          ? operation
          : await operation.prepare().then((prepared) => () => operation.execute(prepared));

      state.sessions[durableSessionID] ??= {};
      state.sessions[durableSessionID][durableKey] = {
        status: "pending",
        updatedAt: Date.now(),
      };
      await this.write(state);

      const result = await execute();
      state.sessions[durableSessionID][durableKey] = {
        status: "completed",
        updatedAt: Date.now(),
        result,
      };
      await this.write(state);
      return result;
    });
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.lock(async () => {
      const state = await this.read();
      const durableSessionID = stateKey(sessionID);
      if (!state.sessions[durableSessionID]) return;
      delete state.sessions[durableSessionID];
      await this.write(state);
    });
  }

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const lock = `${this.path}.lock`;
    const contenders = `${lock}.contenders`;
    const started = Date.now();
    const owner = { pid: process.pid, token: crypto.randomUUID() };
    const ownerPath = `${lock}.${owner.token}.owner`;
    const contenderPath = join(contenders, `${owner.token}.json`);
    const choosing = { ...owner, choosing: true, ticket: 0 } satisfies LockContender;
    await mkdir(contenders, { recursive: true, mode: 0o700 });
    await chmod(contenders, 0o700);
    await publish(contenderPath, choosing);
    let acquired = false;
    try {
      let ticket = 1;
      for await (const contender of readContenders(contenders)) {
        ticket = Math.max(ticket, contender.ticket + 1);
      }
      await replaceContender(contenderPath, { ...owner, choosing: false, ticket });
      while (await hasPredecessor(contenders, owner.token, ticket)) {
        if (Date.now() - started >= LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out entering durable snippet state lock queue: ${lock}`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }

      await writeFile(ownerPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      while (true) {
        const recovery = await recoverOrphanedLock(lock);
        if (recovery === "recovered") continue;
        if (recovery === "live") {
          if (Date.now() - started >= LOCK_TIMEOUT_MS) {
            throw new Error(`Timed out acquiring durable snippet state lock: ${lock}`);
          }
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
          continue;
        }
        try {
          // Linking a fully-written owner file publishes the lock atomically, so
          // contenders can never mistake a live but not-yet-initialized lock for an orphan.
          await link(ownerPath, lock);
          // A recovery candidate is a hard link to the exact inode it inspected.
          // If a concurrent recovery started before this publication, do not enter
          // the critical section until its identity check has finished.
          if (await hasRecoveryCandidates(lock)) {
            await releaseOwnedLock(lock, owner.token);
            await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
            continue;
          }
          acquired = true;
          await unlink(ownerPath);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (Date.now() - started >= LOCK_TIMEOUT_MS) {
            throw new Error(`Timed out acquiring durable snippet state lock: ${lock}`);
          }
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
        }
      }
      return await operation();
    } finally {
      await unlink(ownerPath).catch(() => undefined);
      if (acquired) await releaseOwnedLock(lock, owner.token);
      await unlink(contenderPath).catch(() => undefined);
    }
  }

  private async read(): Promise<DurableState> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: VERSION, sessions: {} };
      }
      throw new Error(`Unable to read durable snippet state: ${this.path}`, { cause: error });
    }

    try {
      const state = JSON.parse(raw) as DurableState;
      if (state.version !== VERSION || !state.sessions || typeof state.sessions !== "object") {
        throw new Error("unsupported state format");
      }
      return prune(state);
    } catch (error) {
      throw new Error(`Invalid durable snippet state; refusing unsafe replay: ${this.path}`, {
        cause: error,
      });
    }
  }

  private async write(state: DurableState): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(prune(state))}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw new Error(`Unable to persist durable snippet state: ${this.path}`, { cause: error });
    }
  }
}

async function publish(path: string, contender: LockContender): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(contender), { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function replaceContender(path: string, contender: LockContender): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(contender), { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function* readContenders(directory: string): AsyncGenerator<LockContender> {
  const names = await readdir(directory);
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory, name);
    let contender: LockContender;
    try {
      contender = JSON.parse(await readFile(path, "utf8")) as LockContender;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Invalid durable snippet lock contender: ${path}`, { cause: error });
    }
    if (
      contender.token !== name.slice(0, -".json".length) ||
      !Number.isSafeInteger(contender.pid) ||
      contender.pid <= 0 ||
      typeof contender.choosing !== "boolean" ||
      !Number.isSafeInteger(contender.ticket) ||
      contender.ticket < 0
    ) {
      throw new Error(`Invalid durable snippet lock contender: ${path}`);
    }
    if (processIsAlive(contender.pid)) {
      yield contender;
      continue;
    }
    // Tokens are random, immutable path identities and are never reused. Removing
    // this exact dead contender cannot delete a subsequently published live one.
    await unlink(path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

async function hasPredecessor(directory: string, token: string, ticket: number): Promise<boolean> {
  // A single predecessor is enough to wait. Scanning every file on every poll
  // makes contending processes delay the lock owner with redundant filesystem IO.
  for await (const contender of readContenders(directory)) {
    if (
      contender.token !== token &&
      (contender.choosing ||
        contender.ticket < ticket ||
        (contender.ticket === ticket && contender.token < token))
    ) {
      return true;
    }
  }
  return false;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function stateKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prune(state: DurableState): DurableState {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [sessionID, records] of Object.entries(state.sessions)) {
    for (const [key, record] of Object.entries(records)) {
      if (record.status === "completed" && record.updatedAt < cutoff) delete records[key];
    }
    const entries = Object.entries(records).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const completed = entries.filter(([, record]) => record.status === "completed");
    const pendingCount = entries.length - completed.length;
    for (const [key] of completed.slice(Math.max(0, MAX_RECORDS_PER_SESSION - pendingCount))) {
      delete records[key];
    }
    if (Object.keys(records).length === 0) delete state.sessions[sessionID];
  }
  const sessions = Object.entries(state.sessions).sort((a, b) => {
    const newest = (records: Record<string, RecordState>) =>
      Math.max(0, ...Object.values(records).map((record) => record.updatedAt));
    return newest(b[1]) - newest(a[1]);
  });
  const completedSessions = sessions.filter(([, records]) =>
    Object.values(records).every((record) => record.status === "completed"),
  );
  const pendingSessions = sessions.length - completedSessions.length;
  for (const [sessionID] of completedSessions.slice(Math.max(0, MAX_SESSIONS - pendingSessions))) {
    delete state.sessions[sessionID];
  }
  return state;
}

async function isOrphanedLock(path: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let pid: number | undefined;
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (typeof parsed.pid === "number" && Number.isSafeInteger(parsed.pid) && parsed.pid > 0) {
      pid = parsed.pid;
    }
  } catch {
    const legacy = Number(raw.trim());
    if (Number.isSafeInteger(legacy) && legacy > 0) pid = legacy;
  }
  if (!pid) {
    const details = await lstat(path);
    return Date.now() - details.mtimeMs >= INCOMPLETE_LOCK_GRACE_MS;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function recoverOrphanedLock(path: string): Promise<"absent" | "live" | "recovered"> {
  const pending = await recoveryCandidates(path);
  if (pending[0]) return finishLockRecovery(path, pending[0]);
  if (!(await pathExists(path))) return "absent";
  if (!(await isOrphanedLock(path))) return "live";

  const candidate = `${path}.recovering.${process.pid}.${crypto.randomUUID()}`;
  try {
    // Move first, then inspect again. If the path changed after the stale observation,
    // rename captures that newer identity and the recovery barrier prevents its removal.
    await rename(path, candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "absent";
    throw error;
  }
  return finishLockRecovery(path, candidate);
}

async function finishLockRecovery(
  path: string,
  candidate: string,
): Promise<"absent" | "live" | "recovered"> {
  if (!(await pathExists(candidate))) return "absent";
  if (await isOrphanedLock(candidate)) {
    await unlink(candidate).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    return "recovered";
  }

  try {
    await link(candidate, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [current, inspected] = await Promise.all([lstat(path), lstat(candidate)]).catch(
      (statError: NodeJS.ErrnoException) => {
        if (statError.code === "ENOENT") return [];
        throw statError;
      },
    );
    if (!current || !inspected) return "absent";
    if (current.dev !== inspected.dev || current.ino !== inspected.ino) return "live";
  }
  await unlink(candidate).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  return "live";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function recoveryCandidates(path: string): Promise<string[]> {
  const prefix = `${basename(path)}.recovering.`;
  return (await readdir(dirname(path)))
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .map((entry) => join(dirname(path), entry));
}

async function hasRecoveryCandidates(path: string): Promise<boolean> {
  return (await recoveryCandidates(path)).length > 0;
}

async function releaseOwnedLock(path: string, token: string): Promise<void> {
  for (const ownedPath of [path, ...(await recoveryCandidates(path))]) {
    try {
      const owner = JSON.parse(await readFile(ownedPath, "utf8")) as { token?: unknown };
      if (owner.token === token) await unlink(ownedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
