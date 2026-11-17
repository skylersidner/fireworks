import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TimelineDriver } from '../../../engine/loop/timeline-driver';
import { PRESETS } from '../../../engine/model/presets';
import type { ShowDocument } from '../../../engine/model/show';
import { FireworksSim } from '../../../engine/sim/simulation';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../../core/client-config';
import { FakeStageRenderers, type FakeStageRenderer } from '../../testing/fake-stage-renderer';
import { doneWhenShow } from '../../testing/show-fixtures';
import {
  FireworksStageComponent,
  STAGE_CLOCK,
  STAGE_RENDERER_FACTORY,
  WARM_UP_SKIP_COLD_RUN_MS,
} from './fireworks-stage';

/**
 * Warm-up waits for quiet, and short shows aren't warmed (Skyler 2026-11-17 on
 * yoshi-end-review-cpu-cost.md Q3: options B and C). B: warm-up starts or restarts only after
 * `playback.warmUpDelayMs` (served, default 1000) of frames with no edit and no seek. C: the first
 * warm-up slice is a probe, and a show whose predicted cold run to the end is at most 200 ms is
 * `skipped`. The clock advances only when a sim steps, so the probe's measured cost is exact.
 * Negative controls are recorded in `luigi-end-review-cpu-fixes.md`.
 */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

vi.setConfig({ testTimeout: 30_000 });

@Component({
  imports: [FireworksStageComponent],
  template: `<app-fireworks-stage
    [shell]="shell"
    [timeline]="driver()"
    [paused]="true"
    [warmUp]="true"
  />`,
})
class HostComponent {
  readonly shell = PRESETS[0];
  readonly driver = signal<TimelineDriver | null>(null);
  readonly stage = viewChild.required(FireworksStageComponent);
}

/** A 4 s slice of the Done-when show (end bound step 1335), with 120-step checkpoints. */
function show4(): ShowDocument {
  const show = doneWhenShow();
  return { ...show, duration: 4, cues: show.cues.filter((c) => c.t <= 4) };
}
const CP = { checkpointSteps: 120 };

