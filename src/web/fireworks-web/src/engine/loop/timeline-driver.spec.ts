// @vitest-environment node
/**
 * TimelineDriver (plan Phase 6, schema.md §4.4–4.5, §13). Determinism, the firing rule, seek and
 * the end of a show. Negative controls for the `<=` comparison, the `(fireStep, id)` tie order and
 * the seek reset are recorded in `.squad/decisions/records/yoshi-phase6-timeline-driver.md`.
 *
 * Checkpoints, warm-up handoff and inheritance are in `timeline-driver.checkpoints.spec.ts`. The
 * cases that run the 60 s Done-when show to its end, twice or at several frame sizes are in
 * `timeline-driver.daily.spec.ts` (daily tier); each has a small-show equivalent here.
 */
import { openShow } from '../model/open';
import { PRESETS } from '../model/presets';
import { newShell } from '../model/shell';
import { GROUND, STEP } from '../sim/constants';
import { MAX_SHELL_LIFETIME } from '../sim/lifetime';
import {
  SMALL_CP,
  WIDTH,
  cue,
  doneWhenShow,
  embed,
  kindCounts,
  makeLoop,
  playFrames,
  referenceRun,
  show,
  smallShow,
  snapshot,
  straight,
  type ReferencePoint,
} from './testing/timeline-spec-helpers';
import { TimelineDriver, secondsToStep, stepToSeconds } from './timeline-driver';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const fs = process.getBuiltinModule('node:fs');
const FIXTURES = `${process.cwd()}/../../../schema/fixtures`;

// Toad, Phase 7 C3: every spec here runs the engine. The full suite's own workers slow this file
// 5-6x, so the 5 s default timed out specs that pass alone in under 1 s. A real hang still fails,
// at 30 s.
vi.setConfig({ testTimeout: 30_000 });

