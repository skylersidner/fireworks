/**
 * Shared fixtures for the TimelineDriver specs (`timeline-driver*.spec.ts`). Specs only: nothing
 * in the app imports this file. It lives under engine/loop, so it imports only model, sim and
 * loop (the boundary rule in `engine-boundary.spec.ts`).
 *
 * Two show shapes:
 *  - `doneWhenShow()`: 60 s, 50 cues over every preset (the Phase 6 Done-when shape). The long
 *    cases on it run in `timeline-driver.daily.spec.ts` (testing strategy §2.3, §3 item 1).
 *  - `smallShow()`: the same cue pattern, 12 cues in 3.3 s, about a quarter of the particle work.
 *    The regular specs prove the same properties on it with `SMALL_CP` (120-step) checkpoints, so
 *    every grid, divergence and memory-cap rule is exercised in a tenth of the steps. One regular
 *    spec still pins the 1200-step default (`timeline-driver.checkpoints.spec.ts`).
 */
import { PRESETS } from '../../model/presets';
import type { ShellDocument } from '../../model/shell';
import type { EmbeddedShell, ShowCue, ShowDocument } from '../../model/show';
import { KIND_COUNT } from '../../sim/kinds';
import { FireworksSim } from '../../sim/simulation';
import { EngineLoop } from '../engine-loop';
import { TimelineDriver, type TimelineDriverOptions } from '../timeline-driver';

export const WIDTH = 1280;

/** Checkpoint spacing for the small-show cases: 1 s, a tenth of the 1200-step default. */
export const SMALL_CP = 120;

/**
 * Particle capacity for the small-show checkpoint cases. The small show peaks near 17k live
 * particles; at 2500 it reaches the cap by step 360 and stays there past step 600, so restores and
 * run keys are exercised at the cap and at a capacity other than the default, for a fraction of
 * the cost.
 */
export const SMALL_CAP = 2500;

export function embed(shell: ShellDocument): EmbeddedShell {
  const { sky: _sky, ...rest } = structuredClone(shell);
  return rest;
}

export function show(cues: ShowCue[], o: Partial<ShowDocument> = {}): ShowDocument {
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

export function cue(id: string, t: number, o: Partial<ShowCue> = {}): ShowCue {
  return { id, t, shell: 'p', x: 0.5, seed: 1000 + id.charCodeAt(0), ...o };
}

export function makeLoop(doc: ShowDocument, capacity?: number, options?: TimelineDriverOptions) {
  const sim = new FireworksSim({ capacity });
  const driver = new TimelineDriver(doc, options);
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => WIDTH, driver });
  return { sim, driver, loop };
}

/** The whole live particle store, exactly, plus the shells in flight. */
export function snapshot(sim: FireworksSim) {
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

export function kindCounts(sim: FireworksSim): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (let i = 0; i < sim.particles.n; i++) counts[sim.particles.kind[i]]++;
  return counts;
}

function patternShow(count: number, tOf: (i: number) => number, duration: number): ShowDocument {
  const shells: Record<string, EmbeddedShell> = {};
  PRESETS.forEach((p, i) => (shells[`s${i}`] = embed(p)));
  const cues = Array.from({ length: count }, (_, i) =>
    cue(`c${String(i).padStart(2, '0')}`, tOf(i), {
      shell: `s${i % PRESETS.length}`,
      x: ((i * 37) % 100) / 100,
      seed: (i * 2654435761) | 0,
      ...(i % 3 === 0 ? { burstHeight: 0.4 + (i % 5) * 0.1 } : {}),
    }),
  );
  return show(cues, { duration, shells });
}

/** A 60 s, 50-cue show (the Phase 6 Done-when shape) over every preset. */
export function doneWhenShow(): ShowDocument {
  return patternShow(50, (i) => (i * 59.5) / 49, 60);
}

/**
 * The Done-when cue pattern cut to 12 cues, 0.3 s apart (0 to 3.3 s), every preset at least once,
 * x at 0 and burstHeight on every third cue. c05 fires on step 180, c08 on 288.
 */
export function smallShow(): ShowDocument {
  return patternShow(12, (i) => i * 0.3, 6);
}

/** Plays `frames` 60 fps frames through the loop, recording particle count after each. */
export function playFrames(loop: EngineLoop, sim: FireworksSim, frames: number): number[] {
  const trace: number[] = [];
  for (let f = 0; f < frames; f++) {
    loop.frame(1000 / 60);
    trace.push(sim.particles.n);
  }
  return trace;
}

/** A straight run of `doc` from 0 to `step` with checkpoints off: the seek oracle. */
export function straight(doc: ShowDocument, step: number, capacity?: number, width = WIDTH) {
  const sim = new FireworksSim({ capacity });
  const driver = new TimelineDriver(doc, { checkpointSteps: 0 });
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
  driver.advance(loop, step);
  return { sim, driver };
}
