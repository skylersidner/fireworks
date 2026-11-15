import type { ShellDocument } from '../model/shell';
import type { FireworksSim } from '../sim/simulation';

/** What a driver may see and do. Implemented by `EngineLoop`. */
export interface PlaybackContext {
  readonly sim: FireworksSim;
  /** The shell the user is working on. */
  readonly shell: ShellDocument;
  /** Current world width in world units (follows the stage's aspect ratio). */
  worldWidth(): number;
  /** Fires `def` at world (tx, ty) with the next derived seed. Returns the seed. */
  fire(def: ShellDocument, tx: number, ty: number): number;
  /**
   * Fires `def` at world (tx, ty) with the caller's `seed`, without consuming the loop's launch
   * counter (a show cue carries its own seed, schema.md §4.4 rule 3).
   */
  fireSeeded(def: ShellDocument, tx: number, ty: number, seed: number): void;
}

/**
 * A playback mode (prototype `tick`'s mode block). Drivers decide *when* to fire; the loop owns
 * seeds and stepping. Timers count frame time (the clamped `dt`), as the prototype's `modeTimer`.
 */
export interface PlaybackDriver {
  readonly mode: string;
  /** Called once per frame, before the fixed steps, with the clamped frame time in seconds. */
  tick(ctx: PlaybackContext, dt: number): void;
  /** The user fired by hand (a click in the sky). */
  onUserFire(ctx: PlaybackContext): void;
  /** Hold off automatic firing for `seconds` (prototype: loading a preset sets `modeTimer`). */
  hold(seconds: number): void;
  /**
   * Called inside the fixed-step loop immediately before every `sim.step(STEP)`, so a driver can
   * fire on an exact step rather than at a frame boundary (schema.md §4.4 rule 3). A driver that
   * needs a step index counts these calls itself: the show clock starts at show start and resets
   * on seek, which the loop knows nothing about (yoshi-phase6-timeline-driver.md).
   */
  beforeStep?(ctx: PlaybackContext): void;
}
