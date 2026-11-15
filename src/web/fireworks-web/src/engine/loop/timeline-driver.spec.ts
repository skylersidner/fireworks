// @vitest-environment node
/**
 * TimelineDriver (plan Phase 6, schema.md §4.4–4.5, §13). Determinism, the firing rule, seek and
 * the end of a show. Negative controls for the `<=` comparison, the `(fireStep, id)` tie order and
 * the seek reset are recorded in `.squad/decisions/records/yoshi-phase6-timeline-driver.md`.
 */
import { openShow } from '../model/open';
import { PRESETS } from '../model/presets';
import { newShell, type ShellDocument } from '../model/shell';
import type { EmbeddedShell, ShowCue, ShowDocument } from '../model/show';
import { GROUND, STEP } from '../sim/constants';
import { KIND_COUNT } from '../sim/kinds';
import { MAX_SHELL_LIFETIME } from '../sim/lifetime';
import { FireworksSim } from '../sim/simulation';
import { EngineLoop } from './engine-loop';
import {
  TimelineDriver,
  secondsToStep,
  stepToSeconds,
  type TimelineDriverOptions,
} from './timeline-driver';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const fs = process.getBuiltinModule('node:fs');
const FIXTURES = `${process.cwd()}/../../../schema/fixtures`;

const WIDTH = 1280;

function embed(shell: ShellDocument): EmbeddedShell {
  const { sky: _sky, ...rest } = structuredClone(shell);
  return rest;
}

function show(cues: ShowCue[], o: Partial<ShowDocument> = {}): ShowDocument {
  return {
    version: 1,
    name: 'Test show',
    sky: { gravity: 160, wind: 0 },
    duration: 600,
    shells: { p: embed(PRESETS[0]) },
    cues,
    ...o,
  };
}

function cue(id: string, t: number, o: Partial<ShowCue> = {}): ShowCue {
  return { id, t, shell: 'p', x: 0.5, seed: 1000 + id.charCodeAt(0), ...o };
}

function makeLoop(doc: ShowDocument, capacity?: number, options?: TimelineDriverOptions) {
  const sim = new FireworksSim({ capacity });
  const driver = new TimelineDriver(doc, options);
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => WIDTH, driver });
  return { sim, driver, loop };
}

/** The whole live particle store, exactly, plus the shells in flight. */
function snapshot(sim: FireworksSim) {
  const P = sim.particles;
  const take = (a: ArrayLike<number>) => Array.from(a).slice(0, P.n);
  return {
    n: P.n,
    shells: sim.shellCount,
    x: take(P.x),
    y: take(P.y),
    vx: take(P.vx),
    vy: take(P.vy),
    age: take(P.age),
    kind: take(P.kind),
    seed: take(P.seed),
  };
}

function kindCounts(sim: FireworksSim): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (let i = 0; i < sim.particles.n; i++) counts[sim.particles.kind[i]]++;
  return counts;
}

/** A 60 s, 50-cue show (the Phase 6 Done-when shape) over every preset. */
function doneWhenShow(): ShowDocument {
  const shells: Record<string, EmbeddedShell> = {};
  PRESETS.forEach((p, i) => (shells[`s${i}`] = embed(p)));
  const cues = Array.from({ length: 50 }, (_, i) =>
    cue(`c${String(i).padStart(2, '0')}`, (i * 59.5) / 49, {
      shell: `s${i % PRESETS.length}`,
      x: ((i * 37) % 100) / 100,
      seed: (i * 2654435761) | 0,
      ...(i % 3 === 0 ? { burstHeight: 0.4 + (i % 5) * 0.1 } : {}),
    }),
  );
  return show(cues, { duration: 60, shells });
}

