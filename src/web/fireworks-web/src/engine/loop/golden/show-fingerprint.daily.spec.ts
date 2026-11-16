// @vitest-environment node
/**
 * T2 show fingerprints, daily tier: the full-length cases except `at-maximums` (today
 * `realistic-600`, about 9 s). `at-maximums` (600 s and 1,000 cues at the 40k cap, about
 * 2.5–3 min in Node) runs only in the final tier, `show-fingerprint.final.spec.ts` (Skyler
 * 2026-11-16: the at-maximums runs move to `final`). Same comparison as the regular
 * `show-fingerprint.spec.ts`.
 */
import { checkCase } from './fingerprint-spec-helpers';
import { FINAL_ONLY_CASES, FINGERPRINT_CASES } from './show-fingerprint';

describe('show fingerprints (daily)', () => {
  for (const c of FINGERPRINT_CASES.filter(
    (x) => x.tier === 'daily' && !FINAL_ONLY_CASES.includes(x.name),
  )) {
    it(`${c.name} matches its golden`, { timeout: 900_000 }, () => {
      expect(checkCase(c)).toEqual([]);
    });
  }
});
