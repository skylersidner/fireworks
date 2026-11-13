/**
 * The single TypeScript source for value ranges (plan 2a). Numeric ranges and steps are the
 * prototype's slider ranges (prototypes/fireworks-prototype.html, `buildShellFields`,
 * `buildBreakFields`, `buildWorldFields`); the structural limits come from plan §3.3. The Phase 3
 * schema doc and the C# validator must agree with this file.
 */
export interface NumericRange {
  readonly min: number;
  readonly max: number;
  /** Slider step. */
  readonly step: number;
  /** Values are rounded to whole numbers. */
  readonly integer?: boolean;
}

export const SHELL_LIMITS = {
  burstHeight: { min: 0.3, max: 0.85, step: 0.01 },
  angleJitter: { min: 0, max: 20, step: 1 },
} as const satisfies Record<string, NumericRange>;

export const BREAK_LIMITS = {
  stars: { min: 4, max: 400, step: 1, integer: true },
  speed: { min: 60, max: 400, step: 5 },
  changeAt: { min: 0.1, max: 0.95, step: 0.05 },
  burn: { min: 0.3, max: 5, step: 0.1 },
  drag: { min: 0, max: 4, step: 0.05 },
  size: { min: 0.4, max: 3, step: 0.05 },
  delay: { min: 0.1, max: 2.5, step: 0.05 },
} as const satisfies Record<string, NumericRange>;

export const SKY_LIMITS = {
  gravity: { min: 40, max: 400, step: 5 },
  wind: { min: -80, max: 80, step: 1 },
} as const satisfies Record<string, NumericRange>;

export const QUALITY_LIMITS = {
  persistence: { min: 0, max: 0.92, step: 0.01 },
  starBudget: { min: 0.25, max: 1, step: 0.05 },
} as const satisfies Record<string, NumericRange>;

export const NAME_MAX_LENGTH = 80;
export const MIN_BREAKS = 1;
export const MAX_BREAKS = 4;

/** ShowDocument v1 (docs/fireworks-app/schema.md §4, §5). Steps are the Show Builder's (Phase 6). */
export const SHOW_LIMITS = {
  duration: { min: 1, max: 600, step: 1 },
} as const satisfies Record<string, NumericRange>;

/**
 * Cue ranges. `t.max` is the show's `duration` when that is valid, otherwise `SHOW_LIMITS.duration.max`
 * (schema.md §6.2.8). `seed` is int32 and is never rounded or clamped, in either mode.
 */
export const CUE_LIMITS = {
  t: { min: 0, max: SHOW_LIMITS.duration.max, step: 0.05 },
  x: { min: 0, max: 1, step: 0.01 },
  burstHeight: SHELL_LIMITS.burstHeight,
  seed: { min: -2147483648, max: 2147483647, step: 1, integer: true },
} as const satisfies Record<string, NumericRange>;

/** An empty show is invalid (Skyler, 2026-11-13): `cues: []` is a `cue-count` error. */
export const MIN_SHOW_CUES = 1;
export const MAX_SHOW_CUES = 1000;
export const MIN_SHOW_SHELLS = 0;
export const MAX_SHOW_SHELLS = 32;

/** Show shell keys and cue ids. The leading letter also rules out `__proto__`. */
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,11}$/;

/** One row of the schema.md §5.1 table / `schema/limits.json`. */
export interface SchemaLimitRow {
  readonly min: number;
  readonly max: number | 'show.duration';
  readonly integer: boolean;
}

function row(range: NumericRange, max?: 'show.duration'): SchemaLimitRow {
  return { min: range.min, max: max ?? range.max, integer: range.integer === true };
}

/**
 * Every schema limit in the schema.md §5.1 key form, derived from the constants above (so changing
 * a constant changes this). `limits.spec.ts` checks it against `schema/limits.json` and the table.
 */
export const SCHEMA_LIMIT_ROWS: Readonly<Record<string, SchemaLimitRow>> = {
  'shell.burstHeight': row(SHELL_LIMITS.burstHeight),
  'shell.angleJitter': row(SHELL_LIMITS.angleJitter),
  'break.stars': row(BREAK_LIMITS.stars),
  'break.speed': row(BREAK_LIMITS.speed),
  'break.changeAt': row(BREAK_LIMITS.changeAt),
  'break.burn': row(BREAK_LIMITS.burn),
  'break.drag': row(BREAK_LIMITS.drag),
  'break.size': row(BREAK_LIMITS.size),
  'break.delay': row(BREAK_LIMITS.delay),
  'sky.gravity': row(SKY_LIMITS.gravity),
  'sky.wind': row(SKY_LIMITS.wind),
  'shell.name.codePoints': { min: 1, max: NAME_MAX_LENGTH, integer: true },
  'shell.breaks.count': { min: MIN_BREAKS, max: MAX_BREAKS, integer: true },
  'show.duration': row(SHOW_LIMITS.duration),
  'show.shells.count': { min: MIN_SHOW_SHELLS, max: MAX_SHOW_SHELLS, integer: true },
  'show.cues.count': { min: MIN_SHOW_CUES, max: MAX_SHOW_CUES, integer: true },
  'cue.t': row(CUE_LIMITS.t, 'show.duration'),
  'cue.x': row(CUE_LIMITS.x),
  'cue.burstHeight': row(CUE_LIMITS.burstHeight),
  'cue.seed': row(CUE_LIMITS.seed),
};
