import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EngineLoop } from '../../../engine/loop/engine-loop';
import { TimelineDriver, type TimelineLaunch } from '../../../engine/loop/timeline-driver';
import { PRESETS } from '../../../engine/model/presets';
import { DEFAULT_QUALITY, type QualitySettings } from '../../../engine/model/shell';
import type { ShowDocument } from '../../../engine/model/show';
import { FireworksSim } from '../../../engine/sim/simulation';
import { FakeStageRenderers } from '../../testing/fake-stage-renderer';
import { doneWhenShow, shortShow } from '../../testing/show-fixtures';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../../core/client-config';
import {
  FireworksStageComponent,
  SEEK_CHUNK_MAX_STEPS,
  STAGE_CLOCK,
  STAGE_RENDERER_FACTORY,
  type SkyClick,
} from './fireworks-stage';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

// Every case here already runs on the fake per-step STAGE_CLOCK below; the time is sim work
// (6a.5 and 6a.6 run shortShow to its end twice). They timed out at the 5 s default under load
// (regular tier, testing interlude); 30 s keeps a real hang visible, as in the other stage specs.
vi.setConfig({ testTimeout: 30_000 });

@Component({
  imports: [FireworksStageComponent],
  template: `<app-fireworks-stage
    [shell]="shell"
    [timeline]="driver()"
    [paused]="paused()"
    [quality]="quality()"
    [clickToFire]="clickToFire()"
    (skyClick)="clicks.push($event)"
    (ended)="ended.push($event)"
    (catchingUp)="catching.push($event)"
  />`,
})
class HostComponent {
  readonly shell = PRESETS[0];
  readonly driver = signal<TimelineDriver | null>(null);
  readonly paused = signal(false);
  readonly quality = signal<QualitySettings>({ ...DEFAULT_QUALITY });
  readonly clickToFire = signal(true);
  readonly clicks: SkyClick[] = [];
  readonly ended: number[] = [];
  readonly catching: (number | null)[] = [];
  readonly stage = viewChild.required(FireworksStageComponent);
}

/** An offline straight run of `show` at the stage's width (the 6a.5 oracle). */
function offline(
  show: ShowDocument,
  width = 1280,
): { ledger: TimelineLaunch[]; end: number | null; digest: number | null } {
  const sim = new FireworksSim();
  const driver = new TimelineDriver(show, { traceDigest: true, checkpointSteps: 0 });
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
  const end = driver.runToEnd(loop);
  return { ledger: [...driver.ledger], end, digest: driver.traceDigest };
}

