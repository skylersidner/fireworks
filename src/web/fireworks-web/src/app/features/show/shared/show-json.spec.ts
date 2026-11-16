import { doneWhenShow } from '../../../testing/show-fixtures';
import { CUE_FIELD_LABELS, FIELD_LABELS } from '../../../../engine/model/labels';
import { formatTime } from './show-copy';
import {
  SHOW_JSON_SHELL_PASTED,
  parseShowJson,
  showJsonConfirmBody,
  showJsonText,
} from './show-json';

const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const iso = (s: string) => `${FSI}${s}${PDI}`;

interface NodeFs {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(p: string, e: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };

/** phase-7.md §9.2, §9.4; acceptance 7k.7, 7k.8, 7k.9, 7k.10. */
describe('Show JSON notes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (): any => JSON.parse(JSON.stringify(doneWhenShow()));

  it('a clean paste: Applied.; the text is the document, 2-space pretty-printed', () => {
    const show = doneWhenShow();
    const r = parseShowJson(showJsonText(show));
    expect(r.ok && r.note).toBe('Applied.');
    expect(r.ok && r.show).toEqual(show);
    expect(showJsonText(show)).toBe(JSON.stringify(show, null, 2));
  });

  it('values adjusted name cue paths by launch time (never cues[3].seed raw)', () => {
    const d = doc();
    d.cues[3].x = 5;
    d.shells.s6.breaks[0].stars = 100000;
    const r = parseShowJson(JSON.stringify(d));
    const t3 = formatTime(d.cues[3].t);
    expect(r.ok && r.note).toBe(
      `Applied, with 2 values adjusted: Stars (${iso('Peony')}, Break 1), Position (Cue at ${t3}).`,
    );
    expect(r.ok && r.note).not.toMatch(/cues\[|shells\./);
  });

  it('unknown fields: show-level, cue and shell forms', () => {
    const d = doc();
    d.theme = 1;
    d.cues[1].sparkle = 1;
    d.shells.s6.breaks[0].sparkle = 1;
    const r = parseShowJson(JSON.stringify(d));
    expect(r.ok && r.note).toBe(
      `Applied. 3 unknown fields were ignored: theme, sparkle (${iso('Peony')}, Break 1), sparkle (Cue at ${formatTime(d.cues[1].t)}).`,
    );
  });

  it('an embedded shell sky is dropped with the caveat (one, then several); a success', () => {
    const d = doc();
    d.shells.s6.sky = { gravity: 1, wind: 0 };
    const one = parseShowJson(JSON.stringify(d));
    expect(one.ok).toBe(true);
    expect(one.ok && Object.hasOwn(one.show.shells['s6'], 'sky')).toBe(false);
    expect(one.ok && one.note).toBe(
      `Applied. Shells in a show play under the show's sky, so ${iso('Peony')}'s own sky was removed.`,
    );
    d.shells.s3.sky = {};
    d.shells.s1.sky = {};
    const many = parseShowJson(JSON.stringify(d));
    expect(many.ok && many.note).toBe(
      `Applied. Shells in a show play under the show's sky, so 3 shells' own skies were removed: ${iso('Crossette')}, ${iso('Willow')}, ${iso('Peony')}.`,
    );
  });

  it('not JSON, a shell pasted here, an invalid show', () => {
    const bad = parseShowJson('{');
    expect(!bad.ok && bad.note).toMatch(
      /^Couldn't apply: this isn't valid JSON \(.+\)\. Nothing changed\.$/,
    );
    const shell = parseShowJson(JSON.stringify({ version: 1, name: 'x', breaks: [] }));
    expect(!shell.ok && shell.note).toBe(SHOW_JSON_SHELL_PASTED);
    const d = doc();
    d.cues[3].seed = 1.5;
    const inv = parseShowJson(JSON.stringify(d));
    expect(!inv.ok && inv.note).toBe(
      `Couldn't apply: Seed (Cue at ${formatTime(d.cues[3].t)}) must be a whole number. Nothing changed.`,
    );
  });

  it('1000 broken cues: at most 5 reasons, then "; and k more problems" (≤ 6 clauses)', () => {
    const d = doc();
    d.cues = Array.from({ length: 1000 }, (_, i) => ({ ...d.cues[0], id: `c${i + 1}`, seed: 0.5 }));
    const r = parseShowJson(JSON.stringify(d));
    expect(r.ok).toBe(false);
    const note = !r.ok ? r.note : '';
    expect(note).toMatch(/; and 995 more problems\. Nothing changed\.$/);
    expect(note.split('; ').length).toBeLessThanOrEqual(6);
  });

  it('six broken cues: "; and 1 more problem", singular (phase-7.md §9.2, C2-4)', () => {
    const d = doc();
    d.cues = Array.from({ length: 6 }, (_, i) => ({ ...d.cues[0], id: `c${i + 1}`, seed: 0.5 }));
    const r = parseShowJson(JSON.stringify(d));
    const note = !r.ok ? r.note : '';
    // Negative control: the old template read "; and 1 more problems".
    expect(note).not.toContain('more problems');
    expect(note).toMatch(/; and 1 more problem\. Nothing changed\.$/);
  });

  it('the confirm body, and its blank-name variant', () => {
    expect(showJsonConfirmBody('Finale')).toBe(
      `This replaces your current show, “${iso('Finale')}”, including its cues, shells and sky. Display settings stay as they are.`,
    );
    expect(showJsonConfirmBody(' ')).toBe(
      'This replaces your current show including its cues, shells and sky. Display settings stay as they are.',
    );
  });

  it('CUE_FIELD_LABELS lives next to FIELD_LABELS; show-copy no longer declares CUE_FIELDS (7k.9)', () => {
    expect(CUE_FIELD_LABELS['t']).toBe('Launch time');
    expect(FIELD_LABELS['stars']).toBe('Stars');
    const fs = process.getBuiltinModule('node:fs');
    const copy = fs.readFileSync(
      `${process.cwd()}/src/app/features/show/shared/show-copy.ts`,
      'utf8',
    );
    expect(copy).not.toMatch(/\bCUE_FIELDS\b/);
  });

  /** 7k.8: no show surface imports bare fieldLabel; only show-copy (which builds showFieldLabel). */
  function bareFieldLabelImports(files: Record<string, string>): string[] {
    return Object.entries(files)
      .filter(([, text]) =>
        /import\s*\{[^}]*\bfieldLabel\b[^}]*\}\s*from\s*'[^']*engine\/model\/labels'/.test(text),
      )
      .map(([p]) => p)
      .filter((p) => p !== 'show-copy.ts')
      .sort();
  }
  const fs = process.getBuiltinModule('node:fs');
  const ROOT = `${process.cwd()}/src/app/features/show`;
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts'))
        files[p.slice(ROOT.length + 1).replace(/^shared\//, '')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(ROOT);

  it('no show surface imports bare fieldLabel (7k.8)', () => {
    expect(files['show-copy.ts']).toContain('fieldLabel');
    expect(bareFieldLabelImports(files)).toEqual([]);
  });

  it('negative control: a show file importing fieldLabel is caught', () => {
    const mutated = {
      ...files,
      'show-json.ts': `import { fieldLabel } from '../../../../engine/model/labels';\n${files['show-json.ts']}`,
    };
    expect(bareFieldLabelImports(mutated)).toEqual(['show-json.ts']);
  });
});
