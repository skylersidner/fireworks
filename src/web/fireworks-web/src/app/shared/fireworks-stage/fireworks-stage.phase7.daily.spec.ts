/**
 * Daily tier (testing strategy §2.3, §3 item 2): the Phase 7 stage cases that run the Done-when
 * show to its end through jsdom frames (end clamp, up to 20,000 frames) or warm a 30 s show up to
 * its end at the default 1200-step spacing, moved unchanged from `fireworks-stage.phase7.spec.ts`
 * (Phase 7, commit 8eb99c7). The regular file runs the same cases on `shortShow()` and a 4 s show at
 * 120-step spacing; the mutant proof is in `.squad/decisions/records/luigi-interlude-spec-split.md`.
 */
import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EngineLoop } from '../../../engine/loop/engine-loop';
import { TimelineDriver } from '../../../engine/loop/timeline-driver';
import type { PlaybackMode } from '../../../engine/model/enums';
import { PRESETS } from '../../../engine/model/presets';
import { DEFAULT_QUALITY, type QualitySettings } from '../../../engine/model/shell';
import type { ShowDocument } from '../../../engine/model/show';
import { FireworksSim } from '../../../engine/sim/simulation';
import { DEVICE_PIXEL_RATIO, MATCH_MEDIA } from '../../core/browser';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../../core/client-config';
import { FakeMatchMedia } from '../../testing/fake-match-media';
import { FakeStageRenderers } from '../../testing/fake-stage-renderer';
import { doneWhenShow } from '../../testing/show-fixtures';
import {
  FireworksStageComponent,
  PAGE_RELOAD,
  STAGE_CLOCK,
  STAGE_RENDERER_FACTORY,
  STAGE_TIMERS,
  WARM_UP_SKIP_COLD_RUN_MS,
} from './fireworks-stage';
import type { StageSurface } from './stage-copy';

/** The default playback knobs with warm-up starting at once (the pre-2026-11-17 behaviour). */
const PLAYBACK = { ...DEFAULT_PLAYBACK, warmUpDelayMs: 0 };

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

// Toad, Phase 7 C3: the warm-up specs run whole shows on two sims in jsdom ("an edit restarts
// warm-up" is the heaviest). They timed out at the 5 s default under load 15-33 during mutant
// runs and pass alone; 30 s keeps a real hang visible.
vi.setConfig({ testTimeout: 30_000 });

@Component({
  imports: [FireworksStageComponent],
  template: `<app-fireworks-stage
    [shell]="shell"
    [mode]="mode()"
    [timeline]="driver()"
    [paused]="paused()"
    [quality]="quality()"
    [surface]="surface()"
    [warmUp]="warmUp()"
    [frameHook]="hook"
  />`,
})
class HostComponent {
  readonly shell = PRESETS[0];
  readonly mode = signal<PlaybackMode>('manual');
  readonly driver = signal<TimelineDriver | null>(null);
  readonly paused = signal(false);
  readonly quality = signal<QualitySettings>({ ...DEFAULT_QUALITY, starBudget: 1 });
  readonly surface = signal<StageSurface>('designer');
  readonly warmUp = signal(false);
  readonly hookSteps: number[] = [];
  readonly hook = (step: number) => this.hookSteps.push(step);
  readonly stage = viewChild.required(FireworksStageComponent);
}

/** Hand-run timers for the 1 s and 10 s loss thresholds. */
class ManualTimers {
  now = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  readonly api = {
    set: (fn: () => void, ms: number) => {
      const id = this.nextId++;
      this.queue.push({ at: this.now + ms, fn, id });
      return id;
    },
    clear: (handle: unknown) => {
      this.queue = this.queue.filter((t) => t.id !== handle);
    },
  };
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((t) => t.at <= this.now).sort((a, b) => a.at - b.at);
    this.queue = this.queue.filter((t) => t.at > this.now);
    for (const t of due) t.fn();
  }
  get pending(): number {
    return this.queue.length;
  }
}