/** Plays `frames` 60 fps frames through the loop, recording particle count after each. */
function playFrames(loop: EngineLoop, sim: FireworksSim, frames: number): number[] {
  const trace: number[] = [];
  for (let f = 0; f < frames; f++) {
    loop.frame(1000 / 60);
    trace.push(sim.particles.n);
  }
  return trace;
}

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
  function straightTo(step: number, capacity?: number) {
    const r = makeLoop(doneWhenShow(), capacity);
    r.driver.advance(r.loop, step);
    return r;
  }

  it('seek to k equals a straight run to k, forward and backward', () => {
    const at900 = straightTo(900);
    const at400 = straightTo(400);
    const s = makeLoop(doneWhenShow());
    s.driver.seek(s.loop, 900);
    expect(snapshot(s.sim)).toEqual(snapshot(at900.sim));
    s.driver.seek(s.loop, 400); // backward: reset and re-run
    expect(s.driver.step).toBe(400);
    expect(snapshot(s.sim)).toEqual(snapshot(at400.sim));
    expect(s.driver.ledger).toEqual(at400.driver.ledger);
    s.driver.seek(s.loop, 900); // forward: run on
    expect(snapshot(s.sim)).toEqual(snapshot(at900.sim));
    expect(s.driver.ledger).toEqual(at900.driver.ledger);
  });

  it('a backward seek at the particle cap still equals a straight run (no state survives)', () => {
    const cap = 3000;
    const at1000 = straightTo(1000, cap);
    const s = makeLoop(doneWhenShow(), cap);
    s.driver.seek(s.loop, 3000);
    s.driver.seek(s.loop, 1000);
    expect(snapshot(s.sim)).toEqual(snapshot(at1000.sim));
  });

  it('seek after playing through the loop equals a straight run', () => {
    const at300 = straightTo(300);
    const s = makeLoop(doneWhenShow());
    playFrames(s.loop, s.sim, 400);
    s.driver.seek(s.loop, 300);
    expect(snapshot(s.sim)).toEqual(snapshot(at300.sim));
    expect(s.driver.ledger).toEqual(at300.driver.ledger);
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
    const at700 = straightTo(700);
    const s = makeLoop(doneWhenShow());
    s.driver.seek(s.loop, 900);
    // Backward to 500, 100 steps per call: reset, then 0 → 100 → … The target moves to 700.
    expect(s.driver.seek(s.loop, 500, 100)).toBe(false);
    expect(s.driver.step).toBe(100);
    expect(s.driver.seek(s.loop, 500, 100)).toBe(false);
    let calls = 0;
    while (!s.driver.seek(s.loop, 700, 100)) calls++;
    expect([calls, s.driver.step]).toEqual([4, 700]);
    expect(snapshot(s.sim)).toEqual(snapshot(at700.sim));
    expect(s.driver.ledger).toEqual(at700.driver.ledger);
    // Already there: a no-op that reports arrival.
    expect(s.driver.seek(s.loop, 700, 100)).toBe(true);
    expect(snapshot(s.sim)).toEqual(snapshot(at700.sim));
  });

  it('time and step convert with the cue rounding', () => {
    expect(stepToSeconds(120)).toBe(1);
    expect(secondsToStep(1.004)).toBe(120);
    expect(secondsToStep(600)).toBe(72_000);
  });
});

describe('TimelineDriver checkpoints (exact; acceptance 6i.2)', () => {
  const OFF = { checkpointSteps: 0 };

  function straight(doc: ShowDocument, step: number, capacity?: number, width = WIDTH) {
    const sim = new FireworksSim({ capacity });
    const driver = new TimelineDriver(doc, OFF);
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
    driver.advance(loop, step);
    return { sim, driver };
  }

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
      expect(cps({ ...doc, cues: doc.cues.filter((c) => c.id !== 'c') })).toEqual([
        1200, 2400, 3600, 4800,
      ]);
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

describe('TimelineDriver trace digest (acceptance 6a.2)', () => {
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
    // the default 5 s (2.4 s alone; Toad, Phase 6 review).
  }, 20_000);

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

  it('the Done-when show (60 s, 50 cues) ends within its bound, on the same step twice', () => {
    const a = makeLoop(doneWhenShow());
    const b = makeLoop(doneWhenShow());
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
