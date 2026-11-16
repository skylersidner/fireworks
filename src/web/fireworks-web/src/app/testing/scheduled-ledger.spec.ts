// @vitest-environment node
import { EngineLoop } from '../../engine/loop/engine-loop';
import { TimelineDriver } from '../../engine/loop/timeline-driver';
import type { ShowDocument } from '../../engine/model/show';
import { FireworksSim } from '../../engine/sim/simulation';
import { scheduledLedger } from './scheduled-ledger';
import { doneWhenShow } from './show-fixtures';

/**
 * The proof obligation for `scheduledLedger` (testing strategy §3 item 3; Yoshi T1): the ledger
 * from the cue schedule alone equals the ledger of a full run to the end, at the default capacity.
 * Negative control (recorded in `luigi-interlude-spec-split.md`): a driver whose row reads the sim
 * (`tx` plus `sim.particles.n`) makes the capacity-1 helper differ from the full run, so this spec
 * fails on it.
 */
vi.setConfig({ testTimeout: 30_000 });

function fullRun(show: ShowDocument, width: number) {
  const driver = new TimelineDriver(show);
  driver.runToEnd(
    new EngineLoop(new FireworksSim(), undefined, { worldWidth: () => width, driver }),
  );
  return driver;
}

describe('scheduledLedger (test helper)', () => {
  for (const width of [1280, 1000]) {
    it(`equals the full Done-when run's ledger at width ${width}, every row`, () => {
      const show = doneWhenShow();
      const full = fullRun(show, width);
      expect(full.done).toBe(true);
      expect(full.ledger).toHaveLength(50);
      expect(scheduledLedger(show, width)).toEqual(full.ledger);
    });
  }

  it('stops one step after the last cue: one step earlier the last row is missing (control)', () => {
    const show = doneWhenShow();
    const driver = new TimelineDriver(show, { checkpointSteps: 0 });
    const loop = new EngineLoop(new FireworksSim({ capacity: 1 }), undefined, {
      worldWidth: () => 1280,
      driver,
    });
    driver.advance(loop, driver.lastFireStep);
    const rows = scheduledLedger(show);
    expect(rows.at(-1)!.step).toBe(driver.lastFireStep);
    expect(driver.ledger.length).toBeLessThan(rows.length);
    expect(driver.ledger).toEqual(rows.slice(0, driver.ledger.length));
  });
});
