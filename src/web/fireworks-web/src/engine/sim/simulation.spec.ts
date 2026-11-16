// @vitest-environment node
import { PATTERNS } from '../model/enums';
import { PRESETS } from '../model/presets';
import { newShell } from '../model/shell';
import { CAP, GROUND, STEP } from './constants';
import { E_CRACKLE, E_CROSSETTE, E_NONE, K_EMBER, K_POP, K_STAR } from './kinds';
import { ParticleStore } from './particle-store';
import { directions } from './patterns';
import { launchSeed, mulberry32, mulberry32Stateful } from './rng';
import { FireworksSim } from './simulation';

describe('rng', () => {
  it('mulberry32 is the prototype generator (first draws for seed 1)', () => {
    const r = mulberry32(1);
    // Reference values of the canonical mulberry32 for seed 1.
    expect(r()).toBeCloseTo(0.6270739405881613, 15);
    expect(r()).toBeCloseTo(0.002735721180215478, 15);
  });

  it('launch n uses (20261112 + n * 7919) | 0', () => {
    expect(launchSeed(0)).toBe(20261112);
    expect(launchSeed(1)).toBe(20261112 + 7919);
    expect(launchSeed(300000)).toBe((20261112 + 300000 * 7919) | 0);
  });
});

describe('directions (2a.10)', () => {
  for (const pattern of PATTERNS) {
    it.each([1, 4, 120, 400])(`${pattern} returns exactly %i vectors`, (n) => {
      const out = directions(pattern, n, mulberry32(42));
      expect(out).toHaveLength(n);
      expect(out.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    });
  }

  it('ring vectors are unit-ish ellipse points; palm magnitudes are 0.8..1', () => {
    for (const [x, y] of directions('palm', 50, mulberry32(3))) {
      expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const [x, y] of directions('ring', 50, mulberry32(3))) {
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('ParticleStore', () => {
  it('spawn at the cap returns -1, never throws, and leaves the arrays consistent (2a.13)', () => {
    const P = new ParticleStore(8);
    for (let k = 0; k < 8; k++) expect(P.spawn(K_STAR, k, 0, 0, 0, 1, {})).toBe(k);
    expect(P.spawn(K_STAR, 99, 0, 0, 0, 1, {})).toBe(-1);
    expect(P.n).toBe(8);
    expect(Array.from(P.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('kill swap-removes: the last particle moves into the slot, every field with it', () => {
    const P = new ParticleStore(4);
    P.spawn(K_STAR, 1, 1, 0, 0, 1, { c1: 0x111111, seed: 5, effect: E_CRACKLE, gen: 0 });
    P.spawn(K_EMBER, 2, 2, 0, 0, 2, { c1: 0x222222, seed: 6, effect: E_NONE, gen: 1 });
    P.kill(0);
    expect(P.n).toBe(1);
    expect([P.x[0], P.kind[0], P.c1[0], P.seed[0], P.gen[0], P.life[0]]).toEqual([
      2,
      K_EMBER,
      0x222222,
      6,
      1,
      2,
    ]);
  });

  it('spawn defaults follow the prototype', () => {
    const P = new ParticleStore(1);
    P.spawn(K_STAR, 0, 0, 0, 0, 1, {});
    expect([P.age[0], P.drag[0], P.grav[0], P.size[0], P.change[0], P.alpha[0]]).toEqual([
      0, 0, 1, 1, 2, 1,
    ]);
    expect([P.c1[0], P.c2[0], P.seed[0]]).toEqual([0xffffff, 0xffffff, 1]);
  });

  // T7.3 (testing strategy §3 item 7): the property doesn't depend on capacity, so regular runs it
  // at 2,500; the 40k run is in simulation.daily.spec.ts, and the 40k default is pinned here.
  it('the default capacity is 40,000 (CAP)', () => {
    expect(CAP).toBe(40_000);
    expect(new FireworksSim().particles.capacity).toBe(CAP);
  });

  it('a sim under sustained load never exceeds its capacity, and every live index has age < life', () => {
    const cap = 2500;
    const sim = new FireworksSim({ capacity: cap });
    const willow = newShell('w', {
      breaks: [{ stars: 400, trail: 'glitter', burn: 5, drag: 1.5 }],
    });
    let peak = 0;
    for (let s = 0; s < 1200; s++) {
      if (s % 10 === 0) sim.launch(willow, 200 + (s % 800), 300, s);
      sim.step(STEP);
      peak = Math.max(peak, sim.particles.n);
      expect(sim.particles.n).toBeLessThanOrEqual(cap);
    }
    expect(peak).toBe(cap);
    const P = sim.particles;
    for (let i = 0; i < P.n; i++) {
      if (!(P.age[i] < P.life[i]))
        throw new Error(`index ${i}: age ${P.age[i]} >= life ${P.life[i]}`);
    }
  });
});

describe('star effects on death', () => {
  /** A sim holding one star that dies on the next step. */
  function dyingStar(effect: number, gen: number) {
    const sim = new FireworksSim();
    sim.particles.spawn(K_STAR, 500, 300, 10, -5, STEP / 2, {
      effect,
      gen,
      c1: 0x3dff6e,
      c2: 0x3dff6e,
      drag: 1,
      size: 1.2,
      seed: 12345,
    });
    sim.step(STEP);
    return sim;
  }

  it('crossette gen 0 splits into exactly 4 gen-1 stars plus 1 pop (2a.11)', () => {
    const sim = dyingStar(E_CROSSETTE, 0);
    const P = sim.particles;
    const stars = [];
    let pops = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.kind[i] === K_STAR) stars.push(i);
      if (P.kind[i] === K_POP) pops++;
    }
    expect(P.n).toBe(5);
    expect(stars).toHaveLength(4);
    expect(pops).toBe(1);
    for (const i of stars) {
      expect(P.gen[i]).toBe(1);
      expect(P.effect[i]).toBe(E_NONE);
    }
  });

  it('a gen-1 crossette star does not split again (the gen guard)', () => {
    expect(dyingStar(E_CROSSETTE, 1).particles.n).toBe(0);
  });

  it('crossette children never split, run to the end', () => {
    const sim = dyingStar(E_CROSSETTE, 0);
    for (let s = 0; s < 240; s++) sim.step(STEP);
    expect(sim.particles.n).toBe(0);
  });

  it('crackle yields 3..7 pops, each born with age in (-0.3, 0] (2a.12)', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      const sim = new FireworksSim();
      sim.particles.spawn(K_STAR, 500, 300, 0, 0, STEP / 2, { effect: E_CRACKLE, seed });
      sim.step(STEP);
      const P = sim.particles;
      expect(P.n).toBeGreaterThanOrEqual(3);
      expect(P.n).toBeLessThanOrEqual(7);
      seen.add(P.n);
      for (let i = 0; i < P.n; i++) {
        expect(P.kind[i]).toBe(K_POP);
        expect(P.age[i]).toBeGreaterThan(-0.3);
        expect(P.age[i]).toBeLessThanOrEqual(0);
      }
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    // Negative ages exist (the pops wait before showing).
    const sim = new FireworksSim();
    sim.particles.spawn(K_STAR, 500, 300, 0, 0, STEP / 2, { effect: E_CRACKLE, seed: 9 });
    sim.step(STEP);
    expect(Array.from(sim.particles.age.subarray(0, sim.particles.n)).some((a) => a < 0)).toBe(
      true,
    );
  });
});

describe('FireworksSim', () => {
  it('launch bursts at the target height regardless of gravity (ballistic)', () => {
    for (const gravity of [40, 160, 400]) {
      const sim = new FireworksSim({ sky: { gravity, wind: 0 } });
      const def = newShell('t', { angleJitter: 0 });
      sim.launch(def, 640, 300, 1);
      let flashY: number | null = null;
      for (let s = 0; s < 2000 && flashY === null; s++) {
        sim.step(STEP);
        const P = sim.particles;
        for (let i = 0; i < P.n; i++) if (P.kind[i] === 4) flashY = P.y[i];
      }
      expect(flashY).not.toBeNull();
      expect(Math.abs(flashY! - 300)).toBeLessThan(gravity / 40 + 2);
    }
  });

  it('clear drops every shell and particle', () => {
    const sim = new FireworksSim();
    sim.launch(newShell('t'), 640, GROUND - 0.65 * GROUND, 1);
    for (let s = 0; s < 100; s++) sim.step(STEP);
    expect(sim.shellCount).toBe(1);
    sim.clear();
    expect([sim.shellCount, sim.particles.n]).toEqual([0, 0]);
  });

  it('launch snapshots the definition, so later edits do not change a shell in flight', () => {
    const sim = new FireworksSim();
    const def = newShell('t', { breaks: [{ stars: 50 }] });
    sim.launch(def, 640, 400, 1);
    def.breaks[0].stars = 400;
    for (let s = 0; s < 600; s++) sim.step(STEP);
    const twin = new FireworksSim();
    twin.launch(newShell('t', { breaks: [{ stars: 50 }] }), 640, 400, 1);
    for (let s = 0; s < 600; s++) twin.step(STEP);
    expect(sim.particles.n).toBe(twin.particles.n);
  });

  it('defaultTarget centers on the width at the burst height', () => {
    const sim = new FireworksSim();
    expect(sim.defaultTarget(newShell('t', { burstHeight: 0.5 }), 1000)).toEqual([500, 380]);
  });
});

describe('environment (2a.17)', () => {
  it('engine specs run without a DOM (the @vitest-environment node docblock is honored)', () => {
    // Negative control, recorded: without the docblock this file runs under jsdom and this fails.
    const g = globalThis as { document?: unknown; window?: unknown };
    expect(typeof g.document).toBe('undefined');
    expect(typeof g.window).toBe('undefined');
  });
});

describe('snapshot and restore (TimelineDriver checkpoints)', () => {
  function state(sim: FireworksSim) {
    const P = sim.particles;
    const cut = (a: ArrayLike<number>) => Array.from(a).slice(0, P.n);
    return [
      P.n,
      sim.shellCount,
      sim.simTime,
      cut(P.x),
      cut(P.y),
      cut(P.vx),
      cut(P.age),
      cut(P.seed),
      cut(P.emit),
      cut(P.kind),
    ];
  }

  it('mulberry32Stateful is the mulberry32 stream, bit for bit, and its state restores', () => {
    for (const seed of [0, 1, -1, 2147483647, -2147483648, 20261112]) {
      const a = mulberry32(seed);
      const b = mulberry32Stateful(seed);
      for (let i = 0; i < 1000; i++) expect(b()).toBe(a());
      const copy = mulberry32Stateful(b.state[0]);
      for (let i = 0; i < 10; i++) expect(copy()).toBe(b());
    }
  });

  it('restore(snapshot()) then N steps equals N steps, mid-burst, with multi-break shells in flight', () => {
    const run = (cut: boolean) => {
      const sim = new FireworksSim();
      PRESETS.forEach((p, i) => sim.launch(p, 100 + i * 100, 300, launchSeed(i)));
      for (let i = 0; i < 400; i++) sim.step(STEP);
      if (cut) {
        const snap = sim.snapshot();
        for (let i = 0; i < 50; i++) sim.step(STEP); // wander off, then come back
        sim.launch(PRESETS[2], 50, 50, 9);
        sim.restore(snap);
      }
      for (let i = 0; i < 600; i++) sim.step(STEP);
      return state(sim);
    };
    expect(run(true)).toEqual(run(false));
  });

  it('a snapshot is a copy: stepping after it never changes it', () => {
    const sim = new FireworksSim();
    sim.launch(PRESETS[0], 640, 300, 1);
    for (let i = 0; i < 350; i++) sim.step(STEP);
    const snap = sim.snapshot();
    const before = structuredClone(snap);
    for (let i = 0; i < 100; i++) sim.step(STEP);
    expect(snap).toEqual(before);
  });

  it('refuses a snapshot from a smaller-capacity or different store', () => {
    const big = new FireworksSim({ capacity: 5000 });
    big.launch(PRESETS[1], 640, 300, 1);
    for (let i = 0; i < 400; i++) big.step(STEP);
    expect(() => new FireworksSim({ capacity: 10 }).restore(big.snapshot())).toThrow(
      /different store/,
    );
  });
});
