// @vitest-environment node
import { PRESETS } from '../../model/presets';
import type { ShellDocument, SkySettings } from '../../model/shell';
import { GROUND, STEP } from '../constants';
import { launchSeed } from '../rng';
import { FireworksSim } from '../simulation';
import { PROTOTYPE_GOLDEN } from './prototype-golden';

/**
 * Golden playback (acceptance 2a.7-2a.9). Expected values are the PROTOTYPE's own output,
 * recorded by record-prototype-golden.mjs from prototypes/fireworks-prototype.html, so a pass
 * means the port plays like the prototype, not merely like itself. Scenario parameters here must
 * match the recorder's.
 */
const WORLD_WIDTH = 1280;
const CHECK_STEPS = [60, 240, 360, 450, 600] as const;
const SEED = 20261112;

interface Snapshot {
  n: number;
  kinds: number[];
  sumX: number;
  sumY: number;
  devX: number;
  devY: number;
  shells: number;
}

function snapshot(sim: FireworksSim): Snapshot {
  const P = sim.particles;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < P.n; i++) {
    sumX += P.x[i];
    sumY += P.y[i];
  }
  const mx = P.n ? sumX / P.n : 0;
  const my = P.n ? sumY / P.n : 0;
  let devX = 0;
  let devY = 0;
  for (let i = 0; i < P.n; i++) {
    devX += Math.abs(P.x[i] - mx);
    devY += Math.abs(P.y[i] - my);
  }
  return { n: P.n, kinds: P.countByKind(), sumX, sumY, devX, devY, shells: sim.shellCount };
}

/**
 * Position checksums: §3.2 item 4 says positions may differ below a pixel across browsers' libm.
 * Sums: 0.5 world units per live particle on each axis sum (an absolute bound, so a
 * systematic shift of a fraction of a unit across the whole burst still fails), plus 0.01.
 * Spread (sum of |p - mean| per axis): sums cancel for a symmetric burst, so a radial error such
 * as a 1% burst-speed spread change passes them (Toad mutant T10). The spread can't cancel.
 * Measured port-vs-prototype delta on every check, in V8 (Node 26, Chrome 157) and JavaScriptCore:
 * at most 5e-4 units per sum (the fixture's 3-decimal rounding). The spread tolerance, 0.01 units
 * per particle, is 100x that per particle and still kills T10.
 */
function expectSnapshot(
  actual: Snapshot,
  expected: {
    readonly n: number;
    readonly kinds: readonly number[];
    readonly sumX: number;
    readonly sumY: number;
    readonly devX: number;
    readonly devY: number;
    readonly shells: number;
  },
  label: string,
): void {
  expect({ n: actual.n, kinds: actual.kinds, shells: actual.shells }, label).toEqual({
    n: expected.n,
    kinds: [...expected.kinds],
    shells: expected.shells,
  });
  const tol = 0.01 + 0.5 * expected.n;
  expect(Math.abs(actual.sumX - expected.sumX), `${label} sumX`).toBeLessThanOrEqual(tol);
  expect(Math.abs(actual.sumY - expected.sumY), `${label} sumY`).toBeLessThanOrEqual(tol);
  const devTol = 0.01 + 0.01 * expected.n;
  expect(Math.abs(actual.devX - expected.devX), `${label} devX`).toBeLessThanOrEqual(devTol);
  expect(Math.abs(actual.devY - expected.devY), `${label} devY`).toBeLessThanOrEqual(devTol);
}

function runSingle(def: ShellDocument, sky?: SkySettings, starBudget = 1) {
  const sim = new FireworksSim({ sky, starBudget });
  sim.launch(def, WORLD_WIDTH / 2, GROUND - def.burstHeight * GROUND, SEED);
  const out: Record<number, Snapshot> = {};
  for (let s = 1; s <= 600; s++) {
    sim.step(STEP);
    if ((CHECK_STEPS as readonly number[]).includes(s)) out[s] = snapshot(sim);
  }
  return out;
}

