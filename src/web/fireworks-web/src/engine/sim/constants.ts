/**
 * World constants (prototypes/fireworks-prototype.html, `WORLD_H`, `GROUND`, `STEP`, `CAP`).
 * World units: a fixed 800-unit height, width follows the aspect ratio (OQ5).
 */
export const WORLD_H = 800;
export const GROUND = 760;
/** Fixed simulation step, seconds. */
export const STEP = 1 / 120;
/** Particle capacity. `spawn` returns -1 once it is reached. */
export const CAP = 40000;
/** Clicks closer than this to the ground are ignored (prototype pointerdown handler). */
export const MIN_CLICK_HEIGHT = 60;

/** Base launch seed and stride: launch n gets `(BASE_SEED + n * SEED_STRIDE) | 0`. */
export const BASE_SEED = 20261112;
export const SEED_STRIDE = 7919;
