import type { Color1, Color2 } from './colors';
import type { Effect, Pattern, Trail } from './enums';
import { deepFreeze } from './freeze';

/** One break of a shell (plan §3.3). Ranges live in `limits.ts`. */
export interface BreakDef {
  pattern: Pattern;
  stars: number;
  speed: number;
  color1: Color1;
  color2: Color2;
  changeAt: number;
  burn: number;
  drag: number;
  size: number;
  trail: Trail;
  effect: Effect;
  /** Seconds after the previous break. Ignored for break 0. */
  delay: number;
}

/** Physics that change the trajectory, so they are saved with a shell (plan §3.2, OQ6). */
export interface SkySettings {
  gravity: number;
  wind: number;
}

/** Viewer/device settings. Never saved (plan §3.2). */
export interface QualitySettings {
  /** Motion-blur trail persistence, 0..0.92. Visual only. */
  persistence: number;
  /** Fraction of each break's stars actually spawned, 0.25..1. Changes RNG draws. */
  starBudget: number;
  /**
   * Photosensitivity setting (designer-2c.md §7.1). Renderer and Auto show only: strobe stops
   * blinking, burst flashes dim, glitter softens, Auto show launches at least 0.8 s apart. It never
   * reaches the sim, so a flip never moves a golden.
   */
  reduceFlashing: boolean;
}

/** ShellDocument v1 (plan §3.3). */
export interface ShellDocument {
  version: 1;
  name: string;
  /** Fraction of the ground height (760 units): the burst is at `GROUND - burstHeight * GROUND`. */
  burstHeight: number;
  angleJitter: number;
  /** Optional; `DEFAULT_SKY` applies when absent. */
  sky?: SkySettings;
  breaks: BreakDef[];
}

export const SHELL_VERSION = 1;

/** Name used when a document has no usable name (prototype JSON Apply: `parsed.name || 'Custom'`). */
export const FALLBACK_NAME = 'Custom';

// Every DEFAULT_* is deep-frozen (Yoshi L6): they are shared, so an in-place edit would change
// every later default. Spread or structuredClone them to get an editable copy.
export const DEFAULT_SKY: Readonly<SkySettings> = deepFreeze({ gravity: 160, wind: 0 });
export const DEFAULT_QUALITY: Readonly<QualitySettings> = deepFreeze({
  persistence: 0.78,
  starBudget: 1,
  reduceFlashing: false,
});

export const DEFAULT_BREAK: Readonly<BreakDef> = deepFreeze({
  pattern: 'peony',
  stars: 120,
  speed: 220,
  color1: 'red',
  color2: 'none',
  changeAt: 0.6,
  burn: 1.6,
  drag: 0.9,
  size: 1,
  trail: 'none',
  effect: 'none',
  delay: 0.6,
});

/**
 * The one default shell (Yoshi L3): prototype `newShell` values. `newShell` and `normalizeShell`
 * both read their defaults from here, so the two can't drift.
 */
export const DEFAULT_SHELL: Readonly<ShellDocument> = deepFreeze({
  version: 1,
  name: FALLBACK_NAME,
  burstHeight: 0.65,
  angleJitter: 4,
  breaks: [{ ...DEFAULT_BREAK }],
});

/** Prototype `newBreak`: defaults overlaid with `o`. */
export function newBreak(o: Partial<BreakDef> = {}): BreakDef {
  return { ...DEFAULT_BREAK, ...o };
}

export interface ShellOverrides extends Partial<Omit<ShellDocument, 'breaks' | 'version'>> {
  breaks?: Partial<BreakDef>[];
}

/** Prototype `newShell`: version 1, defaults, then `o`, with every break filled by `newBreak`. */
export function newShell(name: string, o: ShellOverrides = {}): ShellDocument {
  return {
    version: SHELL_VERSION,
    name,
    burstHeight: DEFAULT_SHELL.burstHeight,
    angleJitter: DEFAULT_SHELL.angleJitter,
    ...o,
    breaks: (o.breaks ?? [newBreak()]).map((b) => newBreak(b)),
  };
}

/**
 * The sky a shell plays under: its own `sky` block when it has one, otherwise `DEFAULT_SKY`.
 * `normalize` leaves an absent `sky` absent (so presets round-trip); callers resolve it here.
 */
export function effectiveSky(shell: Pick<ShellDocument, 'sky'>): SkySettings {
  return { ...(shell.sky ?? DEFAULT_SKY) };
}