describe('TimelineDriver firing rule (schema.md §4.4)', () => {
  it('fires a cue at t = 0 before step 0, before any sim.step', () => {
    const { sim, driver, loop } = makeLoop(show([cue('a', 0)]));
    const order: string[] = [];
    vi.spyOn(sim, 'launch').mockImplementation(() => void order.push('launch'));
    vi.spyOn(sim, 'step').mockImplementation(() => void order.push('step'));
    driver.advance(loop, 2);
    expect(order).toEqual(['launch', 'step', 'step']);
    expect(driver.ledger.map((l) => l.step)).toEqual([0]);
  });

  it('fires on exactly step Math.round(t * 120): not one step early, not one late', () => {
    const { sim, driver, loop } = makeLoop(show([cue('a', 1)]));
    const launch = vi.spyOn(sim, 'launch');
    driver.advance(loop, 120); // beforeStep 0..119
    expect(launch).not.toHaveBeenCalled();
    driver.beforeStep(loop); // step 120
    expect(launch).toHaveBeenCalledTimes(1);
    expect(driver.ledger).toEqual([expect.objectContaining({ id: 'a', step: 120 })]);
  });

  it('rounds t to the nearest step, half up, by multiplying by 120', () => {
    const cues = [cue('a', 1.004), cue('b', 0.5 / 120), cue('c', 2.9 / 120), cue('d', 0.1)];
    const { driver, loop } = makeLoop(show(cues));
    driver.advance(loop, 20);
    expect(driver.ledger.map((l) => [l.id, l.step])).toEqual([
      ['b', 1],
      ['c', 3],
      ['d', 12],
    ]);
    driver.advance(loop, 101);
    expect(driver.ledger.at(-1)).toMatchObject({ id: 'a', step: 120 });
  });

  it('cues on the same step fire in ordinal id order, whatever the array order', () => {
    const cues = [cue('b', 0.5), cue('a', 0.5), cue('B', 0.5), cue('z', 0.25)];
    const { driver, loop } = makeLoop(show(cues));
    driver.advance(loop, 61);
    expect(driver.ledger.map((l) => l.id)).toEqual(['z', 'B', 'a', 'b']);
  });

  it('two t values that round to the same step play identically (§4.4 rule 5)', () => {
    const a = makeLoop(show([cue('a', 1)]));
    const b = makeLoop(show([cue('a', 1.003)]));
    a.driver.seek(a.loop, 600);
    b.driver.seek(b.loop, 600);
    expect(snapshot(b.sim)).toEqual(snapshot(a.sim));
  });

  it("fires through fireSeeded with the cue's seed, at x * worldWidth, without using the launch counter", () => {
    const shell = embed(newShell('High', { burstHeight: 0.7 }));
    const cues = [
      cue('a', 0, { x: 0.25, seed: -7 }),
      cue('b', 0, { x: 1, burstHeight: 0.3, seed: 2147483647 }),
    ];
    const { sim, driver, loop } = makeLoop(show(cues, { shells: { p: shell } }));
    const launch = vi.spyOn(sim, 'launch');
    driver.advance(loop, 1);
    expect(launch.mock.calls.map((c) => c.slice(1))).toEqual([
      [0.25 * WIDTH, GROUND - 0.7 * GROUND, -7],
      [WIDTH, GROUND - 0.3 * GROUND, 2147483647],
    ]);
    expect(launch.mock.calls[0][0].name).toBe('High');
    expect(loop.launchCount).toBe(0);
    expect(loop.lastLaunch?.seed).toBe(2147483647);
    expect(driver.ledger).toEqual([
      { step: 0, id: 'a', shell: 'p', seed: -7, x: 0.25, tx: 320, ty: GROUND - 0.7 * GROUND },
      {
        step: 0,
        id: 'b',
        shell: 'p',
        seed: 2147483647,
        x: 1,
        tx: WIDTH,
        ty: GROUND - 0.3 * GROUND,
      },
    ]);
  });

  it('plays under the show sky, whatever the sim had (§4.1)', () => {
    const { sim, driver, loop } = makeLoop(
      show([cue('a', 0)], { sky: { gravity: 300, wind: -20 } }),
    );
    sim.sky = { gravity: 50, wind: 80 };
    driver.beforeStep(loop);
    expect(sim.sky).toEqual({ gravity: 300, wind: -20 });
  });

  it('starts from an empty sky: the first beforeStep resets the sim', () => {
    const { sim, driver, loop } = makeLoop(show([cue('a', 5)]));
    sim.launch(PRESETS[1], 100, 100, 1);
    for (let i = 0; i < 400; i++) sim.step(STEP);
    expect(sim.particles.n).toBeGreaterThan(0);
    driver.beforeStep(loop);
    expect([sim.particles.n, sim.shellCount, driver.step]).toEqual([0, 0, 1]);
  });

  it('EngineLoop.frame calls beforeStep before every fixed step', () => {
    const { driver, loop } = makeLoop(show([cue('a', 0.05)]));
    const spy = vi.spyOn(driver, 'beforeStep');
    expect(loop.frame(100)).toBe(12);
    expect(spy).toHaveBeenCalledTimes(12);
    expect(driver.step).toBe(12);
    expect(driver.ledger).toEqual([expect.objectContaining({ id: 'a', step: 6 })]);
  });

  it('a paused stage (no frames) never advances the show clock', () => {
    const { driver } = makeLoop(show([cue('a', 0)]));
    expect([driver.step, driver.time, driver.firedCount]).toEqual([0, 0, 0]);
  });

  it('rejects a cue naming a shell the show lacks, including inherited keys', () => {
    expect(() => new TimelineDriver(show([cue('a', 0, { shell: 'nope' })]))).toThrow(
      /unknown shell/,
    );
    expect(() => new TimelineDriver(show([cue('a', 0, { shell: 'toString' })]))).toThrow(
      /unknown shell/,
    );
  });

  it('never mutates the show it was given', () => {
    const doc = doneWhenShow();
    const before = structuredClone(doc);
    const { driver, loop } = makeLoop(doc);
    driver.seek(loop, 1200);
    expect(doc).toEqual(before);
  });
});

