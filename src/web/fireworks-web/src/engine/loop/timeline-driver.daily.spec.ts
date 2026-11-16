// @vitest-environment node
/**
 * TimelineDriver, daily tier (testing strategy §2.3, §3 item 1): the cases that run the 60 s
 * Done-when show, or seek thousands of steps into it, moved here unchanged from the regular
 * `timeline-driver.spec.ts` (Phase 7, commit 8eb99c7). They are the realistic-density coverage
 * (about 5k live particles, 1200-step checkpoints, offsets up to 7000 steps). Each has a
 * small-show equivalent in the regular `timeline-driver.spec.ts` or
 * `timeline-driver.checkpoints.spec.ts`; the mutant proof that both sets kill the same mutants is
 * in `.squad/decisions/records/luigi-interlude-spec-split.md`.
 */
import { FireworksSim } from '../sim/simulation';
import { EngineLoop } from './engine-loop';
import {
  WIDTH,
  doneWhenShow,
  makeLoop,
  playFrames,
  snapshot,
  straight,
} from './testing/timeline-spec-helpers';
import type { ShowCue, ShowDocument } from '../model/show';
import { TimelineDriver } from './timeline-driver';

// Every case here runs the Done-when show at least once (1-3 s each alone); 30 s keeps a hang
// visible under load (Toad, Phase 7 C3).
vi.setConfig({ testTimeout: 30_000 });

describe('TimelineDriver determinism, daily (Done-when show)', () => {
  it('the same show gives the same ledger, particle-count trace and final state across two runs', () => {
    const a = makeLoop(doneWhenShow());
    const b = makeLoop(doneWhenShow());
    const frames = 60 * 20;
    const traceA = playFrames(a.loop, a.sim, frames);
    const traceB = playFrames(b.loop, b.sim, frames);
    expect(traceA.some((n) => n > 0)).toBe(true);
    expect(traceB).toEqual(traceA);
    expect(b.driver.ledger).toEqual(a.driver.ledger);
    expect(snapshot(b.sim)).toEqual(snapshot(a.sim));
  });

  it('frame size never matters: 60 fps, 144 fps and 24 fps frames equal a straight run', () => {
    for (const ms of [1000 / 60, 1000 / 144, 1000 / 24]) {
      const played = makeLoop(doneWhenShow());
      for (let f = 0; f < Math.floor(12_000 / ms); f++) played.loop.frame(ms);
      const straight = makeLoop(doneWhenShow());
      straight.driver.advance(straight.loop, played.driver.step);
      expect(played.driver.step).toBeGreaterThan(1400);
      expect(snapshot(played.sim)).toEqual(snapshot(straight.sim));
      expect(played.driver.ledger).toEqual(straight.driver.ledger);
    }
    // Runs the Done-when show three times; under the full suite's parallel load it needs more
    // than the default 5 s (Luigi, Phase 6 build).
  }, 20_000);
});

