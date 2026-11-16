import { DestroyRef, inject, type Provider } from '@angular/core';
import { TimelineDriver } from '../../engine/loop/timeline-driver';
import { STAGE_CLOCK } from '../shared/fireworks-stage/fireworks-stage';

export interface StepClockOptions {
  /** Milliseconds one step of a visible (non-shadow) driver costs. Default 1/16: 400 per 25 ms. */
  readonly liveMsPerStep?: number;
  /** Milliseconds one step of a warm-up shadow (`TimelineDriver.twin()`) costs. Default 6. */
  readonly shadowMsPerStep?: number;
}

/**
 * A step-driven `STAGE_CLOCK` for specs that mount the stage but are not about seek budgets or
 * warm-up (testing strategy §3 item 6, Yoshi T5). The stage's default clock is
 * `performance.now()`, so without this every fake frame could spend up to `WARM_UP_IDLE_MS` (12 ms)
 * of real time warming the show, and the steps a frame ran depended on machine load.
 *
 * The clock reads 0 at first and advances only when a TimelineDriver steps: `liveMsPerStep` for
 * a visible driver, `shadowMsPerStep` for a warm-up shadow (any driver made by `twin()` while this
 * clock is installed). With the defaults a seek runs 400 steps per frame against the 25 ms default
 * budget, and an idle warm-up slice runs 2 steps (it stops once 12 ms are used), so warm-up costs
 * almost nothing in specs that never wait for it. Both are independent of load.
 *
 * Installed when the stage first injects `STAGE_CLOCK`, removed when the TestBed environment is
 * destroyed (each test's teardown). Specs that test the budget or warm-up themselves keep their own
 * explicit clocks (`fireworks-stage.phase7.spec.ts`, `fireworks-stage.timeline.spec.ts`).
 */
export function provideStepClock(options: StepClockOptions = {}): Provider {
  const live = options.liveMsPerStep ?? 1 / 16;
  const shadowCost = options.shadowMsPerStep ?? 6;
  return {
    provide: STAGE_CLOCK,
    useFactory: () => {
      const clock = { now: 0 };
      const shadows = new WeakSet<TimelineDriver>();
      const proto = TimelineDriver.prototype;
      const { beforeStep, twin } = proto;
      proto.beforeStep = function (this: TimelineDriver, ctx) {
        clock.now += shadows.has(this) ? shadowCost : live;
        beforeStep.call(this, ctx);
      };
      proto.twin = function (this: TimelineDriver) {
        const made = twin.call(this);
        shadows.add(made);
        return made;
      };
      inject(DestroyRef).onDestroy(() => {
        proto.beforeStep = beforeStep;
        proto.twin = twin;
      });
      return () => clock.now;
    },
  };
}
