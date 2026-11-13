import type { Graphics } from 'pixi.js';
import { GROUND } from '../sim/constants';
import { mulberry32 } from '../sim/rng';

/**
 * The seeded city skyline (prototype `drawSkyline`): seed 7, so the same stage size always
 * draws the same skyline. `w`/`h` are CSS pixels; `scale` is CSS pixels per world unit.
 */
export function drawSkyline(skyline: Graphics, w: number, h: number, scale: number): void {
  skyline.clear();
  const rng = mulberry32(7);
  const base = GROUND * scale;
  let x = 0;
  while (x < w) {
    const bw = 30 + rng() * 70;
    const bh = 20 + rng() * 90 * (0.5 + 0.5 * Math.sin((x / w) * Math.PI));
    skyline.rect(x, base - bh * scale, bw, bh * scale + (h - base)).fill(0x070912);
    for (let wy = base - bh * scale + 8; wy < base - 6; wy += 11) {
      for (let wx = x + 6; wx < x + bw - 6; wx += 10) {
        if (rng() < 0.12)
          skyline.rect(wx, wy, 3, 4).fill({ color: 0xffd58a, alpha: 0.35 + rng() * 0.3 });
      }
    }
    x += bw + rng() * 6;
  }
  skyline.rect(0, base, w, h - base).fill(0x05070d);
}
