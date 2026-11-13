/** In-memory `Storage` for specs; `failReads`/`failWrites` make it throw like a refused store. */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  failReads = false;
  failWrites = false;
  readonly writes: [string, string][] = [];

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    if (this.failReads) throw new DOMException('denied', 'SecurityError');
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError');
    this.writes.push([key, value]);
    this.items.set(key, String(value));
  }
}
