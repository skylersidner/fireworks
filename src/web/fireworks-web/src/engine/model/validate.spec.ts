// @vitest-environment node
import { cleanName, normalizeShell, normalizeShow } from './normalize';
import { PRESETS } from './presets';
import { cueFireStep, orderCues } from './show';
import { SHELL_UPGRADES, SHOW_UPGRADES, upgradeShell, upgradeShow } from './upgrade';
import { STRICT_CODE, validateShell, validateShow } from './validate';
import { SHELL_VERSION } from './shell';
import { SHOW_VERSION } from './show';

const peony = () => structuredClone(PRESETS[0]) as unknown as Record<string, unknown>;
const embedded = () => {
  const s = peony();
  delete s['sky'];
  return s;
};
const minimalShow = () => ({
  version: 1,
  name: 'Show',
  sky: { gravity: 160, wind: 0 },
  duration: 10,
  shells: { s1: embedded() } as Record<string, unknown>,
  cues: [{ id: 'c1', t: 1, shell: 's1', x: 0.5, seed: 42 }] as Record<string, unknown>[],
});

function codes(result: ReturnType<typeof validateShell> | ReturnType<typeof validateShow>) {
  return result.ok ? [] : result.errors.map((e) => `${e.path} :: ${e.code}`).sort();
}

describe('walker returns errors and adjustments together (Yoshi finding 1)', () => {
  it('mixed: a hard error does not hide the adjustments', () => {
    const doc: Record<string, unknown> = { ...peony(), version: 99, foo: 1 };
    (doc['breaks'] as Record<string, unknown>[])[0]['stars'] = 401;
    const lenient = normalizeShell(doc);
    expect(lenient.ok).toBe(false);
    expect(lenient.adjustments.map((a) => a.kind).sort()).toEqual(['clamped', 'dropped']);
    expect(codes(validateShell(doc))).toEqual([
      'breaks[0].stars :: out-of-range',
      'foo :: unknown-property',
      'version :: version',
    ]);
  });

  it('every adjustment kind has exactly one strict code', () => {
    expect(STRICT_CODE).toEqual({
      defaulted: 'missing',
      clamped: 'out-of-range',
      rounded: 'not-integer',
      truncated: 'too-long',
      dropped: 'unknown-property',
      cleaned: 'name-format',
    });
  });

  it('every preset is strictly valid', () => {
    for (const p of PRESETS) expect(validateShell(p).ok, p.name).toBe(true);
  });
});

describe('names (schema.md §6.4)', () => {
  const nameCode = (name: unknown) => codes(validateShell({ ...peony(), name }));
  const lenientName = (name: unknown) => {
    const r = normalizeShell({ ...peony(), name });
    if (!r.ok) throw new Error('expected ok');
    return r.shell.name;
  };

  it.each([
    [' Peony', 'Peony'],
    ['Peony\n', 'Peony'],
    ['Pe\tony', 'Peony'],
    ['Pe\u0000ony', 'Peony'],
    ['\uFEFFPeony', 'Peony'],
    ['\u0085Peony', 'Peony'],
    ['Pe\ud800ony', 'Peony'],
    ['Pe\udc00ony', 'Peony'],
  ])('%j is cleaned to %j (name-format)', (raw, cleaned) => {
    expect(lenientName(raw)).toBe(cleaned);
    expect(nameCode(raw)).toEqual(['name :: name-format']);
  });

  it('keeps interior whitespace and BOM, paired surrogates, and counts code points', () => {
    expect(cleanName('Big  Red One')).toBe('Big  Red One');
    expect(cleanName('Pe\uFEFFony')).toBe('Pe\uFEFFony');
    expect(nameCode('🎆'.repeat(80))).toEqual([]);
    expect(nameCode('🎆'.repeat(81))).toEqual(['name :: too-long']);
    expect(lenientName('🎆'.repeat(81))).toBe('🎆'.repeat(80));
  });

  it('one issue per name: type > missing > too-long > name-format', () => {
    expect(nameCode(123)).toEqual(['name :: type']);
    expect(nameCode('\u0000\u0001')).toEqual(['name :: missing']);
    expect(lenientName('\u0000\u0001')).toBe('Custom');
    expect(nameCode('   ')).toEqual(['name :: missing']);
    expect(nameCode(' ' + 'a'.repeat(85))).toEqual(['name :: too-long']);
    expect(lenientName(' ' + 'a'.repeat(85))).toBe('a'.repeat(80));
  });
});

