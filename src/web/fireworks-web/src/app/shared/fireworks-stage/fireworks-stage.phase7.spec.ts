import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EngineLoop } from '../../../engine/loop/engine-loop';
import { TimelineDriver } from '../../../engine/loop/timeline-driver';
import type { PlaybackMode } from '../../../engine/model/enums';
import { PRESETS } from '../../../engine/model/presets';
import { DEFAULT_QUALITY, type QualitySettings } from '../../../engine/model/shell';
import type { ShowDocument } from '../../../engine/model/show';
import { FlashSpacing } from '../../../engine/render/visual-rules';
import { FireworksSim } from '../../../engine/sim/simulation';
import { CANVAS_RESOLUTION, DEVICE_PIXEL_RATIO, MATCH_MEDIA } from '../../core/browser';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../../core/client-config';
import { FakeMatchMedia } from '../../testing/fake-match-media';
import { FakeStageRenderers, type FakeStageRenderer } from '../../testing/fake-stage-renderer';
import { doneWhenShow, shortShow } from '../../testing/show-fixtures';
import {
  CONTEXT_LOST_NOTICE_MS,
  CONTEXT_RESTORE_TIMEOUT_MS,
  FireworksStageComponent,
  PAGE_RELOAD,
  STAGE_CLOCK,
  STAGE_RENDERER_FACTORY,
  STAGE_TIMERS,
  WARM_UP_IDLE_MS,
  WARM_UP_PLAYING_MS,
} from './fireworks-stage';
import {
  CONTEXT_FAILED_HEAD,
  CONTEXT_FAILED_LINE,
  CONTEXT_LOST_NOTICE,
  type StageSurface,
} from './stage-copy';

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

