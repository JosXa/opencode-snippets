import { logger } from "./logger.js";

export interface InjectionDescriptor {
  snippetName: string;
  content: string;
}

export interface ActiveInjection extends InjectionDescriptor {
  key: string;
  lastInjectedMessageCount: number | null;
  pendingRefresh: boolean;
  order: number;
}

export interface RenderableInjectionsResult {
  injections: ActiveInjection[];
  reinjected: ActiveInjection[];
}

/**
 * Tracks active snippet injections and re-injects them when they become stale.
 */
export class InjectionManager {
  private activeInjections = new Map<string, Map<string, ActiveInjection>>();
  private nextOrder = 0;

  touchInjections(sessionID: string, injections: InjectionDescriptor[]): void {
    if (injections.length === 0) return;

    const session = this.getOrCreateSession(sessionID);

    for (const injection of injections) {
      const key = this.getInjectionKey(injection);
      const existing = session.get(key);
      if (existing) {
        existing.snippetName = injection.snippetName;
        existing.content = injection.content;
        existing.pendingRefresh = true;
        continue;
      }

      session.set(key, {
        ...injection,
        key,
        lastInjectedMessageCount: null,
        pendingRefresh: true,
        order: this.nextOrder++,
      });
    }
  }

  getRenderableInjections(
    sessionID: string,
    messageCount: number,
    recencyWindow: number,
  ): RenderableInjectionsResult {
    const session = this.activeInjections.get(sessionID);
    if (!session || session.size === 0) {
      return { injections: [], reinjected: [] };
    }

    const reinjected: ActiveInjection[] = [];
    const normalizedWindow = Math.max(1, recencyWindow);

    for (const injection of session.values()) {
      const shouldRefresh =
        injection.pendingRefresh ||
        injection.lastInjectedMessageCount === null ||
        messageCount - injection.lastInjectedMessageCount >= normalizedWindow;

      if (shouldRefresh) {
        injection.lastInjectedMessageCount = messageCount;
        injection.pendingRefresh = false;
        reinjected.push({ ...injection });
      }
    }

    const injections = [...session.values()]
      .filter((injection) => injection.lastInjectedMessageCount !== null)
      .sort((a, b) => {
        const aPos = a.lastInjectedMessageCount ?? Number.MAX_SAFE_INTEGER;
        const bPos = b.lastInjectedMessageCount ?? Number.MAX_SAFE_INTEGER;
        if (aPos !== bPos) return aPos - bPos;
        return a.order - b.order;
      })
      .map((injection) => ({ ...injection }));

    return { injections, reinjected };
  }

  clearSession(sessionID: string): void {
    if (this.activeInjections.has(sessionID)) {
      this.activeInjections.delete(sessionID);
      logger.debug("Cleared active injections", { sessionID });
    }
  }

  private getOrCreateSession(sessionID: string): Map<string, ActiveInjection> {
    let session = this.activeInjections.get(sessionID);
    if (!session) {
      session = new Map();
      this.activeInjections.set(sessionID, session);
    }
    return session;
  }

  private getInjectionKey(injection: InjectionDescriptor): string {
    return `${injection.snippetName}\u0000${injection.content}`;
  }
}
