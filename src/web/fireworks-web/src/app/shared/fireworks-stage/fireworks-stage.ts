import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CANVAS_RESOLUTION } from '../../core/browser';
import { ClientConfigStore } from '../../core/client-config';
import { createDriver, RandomShowDriver } from '../../../engine/loop/drivers';
import { EngineLoop } from '../../../engine/loop/engine-loop';
import type { TimelineDriver } from '../../../engine/loop/timeline-driver';
import type { PlaybackMode } from '../../../engine/model/enums';
import { normalizeQuality, normalizeSky } from '../../../engine/model/normalize';
import {
  DEFAULT_QUALITY,
  type QualitySettings,
  type ShellDocument,
  type SkySettings,
} from '../../../engine/model/shell';
import type {
  RendererName,
  StageRenderer,
  StageRendererFactory,
  TrailFormat,
} from '../../../engine/render/stage-renderer';
import { GROUND, MIN_CLICK_HEIGHT } from '../../../engine/sim/constants';
import { FlashSpacing } from '../../../engine/render/visual-rules';
import { FireworksSim } from '../../../engine/sim/simulation';
import {
  CONTEXT_FAILED_HEAD,
  CONTEXT_FAILED_LINE,
  CONTEXT_LOST_NOTICE,
  RELOAD_PAGE,
  startFailureText,
  type StageSurface,
} from './stage-copy';

/**
 * `lost`: the WebGL context is gone and the stage holds (no step, no launch) until it's back or
 * the restore timeout passes (yoshi-phase7-architecture-rulings.md point 1).
 */
export type StageStatus = 'starting' | 'running' | 'lost' | 'failed';

/** Why the stage failed: it never started (no WebGL), or a context loss wasn't restored. */
export type StageFailure = 'start' | 'lost';

/** Background checkpoint warm-up (builder): `data-warm-up` on the host. */
export type WarmUpState = 'off' | 'running' | 'finished';

/** A loss shows its status line after this long (phase-7.md §11: a quick blip shows nothing). */
export const CONTEXT_LOST_NOTICE_MS = 1000;
/** A loss not restored by then fails the stage (phase-7.md §11 sets 10 s over Yoshi's 5 s). */
export const CONTEXT_RESTORE_TIMEOUT_MS = 10_000;
/**
 * Warm-up's share of a frame: what the seek budget leaves, capped at this while the show plays
 * (playback keeps its frame rate) and at WARM_UP_IDLE_MS otherwise (the timeline and controls stay
 * near 60 fps; the full 25 ms budget held a paused builder at about 30 fps).
 */
export const WARM_UP_PLAYING_MS = 6;
export const WARM_UP_IDLE_MS = 12;

/** HUD numbers, emitted about 4 times a second (never per frame). */
export interface StageStats {
  readonly particles: number;
  readonly fps: number;
  /** Seed of the last launch, or null before any launch. */
  readonly seed: number | null;
  readonly renderer: RendererName;
}

/** Frame time between `stats` emissions. 250 ms is about 4 Hz. */
export const STATS_INTERVAL_MS = 250;

/*
 * Time a seek may spend per frame comes from ClientConfigStore (`playback.seekBudgetMs`, served by
 * `api/client-config`, default 25 ms), so a long seek spreads over frames (phase-6.md §5.3). Bounded
 * by time, not steps: at the 40k particle cap one step costs a few ms, so a fixed step count froze
 * the tab for seconds per frame (Boo, Phase 6 F1). At least one step always runs, so a seek
 * progresses. The "Catching up" delay (`catchingUpDelayMs`, default 300) comes from there too.
 */
/** Most steps run between two clock reads while a seek is in its budget. */
export const SEEK_CHUNK_MAX_STEPS = 32;

/** A click or tap in the sky while a timeline plays (the builder adds a cue there). */
export interface SkyClick {
  /** Fraction of the world width, 0..1. */
  readonly x: number;
  /** World y of the click. */
  readonly y: number;
}

/**
 * Called once per animation frame in timeline mode with the driver's step, outside change
 * detection. The host writes the DOM directly (the playhead line); it must never write a signal.
 */
export type TimelineFrameHook = (step: number, driver: TimelineDriver) => void;

