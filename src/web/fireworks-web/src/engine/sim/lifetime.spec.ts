// @vitest-environment node
/**
 * The launch lifetime bound (schema.md §4.5, §13) against real runs. If a sim lifetime constant
 * changes, these fail before a show's end is mis-drawn. The worst shell at the limits is checked
 * in loop/timeline-driver.spec.ts (`ends about 21 s after its launch`).
 */
import { PRESETS } from '../model/presets';
import { SKY_LIMITS } from '../model/limits';
import { STEP, GROUND } from './constants';
import {
  cueTimes,
  estimateShowEnd,
  MAX_SHELL_LIFETIME,
  riseSeconds,
  shellLifetimeBound,
} from './lifetime';
import { FireworksSim } from './simulation';

/** Seconds from launch until nothing is alive. */
function measuredLifetime(def: (typeof PRESETS)[number], gravity: number, seed: number): number {
  const sim = new FireworksSim({ sky: { gravity, wind: 0 } });
  sim.launch(def, 640, GROUND - def.burstHeight * GROUND, seed);
  let steps = 0;
  while (sim.shellCount > 0 || sim.particles.n > 0) {
    sim.step(STEP);
    steps++;
    if (steps > 30 * 120) throw new Error('never ended');
  }
  return steps * STEP;
}

describe('shellLifetimeBound', () => {
  for (const gravity of [SKY_LIMITS.gravity.min, 160]) {
    for (const def of PRESETS) {
      it(`${def.name} at gravity ${gravity} ends within its bound`, () => {
        const bound = shellLifetimeBound(def, def.burstHeight, gravity);
        for (const seed of [1, 7919, -123456]) {
          expect(measuredLifetime(def, gravity, seed)).toBeLessThanOrEqual(bound);
        }
      });
    }
  }

  it('rise time is the ballistic sqrt(2h/g) the sim uses for the fuse', () => {
    expect(riseSeconds(0.85, 40)).toBeCloseTo(Math.sqrt((2 * 0.85 * 760) / 40), 12);
    expect(riseSeconds(0.85, 40)).toBeCloseTo(5.683, 3);
  });

  it('at the current limits the bound is about 21 s (§13: 5.68 + 7.5 + 5.6 + 2.2 + slack)', () => {
    expect(MAX_SHELL_LIFETIME).toBeCloseTo(5.683 + 7.5 + 5.6 + 2.2 + 6 / 120, 2);
  });
});

describe('cueTimes and estimateShowEnd (design phase-6.md §7.1, §7.3)', () => {
  const triple = PRESETS.find((p) => p.breaks.length === 3)!;

  it('bursts at t + rise, then each later break after max(0.1, delay)', () => {
    const times = cueTimes({ t: 4 }, triple, 160);
    const rise = Math.sqrt((2 * triple.burstHeight * 760) / 160);
    expect(times.launch).toBe(4);
    expect(times.bursts[0]).toBeCloseTo(4 + rise, 12);
    expect(times.bursts[1] - times.bursts[0]).toBeCloseTo(
      Math.max(0.1, triple.breaks[1].delay),
      12,
    );
    expect(times.bursts).toHaveLength(3);
    expect(cueTimes({ t: 0, burstHeight: 0.3 }, triple, 160).bursts[0]).toBeCloseTo(
      Math.sqrt((2 * 0.3 * 760) / 160),
      12,
    );
  });

  it('the first burst is where the sim bursts, within one step', () => {
    for (const def of PRESETS) {
      const sim = new FireworksSim();
      sim.launch(def, 640, GROUND - def.burstHeight * GROUND, 1);
      let steps = 0;
      while (sim.shellCount === 1 && !sim.particles.countByKind()[4]) {
        sim.step(STEP);
        steps++;
      }
      const predicted = cueTimes({ t: 0 }, def, 160).bursts[0];
      expect(Math.abs(steps * STEP - predicted)).toBeLessThanOrEqual(STEP + 1e-9);
    }
  });

  it('estimate ≤ bound, and the show estimate is the latest cue', () => {
    for (const def of PRESETS) {
      const t = cueTimes({ t: 1 }, def, 160);
      expect(t.endEstimate).toBeLessThanOrEqual(t.endBound);
    }
    const shells = { a: PRESETS[0], b: triple };
    const show = {
      sky: { gravity: 160 },
      shells,
      cues: [
        { t: 0, shell: 'b' },
        { t: 3, shell: 'a' },
        { t: 1, shell: 'zz' },
      ],
    };
    expect(estimateShowEnd(show)).toBe(
      Math.max(
        cueTimes({ t: 0 }, triple, 160).endEstimate,
        cueTimes({ t: 3 }, PRESETS[0], 160).endEstimate,
      ),
    );
    expect(estimateShowEnd({ ...show, cues: [] })).toBe(0);
  });
});
