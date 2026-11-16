// @vitest-environment node
/**
 * TimelineDriver checkpoints (acceptance 6i.2), the warm-up handoff (twin, adoptCheckpoints) and
 * inheritance after an edit (`options.from`). Split from `timeline-driver.spec.ts` (testing
 * strategy §3 item 1). The cases on the Done-when show at 1200-step spacing are in
 * `timeline-driver.daily.spec.ts`; here the same properties run on `smallShow()` at `SMALL_CP`
 * spacing and `SMALL_CAP` capacity. "are taken during live playback too" still pins the 1200-step
 * default on the Done-when show.
 */
import { PRESETS } from '../model/presets';
import type { ShowCue, ShowDocument } from '../model/show';
import { FireworksSim } from '../sim/simulation';
import { EngineLoop } from './engine-loop';
import {
  SMALL_CAP,
  SMALL_CP,
  WIDTH,
  cue,
  doneWhenShow,
  embed,
  makeLoop,
  playFrames,
  show,
  smallShow,
  snapshot,
  straight,
} from './testing/timeline-spec-helpers';
import { TimelineDriver } from './timeline-driver';

// Toad, Phase 7 C3: engine runs; 30 s keeps a real hang visible under load.
vi.setConfig({ testTimeout: 30_000 });

describe('TimelineDriver checkpoints (exact; acceptance 6i.2)', () => {
  const OFF = { checkpointSteps: 0 };
  const CP = { checkpointSteps: SMALL_CP };

  // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
  it('are taken every SMALL_CP steps on the way, and a seek from one equals a straight run at the cap', () => {
    const cap = 1500;
    const s = makeLoop(smallShow(), cap, CP);
    s.driver.seek(s.loop, 400);
    expect(s.driver.checkpointSteps).toEqual([120, 240, 360]);
    let capped = s.sim.particles.n >= cap - 10;
    const restore = vi.spyOn(s.sim, 'restore');
    const reset = vi.spyOn(s.sim, 'clear');
    for (const target of [250, 361, 119, 360, 120]) {
      s.driver.seek(s.loop, target);
      capped ||= s.sim.particles.n >= cap - 10;
      const ref = straight(smallShow(), target, cap);
      expect(snapshot(s.sim)).toEqual(snapshot(ref.sim));
      expect(s.driver.ledger).toEqual(ref.driver.ledger);
    }
    expect(capped).toBe(true);
    // 250 ← 240, 361 ← 360 (forward jump), 119 ← reset, 360 ← 360, 120 ← 120.
    expect(restore).toHaveBeenCalledTimes(4);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
  it('a seek lands within one checkpoint spacing of work', () => {
    const s = makeLoop(smallShow(), SMALL_CAP, CP);
    s.driver.seek(s.loop, 600);
    const step = vi.spyOn(s.sim, 'step');
    s.driver.seek(s.loop, 599);
    expect(step).toHaveBeenCalledTimes(599 - 480);
  });

  it('turned off, every backward seek re-runs from 0', () => {
    const s = makeLoop(doneWhenShow(), undefined, OFF);
    s.driver.seek(s.loop, 3000);
    expect(s.driver.checkpointSteps).toEqual([]);
    const step = vi.spyOn(s.sim, 'step');
    s.driver.seek(s.loop, 2999);
    expect(step).toHaveBeenCalledTimes(2999);
  });

  it('are taken during live playback too, and stay exact', () => {
    const s = makeLoop(doneWhenShow());
    playFrames(s.loop, s.sim, 1300); // about 2600 steps through the loop
    expect(s.driver.checkpointSteps).toEqual([1200, 2400]);
    s.driver.seek(s.loop, 2401);
    expect(snapshot(s.sim)).toEqual(snapshot(straight(doneWhenShow(), 2401).sim));
  });

  // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
  it('a width change drops them, and the next seek is a straight run at the new width', () => {
    let width = WIDTH;
    const sim = new FireworksSim({ capacity: SMALL_CAP });
    const driver = new TimelineDriver(smallShow(), CP);
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
    driver.seek(loop, 300);
    expect(driver.checkpointSteps).toEqual([120, 240]);
    width = 900;
    driver.seek(loop, 250);
    expect(snapshot(sim)).toEqual(snapshot(straight(smallShow(), 250, SMALL_CAP, 900).sim));
    expect(driver.ledger.every((l) => l.tx === l.x * 900)).toBe(true);
    // A forward seek after a width change also re-runs: the old run wasn't at this width.
    width = 1000;
    driver.seek(loop, 260);
    expect(snapshot(sim)).toEqual(snapshot(straight(smallShow(), 260, SMALL_CAP, 1000).sim));
  });

  it('a starBudget change drops them', () => {
    const s = makeLoop(doneWhenShow());
    s.driver.seek(s.loop, 3000);
    s.sim.starBudget = 0.5;
    s.driver.seek(s.loop, 2500);
    const ref = straight(doneWhenShow(), 0);
    ref.sim.starBudget = 0.5;
    const loop = new EngineLoop(ref.sim, undefined, {
      worldWidth: () => WIDTH,
      driver: ref.driver,
    });
    ref.driver.seek(loop, 2500);
    expect(snapshot(s.sim)).toEqual(snapshot(ref.sim));
  });

  // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
  it('over the memory cap the spacing doubles, and seeks stay exact', () => {
    const s = makeLoop(smallShow(), SMALL_CAP, { ...CP, checkpointBytes: 1 });
    s.driver.seek(s.loop, 700);
    expect(s.driver.checkpointSteps.length).toBe(1);
    expect(s.driver.checkpointInterval).toBeGreaterThan(SMALL_CP);
    s.driver.seek(s.loop, 500);
    expect(snapshot(s.sim)).toEqual(snapshot(straight(smallShow(), 500, SMALL_CAP).sim));
  });

  // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
  it('checkpoints filled on a shadow sim (idle warm-up) are exact on the visible one', () => {
    const doc = smallShow();
    const shadow = makeLoop(doc, SMALL_CAP, CP);
    while (!shadow.driver.seek(shadow.loop, 700, 50)); // spread over "idle frames"
    const visible = makeLoop(doc, SMALL_CAP, CP);
    const driver = new TimelineDriver(doc, { from: shadow.driver });
    visible.loop.setDriver(driver);
    expect(driver.checkpointSteps).toEqual(shadow.driver.checkpointSteps);
    const step = vi.spyOn(visible.sim, 'step');
    driver.seek(visible.loop, 650);
    expect(step).toHaveBeenCalledTimes(650 - 600);
    expect(snapshot(visible.sim)).toEqual(snapshot(straight(doc, 650, SMALL_CAP).sim));
  });

  describe('warm-up handoff: twin and adoptCheckpoints (Phase 7)', () => {
    // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
    it('a twin runs on its own sim; adopting its checkpoints changes nothing but the start of a seek', () => {
      const doc = smallShow();
      const live = makeLoop(doc, SMALL_CAP, CP);
      live.driver.seek(live.loop, 30);
      const before = snapshot(live.sim);
      const shadowSim = new FireworksSim({ capacity: SMALL_CAP });
      const twin = live.driver.twin();
      const shadowLoop = new EngineLoop(shadowSim, undefined, {
        worldWidth: () => WIDTH,
        driver: twin,
      });
      while (!twin.seek(shadowLoop, 700, 70));
      expect(live.driver.step).toBe(30);
      expect(snapshot(live.sim)).toEqual(before);
      expect(live.driver.adoptCheckpoints(twin)).toBe(5);
      expect(live.driver.checkpointSteps).toEqual([120, 240, 360, 480, 600]);
      expect(live.driver.step).toBe(30);
      expect(snapshot(live.sim)).toEqual(before);
      const step = vi.spyOn(live.sim, 'step');
      live.driver.seek(live.loop, 610);
      expect(step).toHaveBeenCalledTimes(10);
      const ref = straight(doc, 610, SMALL_CAP);
      expect(snapshot(live.sim)).toEqual(snapshot(ref.sim));
      expect(live.driver.ledger).toEqual(ref.driver.ledger);
      expect(live.driver.adoptCheckpoints(twin)).toBe(0); // already held
    });

    // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
    it('takes only checkpoints before the first step where the schedules differ', () => {
      const doc = smallShow();
      const a = makeLoop(doc, SMALL_CAP, CP);
      a.driver.seek(a.loop, 601);
      const next = { ...doc, cues: doc.cues.map((c) => (c.id === 'c08' ? { ...c, seed: 1 } : c)) };
      const b = makeLoop(next, SMALL_CAP, CP);
      expect(b.driver.adoptCheckpoints(a.driver)).toBe(2); // c08 fires at 288
      expect(b.driver.checkpointSteps).toEqual([120, 240]);
      b.driver.seek(b.loop, 500);
      expect(snapshot(b.sim)).toEqual(snapshot(straight(next, 500, SMALL_CAP).sim));
    });

    // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
    it('refuses another sky, and keeps the memory cap (spacing doubles)', () => {
      const doc = smallShow();
      const a = makeLoop(doc, SMALL_CAP, CP);
      a.driver.seek(a.loop, 601);
      const windy = makeLoop({ ...doc, sky: { gravity: 160, wind: 3 } }, SMALL_CAP, CP);
      expect(windy.driver.adoptCheckpoints(a.driver)).toBe(0);
      const heavy = makeLoop({ ...doc, sky: { gravity: 161, wind: 0 } }, SMALL_CAP, CP);
      expect(heavy.driver.adoptCheckpoints(a.driver)).toBe(0);
      const capped = makeLoop(doc, SMALL_CAP, { ...CP, checkpointBytes: 1 });
      capped.driver.adoptCheckpoints(a.driver);
      expect(capped.driver.checkpointSteps.length).toBeLessThanOrEqual(1);
      capped.driver.seek(capped.loop, 550);
      expect(snapshot(capped.sim)).toEqual(snapshot(straight(doc, 550, SMALL_CAP).sim));
    });

    // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
    // Yoshi addendum 1, gap M9 (Toad, Phase 7 C3): `compatible` must compare the digest flag.
    // A checkpoint from a digest-off run carries the unfolded seed digest, so a digest-on driver
    // that restored it would report a different digest than a straight run (6a.2 would lie).
    it('refuses checkpoints across different traceDigest settings, both ways and through { from }', () => {
      const doc = smallShow();
      const off = makeLoop(doc, SMALL_CAP, CP);
      off.driver.seek(off.loop, 490);
      const on = makeLoop(doc, SMALL_CAP, { ...CP, traceDigest: true });
      on.driver.seek(on.loop, 490);
      expect(off.driver.checkpointSteps).toEqual([120, 240, 360, 480]);

      const adopter = makeLoop(doc, SMALL_CAP, { ...CP, traceDigest: true });
      expect(adopter.driver.adoptCheckpoints(off.driver)).toBe(0);
      expect(adopter.driver.checkpointSteps).toEqual([]);
      expect(off.driver.adoptCheckpoints(on.driver)).toBe(0);

      const inherited = makeLoop(doc, SMALL_CAP, { ...CP, traceDigest: true, from: off.driver });
      expect(inherited.driver.checkpointSteps).toEqual([]);
      inherited.driver.seek(inherited.loop, 490);
      expect(inherited.driver.traceDigest).toBe(on.driver.traceDigest);
      adopter.driver.seek(adopter.loop, 490);
      expect(adopter.driver.traceDigest).toBe(on.driver.traceDigest);
    });
  });

  describe('inherited after an edit (options.from)', () => {
    function edited(doc: ShowDocument, id: string, change: Partial<ShowCue>): ShowDocument {
      return { ...doc, cues: doc.cues.map((c) => (c.id === id ? { ...c, ...change } : c)) };
    }

    // Small-show equivalent of a daily Done-when case (timeline-driver.daily.spec.ts).
    it('keeps checkpoints before the first changed cue and drops the rest; the re-seek is exact', () => {
      const doc = smallShow();
      const a = makeLoop(doc, SMALL_CAP, CP);
      a.driver.seek(a.loop, 601); // the 600 checkpoint is taken as step 600 begins
      expect(a.driver.checkpointSteps).toEqual([120, 240, 360, 480, 600]);
      // c10 fires on step 360: the checkpoint on its own step is kept.
      const next = edited(doc, 'c10', { seed: 12345 });
      const b = new TimelineDriver(next, { from: a.driver });
      expect(b.checkpointSteps).toEqual([120, 240, 360]);
      a.loop.setDriver(b);
      b.seek(a.loop, 600);
      const ref = straight(next, 600, SMALL_CAP);
      expect(snapshot(a.sim)).toEqual(snapshot(ref.sim));
      expect(b.ledger).toEqual(ref.driver.ledger);
    });

    it('a checkpoint on the changed cue’s own step is kept (it was taken before that cue fired)', () => {
      const doc = show([cue('a', 1), cue('b', 10), cue('c', 15)]);
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 2500);
      expect(a.driver.checkpointSteps).toEqual([1200, 2400]);
      const next = edited(doc, 'b', { x: 0.9 }); // b fires on step 1200
      const b = new TimelineDriver(next, { from: a.driver });
      expect(b.checkpointSteps).toEqual([1200]);
      a.loop.setDriver(b);
      b.seek(a.loop, 2000);
      expect(snapshot(a.sim)).toEqual(snapshot(straight(next, 2000).sim));
    });

    it('adding, removing or moving a cue diverges at the earlier of its steps', () => {
      const doc = show([cue('a', 1), cue('b', 25), cue('c', 40)]);
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 5000);
      const cps = (d: ShowDocument) => new TimelineDriver(d, { from: a.driver }).checkpointSteps;
      expect(cps({ ...doc, cues: [...doc.cues, cue('d', 15)] })).toEqual([1200]);
      // A strict prefix (last cue removed) caps at its own last cue (b on 3000): D1.
      expect(cps({ ...doc, cues: doc.cues.filter((c) => c.id !== 'c') })).toEqual([1200, 2400]);
      expect(cps(edited(doc, 'c', { t: 12 }))).toEqual([1200]); // now fires on 1440, before b
      expect(cps(edited(doc, 'b', { t: 25.001 }))).toEqual([1200, 2400, 3600, 4800]); // same step
      expect(cps({ ...doc, sky: { gravity: 161, wind: 0 } })).toEqual([]);
    });

    it('a checkpoint taken after the old show ended doesn’t carry its end into a longer show', () => {
      const doc = show([cue('a', 0)]);
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 2500);
      expect(a.driver.done).toBe(true);
      const next = { ...doc, cues: [...doc.cues, cue('b', 30)] };
      const b = new TimelineDriver(next, { from: a.driver });
      expect(b.checkpointSteps).toEqual([1200, 2400]);
      a.loop.setDriver(b);
      b.seek(a.loop, 2500);
      expect([b.done, b.endStep]).toEqual([false, null]);
      expect(b.runToEnd(a.loop)).toBeGreaterThan(3600);
    });

    it('deleting the last cue past the new end: the end equals a straight run’s (D1)', () => {
      const doc = show([cue('a', 1), cue('b', 5), cue('c', 40)]);
      const next = { ...doc, cues: doc.cues.filter((c) => c.id !== 'c') };
      const ref = straight(next, 4900);
      expect(ref.driver.endStep).toBe(1113);
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 4900);
      const b = new TimelineDriver(next, { from: a.driver });
      expect(b.checkpointSteps).toEqual([]); // b fires on 600, before the first checkpoint
      a.loop.setDriver(b);
      b.seek(a.loop, 4900);
      expect([b.done, b.endStep]).toEqual([true, 1113]);
      expect(snapshot(a.sim)).toEqual(snapshot(ref.sim));
      expect(b.ledger).toEqual(ref.driver.ledger);
      const adopted = makeLoop(next);
      adopted.driver.adoptCheckpoints(a.driver);
      adopted.driver.seek(adopted.loop, 4900);
      expect([adopted.driver.done, adopted.driver.endStep]).toEqual([true, 1113]);
    });

    // Toad, Phase 7 C3: D1's cap also covers the empty receiver (every cue deleted). The cap is
    // `?? 0`; with `?? Infinity` an empty show kept every checkpoint before the old first cue,
    // each with `next === 0 === length` and the old show's unended `endStep`, so the end was
    // dated at the restored checkpoint instead of a straight run's.
    it('deleting every cue past the old first launch: nothing is kept, the end is a straight run’s', () => {
      const doc = show([cue('a', 15), cue('b', 30)]);
      const empty = { ...doc, cues: [] };
      const ref = straight(empty, 3000);
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 3000);
      expect(a.driver.checkpointSteps).toEqual([1200, 2400]);
      const b = new TimelineDriver(empty, { from: a.driver });
      expect(b.checkpointSteps).toEqual([]);
      a.loop.setDriver(b);
      b.seek(a.loop, 3000);
      expect([b.done, b.endStep]).toEqual([ref.driver.done, ref.driver.endStep]);
      expect(snapshot(a.sim)).toEqual(snapshot(ref.sim));
      const adopted = makeLoop(empty);
      expect(adopted.driver.adoptCheckpoints(a.driver)).toBe(0);
      adopted.driver.seek(adopted.loop, 3000);
      expect([adopted.driver.done, adopted.driver.endStep]).toEqual([
        ref.driver.done,
        ref.driver.endStep,
      ]);
    });

    it('built from a driver with checkpoints off, keeps its own interval; off stays off', () => {
      const doc = doneWhenShow();
      const off = makeLoop(doc, undefined, { checkpointSteps: 0 });
      off.driver.seek(off.loop, 3000);
      expect(new TimelineDriver(doc, { from: off.driver }).checkpointInterval).toBe(1200);
      const on = makeLoop(doc);
      on.driver.seek(on.loop, 3000);
      const z = new TimelineDriver(doc, { from: on.driver, checkpointSteps: 0 });
      expect([z.checkpointInterval, z.checkpointSteps]).toEqual([0, []]);
    });

    it('an embedded shell edit diverges at the first cue that uses it', () => {
      const shells = { p: embed(PRESETS[0]), q: embed(PRESETS[3]) };
      const doc = show([cue('a', 1), cue('b', 25, { shell: 'q' })], { shells });
      const a = makeLoop(doc);
      a.driver.seek(a.loop, 4000);
      const q = { ...shells.q, breaks: [{ ...shells.q.breaks[0], stars: 50 }] };
      const next = { ...doc, shells: { ...shells, q } };
      const b = new TimelineDriver(next, { from: a.driver });
      expect(b.checkpointSteps).toEqual([1200, 2400]);
      a.loop.setDriver(b);
      b.seek(a.loop, 3700);
      expect(snapshot(a.sim)).toEqual(snapshot(straight(next, 3700).sim));
    });
  });
});