/**
 * Creates the stage renderer. The default dynamically imports engine/render/pixi-renderer.ts, so
 * pixi.js is only fetched when a stage mounts (its own lazy chunk), and specs swap in a fake
 * (`testing/fake-stage-renderer.ts`) so jsdom never loads Pixi or needs WebGL. The factory is
 * stateless: every stage instance gets its own renderer from it.
 */
/** The stage's millisecond clock for the seek budget. Specs swap in a fake. */
export const STAGE_CLOCK = new InjectionToken<() => number>('STAGE_CLOCK', {
  factory: () => () => performance.now(),
});

/** Timers for the context-loss thresholds. Specs use Vitest fake timers on these. */
export const STAGE_TIMERS = new InjectionToken<{
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}>('STAGE_TIMERS', {
  factory: () => ({
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }),
});

/** The failure block's Reload page. Specs swap in a spy. */
export const PAGE_RELOAD = new InjectionToken<() => void>('PAGE_RELOAD', {
  factory: () => () => location.reload(),
});

export const STAGE_RENDERER_FACTORY = new InjectionToken<StageRendererFactory>(
  'STAGE_RENDERER_FACTORY',
  {
    factory: () => (host, options) =>
      import('../../../engine/render/pixi-renderer').then((m) =>
        m.createPixiRenderer(host, options),
      ),
  },
);

/**
 * The live fireworks stage. Each instance owns its own FireworksSim, EngineLoop and renderer (no
 * root service), so a designer and a player can coexist. Lifecycle follows
 * .squad/skills/pixi-host-lifecycle/SKILL.md:
 *  - the renderer starts in `afterNextRender`, exactly once;
 *  - destroy can arrive while Pixi's `init()` is pending: the renderer is then destroyed the
 *    moment it resolves, and never mounted;
 *  - teardown runs from DestroyRef and releases the WebGL context;
 *  - it reports the renderer Pixi actually picked (`data-renderer`) and the trail buffer format
 *    (`data-trail-format`).
 * Frames run on Pixi's ticker and write no signal; `stats` emits about 4 times a second.
 * Only one live stage per page: browsers cap WebGL contexts.
 */
@Component({
  selector: 'app-fireworks-stage',
  templateUrl: './fireworks-stage.html',
  styleUrl: './fireworks-stage.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-status]': 'status()',
    '[attr.data-renderer]': 'renderer()',
    '[attr.data-trail-format]': 'trailFormat()',
    '[attr.data-warm-up]': 'warmUpState()',
  },
})
export class FireworksStageComponent {
  /** The shell Launch, click and the preview loop fire. */
  readonly shell = input.required<ShellDocument>();
  readonly mode = input<PlaybackMode>('loop');
  /** Physics. When unset, the shell's own `sky` applies, else the default 160/0. */
  readonly sky = input<SkySettings | undefined>(undefined);
  /** Viewer settings (motion blur, star budget, Reduce flashing). Never saved with a shell. */
  readonly quality = input<QualitySettings>(DEFAULT_QUALITY);
  /**
   * While true nothing fires and time stands still: the mode driver isn't ticked, so the preview
   * loop and Auto show don't fire, and Launch, Replay, clicks and `fireNow` launch nothing. The
   * stage keeps rendering. The designer pauses while the flashing notice shows (Skyler 2026-11-13).
   */
  readonly paused = input(false);
  /**
   * Whether a click or tap in the sky fires the shell. The player turns it off: it's a viewer, not
   * a sandbox, and a stray tap on touch shouldn't burst (phase-5.md §8.2).
   */
  readonly clickToFire = input(true);
  /**
   * Timeline mode (Phase 6): the show driver to play. While set it is the loop's driver, so Launch,
   * Replay, `fireNow` and clicks never fire (a click emits `skyClick` instead when `clickToFire`).
   * A new driver (an edit, `{ from: old }`) is put at the old one's step unless `seek` asked for
   * another. Frames stop stepping once the show has ended (§4.5).
   */
  readonly timeline = input<TimelineDriver | null>(null);
  /** See `TimelineFrameHook`. */
  readonly frameHook = input<TimelineFrameHook | null>(null);
  /** Which page hosts the stage: picks the failure copy. */
  readonly surface = input<StageSurface>('designer');
  /**
   * Timeline mode: warm the show's checkpoints up in the background, on a shadow sim, so a first
   * far scrub restores a checkpoint instead of re-running from 0 (Phase 7; Skyler: cold seeks count,
   * every device). The builder turns it on; the player has no scrub. It restarts for every new
   * driver (a `/c/` load, a draft restore, an Apply, an edit), from the edit point: the new driver
   * holds the checkpoints before it. Finished is `data-warm-up="finished"`.
   */
  readonly warmUp = input(false);

