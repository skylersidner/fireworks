import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TimelineDriver } from '../../engine/loop/timeline-driver';
import { PRESETS } from '../../engine/model/presets';
import { FireworksSim } from '../../engine/sim/simulation';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../core/client-config';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
} from '../shared/fireworks-stage/fireworks-stage';
import { FakeStageRenderers } from './fake-stage-renderer';
import { shortShow } from './show-fixtures';
import { provideStepClock } from './stage-clock';

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

/**
 * `provideStepClock` (testing strategy §3 item 6, Yoshi T5). The page specs rely on two numbers
 * from it: a warm-up slice runs 2 shadow steps per idle frame, and a seek runs 400 live steps per
 * frame at the 25 ms default budget, whatever the machine's load. Negative controls (recorded in
 * `luigi-interlude-spec-split.md`): a twin not marked as a shadow fails the 2-step case, and a
 * missing restore fails the last case.
 */
describe('provideStepClock (test helper)', () => {
  const original = {
    beforeStep: TimelineDriver.prototype.beforeStep,
    twin: TimelineDriver.prototype.twin,
  };
  let fakes: FakeStageRenderers;
  let steps: Map<FireworksSim, number>;

  beforeEach(() => {
    fakes = new FakeStageRenderers();
    steps = new Map();
    const step = FireworksSim.prototype.step;
    vi.spyOn(FireworksSim.prototype, 'step').mockImplementation(function (
      this: FireworksSim,
      dt: number,
    ) {
      steps.set(this, (steps.get(this) ?? 0) + 1);
      return step.call(this, dt);
    });
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory }, provideStepClock()],
    });
    // Warm-up from the first frame, so the per-frame step count is visible at once.
    TestBed.inject(ClientConfigStore).setPlayback({ ...DEFAULT_PLAYBACK, warmUpDelayMs: 0 });
  });
  afterEach(() => vi.restoreAllMocks());

  async function mount() {
    const fixture = TestBed.createComponent(HostComponent);
    const driver = new TimelineDriver(shortShow(), { checkpointSteps: 120 });
    fixture.componentInstance.driver.set(driver);
    await fixture.whenStable();
    const renderer = fakes.starts[0].resolve();
    await new Promise<void>((r) => setTimeout(r));
    await fixture.whenStable();
    const stage = fixture.componentInstance.stage();
    const other = () => [...steps].reduce((n, [sim, k]) => (sim === stage.sim ? n : n + k), 0);
    return { renderer, stage, driver, other };
  }

  it('an idle warm-up slice runs exactly 2 shadow steps per frame', async () => {
    const { renderer, stage, other } = await mount();
    renderer.frame(16); // creates the shadow and runs its first slice
    for (let f = 0; f < 5; f++) {
      const before = other();
      renderer.frame(16);
      expect(other() - before).toBe(2);
    }
    expect(steps.get(stage.sim) ?? 0).toBe(0);
    expect(stage.warmUpState()).toBe('running');
  });

  it('a seek runs 400 live steps per frame at the 25 ms default budget', async () => {
    const { renderer, stage, driver } = await mount();
    stage.seek(1000);
    renderer.frame(16);
    expect(driver.step).toBe(400);
    renderer.frame(16);
    expect(driver.step).toBe(800);
  });

  it('is removed with the TestBed: the prototype is the original again', async () => {
    await mount();
    expect(TimelineDriver.prototype.beforeStep).not.toBe(original.beforeStep);
    TestBed.resetTestingModule();
    expect(TimelineDriver.prototype.beforeStep).toBe(original.beforeStep);
    expect(TimelineDriver.prototype.twin).toBe(original.twin);
  });
});
