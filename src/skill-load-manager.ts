export class SkillLoadManager {
  private loads = new Map<string, Map<string, string[]>>();

  register(sessionID: string, messageID: string, payloads: string[]): void {
    const session = this.getOrCreateSession(sessionID);
    session.set(messageID, [...payloads]);
  }

  get(sessionID: string, messageID: string): string[] {
    return [...(this.loads.get(sessionID)?.get(messageID) || [])];
  }

  private getOrCreateSession(sessionID: string): Map<string, string[]> {
    const existing = this.loads.get(sessionID);
    if (existing) return existing;

    const created = new Map<string, string[]>();
    this.loads.set(sessionID, created);
    return created;
  }
}
