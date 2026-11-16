import { BREAK_LIMITS, MAX_BREAKS, SHELL_LIMITS, SKY_LIMITS } from '../model/limits';
import type { BreakDef } from '../model/shell';
import { embeddedShell } from '../model/show';
import { GROUND, STEP } from './constants';

/**
 * Upper bounds on how long a launch leaves anything alive (schema.md §4.5, §13). Every constant
 * here mirrors a lifetime in `simulation.ts`; change one there and this file must follow
 * (`lifetime.spec.ts` checks the bound against real runs).
 */

/** Rising embers live at most 0.25 + 0.35 s past the rocket's last rising step. */
const RISE_EMBER_LIFE = 0.6;
/** A star lives `burn * (0.88 + r * 0.24)`, so under `burn * 1.12`. */
const STAR_LIFE_FACTOR = 1.12;
/**
 * The longest thing a star leaves after it dies: a crossette child (≤ 1.1 s) whose glitter trail
 * outlives it by ≤ 1.1 s. Crackle pops (≤ 0.43 s) and tail embers (≤ 0.55 s) are shorter.
 */
const STAR_AFTERLIFE = 2.2;
/** Slack for step quantization: each break can burst up to one step late, plus float32 ages. */
const SLACK_STEPS = MAX_BREAKS + 2;

/** Seconds from launch to the rocket's first break, at `burstHeight` (a fraction of 760) and `gravity`. */
export function riseSeconds(burstHeight: number, gravity: number): number {
  const h = Math.max(60, burstHeight * GROUND);
  return Math.sqrt((2 * h) / gravity);
}

/**
 * Seconds after its launch by which a shell has nothing left alive: no rocket, no star, no child.
 * An upper bound, not an estimate; the timeline can draw the tail from it before playing.
 * Holds below the 40k particle cap and above it (a full store only spawns fewer particles).
 */
export function shellLifetimeBound(
  shell: { readonly breaks: readonly Pick<BreakDef, 'burn' | 'delay'>[] },
  burstHeight: number,
  gravity: number,
): number {
  let burstAt = riseSeconds(burstHeight, gravity);
  let end = burstAt + RISE_EMBER_LIFE;
  shell.breaks.forEach((b, k) => {
    if (k) burstAt += Math.max(0.1, b.delay);
    end = Math.max(end, burstAt + b.burn * STAR_LIFE_FACTOR + STAR_AFTERLIFE);
  });
  return end + SLACK_STEPS * STEP;
}

/**
 * The bound at the current limits: lowest gravity, highest burst, four breaks at the longest delay
 * and burn. About 21 s (§13): 5.68 rise + 7.5 delays + 5.6 burn + 2.2 afterlife + slack.
 */
export const MAX_SHELL_LIFETIME = shellLifetimeBound(
  {
    breaks: Array.from({ length: MAX_BREAKS }, () => ({
      burn: BREAK_LIMITS.burn.max,
      delay: BREAK_LIMITS.delay.max,
    })),
  },
  SHELL_LIMITS.burstHeight.max,
  SKY_LIMITS.gravity.min,
);

/** Launch, burst and end times of one cue, in show seconds (design phase-6.md §7.1, §7.3). */
export interface CueTimes {
  /** The cue's `t`: the shell leaves the ground. */
  readonly launch: number;
  /** Each break's burst, in order: `launch + rise`, then `+ max(0.1, delay_k)` per later break. */
  readonly bursts: readonly number[];
  /** Rosalina's "Ends about" estimate for this cue (§7.3), capped at `endBound`. */
  readonly endEstimate: number;
  /** A hard upper bound on when this cue has nothing alive (`shellLifetimeBound`). */
  readonly endBound: number;
}

type TimedShell = {
  readonly burstHeight: number;
  readonly breaks: readonly Pick<BreakDef, 'burn' | 'delay' | 'effect' | 'trail'>[];
};

/** Afterlife added to the estimate when any break leaves crossette children or glitter. */
const ESTIMATE_CHILD_TAIL = 2.2;

/**
 * The times the timeline draws for a cue, under the show's `gravity` (wind doesn't change them).
 * `burstHeight` is the cue's when set, else the shell's (§4.3). Bursts can land up to a step
 * later than these in the sim (step quantization); the estimate is shellDuration's formula plus
 * the child tail, and is labelled "about".
 */
export function cueTimes(
  cue: { readonly t: number; readonly burstHeight?: number },
  shell: TimedShell,
  gravity: number,
): CueTimes {
  const bh = cue.burstHeight ?? shell.burstHeight;
  const bursts: number[] = [];
  let at = cue.t + riseSeconds(bh, gravity);
  shell.breaks.forEach((b, k) => {
    if (k) at += Math.max(0.1, b.delay);
    bursts.push(at);
  });
  const children = shell.breaks.some((b) => b.effect === 'crossette' || b.trail === 'glitter');
  const endBound = cue.t + shellLifetimeBound(shell, bh, gravity);
  // §7.3 adds the longest burn to the last burst, which can pass the hard bound when an early
  // break burns longest; nothing outlives the bound, so the estimate never exceeds it.
  const formula =
    at +
    Math.max(...shell.breaks.map((b) => b.burn)) * 1.1 +
    0.4 +
    (children ? ESTIMATE_CHILD_TAIL : 0);
  return { launch: cue.t, bursts, endEstimate: Math.min(formula, endBound), endBound };
}

/**
 * "Ends about" for a whole show (design phase-6.md §7.3): the latest cue estimate. 0 for no cues.
 * Cues naming a missing shell are skipped (the validator rejects that document anyway).
 */
export function estimateShowEnd(show: {
  readonly sky: { readonly gravity: number };
  readonly shells: Readonly<Record<string, TimedShell>>;
  readonly cues: readonly {
    readonly t: number;
    readonly shell: string;
    readonly burstHeight?: number;
  }[];
}): number {
  let end = 0;
  for (const cue of show.cues) {
    const shell = embeddedShell(show, cue.shell);
    if (!shell) continue;
    end = Math.max(end, cueTimes(cue, shell, show.sky.gravity).endEstimate);
  }
  return end;
}
