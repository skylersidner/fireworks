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
}
