import { logger } from "./logger.js";

/**
 * Manages injection lifecycle per session.
 * Injections are ephemeral messages that last for exactly one user message cycle.
 */
export class InjectionManager {
  private activeInjections = new Map<string, string[]>();

  /**
   * Stores new injections for a session, clearing any previous injections.
   */
  setInjections(sessionID: string, injections: string[]): void {
    if (this.activeInjections.has(sessionID)) {
      logger.debug("Clearing previous injections for new user message", {
        sessionID,
        previousCount: this.activeInjections.get(sessionID)?.length || 0,
      });
      this.activeInjections.delete(sessionID);
    }

    if (injections.length > 0) {
      this.activeInjections.set(sessionID, injections);
      logger.debug("Stored inject blocks for session", {
        sessionID,
        count: injections.length,
      });
    }
  }

  /**
   * Adds additional injections to an existing session without duplicates.
   */
  addInjections(sessionID: string, newInjections: string[]): void {
    if (newInjections.length === 0) return;

    const existing = this.activeInjections.get(sessionID) || [];
    const uniqueInjections = newInjections.filter((inj) => !existing.includes(inj));

    if (uniqueInjections.length > 0) {
      this.activeInjections.set(sessionID, [...existing, ...uniqueInjections]);
    }
  }

  /**
   * Gets active injections for a session without removing them.
   */
  getInjections(sessionID: string): string[] | undefined {
    return this.activeInjections.get(sessionID);
  }

  /**
   * Checks if there are active injections for a session.
   */
  has(sessionID: string): boolean {
    return this.activeInjections.has(sessionID);
  }

  /**
   * Clears all injections for a session.
   */
  clearSession(sessionID: string): void {
    if (this.activeInjections.has(sessionID)) {
      this.activeInjections.delete(sessionID);
      logger.debug("Cleared active injections on session idle", { sessionID });
    }
  }

  /**
   * Gets the number of sessions with active injections.
   */
  get size(): number {
    return this.activeInjections.size;
  }

  /**
   * Gets all session IDs with active injections.
   */
  getAllSessionIDs(): string[] {
    return Array.from(this.activeInjections.keys());
  }
}
