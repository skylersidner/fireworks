// @vitest-environment node
import { normalizeShell, normalizeShow } from './normalize';
import { openShell, openShow } from './open';
import { PRESETS } from './presets';

/**
 * `openShell`/`openShow` (schema.md §8.3): upgrade, then normalize. In v1 the upgrade is identity
 * plus the version checks, and normalize rejects the same versions, so the order shows only in
 * the issue's developer message: upgrade's says "newer than this app supports" for a higher
 * version, normalize's says "unsupported version".
 */
describe('openShell', () => {
  const peony = () => structuredClone(PRESETS[0]) as unknown as Record<string, unknown>;

  it('a current document opens exactly as normalize would', () => {
    expect(openShell(peony())).toEqual(normalizeShell(peony()));
  });

  it('a missing version passes upgrade and is defaulted by normalize', () => {
    const doc = peony();
    delete doc['version'];
    const r = openShell(doc);
    expect(r.ok).toBe(true);
    expect(r.adjustments).toContainEqual(expect.objectContaining({ path: 'version' }));
  });

  it('a newer version fails in upgrade (the "reload" message), before normalize sees it', () => {
    const r = openShell({ ...peony(), version: 2 });
    expect(r).toEqual({
      ok: false,
      errors: [
        {
          path: 'version',
          code: 'version',
          value: 2,
          message: 'version: 2 is newer than this app supports (1); reload to open it.',
        },
      ],
      adjustments: [],
    });
    // Negative control: normalize alone gives a different message for the same input.
    const n = normalizeShell({ ...peony(), version: 2 });
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.errors[0].message).not.toContain('newer');
  });

  it('non-objects pass upgrade and normalize reports them', () => {
    expect(openShell([])).toEqual(normalizeShell([]));
    expect(openShell(null)).toEqual(normalizeShell(null));
  });
});

describe('openShow', () => {
  const show = () => ({
    version: 1,
    name: 'S',
    sky: { gravity: 160, wind: 0 },
    duration: 10,
    shells: { s1: { ...structuredClone(PRESETS[0]), sky: undefined } },
    cues: [{ id: 'c1', t: 0, shell: 's1', x: 0.5, seed: 1 }],
  });

  it('a current show opens exactly as normalize would', () => {
    expect(openShow(show())).toEqual(normalizeShow(show()));
  });

  it('a newer show version fails in upgrade', () => {
    const r = openShow({ ...show(), version: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ path: 'version', code: 'version', value: 3 });
      expect(r.errors[0].message).toContain('newer than this app supports');
    }
  });
});