describe('FireworksStage timeline mode (Phase 6; acceptance 6a.5–6a.7, 6c.8, 6h.4, 6i)', () => {
  let fakes: FakeStageRenderers;
  /**
   * The seek budget's fake clock (Boo F1): every sim step costs `msPerStep` fake ms, so a frame's
   * seek slice is exactly SEEK_BUDGET_MS / msPerStep steps. 1/16 ms is exact in binary: 128 steps.
   * These specs configure an 8 ms budget through ClientConfigStore (the F1 numbers); the 25 ms
   * default and a config arriving mid-seek have their own specs below.
   */
  const SEEK_BUDGET_MS = 8;
  const CATCHING_UP_DELAY_MS = DEFAULT_PLAYBACK.catchingUpDelayMs;
  let config: ClientConfigStore;
  const clock = { now: 0, msPerStep: 1 / 16 };
  /** Steps each frame ran (counted from sim steps between frames). */
  let simSteps = 0;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    clock.now = 0;
    clock.msPerStep = 1 / 16;
    simSteps = 0;
    const step = FireworksSim.prototype.step;
    vi.spyOn(FireworksSim.prototype, 'step').mockImplementation(function (
      this: FireworksSim,
      dt: number,
    ) {
      clock.now += clock.msPerStep;
      simSteps++;
      return step.call(this, dt);
    });
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: STAGE_CLOCK, useValue: () => clock.now },
      ],
    });
    config = TestBed.inject(ClientConfigStore);
    config.setPlayback({ ...DEFAULT_PLAYBACK, seekBudgetMs: SEEK_BUDGET_MS });
  });
  afterEach(() => vi.restoreAllMocks());

  async function mount(show = shortShow(), opts: { digest?: boolean } = {}) {
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    const driver = new TimelineDriver(show, { traceDigest: opts.digest ?? true });
    host.driver.set(driver);
    await fixture.whenStable();
    const renderer = fakes.starts[0].resolve();
    await flushMicrotasks();
    await fixture.whenStable();
    return { fixture, host, driver, renderer, stage: host.stage() };
  }

  it('real-time frames, a pause and odd frame sizes give the offline ledger, digest and end (6a.5)', async () => {
    const show = shortShow();
    const oracle = offline(show);
    const { fixture, host, driver, renderer } = await mount(show);
    renderer.frame(1000 / 60, 40);
    host.paused.set(true);
    await fixture.whenStable();
    const held = driver.step;
    renderer.frame(1000 / 60, 120); // paused: the clock holds, no backlog afterwards
    expect(driver.step).toBe(held);
    host.paused.set(false);
    await fixture.whenStable();
    for (let i = 0; i < 5000 && !driver.done; i++) renderer.frame(i % 3 ? 1000 / 144 : 1000 / 24);
    expect(driver.ledger).toEqual(oracle.ledger);
    expect(driver.endStep).toBe(oracle.end);
    expect(host.ended).toEqual([oracle.end]);
    // Done: frames don't step on, and `ended` isn't repeated.
    const at = driver.step;
    renderer.frame(1000 / 60, 30);
    expect(driver.step).toBe(at);
    expect(host.ended).toHaveLength(1);
  });

  it('Reduce flashing changes nothing in the ledger, count digest or end (6a.6)', async () => {
    const runs = [];
    for (const reduceFlashing of [false, true]) {
      fakes = new FakeStageRenderers();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [HostComponent],
        providers: [{ provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory }],
      });
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.quality.set({ ...DEFAULT_QUALITY, reduceFlashing });
      const driver = new TimelineDriver(shortShow(), { traceDigest: true });
      fixture.componentInstance.driver.set(driver);
      await fixture.whenStable();
      const renderer = fakes.starts[0].resolve();
      await flushMicrotasks();
      for (let i = 0; i < 5000 && !driver.done; i++) renderer.frame(1000 / 60);
      expect(renderer.lastReduceFlashing).toBe(reduceFlashing);
      runs.push({ ledger: driver.ledger, digest: driver.traceDigest, end: driver.endStep });
    }
    expect(runs[1]).toEqual(runs[0]);
  });

  it('a sky click emits a fraction and fires nothing; Launch, Replay and fireNow are no-ops (6a.7)', async () => {
    const { stage, driver, host, renderer } = await mount();
    renderer.nextWorldPoint = { x: 320, y: 300 };
    stage['onPointerDown'](new PointerEvent('pointerdown', { clientX: 1, clientY: 1 }));
    expect(host.clicks).toEqual([{ x: 0.25, y: 300 }]);
    expect(stage.launch()).toBeNull();
    expect(stage.replay()).toBe(false);
    expect(stage.fireNow(PRESETS[2])).toBeNull();
    expect(stage.loop.launchCount).toBe(0);
    expect(stage.sim.shellCount).toBe(0);
    expect(driver.ledger).toEqual([]);
    // The player turns clicks off entirely.
    host.clickToFire.set(false);
    TestBed.tick();
    stage['onPointerDown'](new PointerEvent('pointerdown', { clientX: 1, clientY: 1 }));
    expect(host.clicks).toHaveLength(1);
  });

  it('seek lands exactly where a straight run would, spread over frames, with catching-up reports (6i.1)', async () => {
    const show = doneWhenShow();
    const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
    host.paused.set(true);
    await fixture.whenStable();
    stage.seek(20 * 120);
    renderer.frame(CATCHING_UP_DELAY_MS + 1);
    let frames = 1;
    while (stage.seeking() && frames < 100) {
      renderer.frame(16);
      frames++;
    }
    expect(frames).toBeGreaterThan(2);
    expect(driver.step).toBe(2400);
    expect(host.catching).toEqual([2400, null]);
    const straight = new TimelineDriver(show);
    const sim = new FireworksSim();
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => 1280, driver: straight });
    straight.seek(loop, 2400);
    expect(driver.ledger).toEqual(straight.ledger);
    expect(Array.from(stage.sim.particles.x.subarray(0, stage.sim.particles.n))).toEqual(
      Array.from(sim.particles.x.subarray(0, sim.particles.n)),
    );
  }, 30_000);

  it('a new driver (an edit) keeps the step: the stage re-seeks to where the old one was', async () => {
    const show = shortShow();
    const { host, driver, renderer, fixture, stage } = await mount(show);
    renderer.frame(1000 / 60, 30);
    const at = driver.step;
    host.paused.set(true);
    const edited = { ...show, cues: show.cues.map((c) => (c.id === 'c9' ? { ...c, x: 0.1 } : c)) };
    host.driver.set(new TimelineDriver(edited, { from: driver }));
    await fixture.whenStable();
    renderer.frame(16);
    expect(stage.currentStep()).toBe(at);
    expect(stage.seeking()).toBe(false);
  });

  // Toad, Phase 6 review: the test above edits a cue after the playhead, so the state at `at` is
  // the same with or without a re-seek. Here the edit is behind the playhead, while playing.
  it('an edit behind the playhead re-seeks from a kept checkpoint to a straight run of the edited show', async () => {
    const show = doneWhenShow();
    const { host, driver, renderer, stage } = await mount(show, { digest: false });
    for (let i = 0; i < 900; i++) renderer.frame(1000 / 60);
    const at = driver.step;
    expect(at).toBeGreaterThan(1200);
    expect(driver.checkpointSteps).toContain(1200);
    // Move a cue that fired after the 10 s checkpoint and before the playhead.
    const moved = [...driver.ledger].reverse().find((r) => r.step > 1200 && r.step < at - 20)!;
    expect(moved).toBeDefined();
    const edited = {
      ...show,
      cues: show.cues.map((c) => (c.id === moved.id ? { ...c, x: 1 - c.x } : c)),
    };
    const next = new TimelineDriver(edited, { from: driver });
    expect(next.checkpointSteps).toEqual([1200]);
    host.driver.set(next);
    TestBed.tick();
    let frames = 0;
    do {
      renderer.frame(16);
      frames++;
    } while (stage.seeking() && frames < 50);
    // From the 1200 checkpoint, not from 0: ceil((at − 1200) / 128) frames at 1/16 ms a step.
    expect(frames).toBe(Math.ceil((at - 1200) / (SEEK_BUDGET_MS / clock.msPerStep)));
    expect(next.step).toBe(at);
    const straight = new TimelineDriver(edited, { checkpointSteps: 0 });
    const sim = new FireworksSim();
    straight.seek(new EngineLoop(sim, undefined, { worldWidth: () => 1280, driver: straight }), at);
    expect(next.ledger).toEqual(straight.ledger);
    expect(next.ledger.find((r) => r.id === moved.id)!.x).toBe(1 - moved.x);
    const P = stage.sim.particles;
    expect(P.n).toBe(sim.particles.n);
    expect(Array.from(P.x.subarray(0, P.n))).toEqual(Array.from(sim.particles.x.subarray(0, P.n)));
    expect(Array.from(P.y.subarray(0, P.n))).toEqual(Array.from(sim.particles.y.subarray(0, P.n)));
  }, 30_000);
  describe('seek budget is time, not steps (Boo Phase 6 F1)', () => {
    /** Frames until the seek lands, with the steps each frame ran. */
    function frameUntilLanded(
      renderer: { frame(ms: number): void },
      stage: FireworksStageComponent,
    ) {
      const perFrame: number[] = [];
      do {
        const before = simSteps;
        renderer.frame(16);
        perFrame.push(simSteps - before);
      } while (stage.seeking() && perFrame.length < 5000);
      return perFrame;
    }

    function straightTo(show: ShowDocument, step: number) {
      const straight = new TimelineDriver(show, { checkpointSteps: 0 });
      const sim = new FireworksSim();
      straight.seek(
        new EngineLoop(sim, undefined, { worldWidth: () => 1280, driver: straight }),
        step,
      );
      return { straight, sim };
    }

    function expectSameState(
      stage: FireworksStageComponent,
      driver: TimelineDriver,
      show: ShowDocument,
      step: number,
    ) {
      const { straight, sim } = straightTo(show, step);
      expect(driver.step).toBe(step);
      expect(driver.ledger).toEqual(straight.ledger);
      const P = stage.sim.particles;
      expect(P.n).toBe(sim.particles.n);
      expect(Array.from(P.x.subarray(0, P.n))).toEqual(
        Array.from(sim.particles.x.subarray(0, P.n)),
      );
      expect(Array.from(P.vy.subarray(0, P.n))).toEqual(
        Array.from(sim.particles.vy.subarray(0, P.n)),
      );
    }

    it('slow steps: each frame runs only what fits the budget, plus at most one step', async () => {
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      clock.msPerStep = 3; // About the cost of one step at the 40k cap in Chrome.
      stage.seek(600);
      const perFrame = frameUntilLanded(renderer, stage);
      // 3 ms steps against an 8 ms budget: 3 steps a frame (the third starts at 6 ms < 8 ms).
      // A fixed per-frame step count (the old 480) runs the whole 600 in one or two frames.
      expect(Math.max(...perFrame)).toBeLessThanOrEqual(Math.ceil(SEEK_BUDGET_MS / 3));
      expect(perFrame.slice(0, -1).every((n) => n === 3)).toBe(true);
      expect(perFrame.length).toBe(200);
      expectSameState(stage, driver, show, 600);
    }, 30_000);

    it('a step slower than the whole budget still runs one step every frame', async () => {
      const show = shortShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      clock.msPerStep = 50;
      stage.seek(40);
      const perFrame = frameUntilLanded(renderer, stage);
      expect(perFrame).toEqual(Array(40).fill(1));
      expectSameState(stage, driver, show, 40);
    });

    it('cheap steps: a frame stays near the budget, and catching up still waits 300 ms', async () => {
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      stage.seek(1000);
      const perFrame = frameUntilLanded(renderer, stage);
      // 8 ms / (1/16 ms) = 128 steps a frame: 7 full frames and a last one of 104.
      expect(perFrame).toEqual([128, 128, 128, 128, 128, 128, 128, 104]);
      // 8 frames of 16 ms is 128 ms: under 300 ms, so no "Catching up…".
      expect(host.catching).toEqual([]);
      expectSameState(stage, driver, show, 1000);
    }, 30_000);

    it('the default budget is 25 ms: 400 cheap steps a frame', async () => {
      expect(DEFAULT_PLAYBACK.seekBudgetMs).toBe(25);
      config.setPlayback(DEFAULT_PLAYBACK);
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      stage.seek(1000);
      // 25 ms / (1/16 ms) = 400 steps a frame.
      expect(frameUntilLanded(renderer, stage)).toEqual([400, 400, 200]);
      expectSameState(stage, driver, show, 1000);
    }, 30_000);

    it('a config that arrives mid-seek applies from the next frame (the seek started on 8 ms)', async () => {
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      stage.seek(1000);
      const before = simSteps;
      renderer.frame(16);
      expect(simSteps - before).toBe(128);
      config.setPlayback({ ...DEFAULT_PLAYBACK, seekBudgetMs: 25 });
      expect(frameUntilLanded(renderer, stage)).toEqual([400, 400, 72]);
      expectSameState(stage, driver, show, 1000);
    }, 30_000);

    it('a served budget out of range is clamped before the stage reads it (100 ms at most)', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, seekBudgetMs: 1000 });
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      stage.seek(2000);
      // 100 ms / (1/16 ms) = 1600 steps, not the 16000 an unclamped 1000 ms would allow.
      expect(frameUntilLanded(renderer, stage)).toEqual([1600, 400]);
      expectSameState(stage, driver, show, 2000);
    }, 30_000);

    it('the catching-up delay is the configured one', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, seekBudgetMs: 4, catchingUpDelayMs: 20 });
      const show = doneWhenShow();
      const { stage, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      stage.seek(1000);
      renderer.frame(16);
      expect(host.catching).toEqual([]); // 16 ms: under 20.
      renderer.frame(16);
      expect(host.catching).toEqual([1000]); // 32 ms: past 20, far under the default 300.
      frameUntilLanded(renderer, stage);
      expect(host.catching).toEqual([1000, null]);
    }, 30_000);

    it('a new target between frames replaces the old one, backward or forward, exactly', async () => {
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      clock.msPerStep = 1;
      stage.seek(5000);
      renderer.frame(16);
      renderer.frame(16);
      expect(driver.step).toBe(16);
      // Backward past where it is: restarts and lands on the new target, never the old one.
      stage.seek(10);
      expect(stage.currentStep()).toBe(10);
      expect(frameUntilLanded(renderer, stage)).toEqual([8, 2]);
      expectSameState(stage, driver, show, 10);
      // Forward: runs on from 10.
      stage.seek(5000);
      renderer.frame(16);
      stage.seek(30);
      frameUntilLanded(renderer, stage);
      expectSameState(stage, driver, show, 30);
    }, 30_000);

    it('pause and play take effect between frames of a seek; the seek still lands exactly', async () => {
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      clock.msPerStep = 2;
      stage.seek(80);
      renderer.frame(16);
      host.paused.set(true);
      await fixture.whenStable();
      renderer.frame(16);
      host.paused.set(false);
      await fixture.whenStable();
      const perFrame = frameUntilLanded(renderer, stage);
      expect(Math.max(...perFrame)).toBeLessThanOrEqual(4);
      expectSameState(stage, driver, show, 80);
    }, 30_000);

    it('a step cost that jumps mid-frame overshoots by at most one capped chunk (Toad)', async () => {
      // Cheap steps first, so the stage sizes a big chunk from them; then every step costs 2 ms
      // (a burst landing). Without SEEK_CHUNK_MAX_STEPS the chunk sized on the cheap steps
      // (about 127) runs at 2 ms each: a frame of about 250 ms. With the cap: budget + 32 steps.
      const show = doneWhenShow();
      const { stage, driver, host, renderer, fixture } = await mount(show, { digest: false });
      host.paused.set(true);
      await fixture.whenStable();
      const cheap = 1 / 16;
      const jumpAt = simSteps + 2;
      Object.defineProperty(clock, 'msPerStep', {
        configurable: true,
        get: () => (simSteps >= jumpAt ? 2 : cheap),
      });
      try {
        stage.seek(400);
        const frameMs: number[] = [];
        while (stage.seeking() && frameMs.length < 500) {
          const t0 = clock.now;
          renderer.frame(16);
          frameMs.push(clock.now - t0);
        }
        expect(Math.max(...frameMs)).toBeLessThanOrEqual(SEEK_BUDGET_MS + SEEK_CHUNK_MAX_STEPS * 2);
        expect(SEEK_CHUNK_MAX_STEPS).toBe(32);
        expectSameState(stage, driver, show, 400);
      } finally {
        Object.defineProperty(clock, 'msPerStep', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: cheap,
        });
      }
    }, 30_000);
  });
});
