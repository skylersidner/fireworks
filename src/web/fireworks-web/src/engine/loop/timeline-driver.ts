import type { PlaybackContext, PlaybackDriver } from './playback-driver';

/** A show cue (plan §3.3 ShowDocument). Shape is provisional until the Phase 3 schema freeze. */
export interface TimelineCue {
  readonly id: string;
  /** Seconds of simulation time from show start. */
  readonly t: number;
  readonly shell: string;
  /** Fraction of the world width. */
  readonly x: number;
  /** Absent means the shell's own `burstHeight` (schema.md §4.3); never `null`. */
  readonly burstHeight?: number;
  readonly seed: number;
}

/**
 * STUB for Phase 6 (Show Builder; design owned by Yoshi). Cues will be scheduled in simulation
 * time, never wall-clock time (plan §3.2 item 5), each with its own seed. Today it never fires,
 * and the designer never uses it.
 */
export class TimelineDriver implements PlaybackDriver {
  readonly mode = 'timeline';

  constructor(readonly cues: readonly TimelineCue[] = []) {}

  tick(_ctx: PlaybackContext, _dt: number): void {}

  onUserFire(_ctx: PlaybackContext): void {}

  hold(_seconds: number): void {}
}
