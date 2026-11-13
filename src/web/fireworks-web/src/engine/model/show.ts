import type { ShellDocument, SkySettings } from './shell';

/** ShowDocument v1 (docs/fireworks-app/schema.md §4). Built in Phase 6; the schema is frozen now. */
export const SHOW_VERSION = 1;

/** A shell inside a show: a ShellDocument v1 without `sky` (the show's `sky` wins, §4.1). */
export type EmbeddedShell = Omit<ShellDocument, 'sky'>;

/** schema.md §4.3. `t` is the launch time (Skyler, 2026-11-13). */
export interface ShowCue {
  id: string;
  /** Launch time, seconds of simulation time from show start. */
  t: number;
  /** An own key of the show's `shells`. */
  shell: string;
  /** Fraction of the world width (OQ5). */
  x: number;
  /** Absent means the shell's own `burstHeight`. Never `null` in a stored document. */
  burstHeight?: number;
  /** int32, assigned once when the cue is created. */
  seed: number;
}

export interface ShowDocument {
  version: 1;
  name: string;
  /** Required in a show, and the only sky a show plays under. */
  sky: SkySettings;
  duration: number;
  /**
   * Keyed by `KEY_PATTERN`. Built without a prototype (`Object.create(null)`) by `normalizeShow`;
   * test membership with `Object.hasOwn`, never `in` or a plain lookup.
   */
  shells: Record<string, EmbeddedShell>;
  cues: ShowCue[];
}

/** Steps per second of the fixed-step loop (`sim/constants.ts` `STEP` = 1/120). */
export const STEPS_PER_SECOND = 120;

/**
 * The step a cue fires before (schema.md §4.4 rule 2). Multiplies by the exact integer 120:
 * `t / STEP` can round differently at half-steps because 1/120 is inexact.
 */
export function cueFireStep(t: number): number {
  return Math.round(t * STEPS_PER_SECOND);
}

/** Ordinal string comparison (UTF-16 units, like C# `string.CompareOrdinal` on ASCII keys). */
export function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Cues in firing order: by `(fireStep, id)`, never array order (schema.md §4.4 rule 4), so
 * reordering, inserting or deleting cues never changes how the others play. Returns a new array.
 */
export function orderCues<C extends Pick<ShowCue, 't' | 'id'>>(cues: readonly C[]): C[] {
  return cues
    .map((cue) => ({ cue, step: cueFireStep(cue.t) }))
    .sort((a, b) => a.step - b.step || compareOrdinal(a.cue.id, b.cue.id))
    .map(({ cue }) => cue);
}
