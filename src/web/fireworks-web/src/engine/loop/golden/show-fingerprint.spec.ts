// @vitest-environment node
/**
 * T2 show fingerprints, regular tier (testing interlude; record `yoshi-interlude-t2-fingerprints.md`).
 * Each regular case runs once and is compared with its committed golden. A run-vs-run spec can't
 * see a sim change that moves every run the same way; this can. The long cases are elsewhere:
 * `realistic-600` in `show-fingerprint.daily.spec.ts`, `at-maximums` in
 * `show-fingerprint.final.spec.ts` (final tier only).
 *
 * Negative controls: a one-unit change in any field of a golden fails the comparison, and names
 * exactly that field; a missing or extra field fails too.
 */
import {
  checkCase,
  fixtureNames,
  goldenNames,
  readGolden,
  runCase,
} from './fingerprint-spec-helpers';
import { diffFingerprint, FINAL_ONLY_CASES, FINGERPRINT_CASES } from './show-fingerprint';

const regular = FINGERPRINT_CASES.filter((c) => c.tier === 'regular');

describe('show fingerprints (regular)', () => {
  for (const c of regular) {
    it(`${c.name} matches its golden`, { timeout: 30_000 }, () => {
      expect(checkCase(c)).toEqual([]);
    });
  }

  it('every golden has a case, every case a golden, and every valid show fixture a case', () => {
    const names = FINGERPRINT_CASES.map((c) => c.name).sort();
    expect(goldenNames().sort()).toEqual(names);
    const covered = new Set(
      FINGERPRINT_CASES.flatMap((c) => ('fixture' in c.input ? [c.input.fixture] : [])),
    );
    expect(fixtureNames().filter((f) => !covered.has(f))).toEqual([]);
  });

  it('every final-only name is a daily case, so a typo cannot drop a case from both long tiers', () => {
    for (const name of FINAL_ONLY_CASES)
      expect(FINGERPRINT_CASES.find((c) => c.name === name)?.tier, name).toBe('daily');
  });

  it('every golden carries a recorded reason', () => {
    for (const name of goldenNames()) {
      const history = readGolden(name)?.header.history ?? [];
      expect(history.length, name).toBeGreaterThan(0);
      for (const h of history) expect(h.reason.length, name).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('show fingerprints: negative controls', () => {
  // The cheapest case with samples: cue-at-duration (1,713 steps, two 600-step samples).
  const c = regular.find((x) => x.name === 'cue-at-duration')!;
  const golden = readGolden(c.name)!;
  const expected = {
    case: golden.case,
    inputDigest: golden.inputDigest,
    fingerprint: golden.fingerprint,
  };
  const actual = JSON.parse(JSON.stringify(runCase(c)));

  /** Every numeric leaf of the fingerprint, as [path, set(obj, value)]. */
  function leaves(v: unknown, path: string, out: string[] = []): string[] {
    if (typeof v === 'number') out.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, out);
    return out;
  }
  function bump(obj: unknown, path: string, by: number): unknown {
    const copy = structuredClone(obj) as Record<string, unknown>;
    const keys = path.match(/[^.[\]]+/g)!;
    let at = copy as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    const last = keys.at(-1)!;
    at[last] = (at[last] as number) + by;
    return copy;
  }

  it('the control case matches, so every failure below is the bump alone', () => {
    expect(diffFingerprint(expected, actual)).toEqual([]);
  });

  it('a one-unit change in any field fails, naming that field', () => {
    const paths = leaves(expected, '').map((p) => p.slice(1));
    // case.run (3) + inputDigest + 8 scalars + 2 samples × (step, n, shells, 6 kinds).
    expect(paths.length).toBe(3 + 1 + 8 + 2 * 9);
    for (const p of paths) {
      for (const by of [1, -1]) {
        const diff = diffFingerprint(bump(expected, p, by), actual);
        expect(diff.length, `${p} ${by}`).toBe(1);
        expect(diff[0].startsWith(`${p}:`), diff[0]).toBe(true);
      }
    }
  });

  it('a missing field, an extra field and a dropped sample each fail', () => {
    const { peakStep: _gone, ...missing } = expected.fingerprint;
    expect(diffFingerprint({ ...expected, fingerprint: missing }, actual)).toEqual([
      'fingerprint.peakStep: expected nothing, got ' + actual.fingerprint.peakStep,
    ]);
    expect(diffFingerprint(expected, { ...actual, extra: 0 })).toEqual([
      'extra: expected nothing, got 0',
    ]);
    const fewer = { ...expected.fingerprint, samples: expected.fingerprint.samples.slice(1) };
    expect(diffFingerprint({ ...expected, fingerprint: fewer }, actual)[0]).toBe(
      'fingerprint.samples.length: expected 1, got 2',
    );
  });
});