describe('FireworksStage Phase 7 (context loss, end clamp, warm-up, resolution)', () => {
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
        { provide: STAGE_TIMERS, useValue: timers.api },
        { provide: PAGE_RELOAD, useValue: reload },
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: DEVICE_PIXEL_RATIO, useValue: () => dpr },
      ],
    });
    config = TestBed.inject(ClientConfigStore);
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

  /** Resolves the newest pending factory call (a rebuild). */
  async function resolveRebuild(fixture: { whenStable(): Promise<unknown> }) {
    const r = fakes.starts.at(-1)!.resolve();
    await flushMicrotasks();
    await fixture.whenStable();
    return r;
  }

  const status = (el: HTMLElement) =>
    el.querySelector('app-fireworks-stage')!.getAttribute('data-status');

  describe('context loss (Y§1, phase-7.md §11, acceptance 7e)', () => {
    it('a quick loss and restore shows nothing, and rebuilds: one new create, one old destroy (7e.1, 7e.4)', async () => {
      const { fixture, renderer, el } = await mount();
      expect(status(el)).toBe('running');
      renderer.loseContext();
      await fixture.whenStable();
      expect(status(el)).toBe('lost');
      timers.advance(300);
      renderer.restoreContext();
      await fixture.whenStable();
      expect(renderer.destroyCalls).toBe(1);
      expect(fakes.starts).toHaveLength(2);
      const next = await resolveRebuild(fixture);
      expect(status(el)).toBe('running');
      expect(next.started).toBe(true);
      expect(el.contains(next.canvas)).toBe(true);
      expect(el.contains(renderer.canvas)).toBe(false);
      expect(el.querySelector('[data-testid="stage-lost"]')).toBeNull();
      expect(el.querySelector('[data-testid="stage-error"]')).toBeNull();
      expect(timers.pending).toBe(0);
    });

    it('the status line appears after 1 s, not before, with role status (7e.2)', async () => {
      const { fixture, renderer, el, stage } = await mount();
      renderer.loseContext();
      timers.advance(CONTEXT_LOST_NOTICE_MS - 1);
      await fixture.whenStable();
      expect(el.querySelector('[data-testid="stage-lost"]')).toBeNull();
      timers.advance(1);
      await fixture.whenStable();
      const line = el.querySelector('[data-testid="stage-lost"]')!;
      expect(line.textContent?.trim()).toBe(CONTEXT_LOST_NOTICE);
      expect(line.getAttribute('role')).toBe('status');
      expect(stage.lostNotice()).toBe(true);
      renderer.restoreContext();
      await fixture.whenStable();
      expect(el.querySelector('[data-testid="stage-lost"]')).toBeNull();
    });

    for (const surface of ['designer', 'builder', 'player'] as const) {
      it(`10 s without a restore: the ${surface} failure block, Reload page, no raw error; a late restore is ignored (7e.5, N1)`, async () => {
        const { fixture, host, renderer, el } = await mount((h) => h.surface.set(surface));
        renderer.loseContext();
        timers.advance(CONTEXT_RESTORE_TIMEOUT_MS - 1);
        await fixture.whenStable();
        expect(status(el)).toBe('lost');
        timers.advance(1);
        await fixture.whenStable();
        expect(status(el)).toBe('failed');
        expect(renderer.destroyCalls).toBe(1);
        const block = el.querySelector('[data-testid="stage-error"]')!;
        expect(block.getAttribute('role')).toBe('alert');
        expect(block.querySelector('p')!.textContent?.trim()).toBe(
          `${CONTEXT_FAILED_HEAD} ${CONTEXT_FAILED_LINE[surface]}`,
        );
        expect(block.textContent).not.toContain("can't start");
        const button = block.querySelector<HTMLButtonElement>('[data-testid="stage-reload"]')!;
        expect(button.textContent?.trim()).toBe('Reload page');
        button.click();
        expect(reload).toHaveBeenCalledTimes(1);
        // The renderer is gone, so its restore can't reach the host.
        renderer.restoreContext();
        await fixture.whenStable();
        expect(fakes.starts).toHaveLength(1);
        expect(status(el)).toBe('failed');
        expect(host.stage().lostNotice()).toBe(false);
      });
    }

    for (const [surface, tail] of [
      ['designer', 'The controls still work, and your shell is kept in this browser.'],
      ['builder', 'The controls still work, and your show is kept in this browser.'],
      ['player', 'You can still open a copy with Remix.'],
    ] as const) {
      it(`startup failure copy on the ${surface} (7e.12)`, async () => {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.componentInstance.surface.set(surface);
        await fixture.whenStable();
        fakes.starts[0].reject(new Error('no WebGL'));
        await flushMicrotasks();
        await fixture.whenStable();
        const text = (fixture.nativeElement as HTMLElement)
          .querySelector('[data-testid="stage-error"]')!
          .textContent!.replace(/\s+/g, ' ')
          .trim();
        expect(text).toBe(`Fireworks can't start in this browser: no WebGL. ${tail}`);
      });
    }

    it('a loss holds a show: no step, same sim time; the rebuild never clears, re-drives or seeks (7e.3)', async () => {
      const show = doneWhenShow();
      const driver = new TimelineDriver(show);
      const { fixture, renderer, stage } = await mount((h) => h.driver.set(driver));
      renderer.frame(1000 / 60, 120);
      const step = driver.step;
      const simTime = stage.sim.simTime;
      const clear = vi.spyOn(stage.sim, 'clear');
      const setDriver = vi.spyOn(stage.loop, 'setDriver');
      const seek = vi.spyOn(driver, 'seek');
      const reset = vi.spyOn(driver, 'reset');
      renderer.loseContext();
      renderer.frame(1000 / 60, 60); // the real ticker is stopped; the fake runs nothing
      timers.advance(5000);
      expect(stage.launch()).toBeNull();
      expect(stage.replay()).toBe(false);
      renderer.restoreContext();
      await fixture.whenStable();
      const next = await resolveRebuild(fixture);
      expect(driver.step).toBe(step);
      expect(stage.sim.simTime).toBe(simTime);
      expect(stage.currentStep()).toBe(step);
      expect(clear).not.toHaveBeenCalled();
      expect(setDriver).not.toHaveBeenCalled();
      expect(seek).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      next.frame(1000 / 60, 10);
      expect(driver.step).toBeGreaterThan(step);
    });

    it('in manual mode a loss holds Launch, Replay and fireNow; after the rebuild they work again', async () => {
      const { fixture, renderer, stage, host } = await mount();
      expect(stage.launch()).not.toBeNull();
      renderer.loseContext();
      expect(stage.launch()).toBeNull();
      expect(stage.replay()).toBe(false);
      expect(stage.fireNow(PRESETS[2])).toBeNull();
      expect(stage.loop.shell).toBe(PRESETS[2]);
      renderer.restoreContext();
      await fixture.whenStable();
      await resolveRebuild(fixture);
      expect(stage.launch()).not.toBeNull();
      expect(host.mode()).toBe('manual');
    });

    it('fires use the last real width while no renderer is mounted, never 1280 (7e.8)', async () => {
      const { fixture, renderer, stage } = await mount();
      renderer.width = 1620;
      renderer.frame(16);
      renderer.loseContext();
      renderer.restoreContext(); // old destroyed, new one pending
      await fixture.whenStable();
      expect(stage.loop.worldWidth()).toBe(1620);
      await resolveRebuild(fixture);
    });

    it('one host-owned FlashSpacing goes to every renderer, so spacing survives a rebuild (7e.7)', async () => {
      const { fixture, renderer } = await mount();
      renderer.loseContext();
      renderer.restoreContext();
      await fixture.whenStable();
      await resolveRebuild(fixture);
      const [a, b] = fakes.starts.map((s) => s.options?.flashSpacing);
      expect(a).toBeInstanceOf(FlashSpacing);
      expect(b).toBe(a);
    });

    it('destroyed while a rebuild is pending: the late renderer is destroyed, never mounted', async () => {
      const { fixture, renderer, el } = await mount();
      renderer.loseContext();
      renderer.restoreContext();
      await fixture.whenStable();
      fixture.destroy();
      const late = fakes.starts[1].resolve();
      await flushMicrotasks();
      expect(late.destroyCalls).toBe(1);
      expect(late.started).toBe(false);
      expect(el.contains(late.canvas)).toBe(false);
    });

    it('a rebuild the factory rejects fails with the loss copy, never the raw error', async () => {
      const { fixture, renderer, el } = await mount((h) => h.surface.set('builder'));
      renderer.loseContext();
      renderer.restoreContext();
      await fixture.whenStable();
      fakes.starts[1].reject(new Error('GPU <b>gone</b>'));
      await flushMicrotasks();
      await fixture.whenStable();
      expect(status(el)).toBe('failed');
      const text = el.querySelector('[data-testid="stage-error"]')!.textContent!;
      expect(text).toContain(CONTEXT_FAILED_LINE.builder);
      expect(text).not.toContain('gone');
      expect(timers.pending).toBe(0);
    });

    it('destroying a renderer starts no rebuild: its listener is gone first (7e.10)', async () => {
      const { fixture, renderer } = await mount();
      fixture.destroy();
      expect(renderer.contextListener).toBeNull();
      renderer.loseContext(); // what Pixi's own destroy fires
      renderer.restoreContext();
      await flushMicrotasks();
      expect(fakes.starts).toHaveLength(1);
    });

    // 7e.10 negative control (Toad, 7n.2): the fake above nulls its listener in destroy, as
    // PixiRenderer does, so that spec cannot see "listeners left attached". This one models the
    // defect: destroy keeps the listener and fires lost then restored from inside destroy, as
    // Pixi's loseContext() does. `delivered` proves the leaked events reach the host (the control);
    // the host's own guards (destroyed, stage identity) must still start no rebuild.
    function leak(renderer: FakeStageRenderer): { delivered: string[] } {
      const seen = { delivered: [] as string[] };
      const original = renderer.onContextChange.bind(renderer);
      renderer.onContextChange = (listener) =>
        original((state) => {
          seen.delivered.push(state);
          listener(state);
        });
      const wrapped = renderer.contextListener;
      if (wrapped) renderer.onContextChange(wrapped);
      renderer.destroy = function (this: FakeStageRenderer) {
        this.destroyCalls++;
        this.loseContext();
        this.restoreContext();
      };
      return seen;
    }

    it('listeners left attached: navigating away still starts no rebuild (7e.10 control)', async () => {
      const { fixture, renderer } = await mount();
      // Re-register through the leaky wrapper: the host already registered on mount.
      const seen = leak(renderer);
      fixture.destroy();
      await flushMicrotasks();
      expect(renderer.destroyCalls).toBe(1);
      expect(seen.delivered).toEqual(['lost', 'restored']);
      expect(fakes.starts).toHaveLength(1);
    });

    it('listeners left attached: a restore rebuilds exactly once, and the old renderer cannot loop it (7e.10 control)', async () => {
      const { fixture, renderer, el } = await mount();
      const seen = leak(renderer);
      renderer.loseContext();
      await fixture.whenStable();
      renderer.restoreContext();
      await fixture.whenStable();
      // The host destroyed the old renderer, whose destroy fired lost + restored back at it.
      expect(renderer.destroyCalls).toBe(1);
      expect(seen.delivered).toEqual(['lost', 'restored', 'lost', 'restored']);
      await resolveRebuild(fixture);
      expect(fakes.starts).toHaveLength(2);
      expect(status(el)).toBe('running');
      renderer.loseContext();
      renderer.restoreContext();
      await flushMicrotasks();
      await fixture.whenStable();
      expect(fakes.starts).toHaveLength(2);
      expect(status(el)).toBe('running');
    });

    it("an old renderer's late event is ignored once a new one is mounted", async () => {
      const { fixture, renderer, el } = await mount();
      const listener = renderer.contextListener!;
      renderer.loseContext();
      renderer.restoreContext();
      await fixture.whenStable();
      await resolveRebuild(fixture);
      listener('lost');
      await fixture.whenStable();
      expect(status(el)).toBe('running');
    });
  });

  describe('canvas resolution (phase-7.md §5.1, acceptance 7f.2)', () => {
    const cases: [boolean, number, number][] = [
      [true, 3, 1.5],
      [false, 2, 2],
      [false, 3, 2],
      [true, 1, 1],
    ];
    for (const [coarse, ratio, expected] of cases) {
      it(`${coarse ? 'coarse' : 'fine'} pointer at DPR ${ratio}: the stage gets ${expected}, and a rebuild re-reads it`, async () => {
        media.set('(pointer: coarse)', coarse);
        dpr = ratio;
        expect(TestBed.inject(CANVAS_RESOLUTION)()).toBe(expected);
        const { fixture, renderer } = await mount();
        expect(fakes.starts[0].options?.resolution).toBe(expected);
        media.set('(pointer: coarse)', !coarse);
        renderer.loseContext();
        renderer.restoreContext();
        await fixture.whenStable();
        expect(fakes.starts[1].options?.resolution).toBe(TestBed.inject(CANVAS_RESOLUTION)());
        await resolveRebuild(fixture);
      });
    }
  });

  // On `shortShow()` (3 s, 12 cues): the clamp is "reported step == endStep", which doesn't
  // depend on length (Yoshi T1). The Done-when runs are in fireworks-stage.phase7.daily.spec.ts.
  describe('end clamp (Y§2)', () => {
    for (const fps of [60, 10]) {
      it(`at ${fps} fps the reported step and the hook stop at endStep exactly`, async () => {
        const driver = new TimelineDriver(shortShow());
        const { renderer, stage, host } = await mount((h) => h.driver.set(driver));
        for (let i = 0; i < 2000 && !driver.done; i++) renderer.frame(1000 / fps);
        renderer.frame(1000 / fps, 3);
        expect(driver.done).toBe(true);
        expect(driver.step).toBeGreaterThan(driver.endStep!); // the loop overshoots...
        expect(stage.currentStep()).toBe(driver.endStep); // ...the stage reports the end
        expect(host.hookSteps.at(-1)).toBe(driver.endStep);
        expect(Math.max(...host.hookSteps)).toBe(driver.endStep);
      });
    }

    it('an edit after the end re-seeks to the end; a seek past the end reports its target', async () => {
      const show = shortShow();
      const driver = new TimelineDriver(show);
      const { fixture, renderer, stage, host } = await mount((h) => h.driver.set(driver));
      for (let i = 0; i < 2000 && !driver.done; i++) renderer.frame(1000 / 30);
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
    });
  });

  describe('background warm-up (acceptance 7l.4–7l.9)', () => {
    /** A 30 s slice of the Done-when show: enough checkpoints, quick in jsdom. */
    function show30(): ShowDocument {
      const show = doneWhenShow();
      return { ...show, duration: 30, cues: show.cues.filter((c) => c.t <= 30) };
    }
    /**
     * The cases that warm a show up to its end run on a 4 s slice (2 cues, ends on step 1063) with
     * 120-step checkpoints (Yoshi T1): the handoff, run key, edit restart and budget rules are the
     * same at any spacing. Their show30 versions at 1200 steps are in the daily file.
     */
    function show4(): ShowDocument {
      const show = doneWhenShow();
      return { ...show, duration: 4, cues: show.cues.filter((c) => c.t <= 4) };
    }
    const CP4 = { checkpointSteps: 120 };
    const attr = (el: HTMLElement) =>
      el.querySelector('app-fireworks-stage')!.getAttribute('data-warm-up');

    async function warmed(
      show = show30(),
      opts: { paused?: boolean; checkpointSteps?: number } = {},
    ) {
      config.setPlayback({ ...DEFAULT_PLAYBACK, seekBudgetMs: 25 });
      const driver = new TimelineDriver(show, { checkpointSteps: opts.checkpointSteps });
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
      const m = await warmed(show4(), CP4);
      expect(attr(m.el)).toBe('off');
      m.renderer.frame(16);
      await m.fixture.whenStable();
      expect(attr(m.el)).toBe('running');
      await runUntilWarm(m);
      expect(attr(m.el)).toBe('finished');
      expect(m.driver.step).toBe(0);
      expect(liveSteps).toBe(0);
      // The show ends on 1063; the last slice's chunk ran past 1080 before it saw the end.
      expect(m.driver.checkpointSteps).toEqual([120, 240, 360, 480, 600, 720, 840, 960, 1080]);
      // Finished: later frames run no warm-up.
      const before = otherSteps;
      m.renderer.frame(16, 10);
      expect(otherSteps).toBe(before);
    });

    it('a far seek after warm-up restores a checkpoint and lands exactly on a straight run (7l.7)', async () => {
      const m = await warmed(show4(), CP4);
      await runUntilWarm(m);
      const target = 840 + 51;
      m.stage.seek(target);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(51); // from the warmed checkpoint at 840, not from 0
      const oracle = straight(m.show, target);
      expect(m.driver.ledger).toEqual(oracle.driver.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(oracle.sim));
    });

    // Yoshi addendum 1, gap M10 (Toad, Phase 7 C3): the shadow runs at the visible star budget.
    // At the default budget an unsynced shadow is invisible; at 0.5 its checkpoints would carry
    // another run key, `seek` would skip every one, and warm-up would silently do nothing.
    it('at starBudget 0.5 the warmed checkpoints are used, and the seek is a straight run at 0.5', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, seekBudgetMs: 25 });
      const show = show4();
      const driver = new TimelineDriver(show, CP4);
      const m = await mount((h) => {
        h.driver.set(driver);
        h.warmUp.set(true);
        h.paused.set(true);
        h.quality.set({ ...DEFAULT_QUALITY, starBudget: 0.5 });
      });
      expect(m.stage.sim.starBudget).toBe(0.5);
      await runUntilWarm({ ...m, driver, show });
      expect(m.stage.warmUpState()).toBe('finished');
      const target = 840 + 51;
      m.stage.seek(target);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(51); // from the warmed checkpoint at 840, not from 0
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
      const m = await warmed(show4(), CP4);
      m.renderer.width = 1620;
      await runUntilWarm(m);
      expect(m.stage.warmUpState()).toBe('finished');
      const target = 840 + 51;
      m.stage.seek(target);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(51);
      const oracle = straight(m.show, target, 1620);
      expect(m.driver.ledger).toEqual(oracle.driver.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(oracle.sim));
    });

    it('checkpoints warmed at another width are not used: the seek stays exact (7l.7 negative)', async () => {
      const m = await warmed(show4(), CP4);
      await runUntilWarm(m);
      m.renderer.width = 1281;
      m.stage.seek(500);
      liveSteps = 0;
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(liveSteps).toBe(500); // re-ran from 0: nothing at width 1280 was trusted
      expect(snapshot(m.stage.sim)).toEqual(snapshot(straight(m.show, 500, 1281).sim));
      // And warm-up starts again for the new width.
      m.renderer.frame(16);
      await m.fixture.whenStable();
      expect(m.stage.warmUpState()).toBe('running');
    });

    it('stays within the frame budget: idle, WARM_UP_IDLE_MS; playing, WARM_UP_PLAYING_MS (7l.6)', async () => {
      const m = await warmed();
      const budgetSteps = WARM_UP_IDLE_MS / clock.msPerStep;
      m.renderer.frame(16); // creates the shadow
      for (let f = 0; f < 5; f++) {
        otherSteps = 0;
        m.renderer.frame(16);
        expect(otherSteps).toBeGreaterThan(budgetSteps / 2);
        expect(otherSteps).toBeLessThanOrEqual(budgetSteps + 1);
      }
      m.host.paused.set(false);
      await m.fixture.whenStable();
      for (let f = 0; f < 5; f++) {
        otherSteps = liveSteps = 0;
        m.renderer.frame(1000 / 60);
        expect(liveSteps).toBe(2);
        expect(otherSteps).toBeLessThanOrEqual(WARM_UP_PLAYING_MS / clock.msPerStep + 1);
      }
    });

    it('a foreground seek goes first: no warm-up step in a frame the seek used up (7l.6)', async () => {
      const m = await warmed();
      m.renderer.frame(16);
      m.stage.seek(3500);
      otherSteps = liveSteps = 0;
      m.renderer.frame(16);
      expect(liveSteps).toBeGreaterThan(0);
      expect(otherSteps).toBe(0);
    });

    it('a scrub before warm-up finishes lands exactly, and warm-up then finishes', async () => {
      const m = await warmed(show4(), CP4);
      m.renderer.frame(16, 2); // part way
      expect(m.stage.warmUpState()).toBe('running');
      m.stage.seek(777);
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(straight(m.show, 777).sim));
      await runUntilWarm(m);
      expect(m.stage.warmUpState()).toBe('finished');
    });

    it('an edit restarts warm-up from the edit point, and a seek past it is the edited show exactly (7l.8)', async () => {
      const m = await warmed(show4(), CP4);
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
      expect(otherSteps).toBeLessThan(next.endBoundStep - editStep + 240);
      const target = editStep + 70;
      m.stage.seek(target);
      for (let i = 0; i < 400 && m.stage.seeking(); i++) m.renderer.frame(16);
      expect(next.ledger).toEqual(straight(edited, target).driver.ledger);
      expect(snapshot(m.stage.sim)).toEqual(snapshot(straight(edited, target).sim));
    });

    it('keeps checkpoint memory under the configured cap (7l.8)', async () => {
      config.setPlayback({ ...DEFAULT_PLAYBACK, checkpointMemoryMiB: 8 });
      const driver = new TimelineDriver(show4(), { ...CP4, checkpointBytes: 1 });
      const m = await mount((h) => {
        h.driver.set(driver);
        h.warmUp.set(true);
        h.paused.set(true);
      });
      for (let i = 0; i < 5000 && m.stage.warmUpState() !== 'finished'; i++) m.renderer.frame(16);
      expect(m.stage.warmUpState()).toBe('finished');
      expect(driver.checkpointSteps.length).toBeLessThanOrEqual(1);
    });

    // Coordinator, B3: a stage that fails mid-warm-up must not keep reporting `running`.
    it('a failed stage reports data-warm-up="off", not running', async () => {
      const m = await warmed();
      m.renderer.frame(16);
      await m.fixture.whenStable();
      expect(attr(m.el)).toBe('running');
      m.renderer.loseContext();
      timers.advance(CONTEXT_RESTORE_TIMEOUT_MS);
      await m.fixture.whenStable();
      expect(status(m.el)).toBe('failed');
      expect(attr(m.el)).toBe('off');
    });

    it('off by default (the player): no shadow steps, data-warm-up off (7l.9)', async () => {
      const driver = new TimelineDriver(show30());
      const m = await mount((h) => {
        h.driver.set(driver);
        h.paused.set(true);
      });
      m.renderer.frame(16, 50);
      await m.fixture.whenStable();
      expect(otherSteps).toBe(0);
      expect(attr(m.el)).toBe('off');
    });
  });
});
