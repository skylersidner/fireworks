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
