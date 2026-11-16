import { EngineLoop } from '../../engine/loop/engine-loop';
import { TimelineDriver, type TimelineLaunch } from '../../engine/loop/timeline-driver';
import type { ShowDocument } from '../../engine/model/show';
import { FireworksSim } from '../../engine/sim/simulation';

/**
 * A show's whole launch ledger without simulating the show (testing strategy §3 item 3, Yoshi T1).
 *
 * A ledger row is `{ step, id, shell, seed, x, tx: x * worldWidth, ty }`, written by
 * `TimelineDriver.beforeStep` when a cue's `fireStep <= k`. Nothing in a row reads particle state,
 * so the ledger depends on the cue schedule alone: it is complete one step after the last cue
 * fires, and a capacity-1 sim (one particle at most) gives the same rows as the 40k default.
 *
 * `scheduled-ledger.spec.ts` pins this against a full run of the Done-when show, with a negative
 * control (a row that read the sim would differ). Tests only; no product code needs it.
 */
export function scheduledLedger(show: ShowDocument, width = 1280): readonly TimelineLaunch[] {
  const driver = new TimelineDriver(show, { checkpointSteps: 0 });
  const loop = new EngineLoop(new FireworksSim({ capacity: 1 }), undefined, {
    worldWidth: () => width,
    driver,
  });
  driver.advance(loop, driver.lastFireStep + 1);
  return driver.ledger;
}