describe('FireworksStage warm-up delay and short-show skip', () => {
  let fakes: FakeStageRenderers;
  let config: ClientConfigStore;
  const clock = { now: 0, msPerStep: 1 };
  let liveSim: FireworksSim | null = null;
  let shadowSteps = 0;
  let skipMs = 0;

  beforeEach(() => {
    clock.now = 0;
    clock.msPerStep = 1;
    liveSim = null;
    shadowSteps = 0;
    skipMs = 0;
    const step = FireworksSim.prototype.step;
    vi.spyOn(FireworksSim.prototype, 'step').mockImplementation(function (
      this: FireworksSim,
      dt: number,
    ) {
      clock.now += clock.msPerStep;
      if (this !== liveSim) shadowSteps++;
      return step.call(this, dt);
    });
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: STAGE_CLOCK, useValue: () => clock.now },
        { provide: WARM_UP_SKIP_COLD_RUN_MS, useFactory: () => skipMs },
      ],
    });
    config = TestBed.inject(ClientConfigStore);
  });
  afterEach(() => vi.restoreAllMocks());

  async function mount(driver: TimelineDriver) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.driver.set(driver);
    await fixture.whenStable();
    const renderer = fakes.starts[0].resolve();
    await flushMicrotasks();
    await fixture.whenStable();
    const stage = fixture.componentInstance.stage();
    liveSim = stage.sim;
    return { fixture, host: fixture.componentInstance, renderer, stage };
  }

  /** Shadow steps over `count` frames of 16 ms. */
  function shadowOver(renderer: FakeStageRenderer, count: number): number {
    const before = shadowSteps;
    renderer.frame(16, count);
    return shadowSteps - before;
  }

  describe('the quiet delay (option B)', () => {
    it('the default is 1000 ms, the served knob', () => {
      expect(DEFAULT_PLAYBACK.warmUpDelayMs).toBe(1000);
    });

    it('no warm-up before the delay; the first slice on the frame it is reached', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, warmUpDelayMs: 160 });
      const { renderer, stage } = await mount(new TimelineDriver(show4(), CP));
      // Frame 1 is the load's seek to 0 (quiet stays 0). Frames 2-10 bring quiet to 144 ms.
      expect(shadowOver(renderer, 10)).toBe(0);
      expect(stage.warmUpState()).toBe('off');
      // Frame 11: quiet is exactly 160 ms.
      expect(shadowOver(renderer, 1)).toBeGreaterThan(0);
      expect(stage.warmUpState()).toBe('running');
    });

    it('the default 1000 ms holds warm-up for 62 quiet frames of 16 ms and starts on the 63rd', async () => {
      config.setPlayback(DEFAULT_PLAYBACK);
      const { renderer } = await mount(new TimelineDriver(show4(), CP));
      expect(shadowOver(renderer, 1 + 62)).toBe(0); // the seek frame, then 992 ms
      expect(shadowOver(renderer, 1)).toBeGreaterThan(0); // 1008 ms
    });

    it('an edit restarts the wait, and warm-up then resumes for the new driver', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, warmUpDelayMs: 160 });
      const show = show4();
      const driver = new TimelineDriver(show, CP);
      const { renderer, stage, host, fixture } = await mount(driver);
      renderer.frame(16, 11);
      expect(stage.warmUpState()).toBe('running');
      const edited: ShowDocument = {
        ...show,
        cues: show.cues.map((c, i) => (i === 0 ? { ...c, x: 0.123 } : c)),
      };
      host.driver.set(new TimelineDriver(edited, { ...CP, from: driver }));
      await fixture.whenStable();
      expect(stage.warmUpState()).toBe('off');
      expect(shadowOver(renderer, 10)).toBe(0);
      expect(shadowOver(renderer, 1)).toBeGreaterThan(0);
      expect(stage.warmUpState()).toBe('running');
    });

    it('a seek holds a running warm-up until the delay has passed after it lands', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, warmUpDelayMs: 160 });
      const { renderer, stage } = await mount(new TimelineDriver(show4(), CP));
      renderer.frame(16, 11);
      expect(stage.warmUpState()).toBe('running');
      stage.seek(300);
      // At 1 ms a step and the 25 ms budget the seek takes about 12 frames.
      for (let i = 0; i < 100 && stage.seeking(); i++) renderer.frame(16);
      expect(stage.seeking()).toBe(false);
      // Counted from the frame it landed in: 9 frames bring quiet to 144 ms, the 10th to 160.
      expect(shadowOver(renderer, 9)).toBe(0);
      expect(shadowOver(renderer, 1)).toBeGreaterThan(0);
    });

    it('at 0 ms warm-up runs in the frame the load seek lands (the old behaviour)', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, warmUpDelayMs: 0 });
      const { renderer } = await mount(new TimelineDriver(show4(), CP));
      expect(shadowOver(renderer, 1)).toBeGreaterThan(0);
    });
  });

  describe('skipping short shows (option C)', () => {
    beforeEach(() => config.setPlayback({ ...DEFAULT_PLAYBACK, warmUpDelayMs: 0 }));

    it('the default threshold is 200 ms', () => {
      TestBed.resetTestingModule();
      expect(TestBed.inject(WARM_UP_SKIP_COLD_RUN_MS)).toBe(200);
    });

    it('a show predicted at the threshold is skipped after the probe slice, and stays skipped', async () => {
      const driver = new TimelineDriver(show4(), CP);
      // 1 ms per step: the prediction is exactly the show's step count.
      skipMs = driver.endBoundStep + 1;
      const { renderer, stage, fixture } = await mount(driver);
      const probe = shadowOver(renderer, 1);
      expect(probe).toBeGreaterThan(0);
      expect(probe).toBeLessThan(driver.endBoundStep);
      await fixture.whenStable();
      expect(stage.warmUpState()).toBe('skipped');
      expect(fixture.nativeElement.querySelector('app-fireworks-stage').dataset.warmUp).toBe(
        'skipped',
      );
      expect(shadowOver(renderer, 50)).toBe(0);
    });

    it('a show predicted 1 ms over the threshold is warmed to the end', async () => {
      const driver = new TimelineDriver(show4(), CP);
      skipMs = driver.endBoundStep;
      const { renderer, stage } = await mount(driver);
      for (let i = 0; i < 2000 && stage.warmUpState() !== 'finished'; i++) renderer.frame(16);
      expect(stage.warmUpState()).toBe('finished');
      expect(driver.checkpointSteps.length).toBeGreaterThan(5);
    });

    it('the prediction scales with the measured step cost: cheap steps skip, dear steps warm', async () => {
      skipMs = 200;
      clock.msPerStep = 0.1; // about 134 ms predicted for 1336 steps
      const cheap = await mount(new TimelineDriver(show4(), CP));
      cheap.renderer.frame(16);
      expect(cheap.stage.warmUpState()).toBe('skipped');
    });

    it('a dear show (2 ms a step, about 2.7 s predicted) is warmed', async () => {
      skipMs = 200;
      clock.msPerStep = 2;
      const { renderer, stage } = await mount(new TimelineDriver(show4(), CP));
      renderer.frame(16, 3);
      expect(stage.warmUpState()).toBe('running');
    });

    it('the decision is made once, on the probe: cheaper slices later never skip a warm-up', async () => {
      skipMs = 200;
      clock.msPerStep = 2;
      const { renderer, stage } = await mount(new TimelineDriver(show4(), CP));
      renderer.frame(16);
      expect(stage.warmUpState()).toBe('running');
      clock.msPerStep = 0.1;
      renderer.frame(16, 3);
      expect(stage.warmUpState()).toBe('running');
    });

    it('an edit probes again: the new driver is decided on its own', async () => {
      skipMs = 200;
      clock.msPerStep = 0.1;
      const show = show4();
      const driver = new TimelineDriver(show, CP);
      const { renderer, stage, host, fixture } = await mount(driver);
      renderer.frame(16);
      expect(stage.warmUpState()).toBe('skipped');
      clock.msPerStep = 2;
      host.driver.set(new TimelineDriver(show, { ...CP, from: driver }));
      await fixture.whenStable();
      renderer.frame(16, 3);
      expect(stage.warmUpState()).toBe('running');
    });
  });
});
