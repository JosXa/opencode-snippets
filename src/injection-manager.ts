import { logger } from "./logger.js";

export interface InjectionDescriptor {
  snippetName: string;
  content: string;
}

export interface ActiveInjection extends InjectionDescriptor {
  key: string;
  order: number;
}

export interface PositionedInjection extends ActiveInjection {
  /** The message index (0-based from conversation start) where this injection should be placed */
  targetPosition: number;
}

export interface RenderableInjectionsResult {
  injections: PositionedInjection[];
  /** Injections that were just registered for the first time (or had their content updated) */
  newlyRegistered: ActiveInjection[];
}

/**
 * Tracks active snippet injections and computes their placement position.
 *
 * ## Injection Placement Strategy
 *
 * The goal is to keep injected context visible to the LLM without causing
 * instruction overfitting, where the model fixates on injected content as if
 * it were the user's latest directive. It responds with "yes I will do what you
 * asked" every time instead of treating it as background context.
 *
 * Instead, injections are placed at a **fixed offset from the bottom** of the
 * conversation. This makes them feel like something said a while ago: background
 * context the model respects but doesn't fixate on.
 *
 * ```
 *   recencyWindow = 5
 *
 *   messageCount=6, target = max(0, 6-5) = 1
 *   ───────────────────────────────────────────
 *     msg 1  [user]
 *     msg 1+ [INJECTED "Be careful"]    <-- 5 from bottom
 *     msg 2  [assistant]
 *     msg 3  [user]
 *     msg 4  [assistant]
 *     msg 5  [user]
 *     msg 6  [assistant]
 *
 *   messageCount=10, target = max(0, 10-5) = 5
 *   ───────────────────────────────────────────
 *     msg 1  [user]
 *     msg 2  [assistant]
 *     ...
 *     msg 5  [user]
 *     msg 5+ [INJECTED "Be careful"]    <-- 5 from bottom
 *     msg 6  [assistant]
 *     ...
 *     msg 10 [assistant]
 *
 *   messageCount=16, target = max(0, 16-5) = 11
 *   ────────────────────────────────────────────
 *     msg 1  [user]
 *     ...
 *     msg 11 [user]
 *     msg 11+[INJECTED "Be careful"]    <-- 5 from bottom
 *     msg 12 [assistant]
 *     ...
 *     msg 16 [assistant]
 * ```
 *
 * The injection "floats" upward as the conversation grows, always maintaining
 * a constant distance from the bottom. The model treats it as old context
 * rather than a fresh command.
 *
 * For full design rationale, see docs/injection-placement.md
 */
export class InjectionManager {
  private activeInjections = new Map<string, Map<string, ActiveInjection>>();
  private nextOrder = 0;

  /**
   * Register or update injections for a session.
   * Returns true if any injection was newly created (not just updated).
   */
  touchInjections(sessionID: string, injections: InjectionDescriptor[]): boolean {
    if (injections.length === 0) return false;

    const session = this.getOrCreateSession(sessionID);
    let hasNew = false;

    for (const injection of injections) {
      const key = this.getInjectionKey(injection);
      const existing = session.get(key);
      if (existing) {
        // Update content in case it changed (e.g. shell command output)
        existing.snippetName = injection.snippetName;
        existing.content = injection.content;
        continue;
      }

      session.set(key, {
        ...injection,
        key,
        order: this.nextOrder++,
      });
      hasNew = true;
    }

    return hasNew;
  }

  /**
   * Compute positioned injections for rendering into the message array.
   *
   * Each injection is placed at `max(0, messageCount - recencyWindow)` so it
   * always sits a fixed number of messages from the bottom. When the conversation
   * is shorter than the recency window, injections go to the top (position 0).
   */
  getRenderableInjections(
    sessionID: string,
    messageCount: number,
    recencyWindow: number,
  ): RenderableInjectionsResult {
    const session = this.activeInjections.get(sessionID);
    if (!session || session.size === 0) {
      return { injections: [], newlyRegistered: [] };
    }

    const window = Math.max(1, recencyWindow);
    const targetPosition = Math.max(0, messageCount - window);

    const injections = [...session.values()]
      .sort((a, b) => a.order - b.order)
      .map((injection) => ({
        ...injection,
        targetPosition,
      }));

    return { injections, newlyRegistered: [] };
  }

  /**
   * Register injections and return which ones are new (for notification purposes).
   * Combines touchInjections + tracking of newly registered ones.
   */
  registerAndGetNew(sessionID: string, descriptors: InjectionDescriptor[]): ActiveInjection[] {
    if (descriptors.length === 0) return [];

    const session = this.getOrCreateSession(sessionID);
    const newOnes: ActiveInjection[] = [];

    for (const desc of descriptors) {
      const key = this.getInjectionKey(desc);
      const existing = session.get(key);
      if (existing) {
        existing.snippetName = desc.snippetName;
        existing.content = desc.content;
        continue;
      }

      const injection: ActiveInjection = {
        ...desc,
        key,
        order: this.nextOrder++,
      };
      session.set(key, injection);
      newOnes.push(injection);
    }

    return newOnes;
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