describe('TimelineDriver determinism', () => {
  // Small-show equivalent of the daily Done-when case (testing strategy §3 item 1).
  it('the same show gives the same ledger, particle-count trace and final state across two runs', () => {
    const a = makeLoop(smallShow());
    const b = makeLoop(smallShow());
    const frames = 60 * 5;
    const traceA = playFrames(a.loop, a.sim, frames);
    const traceB = playFrames(b.loop, b.sim, frames);
    expect(traceA.some((n) => n > 0)).toBe(true);
    expect(a.driver.ledger).toHaveLength(12);
    expect(traceB).toEqual(traceA);
    expect(b.driver.ledger).toEqual(a.driver.ledger);
    expect(snapshot(b.sim)).toEqual(snapshot(a.sim));
  });

  // Small-show equivalent of the daily Done-when case.
  it('frame size never matters: 60 fps, 144 fps and 24 fps frames equal a straight run', () => {
    for (const ms of [1000 / 60, 1000 / 144, 1000 / 24]) {
      const played = makeLoop(smallShow());
      for (let f = 0; f < Math.floor(4_000 / ms); f++) played.loop.frame(ms);
      const straight = makeLoop(smallShow());
      straight.driver.advance(straight.loop, played.driver.step);
      expect(played.driver.step).toBeGreaterThan(470);
      expect(snapshot(played.sim)).toEqual(snapshot(straight.sim));
      expect(played.driver.ledger).toEqual(straight.driver.ledger);
    }
  });

  it('same-step cues in another array order give the identical particle store (§4.4 rule 4)', () => {
    const shells = { p: embed(PRESETS[0]), q: embed(PRESETS[5]), r: embed(PRESETS[8]) };
    const cues = [
      cue('m', 1, { shell: 'q', x: 0.3 }),
      cue('A', 1, { shell: 'r', x: 0.7 }),
      cue('k', 1, { shell: 'p', x: 0.5 }),
    ];
    const a = makeLoop(show(cues, { shells }), 2500);
    const b = makeLoop(show([cues[2], cues[0], cues[1]], { shells }), 2500);
    for (let k = 0; k < 1200; k += 40) {
      a.driver.advance(a.loop, 40);
      b.driver.advance(b.loop, 40);
      expect(snapshot(b.sim)).toEqual(snapshot(a.sim));
    }
  });

  it('array order never matters, even at the particle cap (§4.4 rule 4)', () => {
    const doc = doneWhenShow();
    const reversed = { ...doc, cues: [...doc.cues].reverse() };
    const a = makeLoop(doc, 3000);
    const b = makeLoop(reversed, 3000);
    let capped = false;
    for (let k = 0; k < 2400; k += 60) {
      a.driver.advance(a.loop, 60);
      b.driver.advance(b.loop, 60);
      capped ||= a.sim.particles.n >= 3000 - 200;
      expect(snapshot(b.sim)).toEqual(snapshot(a.sim));
    }
    expect(capped).toBe(true);
  });
});

