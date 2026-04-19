export class SkillLoadManager {
  private loads = new Map<string, Map<string, string[]>>();
  private pending = new Map<string, string[][]>();

  register(sessionID: string, messageID: string, payloads: string[]): void {
    const session = this.getOrCreateSession(sessionID);
    session.set(messageID, [...payloads]);
  }

  queue(sessionID: string, payloads: string[]): void {
    const session = this.pending.get(sessionID) || [];
    session.push([...payloads]);
    this.pending.set(sessionID, session);
  }

  get(sessionID: string, messageID: string): string[] {
    return [...(this.loads.get(sessionID)?.get(messageID) || [])];
  }

  drainPending(sessionID: string): string[][] {
    const queued = this.pending.get(sessionID) || [];
    this.pending.delete(sessionID);
    return queued.map((payloads) => [...payloads]);
  }

  private getOrCreateSession(sessionID: string): Map<string, string[]> {
    const existing = this.loads.get(sessionID);
    if (existing) return existing;

    const created = new Map<string, string[]>();
    this.loads.set(sessionID, created);
    return created;
  }
}
