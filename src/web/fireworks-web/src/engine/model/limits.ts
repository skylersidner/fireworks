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
