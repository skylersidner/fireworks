import type { Pattern } from '../model/enums';
import type { Rng } from './rng';

export type Direction = [dx: number, dy: number];

/**
 * Unit-ish burst directions for `n` stars (prototype `directions`). Draws from `rng` in exactly
 * the prototype's order, so the shell stream stays in step. Unknown patterns fall through to
 * peony, as in the prototype.
 */
export function directions(pattern: Pattern, n: number, rng: Rng): Direction[] {
  const out: Direction[] = [];
  if (pattern === 'ring') {
    const tilt = 0.25 + rng() * 0.9;
    const roll = rng() * Math.PI;
    const ct = Math.cos(tilt);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = Math.cos(a);
      const y = Math.sin(a) * ct;
      out.push([x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)]);
    }
  } else if (pattern === 'palm') {
    const off = rng() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const m = 0.8 + rng() * 0.2;
      out.push([Math.cos(a) * m, Math.sin(a) * m]);
    }
  } else if (pattern === 'heart') {
    const roll = (rng() - 0.5) * 0.4;
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2;
      const hx = (16 * Math.sin(t) ** 3) / 17;
      const hy =
        -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
      out.push([
        hx * Math.cos(roll) - hy * Math.sin(roll),
        hx * Math.sin(roll) + hy * Math.cos(roll),
      ]);
    }
  } else {
    // peony: Fibonacci sphere, randomly rotated, projected to 2D
    const ax = rng() * Math.PI * 2;
    const ca = Math.cos(ax);
    const sa = Math.sin(ax);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const off = rng() * 6.28;
    for (let k = 0; k < n; k++) {
      const z = 1 - (2 * (k + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      const phi = off + k * golden;
      const x = r * Math.cos(phi);
      const y = r * Math.sin(phi);
      const y2 = y * ca - z * sa;
      const j = 0.94 + rng() * 0.12;
      out.push([x * j, y2 * j]);
    }
  }
  return out;
}
