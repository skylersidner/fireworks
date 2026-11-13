import { newShell, type ShellDocument } from '../model/shell';
import { BASE_SEED, STEP } from '../sim/constants';
import { launchSeed } from '../sim/rng';
import type { FireworksSim } from '../sim/simulation';
import { ManualDriver } from './drivers';
import type { PlaybackContext, PlaybackDriver } from './playback-driver';

/** A launch as fired: a snapshot of the definition, the target and the seed (prototype `lastLaunch`). */
export interface LaunchRecord {
  readonly def: ShellDocument;
  readonly tx: number;
  readonly ty: number;
  readonly seed: number;
}

export interface EngineLoopOptions {
  baseSeed?: number;
  /** Frame-time clamp, seconds (prototype: 0.1). Configurable only so specs can reach the step cap. */
  maxFrameDt?: number;
  /** Fixed steps per frame before the accumulator is dropped (prototype: 24). */
  maxStepsPerFrame?: number;
  /** World width provider; the stage passes the renderer's. */
  worldWidth?: () => number;
  driver?: PlaybackDriver;
}

export const MAX_FRAME_DT = 0.1;
export const MAX_STEPS_PER_FRAME = 24;

/**
 * Fixed-step loop (prototype `tick`, `fire`, Replay) around one `FireworksSim`. Framework-free:
 * the host calls `frame(deltaMS)` from whatever ticker it has, then renders.
 */
export class EngineLoop implements PlaybackContext {
  /** The shell drivers fire and Launch uses. */
  shell: ShellDocument;
  /** Exponential moving average of 1/dt (0.95 / 0.05), starting at 60. */
  fpsAvg = 60;

  private readonly baseSeed: number;
  private readonly maxFrameDt: number;
  private readonly maxSteps: number;
  private readonly widthProvider: () => number;
  private acc = 0;
  private _launchCount = 0;
  private _lastLaunch: LaunchRecord | null = null;
  private _driver: PlaybackDriver;

  constructor(
    readonly sim: FireworksSim,
    shell: ShellDocument = newShell('Peony'),
    options: EngineLoopOptions = {},
  ) {
    this.shell = shell;
    this.baseSeed = options.baseSeed ?? BASE_SEED;
    this.maxFrameDt = options.maxFrameDt ?? MAX_FRAME_DT;
    this.maxSteps = options.maxStepsPerFrame ?? MAX_STEPS_PER_FRAME;
    this.widthProvider = options.worldWidth ?? (() => 1280);
    this._driver = options.driver ?? new ManualDriver();
  }

  get driver(): PlaybackDriver {
    return this._driver;
  }

  /** Launches fired so far through `fire` (Replay does not count). */
  get launchCount(): number {
    return this._launchCount;
  }

  get lastLaunch(): LaunchRecord | null {
    return this._lastLaunch;
  }

  worldWidth(): number {
    return this.widthProvider();
  }

  /** Switches playback mode. Pass a fresh driver: its timer starts at 0, as on a prototype mode change. */
  setDriver(driver: PlaybackDriver): void {
    this._driver = driver;
  }

  /** Fires `def` at (tx, ty) with the next seed, `(baseSeed + n * 7919) | 0`. Returns the seed. */
  fire(def: ShellDocument, tx: number, ty: number): number {
    const seed = launchSeed(this._launchCount++, this.baseSeed);
    this._lastLaunch = { def: structuredClone(def), tx, ty, seed };
    this.sim.launch(def, tx, ty, seed);
    return seed;
  }

  /** The Launch button: the current shell at its default target. Does not touch the mode timer. */
  launch(): number {
    const [tx, ty] = this.sim.defaultTarget(this.shell, this.worldWidth());
    return this.fire(this.shell, tx, ty);
  }

  /** Re-fires the last launch's snapshot with its seed, without advancing the seed counter. */
  replay(): boolean {
    const last = this._lastLaunch;
    if (!last) return false;
    this.sim.launch(last.def, last.tx, last.ty, last.seed);
    return true;
  }

  /** A click in the sky at world (x, y): fires the current shell there and tells the driver. */
  fireAt(x: number, y: number): number {
    this._driver.onUserFire(this);
    return this.fire(this.shell, x, y);
  }

  /** Holds automatic firing for one `shellDuration` of the current shell (preset load). */
  holdAutoFire(): void {
    this._driver.hold(this.sim.shellDuration(this.shell));
  }

  /** Clear sky: drops every particle and shell in flight. Mode timers keep running. */
  clear(): void {
    this.sim.clear();
  }

  /**
   * One rendered frame: clamps dt, updates the fps average, lets the driver fire, then runs fixed
   * steps. Returns the number of steps taken. If the cap is hit, the leftover time is dropped.
   */
  frame(deltaMS: number): number {
    const dt = Math.min(this.maxFrameDt, deltaMS / 1000);
    this.fpsAvg = this.fpsAvg * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    this._driver.tick(this, dt);

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < this.maxSteps) {
      this.sim.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0;
    return steps;
  }
}
