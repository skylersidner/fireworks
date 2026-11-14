import { normalizeShell } from '../../../../engine/model/normalize';
import {
  appliedNote,
  confirmApplyBody,
  confirmPresetAction,
  confirmPresetBody,
  confirmPresetTitle,
  copyBlockedNote,
  invalidShellNote,
  issueReason,
} from './designer-copy';

const adjustments = (input: unknown) => {
  const r = normalizeShell(input);
  if (!r.ok) throw new Error('expected ok');
  return r.adjustments;
};
const errors = (input: unknown) => {
  const r = normalizeShell(input);
  if (r.ok) throw new Error('expected rejection');
  return r.errors;
};

/** designer-2c.md §3.6, "Which adjustments count". */
describe('JSON Apply notes', () => {
  it('a short paste only fills defaults, so it reads "Applied."', () => {
    expect(appliedNote(adjustments({ breaks: [{ stars: 200 }] }))).toBe('Applied.');
  });

  it('counts clamped, rounded and truncated values by row label, singular and plural', () => {
    expect(appliedNote(adjustments({ breaks: [{ stars: 9999 }] }))).toBe(
      'Applied, with 1 value adjusted: Stars (Break 1).',
    );
    expect(appliedNote(adjustments({ breaks: [{ stars: 9999 }, { burn: 0 }] }))).toBe(
      'Applied, with 2 values adjusted: Stars (Break 1), Burn time (Break 2).',
    );
    expect(appliedNote(adjustments({ name: 'n'.repeat(90), breaks: [{ stars: 12.4 }] }))).toBe(
      'Applied, with 2 values adjusted: Name, Stars (Break 1).',
    );
  });

  it('orders shell fields, then breaks in row order, then sky', () => {
    const note = appliedNote(
      adjustments({
        sky: { wind: 500 },
        breaks: [{ burn: 99, stars: 9999 }],
        burstHeight: 9,
      }),
    );
    expect(note).toBe(
      'Applied, with 4 values adjusted: Burst height, Stars (Break 1), Burn time (Break 1), Wind.',
    );
  });

  it('lists at most 5 names, then "and k more"', () => {
    const note = appliedNote(
      adjustments({
        sky: { wind: 500 },
        breaks: [{ stars: 9999, speed: 1, burn: 99 }, { stars: 1 }],
        burstHeight: 9,
        angleJitter: 99,
      }),
    );
    expect(note).toBe(
      'Applied, with 7 values adjusted: Burst height, Angle jitter, Stars (Break 1), ' +
        'Burst speed (Break 1), Burn time (Break 1), and 2 more.',
    );
  });

  it('unknown keys get their own sentence; both together drop the second "Applied."', () => {
    expect(appliedNote(adjustments({ theme: 1, breaks: [{ sparkle: true }] }))).toBe(
      'Applied. 2 unknown fields were ignored: theme, sparkle (Break 1).',
    );
    expect(appliedNote(adjustments({ breaks: [{ stars: 9999, sparkle: 1 }] }))).toBe(
      'Applied, with 1 value adjusted: Stars (Break 1). 1 unknown field was ignored: sparkle (Break 1).',
    );
    const long = 'k'.repeat(50);
    expect(appliedNote(adjustments({ [long]: 1, breaks: [{}] }))).toBe(
      `Applied. 1 unknown field was ignored: ${'k'.repeat(40)}….`,
    );
  });

  it('rejections speak in field labels', () => {
    expect(issueReason(errors({ breaks: [{ pattern: 'spiral' }] })[0])).toBe(
      'Pattern (Break 1) "spiral" isn\'t one of Peony, Ring, Palm, Heart',
    );
    expect(issueReason(errors({ breaks: [] })[0])).toBe('a shell needs 1 to 4 breaks');
    expect(issueReason(errors({ breaks: [{}, { color2: 'rainbow' }] })[0])).toContain(
      'Changes to (Break 2) "rainbow" isn\'t one of No change, Red',
    );
    expect(invalidShellNote(errors({ breaks: [{ stars: 'many' }] }))).toBe(
      "Couldn't apply: Stars (Break 1) must be a number. Nothing changed.",
    );
  });

  it('copy blocked names the platform shortcut', () => {
    expect(copyBlockedNote(true)).toBe(
      'Copy was blocked. The text is selected; press ⌘C to copy it.',
    );
    expect(copyBlockedNote(false)).toContain('Ctrl+C');
  });

  it('replace confirmation copy follows §6.4, dropping a blank name and its commas', () => {
    expect(confirmPresetTitle('Willow')).toBe('Load Willow?');
    expect(confirmPresetAction('Willow')).toBe('Load Willow');
    expect(confirmPresetBody('Mine')).toBe(
      'This replaces your current shell, \u201c\u2068Mine\u2069\u201d, and its breaks, and goes back to Break 1. Sky and display settings stay as they are.',
    );
    expect(confirmPresetBody('  ')).toBe(
      'This replaces your current shell and its breaks, and goes back to Break 1. Sky and display settings stay as they are.',
    );
    expect(confirmApplyBody('Mine', true)).toBe(
      'This replaces your current shell, \u201c\u2068Mine\u2069\u201d, including its breaks and sky, with the shell in the JSON panel. Display settings stay as they are.',
    );
    expect(confirmApplyBody('', true)).toBe(
      'This replaces your current shell, including its breaks and sky, with the shell in the JSON panel. Display settings stay as they are.',
    );
    expect(confirmApplyBody('Mine', false)).toBe(
      'This replaces your current shell, \u201c\u2068Mine\u2069\u201d, and its breaks with the shell in the JSON panel. Sky and display settings stay as they are.',
    );
    expect(confirmApplyBody('', false)).toBe(
      'This replaces your current shell and its breaks with the shell in the JSON panel. Sky and display settings stay as they are.',
    );
    expect(confirmApplyBody('<b>x</b>', true)).toContain('\u201c\u2068<b>x</b>\u2069\u201d');
  });
});
