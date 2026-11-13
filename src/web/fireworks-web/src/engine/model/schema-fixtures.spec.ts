// @vitest-environment node
/**
 * Shared fixture runner (docs/fireworks-app/schema.md §12). Reads repo-root `schema/fixtures/**`
 * through Node's fs (the cwd under `@angular/build:unit-test` is the workspace,
 * src/web/fireworks-web). Every valid fixture must pass strict validation; every invalid fixture
 * must produce exactly its `errors` multiset of `(path, code)`, nothing missing and nothing extra.
 * `server-only/` is the C# harness's (wire-level cases `JSON.parse` can't see) and is skipped.
 */
import { validateShell, validateShow } from './validate';

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
const ROOT = `${process.cwd()}/../../../schema/fixtures`;

interface Fixture {
  readonly file: string;
  readonly description: string;
  readonly kind: 'shell' | 'show';
  readonly document: unknown;
  readonly errors?: readonly { path: string; code: string }[];
  /** Set when the file couldn't be read as a fixture; that fixture's own test fails with it. */
  readonly loadError?: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

function load(group: 'valid' | 'invalid'): Fixture[] {
  const dir = `${ROOT}/${group}`;
  if (!fs.existsSync(dir)) return [];
  return walk(dir)
    .sort()
    .map((path): Fixture => {
      const file = path.slice(ROOT.length + 1);
      // A malformed fixture fails its own test, not the whole file at module load.
      const broken = (loadError: string): Fixture => ({
        file,
        description: '',
        kind: 'shell',
        document: undefined,
        loadError,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
      } catch (e) {
        return broken(`${file}: not readable JSON (${(e as Error).message})`);
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return broken(`${file}: the fixture must be a JSON object`);
      }
      const f = parsed as Omit<Fixture, 'file'>;
      // The folder names the kind too; a mismatch is a fixture bug.
      const folderKind = file.split('/')[1];
      if (f.kind !== folderKind) return broken(`${file}: kind ${f.kind} in ${folderKind}/`);
      if (group === 'invalid' && !Array.isArray(f.errors)) {
        return broken(`${file}: an invalid fixture needs an errors array`);
      }
      return { ...f, file };
    });
}

function validate(f: Fixture) {
  return f.kind === 'show' ? validateShow(f.document) : validateShell(f.document);
}

/** Sorted by path, then code, as schema.md §12.1 states the multiset. */
function ledger(items: readonly { path: string; code: string }[]): string[] {
  return items.map(({ path, code }) => `${path} :: ${code}`).sort();
}

const valid = load('valid');
const invalid = load('invalid');

describe('schema fixtures', () => {
  it('the fixture folder is readable from the Angular unit-test builder', () => {
    expect(fs.existsSync(ROOT)).toBe(true);
    // Guard against a vacuous pass: both groups and both kinds must be present.
    for (const group of [valid, invalid]) {
      expect(group.some((f) => f.kind === 'shell')).toBe(true);
      expect(group.some((f) => f.kind === 'show')).toBe(true);
    }
    for (const f of invalid.filter((x) => !x.loadError)) {
      expect(f.errors?.length, f.file).toBeGreaterThan(0);
    }
  });

  it.each(valid.map((f) => [f.file, f] as const))('valid: %s', (_file, f) => {
    expect(f.loadError).toBeUndefined();
    const result = validate(f);
    expect(result.ok ? [] : ledger(result.errors), f.description).toEqual([]);
  });

  it.each(invalid.map((f) => [f.file, f] as const))('invalid: %s', (_file, f) => {
    expect(f.loadError).toBeUndefined();
    const result = validate(f);
    expect(result.ok ? [] : ledger(result.errors), f.description).toEqual(ledger(f.errors ?? []));
  });
});
