// @vitest-environment node
/**
 * T3 seeded property tests, regular tier: seek exactness on small bounded shows (the generator,
 * oracle and model are in `testing/seek-properties.ts`). A fixed run seed and a small N, so the
 * regular tier is reproducible; the daily tier (`timeline-driver.property.daily.spec.ts`) runs
 * N = 500 on a fresh seed. A failure prints its case seed: replay it with `T3_CASE_SEED=<n>`.
 *
 * The coverage floor below keeps the generator honest: a property test that never restores a
 * checkpoint past the end, never adopts across spacings or never deletes the last cue can't kill
 * the mutants it is meant to (Toad, T3 mutant proof, `toad-interlude-t3-property-tests.md`).
 *
 * F1 (a resize or quality change and back mid-play) is fixed; its repros are in
 * `timeline-driver.run-key.spec.ts`, and the generator produces the shape by default (directed:
 * after frames under another key, the next action usually goes straight back). `T3_RESIZE_BACK=0`
 * reproduces the old generator. The floor keeps 'key back' and a seek after it: without the
 * directed step this seed produced neither, and F1a/F1b (`tools/mutants/sets/f1-fix.mjs`) survived
 * this file.
 */
import { caseSeeds, envNumber, runCase } from './testing/seek-properties';

vi.setConfig({ testTimeout: 60_000 });

const RUN_SEED = envNumber('T3_SEED') ?? 20261115;
const N = envNumber('T3_N') ?? 24;
const ONE = envNumber('T3_CASE_SEED');

describe('TimelineDriver seek properties (T3, regular)', () => {
  it(`every seek, frame run, edit, twin and adopt equals an independent straight run (run seed ${RUN_SEED}, N ${N})`, () => {
    const seeds = ONE !== undefined ? [ONE] : caseSeeds(RUN_SEED, N);
    const coverage: Record<string, number> = {};
    const failures: string[] = [];
    for (const seed of seeds) {
      const res = runCase(seed, { resizeBack: envNumber('T3_RESIZE_BACK') !== 0 });
      for (const [k, v] of Object.entries(res.coverage)) coverage[k] = (coverage[k] ?? 0) + v;
      if (res.error) failures.push(res.error);
      if (failures.length >= 3) break;
    }
    if (envNumber('T3_VERBOSE')) console.warn(`T3 coverage ${JSON.stringify(coverage)}`);
    if (failures.length) {
      throw new Error(
        `T3 run seed ${RUN_SEED}: ${failures.length} failing case(s)\n${failures.join('\n\n')}`,
      );
    }
    if (ONE === undefined && N >= 24) {
      for (const k of [
        'at the cap',
        'ended',
        'restore',
        'restore past end',
        'frames after a key change',
        'quality change',
        'key back',
        'seek after key back',
        'edit delete last',
        'edit delete all',
        'edit move',
        'inherited checkpoints',
        'twin',
        'adopt',
        'adopt across spacings',
        'target on a checkpoint',
        'edit after the end',
      ]) {
        expect(coverage[k] ?? 0, `coverage: ${k} (${JSON.stringify(coverage)})`).toBeGreaterThan(0);
      }
    }
  });
});
