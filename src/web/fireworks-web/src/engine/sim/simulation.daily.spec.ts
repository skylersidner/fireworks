// @vitest-environment node
/**
 * Daily tier (testing strategy §2.3, §3 item 7, Yoshi T7.3): the sustained-load run at the 40k
 * default capacity, moved unchanged from `simulation.spec.ts` (Phase 7, commit 8eb99c7). Regular
 * runs the same property at capacity 2,500 and pins `CAP === 40000`.
 */
import { newShell } from '../model/shell';
import { CAP, STEP } from './constants';
import { FireworksSim } from './simulation';

describe('ParticleStore, daily', () => {
  it('a sim under sustained load never exceeds 40,000, and every live index has age < life', () => {
    const sim = new FireworksSim();
    const willow = newShell('w', {
      breaks: [{ stars: 400, trail: 'glitter', burn: 5, drag: 1.5 }],
    });
    let peak = 0;
    for (let s = 0; s < 1200; s++) {
      if (s % 10 === 0) sim.launch(willow, 200 + (s % 800), 300, s);
      sim.step(STEP);
      peak = Math.max(peak, sim.particles.n);
      expect(sim.particles.n).toBeLessThanOrEqual(CAP);
    }
    expect(peak).toBe(CAP);
    const P = sim.particles;
    for (let i = 0; i < P.n; i++) {
      if (!(P.age[i] < P.life[i]))
        throw new Error(`index ${i}: age ${P.age[i]} >= life ${P.life[i]}`);
    }
    // Explicit timeout (Yoshi L7): 1,200 steps at the 40k cap take ~1-2 s on this machine; the
    // default 5 s is too close on a slow runner, and a hang should fail, not stall.
  }, 30_000);
});
