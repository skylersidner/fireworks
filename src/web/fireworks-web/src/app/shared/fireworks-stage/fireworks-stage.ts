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
import { FireworksSim } from '../../../engine/sim/simulation';

export type StageStatus = 'starting' | 'running' | 'failed';

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

  /** Exposed for the host page and specs; never shared between instances. */
  readonly sim = new FireworksSim();
  readonly loop: EngineLoop;

  private readonly createRenderer = inject(STAGE_RENDERER_FACTORY);
  private readonly clock = inject(STAGE_CLOCK);
  /** Read on each seek frame (untracked), so values that arrive mid-seek apply from the next frame. */
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private stage: StageRenderer | null = null;
  private destroyed = false;
  private persistence = DEFAULT_QUALITY.persistence;
  private reduceFlashing = DEFAULT_QUALITY.reduceFlashing;
  private statsElapsedMs = 0;
  private timelineDriver: TimelineDriver | null = null;
  private seekTarget: number | null = null;
  private seekElapsedMs = 0;
  private catchingUpShown = false;
  private endedReported = false;

  constructor() {
    this.loop = new EngineLoop(this.sim, undefined, {
      worldWidth: () => this.stage?.worldWidth() ?? 1280,
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
          this.timelineDriver = timeline;
          this.loop.setDriver(timeline);
          this.endedReported = false;
          if (this.seekTarget === null) this.requestSeek(previous?.step ?? 0);
          return;
        }
        this.timelineDriver = null;
        this.seekTarget = null;
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

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stage?.destroy();
      this.stage = null;
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

  /** Timeline mode: the step the show is at, or the pending seek's target. */
  currentStep(): number {
    return this.seekTarget ?? this.timelineDriver?.step ?? 0;
  }

  /** True while a timeline seek hasn't landed. */
  seeking(): boolean {
    return this.seekTarget !== null;
  }

  /** The Launch button: current shell at the default target. Returns the seed, or null if paused. */
  launch(): number | null {
    if (this.paused() || this.timelineDriver) return null;
    return this.loop.launch();
  }

  /** Re-fires the last launch with its seed. False before any launch. */
  replay(): boolean {
    if (this.paused() || this.timelineDriver) return false;
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
    if (this.paused() || this.timelineDriver) return null;
    const seed = this.loop.launch();
    this.loop.holdAutoFire();
    return seed;
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.stage || !this.clickToFire()) return;
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

  private async start(): Promise<void> {
    let stage: StageRenderer;
    try {
      stage = await this.createRenderer(this.host().nativeElement);
    } catch (error) {
      console.error('Fireworks stage failed to start', error);
      if (!this.destroyed) {
        this.error.set(error instanceof Error ? error.message : String(error));
        this.status.set('failed');
      }
      return;
    }

    if (this.destroyed) {
      stage.destroy();
      return;
    }

    this.stage = stage;
    this.host().nativeElement.appendChild(stage.canvas);
    this.renderer.set(stage.name);
    this.trailFormat.set(stage.trailFormat);
    this.status.set('running');
    stage.start((deltaMS) => this.onFrame(stage, deltaMS));
  }

  /** Runs once per animation frame, outside change detection. Writes no signals. */
  private onFrame(stage: StageRenderer, deltaMS: number): void {
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
    this.seekElapsedMs = 0;
    this.endedReported = false;
  }

  /** Timeline mode, one frame: a pending seek's next slice, else playback until the end. */
  private timelineFrame(timeline: TimelineDriver, deltaMS: number): void {
    const target = this.seekTarget;
    if (target !== null) {
      this.seekElapsedMs += deltaMS;
      if (this.seekSlice(timeline, target)) {
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
    }
    if (this.seekTarget === null && timeline.done && !this.endedReported) {
      this.endedReported = true;
      if (!untracked(this.paused)) this.ended.emit(timeline.endStep ?? timeline.step);
    }
    untracked(this.frameHook)?.(this.currentStep(), timeline);
  }

  /**
   * One frame of a seek: chunks of `TimelineDriver.seek` until it arrives or the seek budget has
   * passed. The first chunk is one step (always run); later chunks are sized from the measured step
   * cost to fit what is left, so a frame overshoots by at most about one step. Exactness is the
   * driver's: chunked calls with one target equal one uncapped call. Returns whether it arrived.
   */
  private seekSlice(timeline: TimelineDriver, target: number): boolean {
    const budget = untracked(this.clientConfig.playback).seekBudgetMs;
    const start = this.clock();
    let steps = 0;
    let chunk = 1;
    for (;;) {
      if (timeline.seek(this.loop, target, chunk)) return true;
      steps += chunk; // Not arrived: exactly `chunk` steps ran.
      const elapsed = this.clock() - start;
      const left = budget - elapsed;
      if (left <= 0) return false;
      const perStep = elapsed / steps;
      chunk =
        perStep > 0
          ? Math.max(1, Math.min(SEEK_CHUNK_MAX_STEPS, Math.floor(left / perStep)))
          : SEEK_CHUNK_MAX_STEPS;
    }
  }
}