  readonly stats = output<StageStats>();
  /** Timeline mode: a click in the sky, when `clickToFire` (nothing fires). */
  readonly skyClick = output<SkyClick>();
  /** Timeline mode: playback reached the show's end step. Emitted once per arrival. */
  readonly ended = output<number>();
  /** Timeline mode: a seek has taken over the catching-up delay (its target step), then null when it lands. */
  readonly catchingUp = output<number | null>();

  readonly status = signal<StageStatus>('starting');
  readonly renderer = signal<RendererName | null>(null);
  readonly trailFormat = signal<TrailFormat | null>(null);
  readonly error = signal<string | null>(null);
  readonly failure = signal<StageFailure | null>(null);
  /** True from 1 s into a context loss until it's restored or fails (the builder hides Catching up). */
  readonly lostNotice = signal(false);
  readonly warmUpState = signal<WarmUpState>('off');

  protected readonly startFailureText = startFailureText;
  protected readonly lostNoticeText = CONTEXT_LOST_NOTICE;
  protected readonly failedHead = CONTEXT_FAILED_HEAD;
  protected readonly failedLine = CONTEXT_FAILED_LINE;
  protected readonly reloadLabel = RELOAD_PAGE;

  /** Exposed for the host page and specs; never shared between instances. */
  readonly sim = new FireworksSim();
  readonly loop: EngineLoop;

  private readonly createRenderer = inject(STAGE_RENDERER_FACTORY);
  private readonly clock = inject(STAGE_CLOCK);
  /** Read on each seek frame (untracked), so values that arrive mid-seek apply from the next frame. */
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly resolution = inject(CANVAS_RESOLUTION);
  private readonly timers = inject(STAGE_TIMERS);
  protected readonly reload = inject(PAGE_RELOAD);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  /**
   * Host-owned so it outlives a renderer rebuild: Reduce flashing spacing must hold across a
   * context loss (flashing-content-safety rule 6).
   */
  private readonly flashSpacing = new FlashSpacing();
  private stage: StageRenderer | null = null;
  /** Bumped by every mount and teardown: a renderer resolved for an older one is destroyed. */
  private generation = 0;
  private lossTimers: unknown[] = [];
  /** Last world width a renderer reported; fires and run keys use it while none is mounted. */
  private lastWidth = 1280;
  private destroyed = false;
  private persistence = DEFAULT_QUALITY.persistence;
  private reduceFlashing = DEFAULT_QUALITY.reduceFlashing;
  private statsElapsedMs = 0;
  private timelineDriver: TimelineDriver | null = null;
  private seekTarget: number | null = null;
  /**
   * The show's end step once playback ran past it: the loop runs every step a frame holds, so the
   * driver's own step overshoots the end by a few (yoshi-phase7-architecture-rulings.md point 2).
   */
  private playbackEndStep: number | null = null;
  private warm: WarmRun | null = null;
  /** The driver and run key a finished warm-up covered. */
  private warmedFor: { driver: TimelineDriver; key: string } | null = null;
  private seekElapsedMs = 0;
  private catchingUpShown = false;
  private endedReported = false;

  constructor() {
    this.loop = new EngineLoop(this.sim, undefined, {
      worldWidth: () => this.worldWidth(),
    });

    // Inputs flow into plain engine fields. No signal is written from the frame callback.
    effect(() => {
      this.loop.shell = this.shell();
    });
    effect(() => {
      const mode = this.mode();
      const timeline = this.timeline();
      untracked(() => {
        if (timeline) {
          const previous = this.timelineDriver;
          if (previous === timeline) return;
          // The reported step, so an edit after the end re-seeks to the end, not past it.
          const at = previous ? this.currentStep() : 0;
          this.timelineDriver = timeline;
          this.loop.setDriver(timeline);
          this.endedReported = false;
          this.playbackEndStep = null;
          this.stopWarmUp();
          if (this.seekTarget === null) this.requestSeek(at);
          return;
        }
        this.timelineDriver = null;
        this.seekTarget = null;
        this.playbackEndStep = null;
        this.stopWarmUp();
        this.loop.setDriver(createDriver(mode, undefined, { reduceFlashing: this.reduceFlashing }));
      });
    });
    effect(() => {
      this.sim.sky = normalizeSky(this.sky() ?? this.shell().sky);
    });
    effect(() => {
      const q = normalizeQuality(this.quality());
      this.sim.starBudget = q.starBudget;
      this.persistence = q.persistence;
      this.reduceFlashing = q.reduceFlashing;
      // Flipped on the running driver, so a toggle never restarts the Auto show timer.
      const driver = untracked(() => this.loop.driver);
      if (driver instanceof RandomShowDriver) driver.reduceFlashing = q.reduceFlashing;
    });

    afterNextRender(() => {
      void this.start();
    });

    effect(() => {
      if (!this.warmUp()) untracked(() => this.stopWarmUp());
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.generation++;
      this.clearLossTimers();
      this.stage?.destroy();
      this.stage = null;
      this.warm = null;
    });
  }

