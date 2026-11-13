import type { PlaybackMode } from '../model/enums';
import { PRESETS } from '../model/presets';
import { GROUND } from '../sim/constants';
import type { PlaybackContext, PlaybackDriver } from './playback-driver';

/** Shared `modeTimer` behavior: counts down every frame; a new driver starts at 0. */
abstract class TimedDriver implements PlaybackDriver {
  abstract readonly mode: PlaybackMode;
  protected timer = 0;

  /** Seconds until the driver may fire again. Exposed for specs. */
  get remaining(): number {
    return this.timer;
  }

  tick(ctx: PlaybackContext, dt: number): void {
    this.timer -= dt;
    this.update(ctx);
  }

  onUserFire(_ctx: PlaybackContext): void {}

  hold(seconds: number): void {
    this.timer = seconds;
  }

  protected abstract update(ctx: PlaybackContext): void;
}

/**
 * Preview loop: re-fires the current shell at its default target once the timer has run out
 * and nothing is in flight. A click in the sky restarts the timer.
 */
export class PreviewLoopDriver extends TimedDriver {
  readonly mode = 'loop';

  protected update(ctx: PlaybackContext): void {
    if (this.timer <= 0 && ctx.sim.shellCount === 0) {
      const [tx, ty] = ctx.sim.defaultTarget(ctx.shell, ctx.worldWidth());
      ctx.fire(ctx.shell, tx, ty);
      this.timer = ctx.sim.shellDuration(ctx.shell);
    }
  }

  override onUserFire(ctx: PlaybackContext): void {
    this.timer = ctx.sim.shellDuration(ctx.shell);
  }
}

/** Manual: never fires on its own (click and Launch only). */
export class ManualDriver extends TimedDriver {
  readonly mode = 'manual';

  protected update(): void {}
}

/** Shortest Auto show gap with Reduce flashing on (designer-2c.md §7.1); the longest stays 1.75 s. */
export const REDUCED_SHOW_MIN_GAP = 0.8;

/**
 * Random auto-show: the current shell 1 time in 4, otherwise a random preset, at a random x and
 * height. Uses `Math.random` by default, so it is deliberately not repeatable and never saved.
 * With `reduceFlashing` the gap is 0.8–1.75 s instead of 0.35–1.75 s, from the same single draw,
 * so the number of random draws per launch never changes. Settable while running: flipping it
 * does not reset the timer.
 */
export class RandomShowDriver extends TimedDriver {
  readonly mode = 'show';
  reduceFlashing: boolean;

  constructor(
    private readonly random: () => number = Math.random,
    reduceFlashing = false,
  ) {
    super();
    this.reduceFlashing = reduceFlashing;
  }

  protected update(ctx: PlaybackContext): void {
    if (this.timer > 0) return;
    const r = this.random;
    const def = r() < 0.25 ? ctx.shell : PRESETS[(r() * PRESETS.length) | 0];
    const w = ctx.worldWidth();
    ctx.fire(def, w * (0.15 + r() * 0.7), GROUND - (0.45 + r() * 0.35) * GROUND);
    const min = this.reduceFlashing ? REDUCED_SHOW_MIN_GAP : 0.35;
    this.timer = min + r() * (1.75 - min);
  }
}

/** Driver for a stage mode. A fresh driver starts with its timer at 0 (prototype mode change). */
export function createDriver(
  mode: PlaybackMode,
  random?: () => number,
  options: { reduceFlashing?: boolean } = {},
): PlaybackDriver {
  switch (mode) {
    case 'loop':
      return new PreviewLoopDriver();
    case 'manual':
      return new ManualDriver();
    case 'show':
      return new RandomShowDriver(random, options.reduceFlashing ?? false);
  }
}
