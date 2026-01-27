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
    if (injections.length > 0) {
      this.activeInjections.set(sessionID, injections);
    } else {
      this.activeInjections.delete(sessionID);
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
   * Clears all injections for a session.
   */
  clearSession(sessionID: string): void {
    if (this.activeInjections.has(sessionID)) {
      this.activeInjections.delete(sessionID);
      logger.debug("Cleared active injections on session idle", { sessionID });
    }
  }
}
