export class SkillLoadManager {
  private loads = new Map<string, Map<string, string[]>>();
  private pending = new Map<string, Array<{ messageID?: string; payloads: string[] }>>();
  private sessionPayloads = new Map<string, string[]>();

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

  rememberForSession(sessionID: string, payloads: string[]): void {
    const existing = this.sessionPayloads.get(sessionID) || [];
    const seen = new Set(existing);
    const merged = [...existing];

    for (const payload of payloads) {
      if (seen.has(payload)) continue;
      seen.add(payload);
      merged.push(payload);
    }

    this.sessionPayloads.set(sessionID, merged);
  }

  getSessionPayloads(sessionID: string): string[] {
    return [...(this.sessionPayloads.get(sessionID) || [])];
  }

  clearSession(sessionID: string): void {
    this.loads.delete(sessionID);
    this.pending.delete(sessionID);
    this.sessionPayloads.delete(sessionID);
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
