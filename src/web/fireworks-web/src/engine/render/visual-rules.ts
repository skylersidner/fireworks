import { E_STROBE, K_EMBER, K_FLASH, K_GLITTER, K_POP, K_STAR } from '../sim/kinds';
import type { ParticleStore } from '../sim/particle-store';

/** Size in world units of a particle drawn at scale 1 is `px`; the glow texture is 64 px wide. */
export interface ParticleVisual {
  alpha: number;
  /** Diameter in world units. */
  px: number;
  color: number;
}

/**
 * Reduce flashing (designer-2c.md §7.1): burst flash peak alpha and diameter per unit size, and
 * the glitter alpha floor. Strobe stars simply skip the blink.
 */
export const REDUCED_FLASH_ALPHA = 0.3;
export const REDUCED_FLASH_PX = 100;
export const REDUCED_GLITTER_FLOOR = 0.5;

/**
 * Per-kind look of particle i (prototype `sync`, l.443-462): fade-in/out for stars, strobe
 * blink after 30% of life, glitter flicker, flash falloff, and alpha 0 for pops still waiting
 * (negative age). Pure: no Pixi, so it is specced without a DOM. Writes into `out` to avoid a
 * per-particle allocation.
 */
export function particleVisual(
  P: ParticleStore,
  i: number,
  out: ParticleVisual,
  reduceFlashing = false,
): ParticleVisual {
  const k = P.kind[i];
  const age = P.age[i];
  const t = age / P.life[i];
  if (age < 0) {
    out.alpha = 0;
    out.px = 1;
    out.color = P.c1[i];
  } else if (k === K_STAR) {
    let a = Math.min(1, age / 0.04) * (t > 0.75 ? (1 - t) / 0.25 : 1);
    if (!reduceFlashing && P.effect[i] === E_STROBE && t > 0.3)
      a *= (age * 14 + (P.seed[i] & 7)) % 2 < 1 ? 1 : 0.06;
    out.alpha = a;
    out.px = 11 * P.size[i] * (t > 0.75 ? 0.6 + (0.4 * (1 - t)) / 0.25 : 1);
    out.color = P.colorAt(i);
  } else if (k === K_EMBER) {
    out.alpha = P.alpha[i] * (1 - t) ** 1.5;
    out.px = 6 * P.size[i];
    out.color = P.c1[i];
  } else if (k === K_GLITTER) {
    const low = reduceFlashing ? REDUCED_GLITTER_FLOOR : 0.15;
    const fl = Math.sin((age + (P.seed[i] & 1023)) * 97.3) > 0.2 ? 1 : low;
    out.alpha = fl * (1 - t);
    out.px = 5 * P.size[i];
    out.color = P.c1[i];
  } else if (k === K_POP) {
    out.alpha = 1 - t;
    out.px = 12 * P.size[i];
    out.color = P.c1[i];
  } else if (k === K_FLASH) {
    out.alpha = (reduceFlashing ? REDUCED_FLASH_ALPHA : 0.9) * (1 - t) ** 2;
    out.px = (reduceFlashing ? REDUCED_FLASH_PX : 140) * P.size[i];
    out.color = P.c1[i];
  } else {
    // head
    out.alpha = 1;
    out.px = 13;
    out.color = P.c1[i];
  }
  return out;
}

const STEPS_PER_SECOND = 120;
/**
 * Reduce flashing flash spacing (phase-6.md §14.2): a drawn burst flash starts at least 41 steps
 * after the last drawn one. 41, not 40: at 40, starts at steps 0, 40, 80 and 120 put four flashes
 * inside one closed 1.000 s span; at 41 any four drawn starts span 123 steps.
 */
const FLASH_SPACING_STEPS = 41;
export const FLASH_SPACING_SECONDS = FLASH_SPACING_STEPS / STEPS_PER_SECOND;

/**
 * Under Reduce flashing, a burst flash (`K_FLASH`) is drawn only if no other drawn burst flash
 * started in the previous 41 steps (about 0.34 s) of sim time (phase-6.md §14.2, D5). Renderer only: the sim, every
 * count and the launch ledger are unchanged (`flashing-content-safety` rule 6).
 *
 * A flash is identified by the sim step it started on, `round((simTime - age) * 120)`, which is
 * stable across frames even though the store swap-removes. Flashes that start on the same step are
 * one flash in time (they light at the same instant), so they're drawn or skipped together. New
 * start steps are decided in ascending order, once each; a flash that lives and dies between two
 * renders was never drawn, so it never counts. Sim time moving backward (a seek or Replay) forgets
 * everything.
 */
export class FlashSpacing {
  private decided = new Map<number, boolean>();
  private lastDrawnStart = -Infinity;
  private lastSimTime = -Infinity;
  private readonly fresh: number[] = [];

  /** Call once per render, before `drawn`, with the sim's particles and `simTime`. */
  update(P: ParticleStore, simTime: number): void {
    if (simTime < this.lastSimTime) this.reset();
    this.lastSimTime = simTime;
    const fresh = this.fresh;
    fresh.length = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.kind[i] !== K_FLASH) continue;
      const start = startStep(P, i, simTime);
      if (!this.decided.has(start) && !fresh.includes(start)) fresh.push(start);
    }
    fresh.sort((a, b) => a - b);
    for (const start of fresh) {
      const draw = start - this.lastDrawnStart >= FLASH_SPACING_STEPS;
      if (draw) this.lastDrawnStart = start;
      this.decided.set(start, draw);
    }
    // A flash lives 0.16 s, so decisions older than a second can't be asked for again.
    const now = Math.round(simTime * STEPS_PER_SECOND);
    for (const start of this.decided.keys()) {
      if (start < now - STEPS_PER_SECOND) this.decided.delete(start);
    }
  }

  /** Whether flash particle `i` is drawn. Non-flash particles always are. */
  drawn(P: ParticleStore, i: number, simTime: number): boolean {
    if (P.kind[i] !== K_FLASH) return true;
    return this.decided.get(startStep(P, i, simTime)) ?? false;
  }

  reset(): void {
    this.decided = new Map();
    this.lastDrawnStart = -Infinity;
    this.lastSimTime = -Infinity;
  }
}

function startStep(P: ParticleStore, i: number, simTime: number): number {
  return Math.round((simTime - P.age[i]) * STEPS_PER_SECOND);
}
