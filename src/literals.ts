/** One expansion owns its literal table until every effect stage has finished. */
export class LiteralStore {
  private readonly prefix = `\uE000${crypto.randomUUID()}:`;
  private readonly values = new Map<string, string>();
  protect(value: string): string {
    if (!value) return value;
    // Equal answers must produce equal block keys for deduplication.
    for (const [token, text] of this.values) if (text === value) return token;
    const token = `${this.prefix}${this.values.size}\uE001`;
    this.values.set(token, value);
    return token;
  }
  restore(text: string): string {
    // A single pass never interprets tokens contained in an answer.
    const pattern = new RegExp(`${this.prefix}(\\d+)\uE001`, "g");
    return text.replace(pattern, (token) => this.values.get(token) ?? token);
  }
}