  /**
   * Timeline mode: puts the show at `step` exactly as a run from 0 would (`TimelineDriver.seek`),
   * spread over frames at about the configured seek budget each. A newer seek replaces an older one. Runs only
   * while the renderer is up, so cues fire at the real world width.
   */
  seek(step: number): void {
    this.requestSeek(Math.max(0, Math.floor(step)));
  }

  /**
   * Timeline mode: the pending seek's target, else the show's end step once playback passed it,
   * else the driver's step. A seek past the end reports its target.
   */
  currentStep(): number {
    return this.seekTarget ?? this.playbackEndStep ?? this.timelineDriver?.step ?? 0;
  }

  /** True while a timeline seek hasn't landed. */
  seeking(): boolean {
    return this.seekTarget !== null;
  }

  /** The Launch button: current shell at the default target. Returns the seed, or null if paused. */
  launch(): number | null {
    if (this.held() || this.timelineDriver) return null;
    return this.loop.launch();
  }

  /** Re-fires the last launch with its seed. False before any launch. */
  replay(): boolean {
    if (this.held() || this.timelineDriver) return false;
    return this.loop.replay();
  }

  /** Clear sky. */
  clear(): void {
    this.loop.clear();
  }

  /** Delays the next automatic fire by one shellDuration (call after loading a preset). */
  holdAutoFire(): void {
    this.loop.holdAutoFire();
  }

