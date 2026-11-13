// @vitest-environment node
/**
 * Shared fixtures are well-formed (docs/fireworks-app/schema.md §12; owner Toad). This spec checks
 * the files, not a validator: `schema-fixtures.spec.ts` (Luigi) runs them through `validate.ts`, and
 * the C# harness (Bowser) runs them through the API. A malformed fixture would make both runners
 * test the wrong thing in the same way, so the shape is checked here on its own:
 *  - the folder set is exactly valid/{shell,show}, invalid/{shell,show}, server-only, upgrade;
 *  - every file parses, has a non-empty description and exactly the keys its folder allows;
 *  - `kind` matches the folder; `errors` is present exactly under invalid/ (and server-only 400s);
 *  - every error is `{ path, code }` with a well-formed path (§6.2 rule 11: plain names after `.`,
 *    others as `["name"]`, well-formed Unicode), sorted by path then code, and every code comes
 *    from the schema.md §6.3 table (server-only codes only in server-only/);
 *  - server-only bodies: valid JSON exactly when no not-json is expected; `byteMarkers` bodies are
 *    valid JSON as text and invalid UTF-8 as bytes; `contentType` only on the 415; the repeated
 *    names in each body are exactly its duplicate-key paths (a JSON.parse can't see them);
 *  - together the fixtures use every §6.3 code (one fixture per rule, at least);
 *  - preset fixtures are `PRESETS` value for value; the `__proto__` fixture really has that own
 *    key; boundary fixtures sit on schema/limits.json; the max show is at every cap and under
 *    256 KiB as a compact, \u-escaped `{ kind, document }` body;
 *  - upgrade/ holds no fixtures while SHELL_VERSION is 1.
 */
import { PRESETS } from './presets';
import { SHELL_VERSION } from './shell';

interface Dirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface NodeFs {
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };

const fs = process.getBuiltinModule('node:fs');
const REPO = `${process.cwd()}/../../..`;
const ROOT = `${REPO}/schema/fixtures`;
const REQUEST_LIMIT = 262144;

type Json = Record<string, unknown>;
interface FileEntry {
  readonly rel: string;
  readonly dir: string;
  readonly name: string;
  readonly text: string;
}

function walk(dir: string, out: FileEntry[] = []): FileEntry[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) {
      const rel = path.slice(ROOT.length + 1);
      const cut = rel.lastIndexOf('/');
      out.push({
        rel,
        dir: cut < 0 ? '' : rel.slice(0, cut),
        name: rel.slice(cut + 1),
        text: fs.readFileSync(path, 'utf8'),
      });
    }
  }
  return out;
}

function dirsUnder(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel, ...dirsUnder(`${dir}/${entry.name}`, rel));
  }
  return out;
}

/** The §6.3 code table: `{ code, serverOnly }` per row (the Lenient column is "—" for server-only). */
function docCodes(): { all: Set<string>; serverOnly: Set<string> } {
  const doc = fs.readFileSync(`${REPO}/docs/fireworks-app/schema.md`, 'utf8');
  const start = doc.indexOf('### 6.3');
  const end = doc.indexOf('### 6.4');
  if (start < 0 || end < start) throw new Error('schema.md: §6.3 not found');
  const all = new Set<string>();
  const serverOnly = new Set<string>();
  for (const line of doc.slice(start, end).split('\n')) {
    const m = /^\|\s*`([a-z-]+)`\s*\|[^|]*\|\s*([^|]*?)\s*\|/.exec(line);
    if (!m) continue;
    all.add(m[1]);
    if (m[2] === '—') serverOnly.add(m[1]);
  }
  return { all, serverOnly };
}

/** schema.md §6.2 rule 11. */
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const SEGMENT = /\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]|\["((?:[^"\\]|\\["\\])*)"\]|^([A-Za-z_][A-Za-z0-9_-]*)/y;
type Segment = { name: string } | { index: number };

/**
 * Splits a path into its segments, or null when it isn't a rule 11 path: plain names after `.`
 * (or first), `[n]` indexes, and `["name"]` for every other name, with only `\` and `"` escaped
 * and no unpaired surrogate. A bracketed name that is plain must have been written plainly.
 */
