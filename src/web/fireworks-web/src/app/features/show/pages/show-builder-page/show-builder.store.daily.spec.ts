import { TestBed } from '@angular/core/testing';
import { EngineLoop } from '../../../../../engine/loop/engine-loop';
import { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import { FireworksSim } from '../../../../../engine/sim/simulation';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { serializeShowDraft, SHOW_DRAFT_KEY } from '../../shared/show-draft';
import { ShowBuilderStore } from './show-builder.store';

/**
 * Daily tier (testing strategy §2.3, §3 item 3): the 6c.3 and 6c.4 ledger diffs with every ledger
 * from a full Done-when run to its end, exactly as they ran in the regular suite through Phase 7.
 * The regular `show-builder.store.spec.ts` runs the same assertions on `scheduledLedger`, which
 * `testing/scheduled-ledger.spec.ts` pins against a full run. Four (6c.3) and six (6c.4) full
 * runs: 4.7 s and 6.6 s alone.
 */
describe('ShowBuilderStore, daily: ledger diffs over full runs (6c.3, 6c.4)', () => {
  let storage: MemoryStorage;

  function make(): ShowBuilderStore {
    storage.setItem(
      SHOW_DRAFT_KEY,
      serializeShowDraft({
        show: doneWhenShow(),
        nextCueId: 51,
        selectedCueId: null,
        activeShell: { kind: 'preset', index: 0 },
        view: { pxPerSecond: null, scroll: 0 },
        dirty: true,
        saved: false,
        source: null,
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        ShowBuilderStore,
        { provide: BROWSER_STORAGE, useValue: storage },
        { provide: MATCH_MEDIA, useValue: new FakeMatchMedia().fn },
      ],
    });
    return TestBed.inject(ShowBuilderStore);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
  });
  afterEach(() => TestBed.resetTestingModule());

  const fullLedger = (show: ReturnType<ShowBuilderStore['show']>) => {
    const d = new TimelineDriver(show);
    d.runToEnd(
      new EngineLoop(new FireworksSim(), undefined, { worldWidth: () => 1280, driver: d }),
    );
    return d.ledger;
  };
  const without = (rows: ReturnType<typeof fullLedger>, id: string) =>
    rows.filter((r) => r.id !== id);

  it('moving cue A in t and x changes only A’s row; its id, seed and shell stay (6c.3)', () => {
    const store = make();
    // c7 has its own burstHeight; c2 shares its step with c10, which must keep its row.
    for (const [id, t, x] of [
      ['c7', 40.25, 0.125],
      ['c2', 12.5, 0.875],
    ] as const) {
      const before = fullLedger(store.show());
      expect(before).toHaveLength(50);
      const a = before.find((r) => r.id === id)!;
      const seedOf = () => store.show().cues.find((c) => c.id === id)!.seed;
      store.moveCue(id, t);
      expect(seedOf()).toBe(a.seed);
      store.updateCue(id, { x });
      expect(seedOf()).toBe(a.seed);
      const after = fullLedger(store.show());
      expect(after).toHaveLength(50);
      expect(without(after, id)).toEqual(without(before, id));
      const moved = after.find((r) => r.id === id)!;
      expect([moved.id, moved.seed, moved.shell, moved.x, moved.ty]).toEqual([
        a.id,
        a.seed,
        a.shell,
        x,
        a.ty,
      ]);
      expect([moved.step, moved.tx]).toEqual([t * 120, x * 1280]);
      expect(moved.step).not.toBe(a.step);
    }
  }, 60_000);

  it('deleting cue A: the ledger is the old one minus A’s row (6c.4)', () => {
    const store = make();
    const before = fullLedger(store.show());
    // c2 shares its step with c10: the same-step neighbour must keep its row too.
    for (const id of ['c2', 'c33']) {
      const ref = fullLedger(store.show());
      store.deleteCue(id);
      expect(fullLedger(store.show())).toEqual(without(ref, id));
    }
    expect(fullLedger(store.show())).toEqual(without(without(before, 'c2'), 'c33'));
  }, 60_000);
});
