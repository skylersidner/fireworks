import { TestBed } from '@angular/core/testing';
import { ANNOUNCE_REPEAT_MS, announcement, liveNote } from './announcer';

/** phase-7.md §10 B4; acceptance 7g.21: repeated messages re-announce. */
describe('announcement() and liveNote()', () => {
  afterEach(() => vi.useRealTimers());

  it('a different message is set at once; the same one clears, then returns after 100 ms', () => {
    vi.useFakeTimers();
    const a = TestBed.runInInjectionContext(() => announcement());
    a.set('Added Peony at 0:00.0.');
    expect(a()).toBe('Added Peony at 0:00.0.');
    a.set('Added Peony at 0:00.0.');
    expect(a()).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_REPEAT_MS - 1);
    expect(a()).toBe('');
    vi.advanceTimersByTime(1);
    expect(a()).toBe('Added Peony at 0:00.0.');
  });

  it('a new set cancels a pending repeat; clearing is immediate', () => {
    vi.useFakeTimers();
    const a = announcement();
    a.set('x');
    a.set('x');
    a.set('y');
    expect(a()).toBe('y');
    vi.advanceTimersByTime(ANNOUNCE_REPEAT_MS * 2);
    expect(a()).toBe('y');
    a.set('');
    expect(a()).toBe('');
  });

  // Negative control: a plain signal set twice never changes, so a live region stays silent.
  it('negative control: a plain signal does not change on a repeat', async () => {
    const { signal } = await import('@angular/core');
    const plain = signal('x');
    const seen: string[] = [];
    seen.push(plain());
    plain.set('x');
    seen.push(plain());
    expect(seen).toEqual(['x', 'x']);
  });

  it('liveNote gives every set a new sequence number, so a keyed text node is replaced', () => {
    const n = liveNote();
    expect(n()).toBeNull();
    n.set('Duration is between 1 and 600 seconds.');
    const first = n()!;
    n.set('Duration is between 1 and 600 seconds.');
    const second = n()!;
    expect(second.text).toBe(first.text);
    expect(second.seq).not.toBe(first.seq);
    n.set(null);
    expect(n()).toBeNull();
  });
});
