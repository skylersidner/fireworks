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
import { createDriver, RandomShowDriver } from '../../../../../engine/loop/drivers';
import { EngineLoop } from '../../../../../engine/loop/engine-loop';
import type { PlaybackMode } from '../../../../../engine/model/enums';
import { normalizeQuality, normalizeSky } from '../../../../../engine/model/normalize';
import {
  DEFAULT_QUALITY,
  type QualitySettings,
  type ShellDocument,
  type SkySettings,
} from '../../../../../engine/model/shell';
import type {
  RendererName,
  StageRenderer,
  StageRendererFactory,
  TrailFormat,
} from '../../../../../engine/render/stage-renderer';
import { GROUND, MIN_CLICK_HEIGHT } from '../../../../../engine/sim/constants';
import { FireworksSim } from '../../../../../engine/sim/simulation';

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

/**
 * Creates the stage renderer. The default dynamically imports engine/render/pixi-renderer.ts, so
 * pixi.js is only fetched when a stage mounts (its own lazy chunk), and specs swap in a fake
 * (`testing/fake-stage-renderer.ts`) so jsdom never loads Pixi or needs WebGL. The factory is
 * stateless: every stage instance gets its own renderer from it.
 */
export const STAGE_RENDERER_FACTORY = new InjectionToken<StageRendererFactory>(
  'STAGE_RENDERER_FACTORY',
  {
    factory: () => (host, options) =>
      import('../../../../../engine/render/pixi-renderer').then((m) =>
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

  readonly stats = output<StageStats>();

  readonly status = signal<StageStatus>('starting');
  readonly renderer = signal<RendererName | null>(null);
  readonly trailFormat = signal<TrailFormat | null>(null);
  readonly error = signal<string | null>(null);

  /** Exposed for the host page and specs; never shared between instances. */
  readonly sim = new FireworksSim();
  readonly loop: EngineLoop;

  private readonly createRenderer = inject(STAGE_RENDERER_FACTORY);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private stage: StageRenderer | null = null;
  private destroyed = false;
  private persistence = DEFAULT_QUALITY.persistence;
  private reduceFlashing = DEFAULT_QUALITY.reduceFlashing;
  private statsElapsedMs = 0;

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
      untracked(() =>
        this.loop.setDriver(createDriver(mode, undefined, { reduceFlashing: this.reduceFlashing })),
      );
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

  /** The Launch button: current shell at the default target. Returns the seed, or null if paused. */
  launch(): number | null {
    if (this.paused()) return null;
    return this.loop.launch();
  }

  /** Re-fires the last launch with its seed. False before any launch. */
  replay(): boolean {
    if (this.paused()) return false;
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
    if (this.paused()) return null;
    const seed = this.loop.launch();
    this.loop.holdAutoFire();
    return seed;
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.stage || this.paused()) return;
    const { x, y } = this.stage.screenToWorld(event.clientX, event.clientY);
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
    // Read untracked: this runs outside any reactive context anyway, and must not subscribe.
    if (!untracked(this.paused)) this.loop.frame(deltaMS);
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
}
