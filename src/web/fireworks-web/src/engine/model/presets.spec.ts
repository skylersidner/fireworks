// @vitest-environment node
import { PROTOTYPE_GOLDEN } from '../sim/golden/prototype-golden';
import { COLORS, PALETTE, lighten } from './colors';
import { PRESETS } from './presets';
import { DEFAULT_BREAK, newBreak, newShell } from './shell';

/** Acceptance 2a.4. The fixture is the prototype's own PRESETS, recorded from its source. */
describe('presets and factories', () => {
  it('has the 10 prototype presets, in order', () => {
    expect(PRESETS.map((p) => p.name)).toEqual([
      'Peony',
      'Chrysanthemum',
      'Willow',
      'Palm',
      'Ring',
      'Crossette',
      'Crackling Heart',
      'Strobe',
      'Rainbow',
      'Triple Break',
    ]);
  });

  PROTOTYPE_GOLDEN.presetDefs.forEach((expected, k) => {
    it(`${expected.name} equals the prototype field by field`, () => {
      const actual = PRESETS[k];
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        if (key === 'breaks') continue;
        expect(actual[key], `${expected.name}.${key}`).toEqual(expected[key]);
      }
      expect(actual.breaks.length).toBe(expected.breaks.length);
      expected.breaks.forEach((eb, b) => {
        for (const [field, value] of Object.entries(eb)) {
          expect(
            (actual.breaks[b] as unknown as Record<string, unknown>)[field],
            `${expected.name}.breaks[${b}].${field}`,
          ).toEqual(value);
        }
      });
      expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    });
  });

  it('newShell and newBreak defaults equal the prototype', () => {
    expect(newBreak()).toEqual(PROTOTYPE_GOLDEN.defaults.break);
    expect(DEFAULT_BREAK).toEqual(PROTOTYPE_GOLDEN.defaults.break);
    expect(newShell('X')).toEqual(PROTOTYPE_GOLDEN.defaults.shell);
  });

  it('colors equal the prototype, in the same key order (rainbow indexes PALETTE)', () => {
    expect(COLORS).toEqual(PROTOTYPE_GOLDEN.colors);
    expect(PALETTE).toEqual(Object.keys(PROTOTYPE_GOLDEN.colors));
  });

  it('presets are frozen, so nothing can edit one in place', () => {
    expect(Object.isFrozen(PRESETS[0])).toBe(true);
    expect(Object.isFrozen(PRESETS[0].breaks[0])).toBe(true);
  });

  it('lighten goes halfway to white per channel', () => {
    expect(lighten(0x000000)).toBe(0x7f7f7f);
    expect(lighten(0xff3b30)).toBe(0xff9d97);
    expect(lighten(0xffffff)).toBe(0xffffff);
  });
});