function segments(path: string): Segment[] | null {
  if (!wellFormed(path)) return null;
  const out: Segment[] = [];
  SEGMENT.lastIndex = 0;
  while (SEGMENT.lastIndex < path.length) {
    const at = SEGMENT.lastIndex;
    const m = SEGMENT.exec(path);
    if (!m) return null;
    if (m[1] !== undefined && at === 0) return null; // a path doesn't start with "."
    if (m[2] !== undefined && at === 0) return null; // nor with an index
    if (m[3] !== undefined) {
      const name = m[3].replace(/\\(["\\])/g, '$1');
      if (PLAIN_NAME.test(name)) return null;
      out.push({ name });
    } else if (m[2] !== undefined) out.push({ index: Number(m[2]) });
    else out.push({ name: m[1] ?? m[4] });
  }
  return out;
}
const isPath = (path: string) => segments(path) !== null;
function lastName(path: string): string {
  const last = segments(path)?.at(-1);
  if (!last || !('name' in last)) throw new Error(`${path}: does not end in a name`);
  return last.name;
}
function wellFormed(s: string): boolean {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * The names that occur more than once in one object, anywhere in a JSON text (`JSON.parse` keeps
 * the last silently). `raws` are the name tokens as written, so an escaped repeat is visible.
 */
function repeatedNames(text: string): { name: string; raws: string[] }[] {
  const out: { name: string; raws: string[] }[] = [];
  let i = 0;
  const ws = () => {
    while (' \t\n\r'.includes(text[i] ?? 'x')) i++;
  };
  const str = () => {
    const start = i++;
    while (text[i] !== '"') {
      if (i >= text.length) throw new Error('unterminated string');
      i += text[i] === '\\' ? 2 : 1;
    }
    i++;
    return text.slice(start, i);
  };
  const value = (): void => {
    ws();
    if (text[i] === '{') {
      i++;
      const seen = new Map<string, string[]>();
      ws();
      if (text[i] === '}') return void i++;
      for (;;) {
        ws();
        const raw = str();
        const name = JSON.parse(raw) as string;
        seen.set(name, [...(seen.get(name) ?? []), raw]);
        ws();
        i++; // ':'
        value();
        ws();
        if (text[i++] !== ',') break;
      }
      for (const [name, raws] of seen) if (raws.length > 1) out.push({ name, raws });
    } else if (text[i] === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (text[i++] !== ',') break;
      }
    } else if (text[i] === '"') str();
    else while (i < text.length && !',]} \t\n\r'.includes(text[i])) i++;
  };
  value();
  return out;
}
/** A server-only body as bytes: UTF-8, with each `byteMarkers` marker replaced by its hex bytes. */
function bodyBytes(body: string, markers: Record<string, string>): Uint8Array {
  const out: number[] = [];
  const entries = Object.entries(markers);
  let text = '';
  const flush = () => {
    out.push(...new TextEncoder().encode(text));
    text = '';
  };
  for (let i = 0; i < body.length; ) {
    const hit = entries.find(([marker]) => body.startsWith(marker, i));
    if (hit) {
      flush();
      out.push(...hit[1].match(/../g)!.map((h) => parseInt(h, 16)));
      i += hit[0].length;
    } else text += body[i++];
  }
  flush();
  return Uint8Array.from(out);
}
const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.json$/;
const EXPECTED_DIRS = [
  'invalid',
  'invalid/shell',
  'invalid/show',
  'server-only',
  'upgrade',
  'valid',
  'valid/shell',
  'valid/show',
];
const FIXTURE_DIRS = new Set(['valid/shell', 'valid/show', 'invalid/shell', 'invalid/show']);

const files = walk(ROOT);
const jsonFiles = files.filter((f) => f.name.endsWith('.json'));
const parsed = new Map<string, Json>();
for (const f of jsonFiles) {
  try {
    parsed.set(f.rel, JSON.parse(f.text) as Json);
  } catch {
    // reported by the 'parses' test
  }
}
const inDir = (dir: string) => jsonFiles.filter((f) => f.dir === dir);
const doc = (rel: string) => parsed.get(rel)?.['document'] as Json;
const limits = JSON.parse(fs.readFileSync(`${REPO}/schema/limits.json`, 'utf8')) as Record<
  string,
  { min: number; max: number | string }
>;
const codes = docCodes();

function errorsOf(f: Json): { path: string; code: string }[] {
  return f['errors'] as { path: string; code: string }[];
}

describe('schema fixtures are well-formed', () => {
  it('the folder set is exactly the §12.1 layout, and no file sits outside it', () => {
    expect(dirsUnder(ROOT).sort()).toEqual(EXPECTED_DIRS);
    const misplaced = jsonFiles.filter((f) => !FIXTURE_DIRS.has(f.dir) && f.dir !== 'server-only');
    expect(misplaced.map((f) => f.rel)).toEqual([]);
    const strays = files.filter((f) => !f.name.endsWith('.json') && f.rel !== 'upgrade/README.md');
    expect(strays.map((f) => f.rel)).toEqual([]);
  });

  it('there are fixtures in every folder (no vacuous pass)', () => {
    for (const dir of [...FIXTURE_DIRS, 'server-only']) {
      expect(inDir(dir).length, dir).toBeGreaterThan(0);
    }
  });

  it.each(jsonFiles.map((f) => [f.rel, f] as const))('%s parses and is named in kebab case', (_rel, f) => {
    expect(() => JSON.parse(f.text)).not.toThrow();
    expect(f.name).toMatch(FILE_NAME);
  });

  it.each(jsonFiles.filter((f) => FIXTURE_DIRS.has(f.dir)).map((f) => [f.rel, f] as const))(
    '%s has a description, the folder kind, and errors exactly when invalid',
    (_rel, f) => {
      const fx = parsed.get(f.rel)!;
      const [group, kind] = f.dir.split('/');
      const keys = group === 'invalid' ? ['description', 'document', 'errors', 'kind'] : ['description', 'document', 'kind'];
      expect(Object.keys(fx).sort()).toEqual(keys);
      expect(typeof fx['description'] === 'string' && fx['description'].trim().length > 0).toBe(true);
      expect(fx['kind']).toBe(kind);
      if (group === 'invalid') {
        const errors = errorsOf(fx);
        expect(Array.isArray(errors) && errors.length > 0).toBe(true);
        for (const e of errors) {
          expect(Object.keys(e).sort()).toEqual(['code', 'path']);
          expect(isPath(e.path), `${JSON.stringify(e.path)} is a rule 11 path`).toBe(true);
          expect(codes.all.has(e.code), `${e.code} is a §6.3 code`).toBe(true);
          expect(codes.serverOnly.has(e.code), `${e.code} is server-only`).toBe(false);
        }
        const keyed = errors.map((e) => [e.path, e.code]);
        const sorted = [...keyed].sort(([p1, c1], [p2, c2]) =>
          p1 < p2 ? -1 : p1 > p2 ? 1 : c1 < c2 ? -1 : c1 > c2 ? 1 : 0,
        );
        expect(keyed, 'errors sorted by path, then code').toEqual(sorted);
      }
    },
  );

  it.each(inDir('server-only').map((f) => [f.rel, f] as const))(
    '%s is a raw body with a status, and errors exactly when the status is 400',
    (_rel, f) => {
      const fx = parsed.get(f.rel)!;
      const status = fx['status'];
      expect([400, 413, 415]).toContain(status);
      const keys = ['body', 'description', 'status'];
      if (status === 400) keys.push('errors');
      if (status === 415) keys.push('contentType');
      if (Object.hasOwn(fx, 'byteMarkers')) keys.push('byteMarkers');
      expect(Object.keys(fx).sort()).toEqual(keys.sort());
      expect(typeof fx['description'] === 'string' && fx['description'].trim().length > 0).toBe(true);
      expect(typeof fx['body']).toBe('string');
      const body = fx['body'] as string;
      // The C# harness reads body with GetString, which throws on an unpaired surrogate.
      expect(wellFormed(body), 'body is well-formed Unicode').toBe(true);
      const errors = status === 400 ? errorsOf(fx) : [];
      const isNotJson = errors.some((e) => e.code === 'not-json');
      if (Object.hasOwn(fx, 'byteMarkers')) {
        // The bytes are the only defect: as text the body parses; as bytes it isn't UTF-8.
        const markers = fx['byteMarkers'] as Record<string, string>;
        expect(Object.keys(markers).length).toBeGreaterThan(0);
        for (const [marker, hex] of Object.entries(markers)) {
          expect(marker).toMatch(/^[\x21-\x7e]+$/);
          expect(body.split(marker).length - 1, `${marker} occurs once`).toBe(1);
          expect(hex).toMatch(/^([0-9a-f]{2})+$/);
        }
        expect(errors).toEqual([{ path: '', code: 'not-json' }]);
        expect(() => JSON.parse(body)).not.toThrow();
        const bytes = bodyBytes(body, markers);
        expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
      } else if (isNotJson) expect(() => JSON.parse(body)).toThrow();
      else expect(() => JSON.parse(body)).not.toThrow();
      if (status === 413) expect(body.length).toBeGreaterThan(REQUEST_LIMIT);
      if (status === 415) {
        expect(typeof fx['contentType']).toBe('string');
        expect(fx['contentType'] as string).not.toMatch(/^\s*application\/json\b/i);
        expect(body.length).toBeLessThan(REQUEST_LIMIT);
      }
      for (const e of errors) {
        expect(Object.keys(e).sort()).toEqual(['code', 'path']);
        expect(isPath(e.path), `${JSON.stringify(e.path)} is a rule 11 path`).toBe(true);
        expect(codes.all.has(e.code), `${e.code} is a §6.3 code`).toBe(true);
      }
    },
  );

  it.each(inDir('server-only').filter((f) => f.name !== 'duplicate-key-inside-unknown.json').map((f) => [f.rel, f] as const))(
    '%s repeats exactly the names its duplicate-key errors name',
    (_rel, f) => {
      const fx = parsed.get(f.rel)!;
      if (!Object.hasOwn(fx, 'errors') || errorsOf(fx).some((e) => e.code === 'not-json')) return;
      const expected = errorsOf(fx).filter((e) => e.code === 'duplicate-key').map((e) => lastName(e.path));
      const found = repeatedNames(fx['body'] as string).map((r) => r.name);
      expect(found.sort()).toEqual(expected.sort());
    },
  );

  it('duplicate-key-inside-unknown repeats a name only inside the unknown value', () => {
    const fx = parsed.get('server-only/duplicate-key-inside-unknown.json')!;
    expect(repeatedNames(fx['body'] as string).map((r) => r.name)).toEqual(['a']);
    expect(errorsOf(fx).some((e) => e.code === 'duplicate-key')).toBe(false);
    const document = (JSON.parse(fx['body'] as string) as Json)['document'] as Json;
    expect(errorsOf(fx)).toEqual([{ path: 'foo', code: 'unknown-property' }]);
    expect(Object.hasOwn(document, 'foo')).toBe(true);
  });

  it('duplicate-key-escaped really spells the repeat with an escape', () => {
    const fx = parsed.get('server-only/duplicate-key-escaped.json')!;
    const [stars] = repeatedNames(fx['body'] as string);
    expect(stars.name).toBe('stars');
    expect(new Set(stars.raws).size).toBe(stars.raws.length);
    expect(stars.raws.some((r) => r.includes('\\u'))).toBe(true);
  });

  it('valid and invalid fixture files repeat no name (JSON.parse would hide it)', () => {
    for (const f of jsonFiles.filter((x) => FIXTURE_DIRS.has(x.dir))) {
      expect(repeatedNames(f.text), f.rel).toEqual([]);
    }
  });

  it('unknown-key-lone-surrogate really has the unpaired surrogate in its break key', () => {
    const d = doc('invalid/shell/unknown-key-lone-surrogate.json');
    const keys = Object.keys((d['breaks'] as Json[])[0]);
    expect(keys).toContain('stars');
    const odd = keys.filter((k) => !wellFormed(k));
    expect(odd).toEqual(['st' + String.fromCharCode(0xd800) + 'ars']);
    const path = errorsOf(parsed.get('invalid/shell/unknown-key-lone-surrogate.json')!)[0].path;
    expect(lastName(path)).toBe('st' + String.fromCharCode(0xfffd) + 'ars');
  });

  it('together the fixtures use every §6.3 code, server-only codes only in server-only/', () => {
    expect(codes.all.size).toBeGreaterThan(10);
    expect(codes.serverOnly.size).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const f of jsonFiles) {
      const fx = parsed.get(f.rel);
      if (fx?.['errors']) for (const e of errorsOf(fx)) used.add(e.code);
    }
    expect([...used].sort()).toEqual([...codes.all].sort());
  });

  it('preset fixtures are PRESETS value for value, one per preset, with no sky', () => {
    const presetFiles = inDir('valid/shell').filter((f) => f.name.startsWith('preset-'));
    expect(presetFiles.length).toBe(PRESETS.length);
    for (const preset of PRESETS) {
      const slug = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const d = doc(`valid/shell/preset-${slug}.json`);
      expect(d, slug).toEqual(preset);
      expect(Object.hasOwn(d, 'sky'), slug).toBe(false);
    }
  });

  it('shell-key-proto really has an own "__proto__" key in shells', () => {
    const shells = doc('invalid/show/shell-key-proto.json')['shells'] as Json;
    expect(Object.hasOwn(shells, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(shells)).toBe(Object.prototype);
  });

  it('the raw-number fixtures kept their text forms', () => {
    const text = (rel: string) => jsonFiles.find((f) => f.rel === rel)!.text;
    expect(text('valid/shell/number-forms.json')).toMatch(/"version": 1\.0,/);
    expect(text('valid/shell/number-forms.json')).toMatch(/"stars": 1e2,/);
    expect(text('invalid/shell/burst-height-infinite.json')).toMatch(/"burstHeight": 1e400,/);
    expect(doc('invalid/shell/burst-height-infinite.json')['burstHeight']).toBe(Infinity);
    expect(text('valid/show/seed-extremes.json')).toMatch(/"seed": 1293847\.0\b/);
  });

  it('shell boundary fixtures sit exactly on schema/limits.json', () => {
    for (const [file, side] of [
      ['at-minimums', 'min'],
      ['at-maximums', 'max'],
    ] as const) {
      const d = doc(`valid/shell/${file}.json`);
      const at = (key: string) => limits[key][side];
      expect(d['burstHeight'], file).toBe(at('shell.burstHeight'));
      expect(d['angleJitter'], file).toBe(at('shell.angleJitter'));
      expect(d['sky'], file).toEqual({ gravity: at('sky.gravity'), wind: at('sky.wind') });
      const breaks = d['breaks'] as Json[];
      expect(breaks.length, file).toBe(at('shell.breaks.count'));
      for (const b of breaks) {
        for (const f of ['stars', 'speed', 'changeAt', 'burn', 'drag', 'size', 'delay']) {
          expect(b[f], `${file} ${f}`).toBe(at(`break.${f}`));
        }
      }
    }
  });

  it('the max show is at every cap and under 256 KiB as a compact, \\u-escaped body', () => {
    const d = doc('valid/show/at-maximums.json');
    const shells = d['shells'] as Record<string, Json>;
    const cues = d['cues'] as Json[];
    expect(d['duration']).toBe(limits['show.duration'].max);
    expect(Object.keys(shells).length).toBe(limits['show.shells.count'].max);
    expect(cues.length).toBe(limits['show.cues.count'].max);
    for (const s of Object.values(shells)) {
      expect((s['breaks'] as unknown[]).length).toBe(limits['shell.breaks.count'].max);
    }
    const body = JSON.stringify({ kind: 'show', document: d }).replace(
      /[\u007f-￿]/g,
      (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    expect(body.length).toBeLessThan(REQUEST_LIMIT);
  });

  it('upgrade/ holds no fixtures while the schema is at version 1', () => {
    expect(SHELL_VERSION).toBe(1);
    expect(files.filter((f) => f.dir.startsWith('upgrade')).map((f) => f.rel)).toEqual([
      'upgrade/README.md',
    ]);
  });
});
