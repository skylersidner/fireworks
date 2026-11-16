// @vitest-environment node
/**
 * T2 show fingerprints, final tier (end-of-project review only; Skyler 2026-11-16): the
 * `at-maximums` case, 600 s and 1,000 cues at the 40k cap, about 2.5–3 min in Node. Same
 * comparison as `show-fingerprint.spec.ts`. Run by `npm run test:final` (`run.mjs final`).
 */
import { checkCase } from './fingerprint-spec-helpers';
import { FINAL_ONLY_CASES, FINGERPRINT_CASES } from './show-fingerprint';

describe('show fingerprints (final)', () => {
  for (const c of FINGERPRINT_CASES.filter((x) => FINAL_ONLY_CASES.includes(x.name))) {
    it(`${c.name} matches its golden`, { timeout: 900_000 }, () => {
      expect(checkCase(c)).toEqual([]);
    });
  }
});
