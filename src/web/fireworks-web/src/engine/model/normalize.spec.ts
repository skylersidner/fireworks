// @vitest-environment node
import { BREAK_LIMITS, CUE_LIMITS, SHELL_LIMITS, SKY_LIMITS } from './limits';
import {
  childPath,
  FALLBACK_NAME,
  normalizeQuality,
  normalizeShell,
  normalizeShow,
  normalizeSky,
} from './normalize';
import { PRESETS } from './presets';
import { COLORS, PALETTE } from './colors';
import {
  DEFAULT_BREAK,
  DEFAULT_QUALITY,
  DEFAULT_SHELL,
  DEFAULT_SKY,
  effectiveSky,
  newShell,
  type ShellDocument,
} from './shell';

function ok(input: unknown): ShellDocument {
  const result = normalizeShell(input);
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.errors.map((e) => e.message).join('; ')}`);
  }
  return result.shell;
}

/** Error messages (paths and raw values: the developer-facing text). */
function errors(input: unknown): readonly string[] {
  const result = normalizeShell(input);
  if (result.ok) throw new Error('expected a rejection');
  return result.errors.map((e) => e.message);
}

/** Acceptance 2a.6, one block per letter. */
describe('normalizeShell', () => {
  it('(a) round-trips every preset, and is idempotent', () => {
    for (const preset of PRESETS) {
      const once = ok(preset);
      expect(once).toEqual(preset);
      expect(ok(once)).toEqual(once);
    }
    const messy = { name: 'x', burstHeight: 9, breaks: [{ stars: 3.6, speed: -1 }] };
    expect(ok(ok(messy))).toEqual(ok(messy));
  });

  it('never mutates its input', () => {
    const input = { breaks: [{ stars: 9999 }] };
    ok(input);
    expect(input).toEqual({ breaks: [{ stars: 9999 }] });
  });

  it('(b) clamps out-of-range numbers to limits.ts, and rounds stars', () => {
    const s = ok({
      burstHeight: 2,
      angleJitter: -5,
      sky: { gravity: 1, wind: 999 },
      breaks: [
        { stars: 9999, speed: 1, changeAt: 0, burn: 99, drag: -1, size: 10, delay: 0 },
        { stars: 1, speed: 9999, changeAt: 2, burn: 0, drag: 99, size: 0, delay: 99 },
        { stars: 12.6 },
      ],
    });
    expect(s.burstHeight).toBe(SHELL_LIMITS.burstHeight.max);
    expect(s.angleJitter).toBe(SHELL_LIMITS.angleJitter.min);
    expect(s.sky).toEqual({ gravity: SKY_LIMITS.gravity.min, wind: SKY_LIMITS.wind.max });
    const L = BREAK_LIMITS;
    expect(s.breaks[0]).toMatchObject({
      stars: L.stars.max,
      speed: L.speed.min,
      changeAt: L.changeAt.min,
      burn: L.burn.max,
      drag: L.drag.min,
      size: L.size.max,
      delay: L.delay.min,
    });
    expect(s.breaks[1]).toMatchObject({
      stars: L.stars.min,
      speed: L.speed.max,
      changeAt: L.changeAt.max,
      burn: L.burn.min,
      drag: L.drag.max,
      size: L.size.min,
      delay: L.delay.max,
    });
    expect(s.breaks[2].stars).toBe(13);
    expect(s.breaks[0].stars).toBe(400);
  });

  it('(c) fills missing fields with newShell / newBreak defaults', () => {
    const s = ok({ breaks: [{}] });
    expect(s).toEqual({ ...newShell(FALLBACK_NAME), breaks: [DEFAULT_BREAK] });
    expect(ok({ name: '   ', breaks: [{}] }).name).toBe(FALLBACK_NAME);
    expect(ok({ name: 'a'.repeat(100), breaks: [{}] }).name).toBe('a'.repeat(80));
  });

  it.each(['pattern', 'trail', 'effect', 'color1', 'color2'])(
    '(d) rejects an unknown %s, naming the field',
    (field) => {
      const errs = errors({ breaks: [{}, { [field]: 'willow' }] });
      expect(errs).toHaveLength(1);
      expect(errs[0]).toContain(`breaks[1].${field}`);
    },
  );

  it('(d) rejects rainbow as color2 and none as color1', () => {
    expect(errors({ breaks: [{ color2: 'rainbow' }] })[0]).toContain('breaks[0].color2');
    expect(errors({ breaks: [{ color1: 'none' }] })[0]).toContain('breaks[0].color1');
  });

  it('(e) breaks must be a non-empty array of at most 4', () => {
    expect(errors({})[0]).toContain('breaks');
    expect(errors({ breaks: [] })[0]).toContain('breaks');
    expect(errors({ breaks: 'x' })[0]).toContain('breaks');
    expect(errors({ breaks: [{}, {}, {}, {}, {}] })[0]).toContain('at most 4');
    expect(ok({ breaks: [{}, {}, {}, {}] }).breaks).toHaveLength(4);
  });

  it('(f) sky is optional: absent stays absent, partial is filled, and plays as 160/0', () => {
    const absent = ok({ breaks: [{}] });
    expect('sky' in absent).toBe(false);
    expect(effectiveSky(absent)).toEqual({ gravity: 160, wind: 0 });
    expect(DEFAULT_SKY).toEqual({ gravity: 160, wind: 0 });
    expect(ok({ sky: { wind: 12 }, breaks: [{}] }).sky).toEqual({ gravity: 160, wind: 12 });
    expect(effectiveSky(ok({ sky: { gravity: 300 }, breaks: [{}] }))).toEqual({
      gravity: 300,
      wind: 0,
    });
    expect(errors({ sky: 5, breaks: [{}] })[0]).toContain('sky');
  });

  it('(g) drops keys that are not in the ShellDocument', () => {
    const s = ok({
      persistence: 0.5,
      starBudget: 0.5,
      mode: 'show',
      extra: true,
      sky: { gravity: 200, wind: 0, persistence: 0.1 },
      breaks: [{ stars: 50, glow: 3 }],
    });
    expect(Object.keys(s).sort()).toEqual(
      ['angleJitter', 'breaks', 'burstHeight', 'name', 'sky', 'version'].sort(),
    );
    expect(Object.keys(s.sky!).sort()).toEqual(['gravity', 'wind']);
    expect(Object.keys(s.breaks[0]).sort()).toEqual(Object.keys(DEFAULT_BREAK).sort());
  });

  it('rejects non-objects, wrong types and other versions, listing every problem', () => {
    expect(errors(null)).toHaveLength(1);
    expect(errors([])).toHaveLength(1);
    expect(errors('{}')).toHaveLength(1);
    expect(errors({ version: 2, breaks: [{}] })[0]).toContain('version');
    const many = errors({ name: 7, burstHeight: 'high', breaks: [{ stars: NaN, pattern: 'x' }] });
    expect(many).toHaveLength(4);
  });
});

describe('normalizeSky / normalizeQuality', () => {
  it('clamp and default without failing', () => {
    expect(normalizeSky(undefined)).toEqual({ gravity: 160, wind: 0 });
    expect(normalizeSky({ gravity: 9999, wind: -9999 })).toEqual({ gravity: 400, wind: -80 });
    expect(normalizeQuality(null)).toEqual({
      persistence: 0.78,
      starBudget: 1,
      reduceFlashing: false,
    });
    expect(normalizeQuality({ persistence: 5, starBudget: 0, reduceFlashing: true })).toEqual({
      persistence: 0.92,
      starBudget: 0.25,
      reduceFlashing: true,
    });
    expect(
      normalizeQuality({ reduceFlashing: 'yes' } as unknown as { reduceFlashing: boolean })
        .reduceFlashing,
    ).toBe(false);
  });
});

/** yoshi-phase2a-engine-boundaries.md §4 (L2) and L4; designer-2c.md D9 needs these. */
describe('normalizeShell adjustments and issues', () => {
  function adjustments(input: unknown) {
    const result = normalizeShell(input);
    if (!result.ok) throw new Error('expected ok');
    return result.adjustments;
  }

  it('every preset round-trips with zero adjustments (Phase 3 strict == lenient + none)', () => {
    for (const preset of PRESETS) expect(adjustments(preset), preset.name).toEqual([]);
  });

  it('reports clamped, rounded and truncated values with from and to', () => {
    const a = adjustments({
      version: 1,
      name: 'n'.repeat(85),
      burstHeight: 2,
      angleJitter: 4,
      sky: { gravity: 160, wind: -200 },
      breaks: [
        { ...DEFAULT_BREAK, stars: 9999 },
        { ...DEFAULT_BREAK, stars: 12.4, burn: 0 },
      ],
    });
    expect(a).toEqual([
      { path: 'name', kind: 'truncated', from: 'n'.repeat(85), to: 'n'.repeat(80) },
      { path: 'burstHeight', kind: 'clamped', from: 2, to: 0.85 },
      { path: 'sky.wind', kind: 'clamped', from: -200, to: -80 },
      { path: 'breaks[0].stars', kind: 'clamped', from: 9999, to: 400 },
      { path: 'breaks[1].stars', kind: 'rounded', from: 12.4, to: 12 },
      { path: 'breaks[1].burn', kind: 'clamped', from: 0, to: 0.3 },
    ]);
  });

  it('a missing version, a missing field and a blank name are defaulted', () => {
    const full = { ...structuredClone(PRESETS[0]) } as Record<string, unknown>;
    delete full['version'];
    expect(adjustments(full)).toEqual([
      { path: 'version', kind: 'defaulted', from: undefined, to: 1 },
    ]);
    const blank = { ...structuredClone(PRESETS[0]), name: '  ' };
    expect(adjustments(blank)).toEqual([
      { path: 'name', kind: 'defaulted', from: '  ', to: 'Custom' },
    ]);
    const a = adjustments({ ...structuredClone(PRESETS[0]), breaks: [{}] });
    expect(a.filter((x) => x.kind !== 'defaulted')).toEqual([]);
    expect(a.map((x) => x.path)).toEqual(Object.keys(DEFAULT_BREAK).map((k) => `breaks[0].${k}`));
  });

  it('one null rule (L4): null is absent everywhere, and is reported as defaulted', () => {
    const s = ok({
      version: null,
      name: null,
      burstHeight: null,
      sky: null,
      breaks: [{ stars: null, color2: null }],
    });
    expect(s).toEqual({ ...newShell(FALLBACK_NAME), breaks: [DEFAULT_BREAK] });
    expect('sky' in s).toBe(false);
    const a = adjustments({ name: null, sky: null, breaks: [{ stars: null }] });
    expect(a).toContainEqual({ path: 'name', kind: 'defaulted', from: null, to: 'Custom' });
    expect(a).toContainEqual({ path: 'sky', kind: 'defaulted', from: null });
    expect(a).toContainEqual({ path: 'breaks[0].stars', kind: 'defaulted', from: null, to: 120 });
  });

  it('an absent sky is not an adjustment; unknown keys are dropped, with their path', () => {
    const preset = structuredClone(PRESETS[0]) as unknown as Record<string, unknown>;
    expect(adjustments(preset).some((x) => x.path === 'sky')).toBe(false);
    const a = adjustments({
      ...preset,
      mode: 'show',
      sky: { gravity: 160, wind: 0, persistence: 0.1 },
      breaks: [{ ...DEFAULT_BREAK, glow: 3 }],
    });
    expect(a).toEqual([
      { path: 'mode', kind: 'dropped', from: 'show' },
      { path: 'sky.persistence', kind: 'dropped', from: 0.1 },
      { path: 'breaks[0].glow', kind: 'dropped', from: 3 },
    ]);
  });

  it('each rejection carries its path, a code and the data to phrase it', () => {
    const result = normalizeShell({
      version: 3,
      name: 4,
      sky: 1,
      breaks: [{ pattern: 'spiral', stars: 'many' }, 7],
    });
    if (result.ok) throw new Error('expected a rejection');
    expect(
      result.errors.map(({ path, code, value, options }) => ({ path, code, value, options })),
    ).toEqual([
      { path: 'version', code: 'version', value: 3, options: undefined },
      { path: 'name', code: 'type', value: undefined, options: ['string'] },
      { path: 'sky', code: 'not-object', value: undefined, options: undefined },
      {
        path: 'breaks[0].pattern',
        code: 'enum',
        value: 'spiral',
        options: ['peony', 'ring', 'palm', 'heart'],
      },
      { path: 'breaks[0].stars', code: 'type', value: undefined, options: ['number'] },
      { path: 'breaks[1]', code: 'not-object', value: undefined, options: undefined },
    ]);
    const first = (input: unknown) => {
      const r = normalizeShell(input);
      return r.ok ? null : { code: r.errors[0].code, value: r.errors[0].value };
    };
    expect(first({ breaks: [] })).toEqual({ code: 'break-count', value: 0 });
    expect(first({})).toEqual({ code: 'break-count', value: null });
    expect(first({ breaks: [{}, {}, {}, {}, {}] })).toEqual({ code: 'break-count', value: 5 });
    expect(first(null)).toEqual({ code: 'not-object', value: undefined });
  });
});

describe('frozen defaults (L3, L6)', () => {
  it('DEFAULT_SHELL is the newShell default, and every shared default is deep-frozen', () => {
    expect(newShell(FALLBACK_NAME)).toEqual(DEFAULT_SHELL);
    for (const value of [
      DEFAULT_SHELL,
      DEFAULT_SHELL.breaks[0],
      DEFAULT_BREAK,
      DEFAULT_SKY,
      DEFAULT_QUALITY,
      COLORS,
      PALETTE,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(newShell('x').breaks[0]).not.toBe(DEFAULT_SHELL.breaks[0]);
    expect(Object.isFrozen(newShell('x'))).toBe(false);
  });
});

describe('property names in paths (schema.md §6.2 rule 11)', () => {
  const LONE_HIGH = String.fromCharCode(0xd800);
  const LONE_LOW = String.fromCharCode(0xdc00);
  const FFFD = String.fromCharCode(0xfffd);

  it('plain names after a dot (none at the root), anything else in brackets', () => {
    expect(childPath('', 'stars')).toBe('stars');
    expect(childPath('breaks[0]', '_x-1')).toBe('breaks[0]._x-1');
    expect(childPath('', 'a.b')).toBe('["a.b"]');
    expect(childPath('', '')).toBe('[""]');
    expect(childPath('', '1a')).toBe('["1a"]');
    expect(childPath('', 'a b')).toBe('["a b"]');
    expect(childPath('', 'a[0]')).toBe('["a[0]"]');
    expect(childPath('', 'é')).toBe('["é"]');
    expect(childPath('', 'a\n')).toBe('["a\n"]');
    expect(childPath('breaks[0]', 'a"b')).toBe('breaks[0]["a\\"b"]');
    expect(childPath('sky', 'a\\b')).toBe('sky["a\\\\b"]');
  });

  it('keeps surrogate pairs and writes each unpaired surrogate as U+FFFD', () => {
    expect(childPath('', `st${LONE_HIGH}ars`)).toBe(`["st${FFFD}ars"]`);
    expect(childPath('', `${LONE_LOW}${LONE_HIGH}`)).toBe(`["${FFFD}${FFFD}"]`);
    expect(childPath('', `a${LONE_HIGH}`)).toBe(`["a${FFFD}"]`);
    expect(childPath('', '\u{1F386}')).toBe('["\u{1F386}"]');
  });

  it('dropped keys use it at every level', () => {
    const preset = structuredClone(PRESETS[0]) as unknown as Record<string, unknown>;
    const result = normalizeShell({
      ...preset,
      'a.b': 1,
      '': 2,
      sky: { gravity: 160, wind: 0, 'x y': 3 },
      breaks: [{ ...DEFAULT_BREAK, 'a"b': 4, [`st${LONE_HIGH}ars`]: 5 }],
    });
    expect(result.adjustments.map((a) => a.path)).toEqual([
      '["a.b"]',
      '[""]',
      'sky["x y"]',
      'breaks[0]["a\\"b"]',
      `breaks[0]["st${FFFD}ars"]`,
    ]);
  });
});

/** schema.md §12.5: lenient-only show rules (the server has no lenient mode). */
describe('normalizeShow, lenient-only rules (schema.md §12.5)', () => {
  const embedded = () => {
    const s = structuredClone(PRESETS[0]) as unknown as Record<string, unknown>;
    delete s['sky'];
    return s;
  };
  const show = () => ({
    version: 1,
    name: 'Show',
    sky: { gravity: 160, wind: 0 },
    duration: 10,
    shells: { s1: embedded() } as Record<string, unknown>,
    cues: [{ id: 'c1', t: 1, shell: 's1', x: 0.5, seed: 42 }] as Record<string, unknown>[],
  });
  const withCue = (patch: Record<string, unknown>) => {
    const s = show();
    s.cues[0] = { ...s.cues[0], ...patch };
    return s;
  };

  it('the minimal show is ok with no adjustments', () => {
    expect(normalizeShow(show())).toMatchObject({ ok: true, adjustments: [] });
  });

  it.each([1.5, 2147483648, -2147483649])('seed %d is a hard error, never adjusted', (seed) => {
    const r = normalizeShow(withCue({ seed }));
    expect(r.ok).toBe(false);
    expect(r.adjustments).toEqual([]);
  });

  it.each(['id', 't', 'shell', 'x', 'seed'])('a cue without %s is a hard error', (field) => {
    const s = show();
    delete s.cues[0][field];
    expect(normalizeShow(s).ok).toBe(false);
  });

  it('show sky {} is a hard error (no DEFAULT_SKY fill)', () => {
    expect(normalizeShow({ ...show(), sky: {} }).ok).toBe(false);
  });

  it('duration and cue t, x and burstHeight are clamped', () => {
    const cases: [ReturnType<typeof show>, string, number][] = [
      [{ ...show(), duration: 601 }, 'duration', 600],
      [withCue({ t: -1 }), 'cues[0].t', 0],
      [withCue({ x: 1.5 }), 'cues[0].x', 1],
      [withCue({ burstHeight: 0.9 }), 'cues[0].burstHeight', CUE_LIMITS.burstHeight.max],
    ];
    for (const [input, path, to] of cases) {
      const r = normalizeShow(input);
      expect(r.ok, path).toBe(true);
      expect(r.adjustments, path).toEqual([{ path, kind: 'clamped', from: expect.anything(), to }]);
    }
  });

  it('null shell sky and null cue burstHeight are defaulted and absent from the result', () => {
    const shellResult = normalizeShell({ ...structuredClone(PRESETS[0]), sky: null });
    if (!shellResult.ok) throw new Error('expected ok');
    expect(shellResult.adjustments).toEqual([{ path: 'sky', kind: 'defaulted', from: null }]);
    expect('sky' in shellResult.shell).toBe(false);

    const r = normalizeShow(withCue({ burstHeight: null }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.adjustments).toEqual([{ path: 'cues[0].burstHeight', kind: 'defaulted', from: null }]);
    expect('burstHeight' in r.show.cues[0]).toBe(false);
  });
});