  /**
   * Loading a preset or applied JSON (prototype `loadShell(s, true)`): makes `shell` and `sky`
   * current now, fires it at the default target and holds the mode timer for one shellDuration.
   * Takes the values directly because the input effects only run at the next change detection,
   * and the launch must not fire the previous shell. Returns the seed. While paused it only makes
   * `shell` and `sky` current and returns null.
   */
  fireNow(shell: ShellDocument, sky?: SkySettings): number | null {
    this.loop.shell = shell;
    this.sim.sky = normalizeSky(sky ?? shell.sky);
    if (this.held() || this.timelineDriver) return null;
    const seed = this.loop.launch();
    this.loop.holdAutoFire();
    return seed;
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.stage || this.status() !== 'running' || !this.clickToFire()) return;
    // Timeline mode: a click adds a cue (the host decides), playing or paused (phase-6.md §4.1).
    if (!this.timelineDriver && this.paused()) return;
    const { x, y } = this.stage.screenToWorld(event.clientX, event.clientY);
    if (this.timelineDriver) {
      const w = this.stage.worldWidth();
      this.skyClick.emit({ x: Math.min(1, Math.max(0, w > 0 ? x / w : 0.5)), y });
      return;
    }
    if (y < GROUND - MIN_CLICK_HEIGHT) {
      this.loop.fireAt(x, y);
    }
  }

  /** Paused by the host, or held by a context loss (Y§1: a loss acts as a pause). */
  private held(): boolean {
    return this.paused() || this.status() !== 'running';
  }

  /** The mounted renderer's world width, else the last one it reported (never the 1280 default once known). */
  private worldWidth(): number {
    return this.stage ? this.stage.worldWidth() : this.lastWidth;
  }

  /**
   * Creates and mounts a renderer (first start, and the rebuild after a restored context). The
   * generation check covers both a destroy and a newer mount while the factory is pending.
   */
  private async start(rebuild = false): Promise<void> {
    const generation = ++this.generation;
    let stage: StageRenderer;
    try {
      stage = await this.createRenderer(this.host().nativeElement, {
        resolution: this.resolution(),
        flashSpacing: this.flashSpacing,
      });
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return;
      console.error('Fireworks stage failed to start', error);
      if (rebuild) {
        this.fail('lost');
      } else {
        this.error.set(error instanceof Error ? error.message : String(error));
        this.fail('start');
      }
      return;
    }

    if (this.destroyed || generation !== this.generation) {
      stage.destroy();
      return;
    }

    this.stage = stage;
    this.lastWidth = stage.worldWidth();
    this.host().nativeElement.appendChild(stage.canvas);
    this.renderer.set(stage.name);
    this.trailFormat.set(stage.trailFormat);
    this.status.set('running');
    stage.onContextChange((state) => this.onContextChange(stage, state));
    stage.start((deltaMS) => this.onFrame(stage, deltaMS));
  }

  /**
   * Context loss (Y§1, phase-7.md §11): hold, show the status line after 1 s, and fail after 10 s.
   * A restore in time rebuilds the renderer through the factory; the sim, loop, driver and
   * FlashSpacing are the host's and are never touched. A restore after the failure is ignored
   * (coordinator ruling N1: the renderer is destroyed by then).
   */
  private onContextChange(stage: StageRenderer, state: 'lost' | 'restored'): void {
    if (this.destroyed || stage !== this.stage) return;
    if (state === 'lost') {
      if (this.status() !== 'running') return;
      this.status.set('lost');
      this.lossTimers = [
        this.timers.set(() => this.lostNotice.set(true), CONTEXT_LOST_NOTICE_MS),
        this.timers.set(() => this.fail('lost'), CONTEXT_RESTORE_TIMEOUT_MS),
      ];
      return;
    }
    if (this.status() !== 'lost') return;
    this.clearLossTimers();
    this.lostNotice.set(false);
    // Destroy first: browsers cap WebGL contexts per page.
    this.stage = null;
    stage.destroy();
    void this.start(true);
  }

  private fail(failure: StageFailure): void {
    this.clearLossTimers();
    this.lostNotice.set(false);
    this.generation++;
    this.stage?.destroy();
    this.stage = null;
    this.warm = null;
    // A failed stage runs no warm-up: the hook must not keep reading `running` (coordinator, Phase 7 B3).
    this.warmUpState.set('off');
    this.failure.set(failure);
    this.status.set('failed');
  }

  private clearLossTimers(): void {
    for (const handle of this.lossTimers) this.timers.clear(handle);
    this.lossTimers = [];
  }

  /** Runs once per animation frame, outside change detection. Writes no signals. */
  private onFrame(stage: StageRenderer, deltaMS: number): void {
    this.lastWidth = stage.worldWidth();
    const timeline = this.timelineDriver;
    if (timeline) this.timelineFrame(timeline, deltaMS);
    // Read untracked: this runs outside any reactive context anyway, and must not subscribe.
    else if (!untracked(this.paused)) this.loop.frame(deltaMS);
    stage.render(this.sim, this.persistence, this.reduceFlashing);

    this.statsElapsedMs += deltaMS;
    if (this.statsElapsedMs >= STATS_INTERVAL_MS) {
      this.statsElapsedMs = 0;
      this.stats.emit({
        particles: this.sim.particles.n,
        fps: this.loop.fpsAvg,
        seed: this.loop.lastLaunch?.seed ?? null,
        renderer: stage.name,
      });
    }
  }

  private requestSeek(step: number): void {
    this.seekTarget = step;
    this.playbackEndStep = null;
    this.seekElapsedMs = 0;
    this.endedReported = false;
  }

  /**
   * Timeline mode, one frame: a pending seek's next slice, else playback until the end; then
   * warm-up with what the frame's seek budget leaves (the foreground seek always goes first).
   */
  private timelineFrame(timeline: TimelineDriver, deltaMS: number): void {
    const frameStart = this.clock();
    const budget = untracked(this.clientConfig.playback).seekBudgetMs;
    const target = this.seekTarget;
    if (target !== null) {
      this.seekElapsedMs += deltaMS;
      if (this.runSlice(timeline, this.loop, target, budget, frameStart)) {
        this.seekTarget = null;
        if (this.catchingUpShown) {
          this.catchingUpShown = false;
          this.catchingUp.emit(null);
        }
      } else if (
        !this.catchingUpShown &&
        this.seekElapsedMs > untracked(this.clientConfig.playback).catchingUpDelayMs
      ) {
        this.catchingUpShown = true;
        this.catchingUp.emit(target);
      }
    } else if (!untracked(this.paused) && !timeline.done) {
      this.loop.frame(deltaMS);
      if (timeline.done) this.playbackEndStep = timeline.endStep;
    }
    if (this.seekTarget === null && timeline.done && !this.endedReported) {
      this.endedReported = true;
      if (!untracked(this.paused)) this.ended.emit(timeline.endStep ?? timeline.step);
    }
    untracked(this.frameHook)?.(this.currentStep(), timeline);

    if (untracked(this.warmUp) && this.seekTarget === null) {
      const playing = !untracked(this.paused) && !timeline.done;
      const left = budget - (this.clock() - frameStart);
      this.warmUpSlice(timeline, Math.min(left, playing ? WARM_UP_PLAYING_MS : WARM_UP_IDLE_MS));
    }
  }

  /**
   * One frame of a seek on `loop`: chunks of `TimelineDriver.seek` until it arrives or `budget`
   * ms have passed since `start`. The first chunk is one step (always run); later chunks are sized
   * from the measured step cost to fit what is left, so a frame overshoots by at most about one
   * step. Exactness is the driver's: chunked calls with one target equal one uncapped call.
   * `stop` ends it early (warm-up stops at the show's end). Returns whether it arrived or stopped.
   */
  private runSlice(
    driver: TimelineDriver,
    loop: EngineLoop,
    target: number,
    budget: number,
    start: number,
    stop: () => boolean = () => false,
  ): boolean {
    const sliceStart = this.clock();
    let steps = 0;
    let chunk = 1;
    for (;;) {
      if (driver.seek(loop, target, chunk) || stop()) return true;
      steps += chunk; // Not arrived: exactly `chunk` steps ran.
      const now = this.clock();
      const left = budget - (now - start);
      if (left <= 0) return false;
      const perStep = (now - sliceStart) / steps;
      chunk =
        perStep > 0
          ? Math.max(1, Math.min(SEEK_CHUNK_MAX_STEPS, Math.floor(left / perStep)))
          : SEEK_CHUNK_MAX_STEPS;
    }
  }

  /**
   * Warm-up for up to `budget` ms: the shadow (`TimelineDriver.twin`, on its own sim and loop at
   * the same width, star budget and capacity) first takes whatever checkpoints the visible driver
   * holds, runs on toward the end, then hands its checkpoints back. Checkpoints are exact snapshots
   * of a straight run of the same schedule, so the visible driver's results never change, only
   * how far back a seek has to start. Nothing runs when the budget is spent.
   */
  private warmUpSlice(timeline: TimelineDriver, budget: number): void {
    const key = `${this.worldWidth()}|${this.sim.starBudget}|${this.sim.particles.capacity}`;
    const warmed = this.warmedFor;
    if (warmed && warmed.driver === timeline && warmed.key === key) return;
    if (timeline.checkpointInterval === 0) return;
    let warm = this.warm;
    if (!warm || warm.live !== timeline) {
      const sim = new FireworksSim({ capacity: this.sim.particles.capacity });
      const shadow = timeline.twin();
      const loop = new EngineLoop(sim, undefined, {
        worldWidth: () => this.worldWidth(),
        driver: shadow,
      });
      warm = this.warm = { live: timeline, shadow, sim, loop };
      this.warmedFor = null;
      this.warmUpState.set('running');
    }
    if (budget <= 0) return;
    warm.sim.starBudget = this.sim.starBudget;
    warm.shadow.adoptCheckpoints(timeline);
    const shadow = warm.shadow;
    const done = this.runSlice(
      shadow,
      warm.loop,
      shadow.endBoundStep + 1,
      budget,
      this.clock(),
      () => shadow.done,
    );
    timeline.adoptCheckpoints(shadow);
    if (done) {
      this.warm = null;
      this.warmedFor = { driver: timeline, key };
      this.warmUpState.set('finished');
    }
  }

  private stopWarmUp(): void {
    this.warm = null;
    this.warmedFor = null;
    if (untracked(this.warmUpState) !== 'off') this.warmUpState.set('off');
  }
}

/** A warm-up in progress for one visible driver. */
interface WarmRun {
  readonly live: TimelineDriver;
  readonly shadow: TimelineDriver;
  readonly sim: FireworksSim;
  readonly loop: EngineLoop;
}
