import type { ShellIssue } from '../../../../engine/model/normalize';
import { retryWhen } from '../../../shared/link-copy';
import { issueReason, unknownKeyName } from './designer-copy';
import { invalidStatus, ownerNote, reasons, saveFailureStatus, savedToast } from './save-copy';

const issue = (
  path: string,
  code: ShellIssue['code'],
  extra: Partial<ShellIssue> = {},
): ShellIssue => ({
  path,
  code,
  message: 'developer text <b>evil.example</b>',
  ...extra,
});

describe('F12: unknown keys in the Apply note (phase-5.md §11.1)', () => {
  const RLO = String.fromCharCode(0x202e);
  const FFFD = String.fromCharCode(0xfffd);
  it.each([
    ['breaks[1].sparkle', 'sparkle (Break 2)'],
    ['theme', 'theme'],
    ['sky.theme', 'theme (Sky)'],
    ['["a.b"]', '\u201ca.b\u201d'],
    ['[""]', '\u201c\u201d'],
    ['breaks[0]["a\\"b"]', '\u201ca"b\u201d (Break 1)'],
    ['["a\nb"]', '\u201ca\\nb\u201d'],
    [`sky["${RLO}evil"]`, '\u201c\\u202eevil\u201d (Sky)'],
    [`["st${FFFD}ars"]`, `\u201cst${FFFD}ars\u201d`],
    ['["a\\\\b"]', '\u201ca\\\\b\u201d'],
    ['["tab\there"]', '\u201ctab\\there\u201d'],
    [`["nb${String.fromCharCode(0xa0)}sp"]`, '\u201cnb\\u00a0sp\u201d'],
    [`["zw${String.fromCharCode(0x200b)}"]`, '\u201czw\\u200b\u201d'],
    [`["esc${String.fromCharCode(0x1b)}"]`, '\u201cesc\\u001b\u201d'],
  ])('%j → %j', (path, shown) => {
    expect(unknownKeyName(path)).toBe(shown);
  });

  it('cuts at 40 code points after escaping, the ellipsis inside the quote', () => {
    expect(unknownKeyName(`["${'a'.repeat(50)}"]`)).toBe(`\u201c${'a'.repeat(40)}\u2026\u201d`);
    expect(unknownKeyName(`["${'\n'.repeat(30)}"]`)).toBe(`\u201c${'\\n'.repeat(20)}\u2026\u201d`);
    expect(unknownKeyName('x'.repeat(41))).toBe(`${'x'.repeat(40)}\u2026`);
  });
});

describe('issueReason for Save-time codes (phase-5.md §11.2; F11)', () => {
  it.each<[ShellIssue, string]>([
    [
      issue('breaks[0].stars', 'type', { options: ['integer'] }),
      'Stars (Break 1) must be a whole number',
    ],
    [issue('name', 'type', { options: ['string'] }), 'Name must be text'],
    [issue('burstHeight', 'missing'), 'Burst height is missing'],
    [issue('name', 'missing'), 'Name is blank'],
    [issue('sky', 'missing', { value: null }), 'Sky is null; remove it instead'],
    [
      issue('breaks[1].speed', 'out-of-range', { value: 900 }),
      'Burst speed (Break 2) 900 is outside 60 to 400',
    ],
    [issue('sky.wind', 'out-of-range'), 'Wind is outside -80 to 80'],
    [issue('breaks[0].stars', 'not-integer'), 'Stars (Break 1) must be a whole number'],
    [issue('name', 'too-long'), 'Name is longer than 80 characters'],
    [
      issue('breaks[0].sparkle', 'unknown-property'),
      "sparkle (Break 1) isn't a field this app knows",
    ],
    [issue('name', 'name-format'), 'Name has spaces at its ends or hidden characters'],
    [issue('', 'not-json' as ShellIssue['code']), "the data sent wasn't valid JSON"],
    [
      issue('angleJitter', 'duplicate-key' as ShellIssue['code']),
      'Angle jitter appears more than once',
    ],
    [issue('shells', 'shell-count'), 'a show can have up to 32 shells'],
    [issue('cues', 'cue-count'), 'a show needs 1 to 1000 cues'],
    [issue('shells.s1', 'key-format'), "shells.s1 isn't valid"],
  ])('%j', (i, text) => {
    expect(issueReason(i)).toBe(text);
    expect(issueReason(i)).not.toContain('evil.example');
  });
});

describe('Save copy (phase-5.md §2, §3.2, §6)', () => {
  it('reasons: three, then "and k more", or "and more" when truncated', () => {
    const four = ['name', 'burstHeight', 'angleJitter', 'version'].map((p) => issue(p, 'missing'));
    expect(reasons(four.slice(0, 3))).toBe(
      'Name is blank; Burst height is missing; Angle jitter is missing',
    );
    expect(reasons(four)).toBe(
      'Name is blank; Burst height is missing; Angle jitter is missing, and 1 more',
    );
    expect(reasons(four.slice(0, 2), true)).toBe(
      'Name is blank; Burst height is missing, and more',
    );
  });

  it('the client strict check reads as row 400b with a Reload button', () => {
    expect(invalidStatus([issue('name', 'too-long')])).toEqual({
      tone: 'error',
      text: "Couldn't save: the server didn't accept this shell (Name is longer than 80 characters). Reloading the page usually fixes this. Your shell is kept in this browser.",
      actions: ['reload'],
    });
  });

  it('a 400 without a structured body still reads as 400b, never the server message', () => {
    const s = saveFailureStatus(
      {
        kind: 'validation',
        status: 400,
        message: '<b>evil.example</b>',
        errors: [],
        truncated: false,
      },
      'create',
      '',
    );
    expect(s.text).not.toContain('evil.example');
  });

  it('a 404 on a create (never expected) reads as a server fault', () => {
    expect(saveFailureStatus({ kind: 'not-found', status: 404 }, 'create', '').actions).toEqual([
      'retry',
    ]);
  });

  it('owner note falls back when the saved name is unknown', () => {
    expect(ownerNote('')).toBe(
      'Update original changes what its share link plays. Save as new keeps it and makes a new link.',
    );
  });

  it.each([
    ['create', false, 'Saved \u201c\u2068X\u2069\u201d.'],
    ['update', false, 'Updated \u201c\u2068X\u2069\u201d. Its share link plays this version now.'],
    ['remix', true, 'Saved \u201c\u2068X\u2069\u201d as a new creation with its own link.'],
    ['remix', false, 'Saved \u201c\u2068X\u2069\u201d as your own copy.'],
  ] as const)('%s toast', (request, owner, text) => {
    expect(savedToast(request, owner, 'X')).toBe(text);
  });

  it.each([
    [null, 'in a minute'],
    [1, 'in 1 second'],
    [42, 'in 42 seconds'],
    [60, 'in 1 minute'],
    [61, 'in 2 minutes'],
    [5400, 'in 90 minutes'],
    [5401, 'in about 2 hours'],
    [3600 * 20, 'in about 20 hours'],
  ])('retryWhen(%s) → %s', (seconds, text) => {
    expect(retryWhen(seconds)).toBe(text);
  });
});
