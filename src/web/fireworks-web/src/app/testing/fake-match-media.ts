/** A controllable `matchMedia` for specs: set a query's state, and fire change events. */
export class FakeMatchMedia {
  private readonly lists = new Map<string, FakeMediaQueryList>();

  constructor(initial: Record<string, boolean> = {}) {
    for (const [query, matches] of Object.entries(initial)) this.list(query).matches = matches;
  }

  readonly fn = (query: string): MediaQueryList => this.list(query) as unknown as MediaQueryList;

  set(query: string, matches: boolean): void {
    const list = this.list(query);
    list.matches = matches;
    for (const listener of [...list.listeners]) {
      listener({ matches, media: query } as MediaQueryListEvent);
    }
  }

  listenerCount(query: string): number {
    return this.list(query).listeners.size;
  }

  private list(query: string): FakeMediaQueryList {
    let list = this.lists.get(query);
    if (!list) {
      list = new FakeMediaQueryList(query);
      this.lists.set(query, list);
    }
    return list;
  }
}

class FakeMediaQueryList {
  matches = false;
  readonly listeners = new Set<(e: MediaQueryListEvent) => void>();
  constructor(readonly media: string) {}
  addEventListener(_type: 'change', listener: (e: MediaQueryListEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'change', listener: (e: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener);
  }
}