/** The whole live particle store plus shells in flight (exact). */
function snapshot(sim: FireworksSim) {
  const P = sim.particles;
  const take = (a: ArrayLike<number>) => Array.from(a).slice(0, P.n);
  return {
    n: P.n,
    shells: sim.shellCount,
    x: take(P.x),
    y: take(P.y),
    vx: take(P.vx),
    vy: take(P.vy),
    age: take(P.age),
    kind: take(P.kind),
  };
}

/** A straight run of `show` from 0 to `step` at `width` (the oracle). */
function straight(show: ShowDocument, step: number, width = 1280) {
  const sim = new FireworksSim({ starBudget: 1 });
  const driver = new TimelineDriver(show, { checkpointSteps: 0 });
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
  driver.seek(loop, step);
  return { sim, driver };
}

describe('FireworksStage Phase 7, daily (end clamp and warm-up on long shows)', () => {
  let fakes: FakeStageRenderers;
  let timers: ManualTimers;
  let reload: ReturnType<typeof vi.fn>;
  let config: ClientConfigStore;
  const clock = { now: 0, msPerStep: 1 / 16 };
  let liveSteps = 0;
  let otherSteps = 0;
  let liveSim: FireworksSim | null = null;
  let media: FakeMatchMedia;
  let dpr = 2;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    clock.now = 0;
    clock.msPerStep = 1 / 16;
    liveSteps = otherSteps = 0;
    liveSim = null;
    dpr = 2;
    const step = FireworksSim.prototype.step;
    vi.spyOn(FireworksSim.prototype, 'step').mockImplementation(function (
      this: FireworksSim,
      dt: number,
    ) {
      clock.now += clock.msPerStep;
      if (this === liveSim) liveSteps++;
      else otherSteps++;
      return step.call(this, dt);
    });
    fakes = new FakeStageRenderers();
    timers = new ManualTimers();
    reload = vi.fn();
    media = new FakeMatchMedia();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: STAGE_CLOCK, useValue: () => clock.now },
        // These specs are about warm-up itself: no short-show skip, no quiet delay (both are
        // specced in fireworks-stage.warm-up-delay.spec.ts).
        { provide: WARM_UP_SKIP_COLD_RUN_MS, useValue: 0 },
        { provide: STAGE_TIMERS, useValue: timers.api },
        { provide: PAGE_RELOAD, useValue: reload },
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: DEVICE_PIXEL_RATIO, useValue: () => dpr },
      ],
    });
    config = TestBed.inject(ClientConfigStore);
    config.setPlayback(PLAYBACK);
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
    const stage = host.stage();
    liveSim = stage.sim;
    return { fixture, host, renderer, stage, el: fixture.nativeElement as HTMLElement };
  }

  describe('end clamp (Y§2)', () => {
    for (const fps of [60, 10]) {
      it(`at ${fps} fps the reported step and the hook stop at endStep exactly`, async () => {
        const driver = new TimelineDriver(doneWhenShow());
        const { renderer, stage, host } = await mount((h) => h.driver.set(driver));
        for (let i = 0; i < 20000 && !driver.done; i++) renderer.frame(1000 / fps);
        renderer.frame(1000 / fps, 3);
        expect(driver.done).toBe(true);
        expect(driver.step).toBeGreaterThan(driver.endStep!); // the loop overshoots...
        expect(stage.currentStep()).toBe(driver.endStep); // ...the stage reports the end
        expect(host.hookSteps.at(-1)).toBe(driver.endStep);
        expect(Math.max(...host.hookSteps)).toBe(driver.endStep);
      }, 60_000);
    }

    it('an edit after the end re-seeks to the end; a seek past the end reports its target', async () => {
      const show = doneWhenShow();
      const driver = new TimelineDriver(show);
      const { fixture, renderer, stage, host } = await mount((h) => h.driver.set(driver));
      for (let i = 0; i < 20000 && !driver.done; i++) renderer.frame(1000 / 30);
      const end = driver.endStep!;
      const next = new TimelineDriver({ ...show, name: 'edited' }, { from: driver });
      host.driver.set(next);
      await fixture.whenStable();
      expect(stage.currentStep()).toBe(end);
      for (let i = 0; i < 400 && stage.seeking(); i++) renderer.frame(16);
      expect(next.step).toBe(end);
      stage.seek(end + 500);
      for (let i = 0; i < 400 && stage.seeking(); i++) renderer.frame(16);
      renderer.frame(16, 5);
      expect(stage.currentStep()).toBe(end + 500);
    }, 60_000);
  });

  describe('background warm-up (acceptance 7l.4–7l.9)', () => {
    /** A 30 s slice of the Done-when show: enough checkpoints, quick in jsdom. */
    function show30(): ShowDocument {
      const show = doneWhenShow();
      return { ...show, duration: 30, cues: show.cues.filter((c) => c.t <= 30) };
    }
    const attr = (el: HTMLElement) =>
      el.querySelector('app-fireworks-stage')!.getAttribute('data-warm-up');

    async function warmed(show = show30(), opts: { paused?: boolean } = {}) {
      config.setPlayback({ ...PLAYBACK, seekBudgetMs: 25 });
      const driver = new TimelineDriver(show);
      const m = await mount((h) => {
        h.driver.set(driver);
        h.warmUp.set(true);
        h.paused.set(opts.paused ?? true);
      });
      return { ...m, driver, show };
    }

    async function runUntilWarm(m: Awaited<ReturnType<typeof warmed>>) {
      for (let i = 0; i < 5000 && m.stage.warmUpState() !== 'finished'; i++) {
        m.renderer.frame(16);
      }
      await m.fixture.whenStable();
    }

    it('finishes and says so on the host (data-warm-up), without moving the visible show', async () => {
      const m = await warmed();
      expect(attr(m.el)).toBe('off');
      m.renderer.frame(16);
      await m.fixture.whenStable();
      expect(attr(m.el)).toBe('running');
      await runUntilWarm(m);
      expect(attr(m.el)).toBe('finished');
      expect(m.driver.step).toBe(0);
      expect(liveSteps).toBe(0);
      expect(m.driver.checkpointSteps).toEqual([1200, 2400, 3600]);
      // Finished: later frames run no warm-up.
      const before = otherSteps;
      m.renderer.frame(16, 10);
      expect(otherSteps).toBe(before);
    });

    it('a far seek after warm-up restores a checkpoint and lands exactly on a straight run (7l.7)', async () => {
      const m = await warmed();
      await runUntilWarm(m);
      const target = 3600 + 517;
      m.stage.seek(target);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(517); // from the warmed checkpoint at 3600, not from 0
      const oracle = straight(m.show, target);
      expect(m.driver.ledger).toEqual(oracle.driver.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(oracle.sim));
    });

    // Yoshi addendum 1, gap M10 (Toad, Phase 7 C3): the shadow runs at the visible star budget.
    // At the default budget an unsynced shadow is invisible; at 0.5 its checkpoints would carry
    // another run key, `seek` would skip every one, and warm-up would silently do nothing.
    it('at starBudget 0.5 the warmed checkpoints are used, and the seek is a straight run at 0.5', async () => {
      config.setPlayback({ ...PLAYBACK, seekBudgetMs: 25 });
      const show = show30();
      const driver = new TimelineDriver(show);
      const m = await mount((h) => {
        h.driver.set(driver);
        h.warmUp.set(true);
        h.paused.set(true);
        h.quality.set({ ...DEFAULT_QUALITY, starBudget: 0.5 });
      });
      expect(m.stage.sim.starBudget).toBe(0.5);
      await runUntilWarm({ ...m, driver, show });
      expect(m.stage.warmUpState()).toBe('finished');
      const target = 3600 + 517;
      m.stage.seek(target);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(517); // from the warmed checkpoint at 3600, not from 0
      const sim = new FireworksSim({ starBudget: 0.5 });
      const oracle = new TimelineDriver(show, { checkpointSteps: 0 });
      oracle.seek(
        new EngineLoop(sim, undefined, { worldWidth: () => 1280, driver: oracle }),
        target,
      );
      expect(driver.ledger).toEqual(oracle.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(sim));
      // The budget really changes the world: the default-budget run differs.
      expect(snapshot(straight(show, target).sim)).not.toEqual(snapshot(sim));
    });

    // Toad, Phase 7 C3 (mutant W9): the shadow runs at the stage's own width. At 1280 (the fake's
    // default) a shadow fixed at 1280 is invisible; at any real window width its checkpoints carry
    // another run key, `seek` skips them all, and warm-up silently does nothing.
    it('at a world width other than 1280 the warmed checkpoints are used, and the seek is exact', async () => {
      const m = await warmed();
      m.renderer.width = 1620;
      await runUntilWarm(m);
      expect(m.stage.warmUpState()).toBe('finished');
      const target = 3600 + 517;
      m.stage.seek(target);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(517);
      const oracle = straight(m.show, target, 1620);
      expect(m.driver.ledger).toEqual(oracle.driver.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(oracle.sim));
    });

    it('checkpoints warmed at another width are not used: the seek stays exact (7l.7 negative)', async () => {
      const m = await warmed();
      await runUntilWarm(m);
      m.renderer.width = 1281;
      m.stage.seek(2500);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(2500); // re-ran from 0: nothing at width 1280 was trusted
      expect(snapshot(m.stage.sim)).toEqual(snapshot(straight(m.show, 2500, 1281).sim));
      // And warm-up starts again for the new width.
      m.renderer.frame(16);
      await m.fixture.whenStable();
      expect(m.stage.warmUpState()).toBe('running');
    });

    it('a scrub before warm-up finishes lands exactly, and warm-up then finishes', async () => {
      const m = await warmed();
      m.renderer.frame(16, 4); // part way
      m.stage.seek(3333);
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(straight(m.show, 3333).sim));
      await runUntilWarm(m);
      expect(m.stage.warmUpState()).toBe('finished');
    });

    it('an edit restarts warm-up from the edit point, and a seek past it is the edited show exactly (7l.8)', async () => {
      const m = await warmed();
      await runUntilWarm(m);
      const late = [...m.show.cues].sort((a, b) => b.t - a.t)[0];
      const edited: ShowDocument = {
        ...m.show,
        cues: m.show.cues.map((c) => (c.id === late.id ? { ...c, x: 0.123 } : c)),
      };
      const next = new TimelineDriver(edited, { from: m.driver });
      m.host.driver.set(next);
      await m.fixture.whenStable();
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      otherSteps = 0;
      m.renderer.frame(16);
      await m.fixture.whenStable();
      expect(m.stage.warmUpState()).toBe('running');
      for (let i = 0; i < 5000 && m.stage.warmUpState() !== 'finished'; i++) m.renderer.frame(16);
      // It resumed near the edit, not from 0: far fewer shadow steps than the edit's own step.
      const editStep = Math.round(late.t * 120);
      expect(otherSteps).toBeLessThan(next.endBoundStep - editStep + 2400);
      const target = editStep + 700;
      m.stage.seek(target);
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(next.ledger).toEqual(straight(edited, target).driver.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(straight(edited, target).sim));
    });

    it('keeps checkpoint memory under the configured cap (7l.8)', async () => {
      config.setPlayback({ ...PLAYBACK, checkpointMemoryMiB: 8 });
      const driver = new TimelineDriver(show30(), { checkpointBytes: 1 });
      const m = await mount((h) => {
        h.driver.set(driver);
        h.warmUp.set(true);
        h.paused.set(true);
      });
      for (let i = 0; i < 5000 && m.stage.warmUpState() !== 'finished'; i++) m.renderer.frame(16);
      expect(driver.checkpointSteps.length).toBeLessThanOrEqual(1);
    });
  });
});
