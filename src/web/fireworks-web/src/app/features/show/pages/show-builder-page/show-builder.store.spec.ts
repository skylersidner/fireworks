import { TestBed } from '@angular/core/testing';
import { EngineLoop } from '../../../../../engine/loop/engine-loop';
import { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import { FireworksSim } from '../../../../../engine/sim/simulation';
import { MAX_SHOW_CUES } from '../../../../../engine/model/limits';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../../../../core/client-config';
import { MOTION_BLUR_KEY } from '../../../../core/device-preferences';
import { CODE_A } from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { scheduledLedger } from '../../../../testing/scheduled-ledger';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../../designer/shared/designer-draft';
import { CUE_CAP, SHELL_CAP } from '../../shared/show-copy';
import { SHOW_DRAFT_KEY, readShowDraft, serializeShowDraft } from '../../shared/show-draft';
import { embeddable } from '../../shared/show-edit';
import { openShow } from '../../../../../engine/model/open';
import { embeddedShell } from '../../../../../engine/model/show';
import { saveDocumentOf } from './show-save';
import { SHOW_DRAFT_DEBOUNCE_MS, ShowBuilderStore, UNDO_LIMIT } from './show-builder.store';

const SOURCE = {
  shareCode: CODE_A,
  kind: 'show' as const,
  isOwner: true,
  updatedAt: '2026-11-14T10:00:00Z',
  name: 'Saved show',
};
const peony = () => embeddable(PRESETS[0])!;

describe('ShowBuilderStore (phase-6.md §4, §9, §10; acceptance 6c, 6d, 6f.8)', () => {
  let storage: MemoryStorage;

  function make(seed?: Parameters<typeof serializeShowDraft>[0]): ShowBuilderStore {
    if (seed) storage.setItem(SHOW_DRAFT_KEY, serializeShowDraft(seed));
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
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('first visit: New show, 60 s, default sky, no shells or cues, clean', () => {
    const store = make();
    const show = store.show();
    expect([show.name, show.duration, show.sky, show.cues, show.shells]).toEqual([
      'New show',
      60,
      { gravity: 160, wind: 0 },
      [],
      {},
    ]);
    expect([store.dirty(), store.saved(), store.source()]).toEqual([false, false, null]);
  });

  it('add: c{n} id, int32 seed, no burstHeight, shell copied in, selected, dirty (6c.2)', () => {
    const store = make();
    const out = store.addCue(peony(), 1.25, 0.4);
    expect(out.ok).toBe(true);
    const cue = store.show().cues[0];
    expect(cue).toEqual({ id: 'c1', t: 1.25, shell: 's1', x: 0.4, seed: expect.any(Number) });
    expect(Number.isInteger(cue.seed) && cue.seed >= -(2 ** 31) && cue.seed < 2 ** 31).toBe(true);
    expect('sky' in store.show().shells['s1']).toBe(false);
    expect([store.selectedCueId(), store.dirty()]).toEqual(['c1', true]);
    store.addCue(peony(), 2, 0.5);
    expect(Object.keys(store.show().shells)).toEqual(['s1']);
  });

  it('blocks past the window, at 1000 cues and at 32 shells, leaving the show unchanged (6d.3, 6d.4)', () => {
    const store = make();
    expect(store.addCue(peony(), 61, 0.5)).toEqual({ ok: false, reason: 'past-window' });
    const show = doneWhenShow();
    show.cues = Array.from({ length: MAX_SHOW_CUES }, (_, i) => ({
      ...show.cues[i % 50],
      id: `k${i}`,
    }));
    store.edit(show);
    const before = store.show();
    expect(store.addCue(peony(), 1, 0.5)).toEqual({ ok: false, reason: 'cue-cap' });
    expect(store.announcement()).toBe(CUE_CAP);
    expect(store.duplicateCue('k1').ok).toBe(false);
    expect(store.show()).toBe(before);

    const full = doneWhenShow();
    for (let i = 7; i <= 32; i++) full.shells[`s${i}`] = { ...peony(), name: `P${i}` };
    store.edit(full);
    expect(store.addCue({ ...peony(), name: 'New' }, 1, 0.5)).toEqual({
      ok: false,
      reason: 'shell-cap',
    });
    expect(store.announcement()).toBe(SHELL_CAP);
    expect(store.addCue(full.shells['s7'], 1, 0.5).ok).toBe(true);
    expect(Object.keys(store.show().shells)).toHaveLength(32);
  });

  it('selection, view, active shell and the end never set dirty (6f.8, 6i.3)', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()), dirty: false });
    store.select('c3');
    store.setView({ pxPerSecond: 50, scroll: 3 });
    store.setActive({ kind: 'preset', index: 4 });
    store.recordEnd(66.8);
    store.setPersistence(0.5);
    expect(store.dirty()).toBe(false);
    store.nudgeCue('c3', 0.1);
    expect(store.dirty()).toBe(true);
  });

  it('move and New seed keep id; duplicate gets a new id and seed at +0.5 s; delete selects the next', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()) });
    const c4 = store.show().cues[3];
    store.moveCue('c4', 5);
    store.newSeed('c4');
    const moved = store.show().cues.find((c) => c.id === 'c4')!;
    expect([moved.t, moved.id, moved.x]).toEqual([5, 'c4', c4.x]);
    const dup = store.duplicateCue('c4');
    if (!dup.ok) throw new Error('dup');
    expect([dup.cue.id, dup.cue.t, dup.cue.shell]).toEqual(['c51', 5.5, c4.shell]);
    expect(dup.cue.seed).not.toBe(moved.seed);
    const order = store.ordered().map((c) => c.id);
    const next = order[order.indexOf('c51') + 1];
    store.deleteCue('c51');
    expect(store.selectedCueId()).toBe(next);
    expect(store.addCue(peony(), 1, 0.5).ok && store.show().cues.at(-1)!.id).toBe('c52');
  });

  it('Duration below the last launch is blocked, never clamping cues (6c.9)', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()) });
    expect(store.setDuration(59)).toBe(false);
    expect(store.show().duration).toBe(60);
    expect(store.setDuration(90)).toBe(true);
    expect(store.show().duration).toBe(90);
  });

  it('Undo and Redo replace the document; 50 steps; coalesced edits are one step', () => {
    const store = make();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) store.addCue(peony(), i / 10, 0.5);
    let undone = 0;
    while (store.undo()) undone++;
    expect(undone).toBe(UNDO_LIMIT);
    expect(store.show().cues).toHaveLength(5);
    store.redo();
    expect(store.show().cues).toHaveLength(6);
    store.setName('A');
    store.setName('AB');
    store.setName('ABC');
    store.undo();
    expect(store.show().name).toBe('New show');
  });

  // Toad, Phase 6 review: the 6c.11 rows the test above leaves open.
  it('Undo of a delete restores the same id, seed and ledger; Undo sets dirty (6c.11)', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()), dirty: false });
    const before = store.show();
    const c7 = before.cues.find((c) => c.id === 'c7')!;
    const ledgerOf = () => {
      const d = new TimelineDriver(store.show());
      d.seek(
        new EngineLoop(new FireworksSim(), undefined, { worldWidth: () => 1280, driver: d }),
        1500,
      );
      return d.ledger;
    };
    const ledgerBefore = ledgerOf();
    store.deleteCue('c7');
    store.completeSave(SOURCE, store.snapshotForSave());
    expect(store.dirty()).toBe(false);
    expect(store.undo()).toBe(true);
    expect(store.show()).toBe(before);
    expect(store.show().cues.find((c) => c.id === 'c7')).toEqual(c7);
    expect(ledgerOf()).toEqual(ledgerBefore);
    expect([store.dirty(), store.saved()]).toEqual([true, false]);
    // Selection, view and the active shell are not steps: one Undo already took the only one.
    store.select('c3');
    store.setView({ pxPerSecond: 40, scroll: 2 });
    store.setActive({ kind: 'preset', index: 3 });
    expect(store.undo()).toBe(false);
  });

  // Toad, Phase 6 review-fix (Peach 6c.3, 6c.4): ledger diffs over the whole show. The ledger
  // comes from the cue schedule alone (`scheduledLedger`, pinned against a full run in
  // `testing/scheduled-ledger.spec.ts`), so no show is simulated past its last cue. The original
  // ten full Done-when runs are in `show-builder.store.daily.spec.ts` (testing strategy §3 item 3).
  describe('ledger diffs: an edit to cue A leaves every other row unchanged', () => {
    const ledgerOf = (show: ReturnType<ShowBuilderStore['show']>) => scheduledLedger(show);
    const without = (rows: ReturnType<typeof ledgerOf>, id: string) =>
      rows.filter((r) => r.id !== id);

    it('moving cue A in t and x changes only A’s row; its id, seed and shell stay (6c.3)', () => {
      const store = make({ ...readShowDraftOf(doneWhenShow()) });
      // c7 has its own burstHeight; c2 shares its step with c10, which must keep its row.
      for (const [id, t, x] of [
        ['c7', 40.25, 0.125],
        ['c2', 12.5, 0.875],
      ] as const) {
        const before = ledgerOf(store.show());
        expect(before).toHaveLength(50);
        const a = before.find((r) => r.id === id)!;
        const seedOf = () => store.show().cues.find((c) => c.id === id)!.seed;
        store.moveCue(id, t);
        expect(seedOf()).toBe(a.seed);
        store.updateCue(id, { x });
        expect(seedOf()).toBe(a.seed);
        const after = ledgerOf(store.show());
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
    });

    it('deleting cue A: the ledger is the old one minus A’s row (6c.4)', () => {
      const store = make({ ...readShowDraftOf(doneWhenShow()) });
      const before = ledgerOf(store.show());
      // c2 shares its step with c10: the same-step neighbour must keep its row too.
      for (const id of ['c2', 'c33']) {
        const ref = ledgerOf(store.show());
        store.deleteCue(id);
        expect(ledgerOf(store.show())).toEqual(without(ref, id));
      }
      expect(ledgerOf(store.show())).toEqual(without(without(before, 'c2'), 'c33'));
    });
  });

  it('an undone add frees nothing: the next add gets a new id (Peach N4)', () => {
    const store = make();
    store.addCue(peony(), 1, 0.5);
    store.addCue(peony(), 2, 0.5);
    store.undo();
    expect(store.show().cues.map((c) => c.id)).toEqual(['c1']);
    store.addCue(peony(), 3, 0.5);
    expect(store.show().cues.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(store.canRedo()).toBe(false);
    store.undo();
    store.undo();
    store.addCue(peony(), 4, 0.5);
    expect(store.show().cues.map((c) => c.id)).toEqual(['c4']);
  });

  it('after 51 changes, 50 undos reach the state after the first; a 51st does nothing (6c.11)', () => {
    const store = make();
    const states = [];
    for (let i = 0; i <= UNDO_LIMIT; i++) {
      store.setSky('wind', i);
      store.endCoalesce();
      states.push(store.show());
    }
    for (let i = 0; i < UNDO_LIMIT; i++) expect(store.undo()).toBe(true);
    expect(store.show()).toBe(states[0]);
    expect(store.undo()).toBe(false);
    expect(store.show()).toBe(states[0]);
  });

  it('pagehide writes a pending draft at once, inside the debounce (phase-7.md §11; 7e.6)', () => {
    const store = make();
    store.addCue(peony(), 1, 0.5);
    TestBed.tick();
    expect(storage.getItem(SHOW_DRAFT_KEY)).toBeNull(); // still inside the debounce
    window.dispatchEvent(new Event('pagehide'));
    expect(readShowDraft(storage)?.show.cues.map((c) => c.id)).toEqual(['c1']);
  });

  it('history is session only: no draft key holds it, and a reload has nothing to undo (6c.11)', async () => {
    const store = make();
    store.addCue(peony(), 1, 0.5);
    store.addCue(peony(), 2, 0.5);
    store.undo();
    TestBed.tick();
    store.flushDraft();
    const raw = storage.getItem(SHOW_DRAFT_KEY)!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      Object.keys(JSON.parse(serializeShowDraft(store.draft()))).sort(),
    );
    expect(raw).not.toMatch(/past|future|undo|redo|history/i);
    TestBed.resetTestingModule();
    const reloaded = make();
    expect(reloaded.show().cues.map((c) => c.id)).toEqual(['c1']);
    expect([reloaded.canUndo(), reloaded.canRedo(), reloaded.undo()]).toEqual([
      false,
      false,
      false,
    ]);
    // The counter survived the reload, so the undone c2 is still never reused.
    expect(reloaded.addCue(peony(), 3, 0.5).ok && reloaded.show().cues.at(-1)!.id).toBe('c3');
  });

  it('a shell whose keys came back reordered (jsonb) still reuses its key (6d.3, §4.1)', () => {
    const shell = peony();
    const reordered = {
      breaks: shell.breaks.map((b) => Object.fromEntries(Object.entries(b).reverse())),
      angleJitter: shell.angleJitter,
      burstHeight: shell.burstHeight,
      name: shell.name,
      version: shell.version,
    };
    const store = make();
    store.edit({ ...store.show(), shells: { s1: reordered as unknown as typeof shell } });
    expect(store.addCue(shell, 1, 0.5).ok).toBe(true);
    expect(Object.keys(store.show().shells)).toEqual(['s1']);
    expect(store.show().cues[0].shell).toBe('s1');
  });

  it('F4: a save clears dirty and sets saved only for the document it sent', () => {
    const store = make();
    store.addCue(peony(), 1, 0.5);
    const sent = store.snapshotForSave();
    store.completeSave(SOURCE, sent);
    expect([store.dirty(), store.saved(), store.source()]).toEqual([false, true, SOURCE]);
    const sent2 = store.snapshotForSave();
    store.addCue(peony(), 2, 0.5);
    store.completeSave(SOURCE, sent2);
    expect([store.dirty(), store.saved()]).toEqual([true, false]);
  });

  it('a link load asks only when dirty; it loads dirty with the source and clears Undo (6g.1, 6g.3)', () => {
    const store = make();
    const copy = { show: doneWhenShow(), source: SOURCE };
    expect(store.openWorkingCopy(copy)).toBe(true);
    expect([store.dirty(), store.saved(), store.source(), store.nextCueId()]).toEqual([
      true,
      false,
      SOURCE,
      51,
    ]);
    expect(store.canUndo()).toBe(false);
    expect(store.openWorkingCopy(copy)).toBe(false);
    expect(store.pending()?.kind).toBe('link');
    const before = store.show();
    store.cancelPending();
    expect(store.show()).toBe(before);
    expect(store.newShow()).toBe(false);
    store.confirmPending();
    expect([store.show().cues.length, store.dirty(), store.source()]).toEqual([0, false, null]);
  });

  it('removing a used shell asks; Remove deletes its cues', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()) });
    store.removeShell('s6');
    expect(Object.hasOwn(store.show().shells, 's6')).toBe(false);
    store.removeShell('s1');
    expect(store.pending()).toEqual({ kind: 'remove-shell', key: 's1' });
    store.confirmPending();
    expect(store.show().cues.some((c) => c.shell === 's1')).toBe(false);
  });

  describe('Motion blur is the device preference (Skyler, 2026-11-14; replaces §10.1)', () => {
    const designerDraft = (persistence: number) =>
      serializeDraft({
        shell: editableFrom(PRESETS[0]),
        activeBreak: 0,
        display: { mode: 'loop', persistence, starBudget: 1, reduceFlashing: null },
        shellDirty: false,
        skyDirty: false,
        saved: false,
        source: null,
      });

    it('defaults to 0.78 with nothing stored, and stores nothing until changed', () => {
      const store = make();
      expect(store.quality().persistence).toBe(0.78);
      TestBed.tick();
      expect(storage.getItem(MOTION_BLUR_KEY)).toBeNull();
    });

    it("the device value wins over the designer draft's (negative control for the old read)", () => {
      storage.setItem(MOTION_BLUR_KEY, '0.6');
      storage.setItem(DRAFT_KEY, designerDraft(0.3));
      expect(make().quality().persistence).toBe(0.6);
    });

    it("an old designer draft's value is adopted once, then the draft no longer matters", () => {
      storage.setItem(DRAFT_KEY, designerDraft(0.3));
      expect(make().quality().persistence).toBe(0.3);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBe('0.3');
      TestBed.resetTestingModule();
      storage.setItem(DRAFT_KEY, designerDraft(0.1));
      expect(make().quality().persistence).toBe(0.3);
    });

    it('a change is stored on the device; the designer draft stays byte-identical (6c.1)', () => {
      vi.useFakeTimers();
      storage.setItem(DRAFT_KEY, designerDraft(0.3));
      const before = storage.getItem(DRAFT_KEY);
      const store = make();
      store.setPersistence(0.5);
      TestBed.tick();
      expect(store.quality().persistence).toBe(0.5);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBe('0.5');
      vi.advanceTimersByTime(SHOW_DRAFT_DEBOUNCE_MS);
      expect(storage.getItem(DRAFT_KEY)).toBe(before);
      expect(storage.getItem(SHOW_DRAFT_KEY) ?? '').not.toContain('persistence');
    });
  });

  // Fake timers (testing strategy §3 item 9, risk 5.9): both sides of the debounce edge.
  it('writes its own draft debounced and never the designer draft (6c.1)', () => {
    vi.useFakeTimers();
    storage.setItem(DRAFT_KEY, '{"designer":true}');
    const store = make();
    store.addCue(peony(), 1, 0.5);
    TestBed.tick();
    expect(storage.getItem(SHOW_DRAFT_KEY)).toBeNull();
    vi.advanceTimersByTime(SHOW_DRAFT_DEBOUNCE_MS - 1);
    expect(storage.getItem(SHOW_DRAFT_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(readShowDraft(storage)?.show.cues).toHaveLength(1);
    expect(storage.getItem(DRAFT_KEY)).toBe('{"designer":true}');
  });

  it('the driver is rebuilt from the previous one on each change, at starBudget 1', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()) });
    const first = store.driver();
    store.moveCue('c50', 59);
    expect(store.driver()).not.toBe(first);
    expect(store.quality().starBudget).toBe(1);
  });

  /** The driver's checkpoint spacing and memory cap (private; read for this spec only). */
  const checkpointing = (d: TimelineDriver) => [d['cpSteps'], d['cpBytesMax']];

  it('the driver takes the configured checkpoint spacing and memory cap (api/client-config)', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()) });
    // Before the first driver is built (it is lazy), as when the loader answered at app init.
    TestBed.inject(ClientConfigStore).setPlayback({
      ...DEFAULT_PLAYBACK,
      checkpointIntervalSeconds: 5,
      checkpointMemoryMiB: 16,
    });
    expect(checkpointing(store.driver())).toEqual([600, 16 * 1024 * 1024]);
    const d = store.driver();
    d.seek(
      new EngineLoop(new FireworksSim(), undefined, { worldWidth: () => 1280, driver: d }),
      1300,
    );
    expect(d.checkpointSteps).toEqual([600, 1200]);
  });

  it('defaults (10 s, 64 MiB) until the config arrives; a late config applies from the next edit', () => {
    const store = make({ ...readShowDraftOf(doneWhenShow()) });
    const first = store.driver();
    expect(checkpointing(first)).toEqual([1200, 64 * 1024 * 1024]);
    TestBed.inject(ClientConfigStore).setPlayback({
      ...DEFAULT_PLAYBACK,
      checkpointIntervalSeconds: 2,
      checkpointMemoryMiB: 8,
    });
    // Not replaced mid-play by the config alone.
    expect(store.driver()).toBe(first);
    store.moveCue('c50', 59);
    // The memory cap applies now; the spacing is inherited with the kept checkpoints (the
    // driver's `from` rule, so they stay on one grid) until a driver is built without `from`.
    expect(checkpointing(store.driver())).toEqual([1200, 8 * 1024 * 1024]);
  });

  // Toad, Phase 7 C3 (acceptance 7k.5): Apply keeps the active shell unless it is an embedded
  // shell the applied show no longer has; that one falls back to Peony (preset 0). Mutant J2
  // (no fallback) survived every Show JSON spec before this one.
  it('Apply: a gone embedded active shell falls back to Peony; a kept one, a preset or the designer item stays (7k.5)', () => {
    const show = doneWhenShow();
    const [gone, kept] = Object.keys(show.shells);
    const applied: typeof show = {
      ...show,
      shells: Object.fromEntries(Object.entries(show.shells).filter(([k]) => k !== gone)),
      cues: show.cues.filter((c) => c.shell !== gone),
    };
    for (const [active, expected] of [
      [
        { kind: 'embedded', key: gone },
        { kind: 'preset', index: 0 },
      ],
      [
        { kind: 'embedded', key: kept },
        { kind: 'embedded', key: kept },
      ],
      [
        { kind: 'preset', index: 3 },
        { kind: 'preset', index: 3 },
      ],
      [{ kind: 'designer' }, { kind: 'designer' }],
    ] as const) {
      const store = make({ ...readShowDraftOf(doneWhenShow()), dirty: false });
      store.setActive(active);
      expect(store.applyJson(applied, 'Applied.')).toBe(true);
      expect(store.show()).toBe(applied);
      expect(store.activeShell()).toEqual(expected);
      TestBed.resetTestingModule();
      storage = new MemoryStorage();
    }
  });

  // Toad, Phase 7 C3 (yoshi-phase7-architecture-rulings.md point 5, acceptance 7m.5): embedded
  // shells keyed like Object.prototype members survive every store path, and a prototype name
  // that is not a key is never treated as one. `loadCopy` spreads `shells` into an ordinary
  // object, so from here on a bare `shells[k]` or `k in shells` would see Object.prototype.
  it('prototype-named shell keys go through loadCopy, add, remove, the draft and the Save body (7m.5)', () => {
    const [a, b, c, fresh] = [1, 2, 3, 4].map((i) => embeddable(PRESETS[i])!);
    const opened = openShow({
      ...doneWhenShow(),
      shells: { constructor: a, toString: b, valueOf: c },
      cues: [
        { id: 'c1', t: 1, shell: 'constructor', x: 0.2, seed: 11 },
        { id: 'c2', t: 2, shell: 'toString', x: 0.4, seed: 22 },
        { id: 'c3', t: 3, shell: 'valueOf', x: 0.6, seed: 33 },
      ],
    });
    if (!opened.ok) throw new Error('fixture does not open');
    const store = make();
    expect(store.openWorkingCopy({ show: opened.show, source: SOURCE })).toBe(true);
    const keysOf = () => Object.keys(store.show().shells).sort();
    expect(keysOf()).toEqual(['constructor', 'toString', 'valueOf']);
    expect(embeddedShell(store.show(), 'constructor')?.name).toBe(a.name);
    expect(embeddedShell(store.show(), 'hasOwnProperty')).toBeUndefined();

    // Add: an identical shell reuses its prototype-named key; a new one gets s1.
    const again = store.addCue(b, 4, 0.5, 44);
    expect(again.ok && again.cue.shell).toBe('toString');
    const added = store.addCue(fresh, 5, 0.5, 55);
    expect(added.ok && added.cue.shell).toBe('s1');
    expect(keysOf()).toEqual(['constructor', 's1', 'toString', 'valueOf']);

    // Remove: a prototype name that isn't a key changes nothing (no Undo step, same document).
    const before = store.show();
    store.removeShell('hasOwnProperty');
    store.removeShell('isPrototypeOf');
    expect(store.show()).toBe(before);
    expect(store.pending()).toBeNull();
    // A real one with cues asks, then removes the shell and its cue only.
    store.removeShell('valueOf');
    expect(store.pending()).toEqual({ kind: 'remove-shell', key: 'valueOf' });
    store.confirmPending();
    expect(keysOf()).toEqual(['constructor', 's1', 'toString']);
    expect(
      store
        .show()
        .cues.map((q) => q.id)
        .sort(),
    ).toEqual(['c1', 'c2', 'c4', 'c5']);

    // The Save body carries exactly the own keys, each with its own shell.
    const body = JSON.parse(JSON.stringify(saveDocumentOf(store.snapshotForSave())));
    expect(Object.keys(body.shells).sort()).toEqual(['constructor', 's1', 'toString']);
    expect([body.shells.constructor.name, body.shells.toString.name, body.shells.s1.name]).toEqual([
      a.name,
      b.name,
      fresh.name,
    ]);

    // The draft: flushed, restored by a new store, the same show and active shell.
    store.setActive({ kind: 'embedded', key: 'constructor' });
    TestBed.tick();
    store.flushDraft();
    expect(readShowDraft(storage)?.show).toEqual(store.show());
    const saved = store.show();
    TestBed.resetTestingModule();
    const restored = make();
    expect(restored.show()).toEqual(saved);
    expect(restored.activeShell()).toEqual({ kind: 'embedded', key: 'constructor' });
    expect(embeddedShell(restored.show(), 'toString')?.name).toBe(b.name);
    expect(embeddedShell(restored.show(), 'valueOf')).toBeUndefined();
  });
});

function readShowDraftOf(show: ReturnType<typeof doneWhenShow>) {
  return {
    show,
    nextCueId: 51,
    selectedCueId: null,
    activeShell: { kind: 'preset' as const, index: 0 },
    view: { pxPerSecond: null, scroll: 0 },
    dirty: true,
    saved: false,
    source: null,
  };
}