describe('normalizeShow / validateShow', () => {
  it('a minimal show is strictly valid, and its shells map has no prototype', () => {
    const r = normalizeShow(minimalShow());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.adjustments).toEqual([]);
    expect(Object.getPrototypeOf(r.show.shells)).toBeNull();
    expect(r.show.cues[0]).toEqual({ id: 'c1', t: 1, shell: 's1', x: 0.5, seed: 42 });
    expect(validateShow(minimalShow()).ok).toBe(true);
  });

  it('prototype keys are never shells', () => {
    for (const shell of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const show = minimalShow();
      show.cues[0]['shell'] = shell;
      expect(codes(validateShow(show)), shell).toEqual(['cues[0].shell :: unknown-shell']);
    }
    // JSON.parse makes "__proto__" an own key; the key pattern rejects it.
    const parsed = JSON.parse(
      JSON.stringify(minimalShow()).replace('"shells":{', '"shells":{"__proto__":{},'),
    );
    expect(Object.hasOwn(parsed.shells, '__proto__')).toBe(true);
    expect(codes(validateShow(parsed))).toEqual(['shells :: key-format']);
  });

  it('an empty show is invalid; missing required fields are hard errors', () => {
    expect(codes(validateShow({ ...minimalShow(), cues: [] }))).toEqual(['cues :: cue-count']);
    expect(codes(validateShow({ ...minimalShow(), cues: undefined }))).toEqual([
      'cues :: cue-count',
    ]);
    const r = normalizeShow({ ...minimalShow(), sky: undefined, duration: null });
    expect(r.ok).toBe(false);
    expect(codes(validateShow({ ...minimalShow(), sky: undefined }))).toEqual(['sky :: missing']);
    expect(codes(validateShow({ ...minimalShow(), sky: {} }))).toEqual([
      'sky.gravity :: missing',
      'sky.wind :: missing',
    ]);
    const show = minimalShow();
    show.cues = [{}];
    expect(normalizeShow(show).ok).toBe(false);
    expect(codes(validateShow(show))).toEqual([
      'cues[0].id :: missing',
      'cues[0].seed :: missing',
      'cues[0].shell :: missing',
      'cues[0].t :: missing',
      'cues[0].x :: missing',
    ]);
  });

  it('embedded sky is dropped (unknown-property); embedded version and stars are walked', () => {
    const show = minimalShow();
    (show.shells['s1'] as Record<string, unknown>)['sky'] = { gravity: 160, wind: 0 };
    const lenient = normalizeShow(show);
    if (!lenient.ok) throw new Error('expected ok');
    expect('sky' in lenient.show.shells['s1']).toBe(false);
    expect(codes(validateShow(show))).toEqual(['shells.s1.sky :: unknown-property']);
    delete (show.shells['s1'] as Record<string, unknown>)['sky'];
    delete (show.shells['s1'] as Record<string, unknown>)['version'];
    expect(codes(validateShow(show))).toEqual(['shells.s1.version :: missing']);
  });

  it('cue rules: duplicates after the first, seeds never adjusted, t bound by a valid duration', () => {
    const show = minimalShow();
    show.cues = [0, 1, 2].map(() => ({ id: 'c1', t: 1, shell: 's1', x: 0.5, seed: 1 }));
    expect(codes(validateShow(show))).toEqual([
      'cues[1].id :: duplicate-id',
      'cues[2].id :: duplicate-id',
    ]);
    const seed = (value: unknown) => {
      const s = minimalShow();
      s.cues[0]['seed'] = value;
      expect(normalizeShow(s).ok, String(value)).toBe(false);
      return codes(validateShow(s));
    };
    expect(seed(1.5)).toEqual(['cues[0].seed :: not-integer']);
    expect(seed(2147483648)).toEqual(['cues[0].seed :: out-of-range']);
    expect(seed(2147483647.5)).toEqual(['cues[0].seed :: out-of-range']);
    expect(seed('1')).toEqual(['cues[0].seed :: type']);
    const t = (duration: unknown, value: number) => {
      const s = { ...minimalShow(), duration };
      s.cues[0]['t'] = value;
      return codes(validateShow(s));
    };
    expect(t(10, 10.5)).toEqual(['cues[0].t :: out-of-range']);
    expect(t(10, 10)).toEqual([]);
    expect(t(601, 500)).toEqual(['duration :: out-of-range']);
    expect(t(0, 600)).toEqual(['duration :: out-of-range']);
    expect(t(0, 601)).toEqual(['cues[0].t :: out-of-range', 'duration :: out-of-range']);
  });

  it('cue burstHeight: absent stays absent, null is missing', () => {
    const show = minimalShow();
    show.cues[0]['burstHeight'] = null;
    const r = normalizeShow(show);
    if (!r.ok) throw new Error('expected ok');
    expect('burstHeight' in r.show.cues[0]).toBe(false);
    expect(codes(validateShow(show))).toEqual(['cues[0].burstHeight :: missing']);
    show.cues[0]['burstHeight'] = 0.5;
    expect(codes(validateShow(show))).toEqual([]);
  });

  it('unknown-shell is not checked when shells was not walked', () => {
    expect(codes(validateShow({ ...minimalShow(), shells: [] }))).toEqual(['shells :: not-object']);
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 33; i++) many[`s${i}`] = embedded();
    const show = { ...minimalShow(), shells: many };
    show.cues[0]['shell'] = 'nope';
    expect(codes(validateShow(show))).toEqual(['shells :: shell-count']);
  });
});

