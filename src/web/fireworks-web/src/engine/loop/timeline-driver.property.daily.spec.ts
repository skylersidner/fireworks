// @vitest-environment node
/**
 * T3 seeded property tests, daily tier: N = 500 on a fresh run seed, printed before the run and in
 * every failure (`T3_SEED=<n>` replays the run, `T3_CASE_SEED=<n>` one case). The regular file
 * runs a small N on a fixed seed. Generator, oracle and model: `testing/seek-properties.ts`.
 */
import { caseSeeds, envNumber, runCase } from './testing/seek-properties';

vi.setConfig({ testTimeout: 1_800_000 });

const RUN_SEED = envNumber('T3_SEED') ?? Math.floor(Math.random() * 2 ** 31);
const N = envNumber('T3_N') ?? 500;

describe('TimelineDriver seek properties (T3, daily)', () => {
  it(`N cases on a fresh seed equal an independent straight run (run seed ${RUN_SEED}, N ${N})`, () => {
    console.log(`T3 daily: run seed ${RUN_SEED}, N ${N} (replay: T3_SEED=${RUN_SEED})`);
    const failures: string[] = [];
    for (const seed of caseSeeds(RUN_SEED, N)) {
      const res = runCase(seed, { resizeBack: envNumber('T3_RESIZE_BACK') !== 0 });
      if (res.error) failures.push(res.error);
      if (failures.length >= 5) break;
    }
    if (failures.length) {
      throw new Error(
        `T3 run seed ${RUN_SEED}: ${failures.length} failing case(s)\n${failures.join('\n\n')}`,
      );
    }
  });
});
