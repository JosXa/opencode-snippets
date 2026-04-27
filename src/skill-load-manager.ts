export class SkillLoadManager {
  private loads = new Map<string, Map<string, string[]>>();
  private pending = new Map<string, Array<{ messageID?: string; payloads: string[] }>>();

  register(sessionID: string, messageID: string, payloads: string[]): void {
    const session = this.getOrCreateSession(sessionID);
    session.set(messageID, [...payloads]);
  }

  queue(sessionID: string, payloads: string[], messageID?: string): void {
    const session = this.pending.get(sessionID) || [];
    session.push({ messageID, payloads: [...payloads] });
    this.pending.set(sessionID, session);
  }

  get(sessionID: string, messageID: string): string[] {
    return [...(this.loads.get(sessionID)?.get(messageID) || [])];
  }

  drainPending(sessionID: string): Array<{ messageID?: string; payloads: string[] }> {
    const queued = this.pending.get(sessionID) || [];
    this.pending.delete(sessionID);
    return queued.map((entry) => ({
      messageID: entry.messageID,
      payloads: [...entry.payloads],
    }));
  }

  private getOrCreateSession(sessionID: string): Map<string, string[]> {
    const existing = this.loads.get(sessionID);
    if (existing) return existing;

    const created = new Map<string, string[]>();
    this.loads.set(sessionID, created);
    return created;
  }
}
