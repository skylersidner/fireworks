import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TimelineDriver } from '../../../engine/loop/timeline-driver';
import type { PlaybackMode } from '../../../engine/model/enums';
import { PRESETS } from '../../../engine/model/presets';
import { DEFAULT_QUALITY, type QualitySettings } from '../../../engine/model/shell';
import { DEVICE_PIXEL_RATIO } from '../../core/browser';
import { FakeStageRenderers, type FakeStageRenderer } from '../../testing/fake-stage-renderer';
import { shortShow } from '../../testing/show-fixtures';
import { provideStepClock } from '../../testing/stage-clock';
import {
  FireworksStageComponent,
  RENDER_SETTLE_FRAMES,
  STAGE_RENDERER_FACTORY,
  type StageStats,
} from './fireworks-stage';

/**
 * Render only when the frame changed (yoshi-end-review-cpu-cost.md Q1; Skyler 2026-11-17). An idle
 * stage measured 20–25% of a core presenting identical frames. The rule: draw on any change, then
 * RENDER_SETTLE_FRAMES more while the trail fades, then present nothing until the next change. The
 * sim, drivers, frame hook and stats keep running every frame. Negative controls are recorded in
 * `luigi-end-review-cpu-fixes.md`.
 */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

@Component({
  imports: [FireworksStageComponent],
  template: `<app-fireworks-stage
    [shell]="shell"
    [mode]="mode()"
    [quality]="quality()"
    [paused]="paused()"
    [timeline]="driver()"
    [frameHook]="hook"
    (stats)="stats.push($event)"
  />`,
})
class HostComponent {
  readonly shell = PRESETS[0];
  readonly mode = signal<PlaybackMode>('manual');
  readonly quality = signal<QualitySettings>({ ...DEFAULT_QUALITY, persistence: 0.92 });
  readonly paused = signal(false);
  readonly driver = signal<TimelineDriver | null>(null);
  readonly stats: StageStats[] = [];
  hookCalls = 0;
  readonly hook = () => this.hookCalls++;
  readonly stage = viewChild.required(FireworksStageComponent);
}

