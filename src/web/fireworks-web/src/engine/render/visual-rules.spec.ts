// @vitest-environment node
import { E_STROBE, K_EMBER, K_FLASH, K_GLITTER, K_HEAD, K_POP, K_STAR } from '../sim/kinds';
import { ParticleStore } from '../sim/particle-store';
import { screenToWorld, worldScale, worldWidthFor } from './coordinates';
import { particleVisual, type ParticleVisual } from './visual-rules';

const out = (): ParticleVisual => ({ alpha: -1, px: -1, color: -1 });

describe('particleVisual (prototype sync rules)', () => {
  it('a pop with negative age is counted but drawn with alpha 0 (2a.12)', () => {
    const P = new ParticleStore(2);
    P.spawn(K_POP, 0, 0, 0, 0, 0.1, { age: -0.2, c1: 0xffe3a0 });
    expect(P.n).toBe(1);
    expect(particleVisual(P, 0, out())).toEqual({ alpha: 0, px: 1, color: 0xffe3a0 });
  });

  it('a star fades in over 0.04 s, then out over its last 25%, shrinking to 60%', () => {
    const P = new ParticleStore(3);
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.02, size: 2 });
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.5, size: 2 });
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.875, size: 2 });
    expect(particleVisual(P, 0, out()).alpha).toBeCloseTo(0.5, 6);
    expect(particleVisual(P, 1, out())).toMatchObject({ alpha: 1, px: 22 });
    const late = particleVisual(P, 2, out());
    expect(late.alpha).toBeCloseTo(0.5, 6);
    expect(late.px).toBeCloseTo(22 * 0.8, 5);
  });

  it('a star changes color at its change point', () => {
    const P = new ParticleStore(2);
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.5, c1: 1, c2: 2, change: 0.6 });
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.7, c1: 1, c2: 2, change: 0.6 });
    expect(particleVisual(P, 0, out()).color).toBe(1);
    expect(particleVisual(P, 1, out()).color).toBe(2);
  });

  it('strobe blinks to 6% only after 30% of life', () => {
    const P = new ParticleStore(2);
    // Before 30% of life: never blinks.
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.2, effect: E_STROBE, seed: 8 });
    // After: (age * 14 + (seed & 7)) % 2 = (7 + 0) % 2 = 1, which is the "off" half.
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.5, effect: E_STROBE, seed: 0 });
    expect(particleVisual(P, 0, out()).alpha).toBe(1);
    expect(particleVisual(P, 1, out()).alpha).toBeCloseTo(0.06, 6);
  });

  it('ember, glitter, flash and head sizes follow the prototype', () => {
    const P = new ParticleStore(4);
    P.spawn(K_EMBER, 0, 0, 0, 0, 1, { size: 1, alpha: 0.5 });
    P.spawn(K_GLITTER, 0, 0, 0, 0, 1, { size: 1 });
    P.spawn(K_FLASH, 0, 0, 0, 0, 1, { size: 2 });
    P.spawn(K_HEAD, 0, 0, 0, 0, 1, {});
    expect(particleVisual(P, 0, out())).toMatchObject({ alpha: 0.5, px: 6 });
    expect(particleVisual(P, 1, out()).px).toBe(5);
    expect(particleVisual(P, 2, out())).toMatchObject({ alpha: 0.9, px: 280 });
    expect(particleVisual(P, 3, out())).toMatchObject({ alpha: 1, px: 13 });
  });
});

describe('Reduce flashing (designer-2c.md §7.1; renderer only)', () => {
  it('strobe stars stay steady: the "off" half of the blink renders at full alpha', () => {
    const P = new ParticleStore(1);
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.5, effect: E_STROBE, seed: 0 });
    expect(particleVisual(P, 0, out(), false).alpha).toBeCloseTo(0.06, 6);
    expect(particleVisual(P, 0, out(), true).alpha).toBe(1);
  });

  it('the burst flash peaks at 0.3 and 100 px per size', () => {
    const P = new ParticleStore(1);
    P.spawn(K_FLASH, 0, 0, 0, 0, 1, { size: 2 });
    expect(particleVisual(P, 0, out(), false)).toMatchObject({ alpha: 0.9, px: 280 });
    expect(particleVisual(P, 0, out(), true)).toMatchObject({ alpha: 0.3, px: 200 });
  });

  it('glitter flickers between 1 and 0.5 instead of 1 and 0.15', () => {
    const P = new ParticleStore(400);
    for (let k = 0; k < 400; k++) P.spawn(K_GLITTER, 0, 0, 0, 0, 10, { age: k * 0.013, seed: k });
    const lows = (flag: boolean) => {
      const seen = new Set<number>();
      for (let i = 0; i < P.n; i++) {
        const v = particleVisual(P, i, out(), flag);
        seen.add(Math.round((v.alpha / (1 - P.age[i] / P.life[i])) * 100) / 100);
      }
      return [...seen].sort();
    };
    expect(lows(false)).toEqual([0.15, 1]);
    expect(lows(true)).toEqual([0.5, 1]);
  });

  it('every other kind looks the same with the flag on', () => {
    const P = new ParticleStore(4);
    P.spawn(K_EMBER, 0, 0, 0, 0, 1, { size: 1, alpha: 0.5, age: 0.2 });
    P.spawn(K_POP, 0, 0, 0, 0, 1, { size: 1, age: 0.2 });
    P.spawn(K_HEAD, 0, 0, 0, 0, 1, {});
    P.spawn(K_STAR, 0, 0, 0, 0, 1, { age: 0.5 });
    for (let i = 0; i < P.n; i++) {
      expect(particleVisual(P, i, out(), true)).toEqual(particleVisual(P, i, out(), false));
    }
  });
});

describe('coordinates (2b.8)', () => {
  it('scale is the CSS height over 800, and world width follows the aspect', () => {
    expect(worldScale(400)).toBe(0.5);
    expect(worldWidthFor(1000, 400)).toBe(2000);
  });

  it('screenToWorld subtracts the stage offset and divides by scale; DPR never enters', () => {
    // A stage at (340, 50), 600 CSS px tall (scale 0.75), on a DPR-2 screen: the backing
    // store is 2x, but client coordinates and the rect are CSS pixels.
    const rect = { left: 340, top: 50 };
    const scale = worldScale(600);
    expect(screenToWorld(340 + 300, 50 + 150, rect, scale)).toEqual({ x: 400, y: 200 });
    expect(screenToWorld(340, 50, rect, scale)).toEqual({ x: 0, y: 0 });
  });
});