describe('golden playback against the prototype', () => {
  it('records every preset, in prototype order', () => {
    expect(Object.keys(PROTOTYPE_GOLDEN.presets)).toEqual(PRESETS.map((p) => p.name));
  });

  for (const preset of PRESETS) {
    it(`${preset.name}: per-kind counts and checksums at steps ${CHECK_STEPS.join('/')}`, () => {
      const expected =
        PROTOTYPE_GOLDEN.presets[preset.name as keyof typeof PROTOTYPE_GOLDEN.presets];
      const actual = runSingle(preset);
      for (const s of CHECK_STEPS) expectSnapshot(actual[s], expected[s], `${preset.name}@${s}`);
    });
  }

  it('the launch sequence: every preset fired in turn with derived seeds (stride 7919)', () => {
    const sim = new FireworksSim();
    const out: Record<number, Snapshot> = {};
    let n = 0;
    for (let s = 0; s < 900; s++) {
      if (s % 30 === 0 && s / 30 < PRESETS.length) {
        const k = s / 30;
        const def = PRESETS[k];
        sim.launch(def, 100 + k * 110, GROUND - def.burstHeight * GROUND, launchSeed(n++));
      }
      sim.step(STEP);
      if ([60, 240, 360, 450, 600, 900].includes(s + 1)) out[s + 1] = snapshot(sim);
    }
    for (const [s, expected] of Object.entries(PROTOTYPE_GOLDEN.sequence)) {
      expectSnapshot(out[Number(s)], expected, `sequence@${s}`);
    }
  });

  it('sky is honored: Willow under gravity 220 and wind 40', () => {
    const actual = runSingle(PRESETS[2], { gravity: 220, wind: 40 });
    for (const s of CHECK_STEPS)
      expectSnapshot(actual[s], PROTOTYPE_GOLDEN.windyWillow[s], `windy@${s}`);
  });

  it('star budget is honored: Triple Break at 50%', () => {
    const actual = runSingle(PRESETS[9], undefined, 0.5);
    for (const s of CHECK_STEPS) {
      expectSnapshot(actual[s], PROTOTYPE_GOLDEN.halfBudgetTripleBreak[s], `half@${s}`);
    }
  });

  it('shellDuration matches the prototype for every preset', () => {
    const sim = new FireworksSim();
    for (const preset of PRESETS) {
      const expected =
        PROTOTYPE_GOLDEN.shellDuration[preset.name as keyof typeof PROTOTYPE_GOLDEN.shellDuration];
      expect(sim.shellDuration(preset)).toBeCloseTo(expected, 12);
    }
  });
});

describe('determinism without module-global state (2a.9)', () => {
  function integerTrace(sim: FireworksSim, def: ShellDocument, steps: number): number[][] {
    sim.launch(def, 640, GROUND - def.burstHeight * GROUND, SEED);
    const trace: number[][] = [];
    for (let s = 1; s <= steps; s++) {
      sim.step(STEP);
      if (s % 30 === 0) trace.push([sim.particles.n, ...sim.particles.countByKind()]);
    }
    return trace;
  }

  it('two fresh sims give identical integer state at every snapshot step', () => {
    for (const preset of PRESETS) {
      expect(integerTrace(new FireworksSim(), preset, 600)).toEqual(
        integerTrace(new FireworksSim(), preset, 600),
      );
    }
  });

  it('two sims stepped interleaved in one process do not affect each other', () => {
    const solo = integerTrace(new FireworksSim(), PRESETS[5], 600);
    const a = new FireworksSim();
    const b = new FireworksSim({ sky: { gravity: 300, wind: -50 } });
    a.launch(PRESETS[5], 640, GROUND - PRESETS[5].burstHeight * GROUND, SEED);
    b.launch(PRESETS[2], 300, 200, 99);
    const trace: number[][] = [];
    let bPeak = 0;
    for (let s = 1; s <= 600; s++) {
      b.step(STEP);
      bPeak = Math.max(bPeak, b.particles.n);
      a.step(STEP);
      b.step(STEP);
      if (s % 30 === 0) trace.push([a.particles.n, ...a.particles.countByKind()]);
    }
    expect(trace).toEqual(solo);
    expect(bPeak).toBeGreaterThan(1000);
  });
});