describe('FireworksStage render on change', () => {
  let fakes: FakeStageRenderers;
  let dpr = 2;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakes = new FakeStageRenderers();
    dpr = 2;
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: DEVICE_PIXEL_RATIO, useValue: () => dpr },
        provideStepClock(),
      ],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function mount(setup: (host: HostComponent) => void = () => undefined) {
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    setup(host);
    await fixture.whenStable();
    const renderer = fakes.starts[0].resolve();
    await flushMicrotasks();
    await fixture.whenStable();
    return { fixture, host, renderer, stage: host.stage() };
  }

  /** Renders over `count` frames of 16 ms. */
  function rendersOver(renderer: FakeStageRenderer, count: number): number {
    const before = renderer.renderCalls;
    renderer.frame(16, count);
    return renderer.renderCalls - before;
  }

  /** Runs frames until the stage stops drawing (an empty, settled sky). */
  function settle(renderer: FakeStageRenderer): void {
    renderer.frame(16, RENDER_SETTLE_FRAMES + 2);
    expect(rendersOver(renderer, 20)).toBe(0);
  }

  it('an empty sky draws its first frame and the settle frames, then nothing (the idle cost)', async () => {
    const { renderer, host } = await mount();
    expect(rendersOver(renderer, 1)).toBe(1);
    expect(rendersOver(renderer, RENDER_SETTLE_FRAMES)).toBe(RENDER_SETTLE_FRAMES);
    expect(rendersOver(renderer, 300)).toBe(0);
    // Stats still run at about 4 Hz while nothing is drawn.
    const stats = host.stats.length;
    renderer.frame(16, 100);
    expect(host.stats.length).toBeGreaterThan(stats);
  });

  it('live particles draw every frame; after the sky empties the trail fades for the settle frames', async () => {
    const { renderer, stage } = await mount();
    settle(renderer);
    stage.launch();
    expect(rendersOver(renderer, 60)).toBe(60);
    expect(stage.sim.particles.n).toBeGreaterThan(0);
    stage.clear();
    // The frame the count changed, then exactly RENDER_SETTLE_FRAMES of fading, then nothing.
    expect(rendersOver(renderer, 1)).toBe(1);
    expect(rendersOver(renderer, RENDER_SETTLE_FRAMES)).toBe(RENDER_SETTLE_FRAMES);
    expect(rendersOver(renderer, 50)).toBe(0);
  });

  it('the settle covers trail convergence at the maximum persistence (0.92)', () => {
    const fadeFrames = Math.ceil(Math.log(1 / 1024) / Math.log(0.92));
    // ln(1/1024) / ln(0.92) = 83.1, so 84 whole frames (the review record rounds it to 83).
    expect(fadeFrames).toBe(84);
    expect(RENDER_SETTLE_FRAMES).toBeGreaterThanOrEqual(fadeFrames);
  });

  it('a paused sky with particles still in it stops drawing after the settle frames', async () => {
    const { renderer, stage, host, fixture } = await mount();
    stage.launch();
    renderer.frame(16, 60);
    host.paused.set(true);
    await fixture.whenStable();
    renderer.frame(16, RENDER_SETTLE_FRAMES + 2);
    expect(stage.sim.particles.n).toBeGreaterThan(0);
    expect(rendersOver(renderer, 30)).toBe(0);
    // Unpausing steps the sim: it draws at once.
    host.paused.set(false);
    await fixture.whenStable();
    expect(rendersOver(renderer, 1)).toBe(1);
  });

  it('draws the frame after a resize', async () => {
    const { renderer } = await mount();
    settle(renderer);
    renderer.resize(1500);
    expect(rendersOver(renderer, 1)).toBe(1);
  });

  it('draws the frame after a device pixel ratio change', async () => {
    const { renderer } = await mount();
    settle(renderer);
    dpr = 1.5;
    expect(rendersOver(renderer, 1)).toBe(1);
  });

  it('draws after a motion-blur or Reduce flashing change, with the new setting', async () => {
    const { renderer, host, fixture } = await mount();
    settle(renderer);
    host.quality.set({ ...DEFAULT_QUALITY, persistence: 0.3 });
    await fixture.whenStable();
    expect(rendersOver(renderer, 1)).toBe(1);
    expect(renderer.lastPersistence).toBe(0.3);
    settle(renderer);
    host.quality.set({ ...DEFAULT_QUALITY, persistence: 0.3, reduceFlashing: true });
    await fixture.whenStable();
    expect(rendersOver(renderer, 1)).toBe(1);
    expect(renderer.lastReduceFlashing).toBe(true);
  });

  it('the first frame of a renderer rebuilt after a context restore draws at once', async () => {
    const { renderer, fixture } = await mount();
    settle(renderer);
    renderer.loseContext();
    await fixture.whenStable();
    renderer.restoreContext();
    await fixture.whenStable();
    const rebuilt = fakes.starts[1].resolve();
    await flushMicrotasks();
    await fixture.whenStable();
    expect(rendersOver(rebuilt, 1)).toBe(1);
  });

  it('a seek draws the frame it runs in, even when the sky is empty at both ends', async () => {
    // Before the first cue's shell has risen the sky is empty, so only the seek itself says "changed".
    const driver = new TimelineDriver(shortShow(), { checkpointSteps: 120 });
    const { renderer, stage, host, fixture } = await mount((h) => {
      h.driver.set(driver);
      h.paused.set(true);
    });
    settle(renderer);
    expect(stage.sim.particles.n).toBe(0);
    stage.seek(0);
    await fixture.whenStable();
    expect(rendersOver(renderer, 1)).toBe(1);
    expect(stage.seeking()).toBe(false);
    // The timeline's frame hook (the playhead) ran on every frame, drawn or not.
    expect(host.hookCalls).toBeGreaterThan(RENDER_SETTLE_FRAMES + 20);
  });

  it('a playing show draws every frame while its particles are alive', async () => {
    const driver = new TimelineDriver(shortShow(), { checkpointSteps: 120 });
    const { renderer, stage } = await mount((h) => h.driver.set(driver));
    renderer.frame(16, 40);
    expect(stage.sim.particles.n).toBeGreaterThan(0);
    expect(rendersOver(renderer, 60)).toBe(60);
  });
});