describe('show walk settlements (schema.md §6.2 rules 7, 8, 10, 13)', () => {
  it('absent or null shells is missing and nothing under it is walked; same for cues', () => {
    for (const shells of [undefined, null]) {
      const s = { ...minimalShow(), shells };
      s.cues[0]['shell'] = 'nope';
      expect(codes(validateShow(s)), String(shells)).toEqual(['shells :: missing']);
    }
    for (const cues of [undefined, null]) {
      expect(codes(validateShow({ ...minimalShow(), cues })), String(cues)).toEqual([
        'cues :: cue-count',
      ]);
    }
  });

  it('one key-format per bad key, and a cue naming one is unknown-shell', () => {
    const show = { ...minimalShow(), shells: { s1: embedded(), '1x': 5, 'a.b': embedded() } };
    show.cues[0]['shell'] = 'a.b';
    const r = validateShow(show);
    expect(codes(r)).toEqual([
      'cues[0].shell :: unknown-shell',
      'shells :: key-format',
      'shells :: key-format',
    ]);
    if (!r.ok) {
      expect(r.errors.filter((e) => e.code === 'key-format').map((e) => e.value)).toEqual([
        '1x',
        'a.b',
      ]);
    }
  });

  it('a wrong-type id or shell is type only, and failed ids take no part in duplicate-id', () => {
    const show = minimalShow();
    const cue = (id: unknown, shell: unknown = 's1') => ({ id, t: 1, shell, x: 0.5, seed: 1 });
    show.cues = [cue(5), cue(5, 7), cue('9z'), cue('9z'), cue('c1'), cue('c2'), cue('c1')];
    expect(codes(validateShow(show))).toEqual([
      'cues[0].id :: type',
      'cues[1].id :: type',
      'cues[1].shell :: type',
      'cues[2].id :: key-format',
      'cues[3].id :: key-format',
      'cues[6].id :: duplicate-id',
    ]);
  });

  it('embedded version 2 is reported and the walk continues; embedded sky is not walked', () => {
    const show = minimalShow();
    const s1 = show.shells['s1'] as Record<string, unknown>;
    s1['version'] = 2;
    s1['sky'] = { gravity: 'x', wind: 99999, extra: 1 };
    (s1['breaks'] as Record<string, unknown>[])[0]['stars'] = 999;
    expect(codes(validateShow(show))).toEqual([
      'shells.s1.breaks[0].stars :: out-of-range',
      'shells.s1.sky :: unknown-property',
      'shells.s1.version :: version',
    ]);
  });

  it('a null shell sky is missing in strict mode', () => {
    expect(codes(validateShell({ ...peony(), sky: null }))).toEqual(['sky :: missing']);
  });
});

describe('firing order (schema.md §4.4)', () => {
  it('fireStep is Math.round(t * 120), and order is (fireStep, id), not array order', () => {
    expect(cueFireStep(1)).toBe(120);
    expect(cueFireStep(1.004)).toBe(120);
    expect(cueFireStep(0.5 / 120)).toBe(1);
    const cues = [
      { id: 'b', t: 1.004 },
      { id: 'z', t: 0 },
      { id: 'a', t: 1 },
      { id: 'B', t: 1 },
    ];
    expect(orderCues(cues).map((c) => c.id)).toEqual(['z', 'B', 'a', 'b']);
    expect(cues.map((c) => c.id)).toEqual(['b', 'z', 'a', 'B']);
  });
});

describe('upgrade (schema.md §8.2)', () => {
  it('v1 is identity, and the chains have VERSION − 1 steps', () => {
    expect(Object.keys(SHELL_UPGRADES)).toHaveLength(SHELL_VERSION - 1);
    expect(Object.keys(SHOW_UPGRADES)).toHaveLength(SHOW_VERSION - 1);
    const doc = peony();
    expect(upgradeShell(doc)).toEqual({ ok: true, document: doc, from: 1 });
    const show = minimalShow();
    expect(upgradeShow(show)).toEqual({ ok: true, document: show, from: 1 });
  });

  it('passes a missing version and non-objects through for normalize to report', () => {
    const doc = peony();
    delete doc['version'];
    expect(upgradeShell(doc)).toMatchObject({ ok: true, document: doc });
    expect(upgradeShell([])).toMatchObject({ ok: true, document: [] });
  });

  it.each([2, 99, 1.5, '1', true, 0, -1])('rejects version %j with a version issue', (v) => {
    const r = upgradeShell({ ...peony(), version: v });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ path: 'version', code: 'version', value: v });
  });
});