describe('TimelineDriver checkpoints, daily (exact; acceptance 6i.2; Done-when show)', () => {
  it('are taken every 1200 steps on the way, and a seek from one equals a straight run at the cap', () => {
    const cap = 3000;
    const s = makeLoop(doneWhenShow(), cap);
    s.driver.seek(s.loop, 4000);
    expect(s.driver.checkpointSteps).toEqual([1200, 2400, 3600]);
    const restore = vi.spyOn(s.sim, 'restore');
    const reset = vi.spyOn(s.sim, 'clear');
    for (const target of [2500, 3601, 1199, 3600, 1200]) {
      s.driver.seek(s.loop, target);
      const ref = straight(doneWhenShow(), target, cap);
      expect(snapshot(s.sim)).toEqual(snapshot(ref.sim));
      expect(s.driver.ledger).toEqual(ref.driver.ledger);
    }
    // 2500 ← 2400, 3601 ← 3600 (forward jump), 1199 ← reset, 3600 ← 3600, 1200 ← 1200.
    expect(restore).toHaveBeenCalledTimes(4);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('a seek lands within one checkpoint spacing of work', () => {
    const s = makeLoop(doneWhenShow());
    s.driver.seek(s.loop, 6000);
    const step = vi.spyOn(s.sim, 'step');
    s.driver.seek(s.loop, 5999);
    expect(step).toHaveBeenCalledTimes(5999 - 4800);
  });

  it('a width change drops them, and the next seek is a straight run at the new width', () => {
    let width = WIDTH;
    const sim = new FireworksSim();
    const driver = new TimelineDriver(doneWhenShow());
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
    driver.seek(loop, 3000);
    width = 900;
    driver.seek(loop, 2500);
    expect(snapshot(sim)).toEqual(snapshot(straight(doneWhenShow(), 2500, undefined, 900).sim));
    expect(driver.ledger.every((l) => l.tx === l.x * 900)).toBe(true);
    // A forward seek after a width change also re-runs: the old run wasn't at this width.
    width = 1000;
    driver.seek(loop, 2600);
    expect(snapshot(sim)).toEqual(snapshot(straight(doneWhenShow(), 2600, undefined, 1000).sim));
    // Several full seeks of the Done-when show; under the full suite's parallel load it can exceed
    // the default 5 s (1.6 s alone; Toad, Phase 6 review).
  }, 20_000);

  it('over the memory cap the spacing doubles, and seeks stay exact', () => {
    const s = makeLoop(doneWhenShow(), undefined, { checkpointBytes: 1 });
    s.driver.seek(s.loop, 7000);
    expect(s.driver.checkpointSteps.length).toBe(1);
    s.driver.seek(s.loop, 5000);
    expect(snapshot(s.sim)).toEqual(snapshot(straight(doneWhenShow(), 5000).sim));
  });

  it('checkpoints filled on a shadow sim (idle warm-up) are exact on the visible one', () => {
    const doc = doneWhenShow();
    const shadow = makeLoop(doc);
    while (!shadow.driver.seek(shadow.loop, 7000, 500)); // spread over "idle frames"
    const visible = makeLoop(doc);
    const driver = new TimelineDriver(doc, { from: shadow.driver });
    visible.loop.setDriver(driver);
    expect(driver.checkpointSteps).toEqual(shadow.driver.checkpointSteps);
    const step = vi.spyOn(visible.sim, 'step');
    driver.seek(visible.loop, 6500);
    expect(step).toHaveBeenCalledTimes(6500 - 6000);
    expect(snapshot(visible.sim)).toEqual(snapshot(straight(doc, 6500).sim));
  });

  describe('warm-up handoff: twin and adoptCheckpoints (Phase 7)', () => {
    it('a twin runs on its own sim; adopting its checkpoints changes nothing but the start of a seek', () => {
      const doc = doneWhenShow();
      const live = makeLoop(doc);
      live.driver.seek(live.loop, 300);
      const before = snapshot(live.sim);
      const shadowSim = new FireworksSim();
      const twin = live.driver.twin();
      const shadowLoop = new EngineLoop(shadowSim, undefined, {
        worldWidth: () => WIDTH,
        driver: twin,
      });
      while (!twin.seek(shadowLoop, 7000, 700));
      expect(live.driver.step).toBe(300);
      expect(snapshot(live.sim)).toEqual(before);
      expect(live.driver.adoptCheckpoints(twin)).toBe(5);
      expect(live.driver.checkpointSteps).toEqual([1200, 2400, 3600, 4800, 6000]);
      expect(live.driver.step).toBe(300);
      expect(snapshot(live.sim)).toEqual(before);
      const step = vi.spyOn(live.sim, 'step');
      live.driver.seek(live.loop, 6100);
      expect(step).toHaveBeenCalledTimes(100);
      const ref = straight(doc, 6100);
      expect(snapshot(live.sim)).toEqual(snapshot(ref.sim));
      expect(live.driver.ledger).toEqual(ref.driver.ledger);
      expect(live.driver.adoptCheckpoints(twin)).toBe(0); // already held
    });

    it('takes only checkpoints before the first step where the schedules differ', () => {
      const doc = doneWhenShow();
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 6001);
      const next = { ...doc, cues: doc.cues.map((c) => (c.id === 'c30' ? { ...c, seed: 1 } : c)) };
      const b = makeLoop(next);
      expect(b.driver.adoptCheckpoints(a.driver)).toBe(3); // c30 fires at 4371
      expect(b.driver.checkpointSteps).toEqual([1200, 2400, 3600]);
      b.driver.seek(b.loop, 5000);
      expect(snapshot(b.sim)).toEqual(snapshot(straight(next, 5000).sim));
    });

    it('refuses another sky, and keeps the memory cap (spacing doubles)', () => {
      const doc = doneWhenShow();
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 6001);
      const windy = makeLoop({ ...doc, sky: { gravity: 160, wind: 3 } });
      expect(windy.driver.adoptCheckpoints(a.driver)).toBe(0);
      const capped = makeLoop(doc, undefined, { checkpointBytes: 1 });
      capped.driver.adoptCheckpoints(a.driver);
      expect(capped.driver.checkpointSteps.length).toBeLessThanOrEqual(1);
      capped.driver.seek(capped.loop, 5500);
      expect(snapshot(capped.sim)).toEqual(snapshot(straight(doc, 5500).sim));
    });

    // Yoshi addendum 1, gap M9 (Toad, Phase 7 C3): `compatible` must compare the digest flag.
    // A checkpoint from a digest-off run carries the unfolded seed digest, so a digest-on driver
    // that restored it would report a different digest than a straight run (6a.2 would lie).
    it('refuses checkpoints across different traceDigest settings, both ways and through { from }', () => {
      const doc = doneWhenShow();
      const off = makeLoop(doc);
      off.driver.seek(off.loop, 4900);
      const on = makeLoop(doc, undefined, { traceDigest: true });
      on.driver.seek(on.loop, 4900);
      expect(off.driver.checkpointSteps).toEqual([1200, 2400, 3600, 4800]);

      const adopter = makeLoop(doc, undefined, { traceDigest: true });
      expect(adopter.driver.adoptCheckpoints(off.driver)).toBe(0);
      expect(adopter.driver.checkpointSteps).toEqual([]);
      expect(off.driver.adoptCheckpoints(on.driver)).toBe(0);

      const inherited = makeLoop(doc, undefined, { traceDigest: true, from: off.driver });
      expect(inherited.driver.checkpointSteps).toEqual([]);
      inherited.driver.seek(inherited.loop, 4900);
      expect(inherited.driver.traceDigest).toBe(on.driver.traceDigest);
      adopter.driver.seek(adopter.loop, 4900);
      expect(adopter.driver.traceDigest).toBe(on.driver.traceDigest);
    });
  });

  describe('inherited after an edit (options.from)', () => {
    function edited(doc: ShowDocument, id: string, change: Partial<ShowCue>): ShowDocument {
      return { ...doc, cues: doc.cues.map((c) => (c.id === id ? { ...c, ...change } : c)) };
    }

    it('keeps checkpoints before the first changed cue and drops the rest; the re-seek is exact', () => {
      const doc = doneWhenShow();
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 6001); // the 6000 checkpoint is taken as step 6000 begins
      expect(a.driver.checkpointSteps).toEqual([1200, 2400, 3600, 4800, 6000]);
      // c30 fires at step round(30 * 59.5 / 49 * 120) = 4371.
      const next = edited(doc, 'c30', { seed: 12345 });
      const b = new TimelineDriver(next, { from: a.driver });
      expect(b.checkpointSteps).toEqual([1200, 2400, 3600]);
      a.loop.setDriver(b);
      b.seek(a.loop, 6000);
      const ref = straight(next, 6000);
      expect(snapshot(a.sim)).toEqual(snapshot(ref.sim));
      expect(b.ledger).toEqual(ref.driver.ledger);
    });
  });
});

