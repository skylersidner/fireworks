import { doneWhenShow } from '../../../testing/show-fixtures';
import {
  confirmNewBody,
  confirmOpenShowBody,
  formatClock,
  formatTime,
  showFieldLabel,
  showIssueReason,
  spokenTime,
} from './show-copy';

const FSI = '⁨';
const PDI = '⁩';

describe('show copy (phase-6.md header, §10.3, §15)', () => {
  it('formats times as m:ss.s and spoken text', () => {
    expect(formatTime(12.5)).toBe('0:12.5');
    expect(formatTime(600)).toBe('10:00.0');
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatClock(67)).toBe('1:07');
    expect(spokenTime(12.5)).toBe('12.5 seconds');
    expect(spokenTime(62.5)).toBe('1 minute 2.5 seconds');
    expect(spokenTime(120)).toBe('2 minutes');
  });

  it('blank names drop ", {name}," mechanically', () => {
    expect(confirmNewBody('', 3)).toBe(
      'This replaces your current show and its 3 cues with an empty show. Display settings stay as they are.',
    );
    expect(confirmOpenShowBody(' ', 'B')).toBe(
      `This replaces your current show including its cues, shells and sky, with a copy of “${FSI}B${PDI}”. Display settings stay as they are.`,
    );
  });

  it('labels show paths by cue time and shell name (Peach N1; 6f.7)', () => {
    const show = doneWhenShow();
    const t3 = formatTime(show.cues[3].t);
    expect(showFieldLabel('cues[3].seed', show)).toBe(`Seed (Cue at ${t3})`);
    expect(showFieldLabel('duration', show)).toBe('Duration');
    expect(showFieldLabel('sky.wind', show)).toBe('Wind (Sky)');
    expect(showFieldLabel('shells.s1.breaks[0].stars', show)).toBe(
      `Stars (${FSI}Crossette${PDI}, Break 1)`,
    );
    expect(showFieldLabel('shells.s1.burstHeight', show)).toBe(
      `Burst height (${FSI}Crossette${PDI})`,
    );
    expect(showFieldLabel('cues[99].x', show)).toBe('Position (Cue 100)');
    expect(showFieldLabel('shells.zz.name', show)).toBe('Name (shell “zz”)');
  });

  it('words issues with those labels, never the raw path', () => {
    const show = doneWhenShow();
    const t0 = formatTime(show.cues[0].t);
    expect(
      showIssueReason(
        { path: 'cues[0].seed', code: 'type', message: '', options: ['integer'] },
        show,
      ),
    ).toBe(`Seed (Cue at ${t0}) must be a whole number`);
    expect(
      showIssueReason(
        { path: 'shells.s1.breaks[0].stars', code: 'out-of-range', message: '', value: 900 },
        show,
      ),
    ).toBe(`Stars (${FSI}Crossette${PDI}, Break 1) 900 is outside 4 to 400`);
    expect(
      showIssueReason({ path: 'cues[3].x', code: 'out-of-range', message: '', value: 2 }, show),
    ).toBe(`Position (Cue at ${formatTime(show.cues[3].t)}) 2 is outside 0 to 1`);
    expect(
      showIssueReason({ path: 'cues[1].id', code: 'duplicate-id', message: '', value: 'c2' }, show),
    ).toBe('Cue id c2 is used by more than one cue');
    expect(
      showIssueReason({ path: 'cues[0].shell', code: 'unknown-shell', message: '' }, show),
    ).toBe(`Shell (Cue at ${t0}) names a shell this show doesn't have`);
    expect(
      showIssueReason({ path: 'shells', code: 'key-format', message: '', value: '9x' }, show),
    ).toBe(
      "shell key “9x” isn't valid: use up to 12 letters, digits, - or _, starting with a letter",
    );
  });
});