describe('TimelineDriver seek (plan Phase 6: scrub re-runs from t = 0)', () => {
  // One straight run of the Done-when show serves every oracle in this block (Yoshi T7.1).
  let ref: ReadonlyMap<number, ReferencePoint> | null = null;
  const at = (step: number): ReferencePoint => {
    ref ??= referenceRun(doneWhenShow(), [300, 400, 700, 900]);
    return ref.get(step)!;
  };

  it('seek to k equals a straight run to k, forward and backward', () => {
    const s = makeLoop(doneWhenShow());
    s.driver.seek(s.loop, 900);
    expect(snapshot(s.sim)).toEqual(at(900).snapshot);
    s.driver.seek(s.loop, 400); // backward: reset and re-run
    expect(s.driver.step).toBe(400);
    expect(snapshot(s.sim)).toEqual(at(400).snapshot);
    expect(s.driver.ledger).toEqual(at(400).ledger);
    s.driver.seek(s.loop, 900); // forward: run on
    expect(snapshot(s.sim)).toEqual(at(900).snapshot);
    expect(s.driver.ledger).toEqual(at(900).ledger);
  });

  it('a backward seek at the particle cap still equals a straight run (no state survives)', () => {
    const cap = 3000;
    const s = makeLoop(doneWhenShow(), cap);
    s.driver.seek(s.loop, 3000);
    s.driver.seek(s.loop, 1000);
    expect(snapshot(s.sim)).toEqual(snapshot(straight(doneWhenShow(), 1000, cap).sim));
  });

  it('seek after playing through the loop equals a straight run', () => {
    const s = makeLoop(doneWhenShow());
    playFrames(s.loop, s.sim, 400);
    s.driver.seek(s.loop, 300);
    expect(snapshot(s.sim)).toEqual(at(300).snapshot);
    expect(s.driver.ledger).toEqual(at(300).ledger);
  });

  it('seek back past the end clears done', () => {
    const s = makeLoop(show([cue('a', 0)]));
    s.driver.runToEnd(s.loop);
    expect(s.driver.done).toBe(true);
    s.driver.seek(s.loop, 10);
    expect([s.driver.done, s.driver.endStep, s.driver.firedCount]).toEqual([false, null, 1]);
  });

  it('seek clamps and floors its target; seek(0) is the empty sky before step 0', () => {
    const s = makeLoop(show([cue('a', 0)]));
    s.driver.seek(s.loop, 10.9);
    expect(s.driver.step).toBe(10);
    s.driver.seek(s.loop, -5);
    expect([s.driver.step, s.sim.particles.n, s.sim.shellCount, s.driver.firedCount]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('a budgeted seek arrives in slices and equals a straight run, even if the target moves', () => {
    const s = makeLoop(doneWhenShow());
    s.driver.seek(s.loop, 900);
    // Backward to 500, 100 steps per call: reset, then 0 → 100 → … The target moves to 700.
    expect(s.driver.seek(s.loop, 500, 100)).toBe(false);
    expect(s.driver.step).toBe(100);
    expect(s.driver.seek(s.loop, 500, 100)).toBe(false);
    let calls = 0;
    while (!s.driver.seek(s.loop, 700, 100)) calls++;
    expect([calls, s.driver.step]).toEqual([4, 700]);
    expect(snapshot(s.sim)).toEqual(at(700).snapshot);
    expect(s.driver.ledger).toEqual(at(700).ledger);
    // Already there: a no-op that reports arrival.
    expect(s.driver.seek(s.loop, 700, 100)).toBe(true);
    expect(snapshot(s.sim)).toEqual(at(700).snapshot);
  });

  it('time and step convert with the cue rounding', () => {
    expect(stepToSeconds(120)).toBe(1);
    expect(secondsToStep(1.004)).toBe(120);
    expect(secondsToStep(600)).toBe(72_000);
  });
});

describe('TimelineDriver trace digest (acceptance 6a.2)', () => {
  const ON = { traceDigest: true };

  // Small-show equivalent of the daily Done-when case: to the end, through the loop, after seeks.
  it('is equal across runs, through the loop or offline, and after a seek', () => {
    const a = makeLoop(smallShow(), undefined, ON);
    // 120-step checkpoints, so both seeks below start from a restored checkpoint (960, then 480),
    // as the Done-when case's seeks do at 1200-step spacing.
    const b = makeLoop(smallShow(), undefined, { ...ON, checkpointSteps: SMALL_CP });
    a.driver.runToEnd(a.loop);
    playFrames(b.loop, b.sim, 700);
    expect(b.driver.step).toBeGreaterThan(a.driver.endStep!);
    const restore = vi.spyOn(b.sim, 'restore');
    b.driver.seek(b.loop, a.driver.endStep!);
    expect(b.driver.traceDigest).toBe(a.driver.traceDigest);
    b.driver.seek(b.loop, 500);
    expect(restore).toHaveBeenCalledTimes(2);
    const c = makeLoop(smallShow(), undefined, ON);
    c.driver.advance(c.loop, 500);
    expect(b.driver.traceDigest).toBe(c.driver.traceDigest);
  });

  it('negative control: one seed changed by 1 changes the digest and the ledger', () => {
    const doc = smallShow();
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

  it('is null unless asked for', () => {
    expect(new TimelineDriver(doneWhenShow()).traceDigest).toBeNull();
    expect(new TimelineDriver(doneWhenShow(), ON).traceDigest).toBe(0x811c9dc5);
  });
});

describe('TimelineDriver end of show (schema.md §4.5)', () => {
  it('a cue at t == duration fires and its burst is seen (valid/show/cue-at-duration.json)', () => {
    const raw = JSON.parse(fs.readFileSync(`${FIXTURES}/valid/show/cue-at-duration.json`, 'utf8'));
    const opened = openShow(raw.document);
    if (!opened.ok) throw new Error('fixture must open');
    const { sim, driver, loop } = makeLoop(opened.show);
    const fireStep = 10 * 120;

    driver.advance(loop, fireStep + 1);
    expect(driver.ledger.map((l) => [l.id, l.step])).toEqual([
      ['c2', 0],
      ['c1', fireStep],
    ]);
    let starsAfterBurst = 0;
    while (!driver.done && driver.step < fireStep + 30 * 120) {
      driver.advance(loop, 1);
      starsAfterBurst = Math.max(starsAfterBurst, kindCounts(sim)[0]);
    }
    expect(starsAfterBurst).toBe(120);
    expect(driver.endStep).toBeGreaterThan(fireStep);
    expect(driver.endStep).toBeLessThanOrEqual(driver.endBoundStep);
  });

  it('ends on the first step with every cue fired and nothing alive, and stays ended', () => {
    const { sim, driver, loop } = makeLoop(show([cue('a', 0), cue('b', 2)]));
    const end = driver.runToEnd(loop);
    expect(end).not.toBeNull();
    expect([sim.particles.n, sim.shellCount, driver.firedCount]).toEqual([0, 0, 2]);
    // One step earlier something was still alive.
    const r = makeLoop(show([cue('a', 0), cue('b', 2)]));
    r.driver.seek(r.loop, end! - 1);
    expect(r.sim.particles.n + r.sim.shellCount).toBeGreaterThan(0);
    expect(r.driver.done).toBe(false);
    // Running on never moves the end.
    driver.advance(loop, 500);
    expect(driver.endStep).toBe(end);
  });

  it('a gap with an empty sky between cues is not the end', () => {
    const { driver, loop } = makeLoop(show([cue('a', 0), cue('b', 30)]));
    driver.seek(loop, 20 * 120);
    expect(driver.done).toBe(false);
  });

  // Small-show equivalent of the daily Done-when case.
  it('a 12-cue show ends within its bound, after its last launch, on the same step twice', () => {
    const a = makeLoop(smallShow());
    const b = makeLoop(smallShow());
    const end = a.driver.runToEnd(a.loop);
    expect(b.driver.runToEnd(b.loop)).toBe(end);
    expect(end).toBeGreaterThan(a.driver.lastFireStep);
    expect(end).toBeLessThanOrEqual(a.driver.endBoundStep);
  });

  it('the worst shell at the limits ends about 21 s after its launch, never later (§13)', () => {
    const worst = embed(
      newShell('Worst', {
        burstHeight: 0.85,
        breaks: Array.from({ length: 4 }, () => ({
          stars: 400,
          burn: 5,
          delay: 2.5,
          effect: 'crossette' as const,
          trail: 'glitter' as const,
        })),
      }),
    );
    const doc = show([cue('w', 600)], { sky: { gravity: 40, wind: 0 }, shells: { p: worst } });
    const { driver, loop } = makeLoop(doc);
    driver.seek(loop, 72_000);
    const end = driver.runToEnd(loop);
    const tail = stepToSeconds(end! - driver.lastFireStep);
    expect(MAX_SHELL_LIFETIME).toBeGreaterThan(20.9);
    expect(MAX_SHELL_LIFETIME).toBeLessThan(21.1);
    expect(tail).toBeLessThanOrEqual(MAX_SHELL_LIFETIME);
    expect(tail).toBeGreaterThan(20); // the bound is tight, not just safe
    expect(end).toBeLessThanOrEqual(driver.endBoundStep);
  });
});