describe('TimelineDriver trace digest, daily (acceptance 6a.2; Done-when show)', () => {
  const ON = { traceDigest: true };

  it('is equal across runs, through the loop or offline, and after a seek', () => {
    const a = makeLoop(doneWhenShow(), undefined, ON);
    const b = makeLoop(doneWhenShow(), undefined, ON);
    a.driver.runToEnd(a.loop);
    playFrames(b.loop, b.sim, 5000);
    b.driver.seek(b.loop, a.driver.endStep!);
    expect(b.driver.traceDigest).toBe(a.driver.traceDigest);
    b.driver.seek(b.loop, 3000);
    const c = makeLoop(doneWhenShow(), undefined, ON);
    c.driver.advance(c.loop, 3000);
    expect(b.driver.traceDigest).toBe(c.driver.traceDigest);
    // Three full runs of the Done-when show; under the full suite's parallel load it can exceed
    // the default 5 s (2.4 s alone; Toad, Phase 6 review). 20 s timed out under a mutant run's
    // load in Phase 7 C3; 30 s matches the file's setting.
  }, 30_000);

  it('negative control: one seed changed by 1 changes the digest and the ledger', () => {
    const doc = doneWhenShow();
    const off = {
      ...doc,
      cues: doc.cues.map((c, i) => (i === 7 ? { ...c, seed: c.seed + 1 } : c)),
    };
    const a = makeLoop(doc, undefined, ON);
    const b = makeLoop(off, undefined, ON);
    a.driver.runToEnd(a.loop);
    b.driver.runToEnd(b.loop);
    expect(b.driver.traceDigest).not.toBe(a.driver.traceDigest);
    expect(b.driver.ledger).not.toEqual(a.driver.ledger);
  });
});

describe('TimelineDriver end of show, daily (schema.md §4.5; Done-when show)', () => {
  it('the Done-when show (60 s, 50 cues) ends within its bound, on the same step twice', () => {
    const a = makeLoop(doneWhenShow());
    const b = makeLoop(doneWhenShow());
    const end = a.driver.runToEnd(a.loop);
    expect(b.driver.runToEnd(b.loop)).toBe(end);
    expect(end).toBeGreaterThan(a.driver.lastFireStep);
    expect(end).toBeLessThanOrEqual(a.driver.endBoundStep);
  });
});
