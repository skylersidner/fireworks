import { BASE_SEED, SEED_STRIDE } from './constants';

export type Rng = () => number;

/** Seeded generator in [0, 1), bit for bit the prototype's `mulberry32`. */
export function mulberry32(seed: number): Rng {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One step of mulberry32 on a state held in an Int32Array slot (the per-particle `prand`
 * stream). Advances `state[i]` and returns the draw.
 */
export function mulberry32Step(state: Int32Array, i: number): number {
  const a = (state[i] = (state[i] + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A mulberry32 stream whose state is readable and settable (sim snapshots). */
export interface SeededRng {
  (): number;
  /** The whole generator state: one int32. Copy `state[0]` to snapshot, write it to restore. */
  readonly state: Int32Array;
}

/**
 * The same stream as `mulberry32(seed)`, bit for bit, with its state held in an Int32Array slot
 * (`mulberry32Step`): `ToInt32(seed)` is `seed | 0`, and the slot's store is the same `| 0`.
 */
export function mulberry32Stateful(seed: number): SeededRng {
  const state = new Int32Array(1);
  state[0] = seed;
  return Object.assign(() => mulberry32Step(state, 0), { state });
}

/** Seed of the n-th launch from a base seed (prototype `fire`: `baseSeed + launchCount++ * 7919`). */
export function launchSeed(n: number, baseSeed: number = BASE_SEED): number {
  return (baseSeed + n * SEED_STRIDE) | 0;
}
