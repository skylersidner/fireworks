// @vitest-environment node
import { E_STROBE, K_EMBER, K_FLASH, K_GLITTER, K_HEAD, K_POP, K_STAR } from '../sim/kinds';
import { ParticleStore } from '../sim/particle-store';
import { screenToWorld, worldScale, worldWidthFor } from './coordinates';
import {
  FLASH_SPACING_SECONDS,
  FlashSpacing,
  particleVisual,
  type ParticleVisual,
} from './visual-rules';

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

describe('Reduce flashing flash spacing (phase-6.md §14.2)', () => {
  /** Draws with the renderer's rule: every flash when the flag is off, the gate's when on. */
  function drawnFlashes(P: ParticleStore, gate: FlashSpacing, simTime: number, flag: boolean) {
    if (flag) gate.update(P, simTime);
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.kind[i] === K_FLASH && (!flag || gate.drawn(P, i, simTime))) n++;
    }
    return n;
  }

  it('two flashes 0.2 s apart: one drawn with the flag on, two with it off', () => {
    for (const flag of [true, false]) {
      const P = new ParticleStore(4);
      const gate = new FlashSpacing();
      P.spawn(K_FLASH, 0, 0, 0, 0, 1, {});
      expect(drawnFlashes(P, gate, 1, flag)).toBe(1);
      for (let i = 0; i < P.n; i++) P.age[i] += 0.2;
      P.spawn(K_FLASH, 50, 0, 0, 0, 1, {});
      expect(drawnFlashes(P, gate, 1.2, flag)).toBe(flag ? 1 : 2);
    }
  });

  it('a flash 0.33 s or more after the last drawn one is drawn; the skipped one never counts', () => {
    const P = new ParticleStore(4);
    const gate = new FlashSpacing();
    P.spawn(K_FLASH, 0, 0, 0, 0, 2, {});
    gate.update(P, 1);
    for (let i = 0; i < P.n; i++) P.age[i] += 0.2;
    P.spawn(K_FLASH, 0, 0, 0, 0, 2, {});
    gate.update(P, 1.2);
    for (let i = 0; i < P.n; i++) P.age[i] += FLASH_SPACING_SECONDS - 0.2;
    P.spawn(K_FLASH, 0, 0, 0, 0, 2, {});
    const t = 1 + FLASH_SPACING_SECONDS;
    gate.update(P, t);
    expect([0, 1, 2].map((i) => gate.drawn(P, i, t))).toEqual([true, false, true]);
  });

  it('flashes on the same step are one flash in time; other kinds are never gated', () => {
    const P = new ParticleStore(4);
    const gate = new FlashSpacing();
    P.spawn(K_FLASH, 0, 0, 0, 0, 1, {});
    P.spawn(K_FLASH, 90, 0, 0, 0, 1, {});
    P.spawn(K_STAR, 0, 0, 0, 0, 1, {});
    gate.update(P, 3);
    expect([0, 1, 2].map((i) => gate.drawn(P, i, 3))).toEqual([true, true, true]);
  });

  it('sim time moving backward (a seek) forgets earlier decisions', () => {
    const P = new ParticleStore(2);
    const gate = new FlashSpacing();
    P.spawn(K_FLASH, 0, 0, 0, 0, 1, {});
    gate.update(P, 5);
    P.clear();
    P.spawn(K_FLASH, 0, 0, 0, 0, 1, {});
    gate.update(P, 5.1);
    expect(gate.drawn(P, 0, 5.1)).toBe(false);
    gate.update(P, 1);
    expect(gate.drawn(P, 0, 1)).toBe(true);
  });
});

// Toad, Phase 6 review: the brief's bound (at most 3 flashes a second with Reduce flashing on),
// on a dense stream, at real render rates, with the store's order shuffled every render.
describe('Reduce flashing flash spacing: the 3-per-second bound', () => {
  function run(spawnEvery: number, renderEvery: readonly number[], seed: number): number[] {
    let r = seed >>> 0;
    const rand = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const gate = new FlashSpacing();
    const starts: number[] = [];
    const drawn = new Set<number>();
    let next = 0;
    for (let step = 0, f = 0; step < 1200; f++) {
      step += renderEvery[f % renderEvery.length];
      while (next <= step) {
        starts.push(next);
        next += spawnEvery;
      }
      const simTime = step / 120;
      const live = starts.filter((s) => step - s < 0.16 * 120);
      for (let i = live.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [live[i], live[j]] = [live[j], live[i]];
      }
      const P = new ParticleStore(64);
      for (const s of live) P.spawn(K_FLASH, 0, 0, 0, 0, 1, { age: (step - s) / 120 });
      gate.update(P, simTime);
      for (let i = 0; i < P.n; i++) {
        if (gate.drawn(P, i, simTime)) drawn.add(Math.round((simTime - P.age[i]) * 120));
      }
    }
    return [...drawn].sort((a, b) => a - b);
  }

  it('never draws more than 3 flash starts in any 1 s window, whatever the frame rate', () => {
    for (const spawnEvery of [1, 3, 7, 13]) {
      for (const renderEvery of [[2], [5], [1, 4, 2], [8, 1]]) {
        const drawn = run(spawnEvery, renderEvery, spawnEvery * 31 + renderEvery[0]);
        expect(drawn.length).toBeGreaterThan(20);
        for (let i = 3; i < drawn.length; i++) {
          // At most 3 starts in any closed 1.000 s span (Rosalina): four drawn starts span more
          // than 120 steps, so starts at 0/40/80/120 (a spacing of 40) fail (Bowser).
          expect(drawn[i] - drawn[i - 3], `${spawnEvery}/${renderEvery}`).toBeGreaterThan(120);
        }
        for (let i = 1; i < drawn.length; i++) {
          expect(drawn[i] - drawn[i - 1]).toBeGreaterThanOrEqual(
            Math.ceil(FLASH_SPACING_SECONDS * 120),
          );
        }
      }
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
