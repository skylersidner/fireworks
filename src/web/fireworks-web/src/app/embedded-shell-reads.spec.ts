// @vitest-environment node
/**
 * Boo F3 guard (yoshi-phase7-architecture-rulings.md point 5, Boo P7-S15). A show's `shells` is a
 * plain object after any spread or `structuredClone`, so `shells[key]` with a key like
 * `constructor` returns `Object.prototype.constructor`, and `key in shells` is true for it. Every
 * read of an embedded shell by key goes through `embeddedShell` (engine/model/show.ts). This spec
 * reads the source tree (every non-spec `.ts` and `.html` under src/app and src/engine) and allows
 * a `.shells[` access only in the files that own the map.
 */
import { embeddedShell, type EmbeddedShell, type ShowDocument } from '../engine/model/show';
import { normalizeShow } from '../engine/model/normalize';
import { doneWhenShow } from './testing/show-fixtures';

interface Dirent {
  name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const fs = process.getBuiltinModule('node:fs');
const SRC = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(SRC.length + 1);
const files = [...walk(`${SRC}/app`), ...walk(`${SRC}/engine`)].map((p) => ({
  path: rel(p),
  text: fs.readFileSync(p, 'utf8'),
}));

/**
 * The files that may index `shells` directly, each with its reason:
 *  - normalize.ts builds the null-prototype map from untrusted JSON (keys checked by KEY_PATTERN);
 *  - show.ts is the helper itself;
 *  - show-edit.ts is the only writer after normalize (add and remove, keys it generates);
 *  - sim/simulation.ts's `this.shells[s]` is the sim's own in-flight array, not a show's map.
 */
export const SHELLS_INDEX_ALLOWED = [
  'engine/model/normalize.ts',
  'engine/model/show.ts',
  'app/features/show/shared/show-edit.ts',
  'engine/sim/simulation.ts',
];

/** Code with comments removed (a doc comment may name the pattern). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `x.shells[k]`, `x.shells?.[k]` and `x.shells [k]`, in TS and in templates. */
export const SHELLS_INDEX = /\.shells\s*(?:\?\.)?\s*\[/;
/** Membership by `in` or a `for…in` over a shells map: never (rule 2). */
export const SHELLS_IN = /\bin\s+[\w$.?()]*\bshells\b/;

/** `path:line: text` for every offending line. */
export function shellsOffenses(
  list: readonly { path: string; text: string }[],
  allowed: readonly string[] = SHELLS_INDEX_ALLOWED,
): string[] {
  const out: string[] = [];
  for (const f of list) {
    const lines = code(f.text).split('\n');
    lines.forEach((line, i) => {
      const index = SHELLS_INDEX.test(line) && !allowed.includes(f.path);
      if (index || SHELLS_IN.test(line)) out.push(`${f.path}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe('embedded shells are read by own key only (Boo F3)', () => {
  it('sees the files it checks', () => {
    for (const f of [
      'app/features/show/pages/show-builder-page/show-builder-page.html',
      'app/features/show/pages/show-builder-page/show-builder-page.ts',
      'app/features/player/pages/player-page/player-page.ts',
      'engine/loop/timeline-driver.ts',
      ...SHELLS_INDEX_ALLOWED,
    ]) {
      expect(
        files.some((x) => x.path === f),
        f,
      ).toBe(true);
    }
  });

  it('no `.shells[` outside the owning files, and no `in` over shells anywhere', () => {
    expect(shellsOffenses(files)).toEqual([]);
  });

  it('negative controls: a bare read, an optional read, a template read and `in` are caught', () => {
    const bad = [
      { path: 'app/x.ts', text: 'const s = show.shells[cue.shell];' },
      { path: 'app/y.ts', text: 'const s = this.store.show().shells?.[key];' },
      { path: 'app/z.html', text: '<bdi>{{ store.show().shells[cue.shell]?.name }}</bdi>' },
      { path: 'engine/model/show.ts', text: 'if (key in show.shells) return 1;' },
      { path: 'app/w.ts', text: 'for (const k in show.shells) n++;' },
    ];
    expect(shellsOffenses(bad)).toHaveLength(5);
    // The allowlist is what lets the owners through: the same read there passes.
    expect(shellsOffenses([{ path: 'engine/model/show.ts', text: 'show.shells[key]' }])).toEqual(
      [],
    );
    // A comment naming the pattern is not code.
    expect(shellsOffenses([{ path: 'app/c.ts', text: '// show.shells[key] is banned' }])).toEqual(
      [],
    );
  });
});

describe('embeddedShell (Toad round-trip keys, direct case)', () => {
  const proto = (doc: ShowDocument): ShowDocument => ({ ...doc, shells: { ...doc.shells } });

  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    it(`is undefined for "${key}" on a show without it, where a plain lookup is not`, () => {
      const show = proto(doneWhenShow()); // an Object.prototype map, as after any spread
      expect(embeddedShell(show, key)).toBeUndefined();
      // Negative control: the bare lookup the helper replaces returns an Object.prototype member.
      expect((show.shells as Record<string, unknown>)[key]).toBeDefined();
    });
  }

  it('returns an own shell, including one keyed "constructor"', () => {
    const show = proto(doneWhenShow());
    const s1 = embeddedShell(show, 's1') as EmbeddedShell;
    expect(s1.name).toBe(show.shells['s1'].name);
    const opened = normalizeShow({
      ...show,
      shells: { constructor: s1 },
      cues: [{ ...show.cues[0], shell: 'constructor' }],
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(embeddedShell(opened.show, 'constructor')?.name).toBe(s1.name);
  });
});
