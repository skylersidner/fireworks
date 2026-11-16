// @vitest-environment node
/**
 * Import-boundary drift spec (plan 2a, acceptance 2a.2; hardened per Yoshi's 2a review, L1 in
 * `.squad/decisions/records/yoshi-phase2a-engine-boundaries.md` §1–3). Walks every .ts file under
 * src/ and fails when:
 *  - a layer imports across a forbidden edge: model → model only; sim → model, sim;
 *    loop → model, sim, loop; render → model, sim, render. model/sim/loop never import render,
 *    in any form (type-only included), and import no bare package at all;
 *  - any file under engine/ imports `@angular/*`;
 *  - a file outside engine/render reaches `pixi.js` or `@pixi/*` through any chain of static
 *    value imports (a dynamic `import()` is the one legal edge: it is the lazy chunk; a type-only
 *    import loads nothing);
 *  - a file under engine/ has a dynamic `import()` or `require()` whose argument isn't a plain
 *    string literal (fail closed: an import the spec can't read is an offense);
 *  - shipped code imports test support (Boo F6, testing interlude): no non-spec file outside the
 *    test-support folders (`app/testing/`, `engine/<layer>/golden/`, `engine/<layer>/testing/`)
 *    imports into one of them, in any form (type-only included). Specs, `tools/` and the
 *    test-support folders themselves may.
 * There is no allow-list. Every form is parsed: static, `import type`, side-effect,
 * `export … from`, dynamic with quotes or a plain template literal, with an options bag, and
 * `require`.
 *
 * Node's fs is reached through `process.getBuiltinModule` so the test bundle never imports a
 * Node builtin and the spec needs no @types/node.
 */
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
const SRC = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * How a module is reached. `static` loads it with the importer; `type` loads nothing; `dynamic`
 * loads it later, in its own chunk; `unparseable` is an import whose target can't be read.
 */
export type ImportKind = 'static' | 'type' | 'dynamic' | 'unparseable';

export interface ImportRecord {
  readonly spec: string;
  readonly kind: ImportKind;
}

/** Every import, export-from, dynamic import and require in `source`. */
export function importRecords(source: string): ImportRecord[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: ImportRecord[] = [];

  // import … from 'x' / import type … from 'x'
  for (const m of code.matchAll(/\bimport\s+(type\s+)?([^'"`;()]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[3], kind: m[1] || onlyTypes(m[2]) ? 'type' : 'static' });
  }
  // export … from 'x' / export type … from 'x'
  for (const m of code.matchAll(/\bexport\s+(type\s+)?([^'"`;()]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[3], kind: m[1] || onlyTypes(m[2]) ? 'type' : 'static' });
  }
  // import 'x' (side effect)
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[1], kind: 'static' });
  }
  // import(…) and require(…): the first argument must be a plain literal.
  for (const m of code.matchAll(/\b(import|require)\s*\(\s*/g)) {
    const rest = code.slice(m.index! + m[0].length);
    const literal = /^(['"])([^'"\n]+)\1|^`([^`$\\]+)`/.exec(rest);
    const kind: ImportKind = m[1] === 'import' ? 'dynamic' : 'static';
    if (literal) out.push({ spec: literal[2] ?? literal[3], kind });
    else out.push({ spec: rest.slice(0, 40), kind: 'unparseable' });
  }
  return out;
}

/** Module specifiers only (kept for the parser controls). */
export function importSpecifiers(source: string): string[] {
  return importRecords(source).map((r) => r.spec);
}

/** `{ type A, type B }` imports no value. */
function onlyTypes(clause: string): boolean {
  const braces = /^\s*\{([^}]*)\}\s*$/.exec(clause);
  if (!braces) return false;
  const names = braces[1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith('type '));
}

const isAngular = (s: string) => s === '@angular' || s.startsWith('@angular/');
const isPixi = (s: string) =>
  s === 'pixi.js' || s.startsWith('pixi.js/') || s === '@pixi' || s.startsWith('@pixi/');
const isRelative = (s: string) => s.startsWith('./') || s.startsWith('../');

function relative(path: string): string {
  return path.slice(SRC.length + 1);
}

/**
 * Resolves a relative specifier from `fromRel` to a src-relative .ts path, or null. `exists`
 * defaults to the real tree; the reach check's control passes its own graph.
 */
function resolve(
  fromRel: string,
  spec: string,
  exists: (rel: string) => boolean = (rel) => fs.existsSync(`${SRC}/${rel}`),
): string | null {
  if (!isRelative(spec)) return null;
  const parts = fromRel.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  const base = parts.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (candidate.endsWith('.ts') && exists(candidate)) return candidate;
  }
  return null;
}

type Layer = 'model' | 'sim' | 'loop' | 'render';
const LAYER_EDGES: Record<Layer, readonly Layer[]> = {
  model: ['model'],
  sim: ['model', 'sim'],
  loop: ['model', 'sim', 'loop'],
  render: ['model', 'sim', 'render'],
};
const layerOf = (rel: string): Layer | null =>
  (/^engine\/(model|sim|loop|render)\//.exec(rel)?.[1] as Layer | undefined) ?? null;

interface FileInfo {
  readonly path: string;
  readonly imports: readonly ImportRecord[];
}

/**
 * Whether the first import statement in `source` is the side-effect `pixi.js/unsafe-eval`
 * polyfill. Pixi's own modules run on import, so it must load before any of them (Boo P7-S10).
 */
export function firstImportIsUnsafeEvalPolyfill(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const first = /^\s*(?:import|export)\b[^;]*?;/m.exec(code)?.[0].trim() ?? '';
  return new RegExp(`^import\\s*['"]pixi\\.js/unsafe-eval['"];$`).test(first);
}

/** Test-support folders: specs and tools only, never a shipped import (Boo F6). */
const isTestSupport = (rel: string) =>
  rel.startsWith('app/testing/') || /^engine\/[^/]+\/(golden|testing)\//.test(rel);

/**
 * Shipped files (not a spec, not in a test-support folder) that import test support, as
 * `from -> spec (kind)`. `exists` as in `resolve`; the control passes its own graph.
 */
export function testSupportImports(
  files: readonly FileInfo[],
  exists?: (rel: string) => boolean,
): string[] {
  return files
    .filter((f) => !f.path.endsWith('.spec.ts') && !isTestSupport(f.path))
    .flatMap((f) =>
      f.imports
        .filter((imp) => {
          const target = resolve(f.path, imp.spec, exists);
          return target !== null && isTestSupport(target);
        })
        .map((imp) => `${f.path} -> ${imp.spec} (${imp.kind})`),
    );
}

/** Files that load `pixi.js`/`@pixi/*` through static value imports (direct or transitive). */
export function pixiReach(files: readonly FileInfo[]): Map<string, string[]> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const memo = new Map<string, string[] | null>();
  const visit = (path: string, stack: Set<string>): string[] | null => {
    if (memo.has(path)) return memo.get(path)!;
    if (stack.has(path)) return null;
    stack.add(path);
    const file = byPath.get(path);
    let chain: string[] | null = null;
    for (const imp of file?.imports ?? []) {
      if (imp.kind !== 'static') continue;
      if (isPixi(imp.spec)) {
        chain = [path, imp.spec];
        break;
      }
      const target = resolve(path, imp.spec, (rel) => byPath.has(rel));
      const sub = target ? visit(target, stack) : null;
      if (sub) {
        chain = [path, ...sub];
        break;
      }
    }
    stack.delete(path);
    memo.set(path, chain);
    return chain;
  };
  const out = new Map<string, string[]>();
  for (const f of files) {
    const chain = visit(f.path, new Set());
    if (chain) out.set(f.path, chain);
  }
  return out;
}

describe('engine import boundary', () => {
  const files: FileInfo[] = walk(SRC).map((path) => ({
    path: relative(path),
    imports: importRecords(fs.readFileSync(path, 'utf8')),
  }));
  const engineFiles = files.filter((f) => f.path.startsWith('engine/'));

  it('sees the whole tree (sanity: the walker finds files in every layer and in app/)', () => {
    for (const dir of ['engine/model/', 'engine/sim/', 'engine/loop/', 'engine/render/', 'app/']) {
      expect(
        files.some((f) => f.path.startsWith(dir)),
        dir,
      ).toBe(true);
    }
    // And the parser sees pixi where it really is, and the one legal lazy edge.
    expect(files.find((f) => f.path === 'engine/render/pixi-renderer.ts')?.imports).toContainEqual({
      spec: 'pixi.js',
      kind: 'static',
    });
    expect(
      files.find((f) => f.path.endsWith('fireworks-stage/fireworks-stage.ts'))?.imports,
    ).toContainEqual({ spec: '../../../engine/render/pixi-renderer', kind: 'dynamic' });
  });

  // Scoped to shipped source: a spec may read a fixture from another layer (model's preset spec
  // reads the prototype golden recorded under sim/), and specs never enter a bundle. Every other
  // rule below covers specs too.
  it('layers import only along allowed edges; model/sim/loop never reach render (any form)', () => {
    const offenders = engineFiles
      .filter((f) => !f.path.endsWith('.spec.ts'))
      .flatMap((f) => {
        const from = layerOf(f.path);
        if (!from) return [];
        return f.imports
          .filter((imp) => isRelative(imp.spec))
          .flatMap((imp) => {
            const target = resolve(f.path, imp.spec);
            const to = target ? layerOf(target) : null;
            if (to && LAYER_EDGES[from].includes(to)) return [];
            if (!to && target === null) return [`${f.path} -> ${imp.spec} (unresolved)`];
            if (!to && target?.startsWith('engine/')) return [];
            return [`${f.path} -> ${imp.spec} (${imp.kind})`];
          });
      });
    expect(offenders).toEqual([]);
  });

  it('engine/model, engine/sim and engine/loop import no package at all (relative paths only)', () => {
    const offenders = engineFiles
      .filter((f) => /^engine\/(model|sim|loop)\//.test(f.path))
      .flatMap((f) =>
        f.imports.filter((i) => !isRelative(i.spec)).map((i) => `${f.path} -> ${i.spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it('nothing under engine/ imports @angular/*', () => {
    const offenders = engineFiles.flatMap((f) =>
      f.imports.filter((i) => isAngular(i.spec)).map((i) => `${f.path} -> ${i.spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no file under engine/ has an import the spec cannot read (fail closed)', () => {
    const offenders = engineFiles.flatMap((f) =>
      f.imports.filter((i) => i.kind === 'unparseable').map((i) => `${f.path} -> ${i.spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('only engine/render imports pixi.js or @pixi/*, in any form, anywhere under src/', () => {
    const offenders = files
      .filter((f) => !f.path.startsWith('engine/render/'))
      .flatMap((f) => f.imports.filter((i) => isPixi(i.spec)).map((i) => `${f.path} -> ${i.spec}`));
    expect(offenders).toEqual([]);
  });

  it('no file outside engine/render reaches Pixi through static imports (only the lazy edge)', () => {
    const reach = pixiReach(files);
    const offenders = [...reach]
      .filter(([path]) => !path.startsWith('engine/render/'))
      .map(([, chain]) => chain.join(' -> '));
    expect(offenders).toEqual([]);
    // Positive control: the renderer itself does reach Pixi.
    expect(reach.has('engine/render/pixi-renderer.ts')).toBe(true);
  });

  it('shipped code never imports app/testing, engine/*/golden or engine/*/testing (Boo F6)', () => {
    expect(testSupportImports(files)).toEqual([]);
    // Positive control on the real tree: specs do import test support, and the resolver sees it.
    const specEdges = files
      .filter((f) => f.path.endsWith('.spec.ts'))
      .flatMap((f) => f.imports.map((i) => resolve(f.path, i.spec)))
      .filter((t): t is string => t !== null && isTestSupport(t));
    expect(specEdges.some((t) => t.startsWith('app/testing/'))).toBe(true);
    expect(specEdges.some((t) => /^engine\/[^/]+\/golden\//.test(t))).toBe(true);
  });

  it('pixi-renderer.ts imports the CSP-safe polyfill first (Boo P7-S10: no unsafe-eval)', () => {
    const source = fs.readFileSync(`${SRC}/engine/render/pixi-renderer.ts`, 'utf8');
    expect(firstImportIsUnsafeEvalPolyfill(source)).toBe(true);
  });

  it('every model/sim/loop spec runs without a DOM (starts with @vitest-environment node)', () => {
    const missing = walk(SRC)
      .filter((p) => /\/engine\/(model|sim|loop)\/.*\.spec\.ts$/.test(p))
      .filter((p) => !fs.readFileSync(p, 'utf8').startsWith('// @vitest-environment node\n'))
      .map(relative);
    expect(missing).toEqual([]);
  });

  describe('negative controls for the parser and the reach check', () => {
    // Built from variables so this file's own source contains no literal pixi/angular import.
    const PIXI = ['pixi', 'js'].join('.');
    const NG = ['@angular', 'core'].join('/');
    const IMPORT = ['im', 'port'].join('');
    const REQUIRE = ['req', 'uire'].join('');

    it('reads every import form, with its kind', () => {
      const forms: [string, ImportRecord[]][] = [
        [`${IMPORT} { Application } from '${PIXI}';`, [{ spec: PIXI, kind: 'static' }]],
        [`${IMPORT} type { Texture } from "${PIXI}";`, [{ spec: PIXI, kind: 'type' }]],
        [`${IMPORT} { type Texture } from '${PIXI}';`, [{ spec: PIXI, kind: 'type' }]],
        [`${IMPORT} { type Texture, Sprite } from '${PIXI}';`, [{ spec: PIXI, kind: 'static' }]],
        [`${IMPORT} '${PIXI}';`, [{ spec: PIXI, kind: 'static' }]],
        [`const m = await ${IMPORT}('${PIXI}');`, [{ spec: PIXI, kind: 'dynamic' }]],
        [`const m = await ${IMPORT}(\`${PIXI}\`);`, [{ spec: PIXI, kind: 'dynamic' }]],
        [
          `const m = await ${IMPORT}('${PIXI}', { with: { type: 'x' } });`,
          [{ spec: PIXI, kind: 'dynamic' }],
        ],
        [`const m = ${REQUIRE}('${PIXI}');`, [{ spec: PIXI, kind: 'static' }]],
        [`export { Sprite } from '${PIXI}';`, [{ spec: PIXI, kind: 'static' }]],
        [`export type { Sprite } from '${PIXI}';`, [{ spec: PIXI, kind: 'type' }]],
        [`${IMPORT} {\n  Component,\n} from '${NG}';`, [{ spec: NG, kind: 'static' }]],
        [`${IMPORT} { Assets } from '@pixi/assets';`, [{ spec: '@pixi/assets', kind: 'static' }]],
      ];
      for (const [source, expected] of forms)
        expect(importRecords(source), source).toEqual(expected);
      expect(importSpecifiers(`// ${IMPORT} '${PIXI}';\n/* ${IMPORT} '${PIXI}' */`)).toEqual([]);
      expect(isPixi('@pixi/assets')).toBe(true);
    });

    it('the polyfill check fails when the import is missing, late or type-only', () => {
      const polyfill = `${IMPORT} '${PIXI}/unsafe-eval';`;
      const app = `${IMPORT} { Application } from '${PIXI}';`;
      expect(firstImportIsUnsafeEvalPolyfill(`// note\n${polyfill}\n${app}`)).toBe(true);
      expect(firstImportIsUnsafeEvalPolyfill(app)).toBe(false);
      expect(firstImportIsUnsafeEvalPolyfill(`${app}\n${polyfill}`)).toBe(false);
      expect(firstImportIsUnsafeEvalPolyfill(`// ${polyfill}\n${app}`)).toBe(false);
      expect(firstImportIsUnsafeEvalPolyfill(`${IMPORT} '${PIXI}';\n${polyfill}`)).toBe(false);
      expect(firstImportIsUnsafeEvalPolyfill('')).toBe(false);
    });

    it('fails closed on a computed import or require', () => {
      for (const source of [
        `${IMPORT}(name)`,
        `${IMPORT}(\`pixi\${x}\`)`,
        `${IMPORT}('a' + b)`.replace(`'a' + b`, `prefix + 'b'`),
        `${REQUIRE}(name)`,
      ]) {
        expect(
          importRecords(source).map((r) => r.kind),
          source,
        ).toEqual(['unparseable']);
      }
    });

    it('the test-support rule catches every form from app/ and engine/, and allows specs and support', () => {
      const graph: FileInfo[] = [
        {
          path: 'app/testing/fake.ts',
          imports: [{ spec: '../../engine/loop/golden/g', kind: 'static' }],
        },
        { path: 'engine/loop/golden/g.ts', imports: [] },
        { path: 'engine/loop/testing/h.ts', imports: [{ spec: '../golden/g', kind: 'static' }] },
        {
          path: 'app/features/x/page.ts',
          imports: [{ spec: '../../testing/fake', kind: 'static' }],
        },
        { path: 'app/core/typed.ts', imports: [{ spec: '../testing/fake', kind: 'type' }] },
        {
          path: 'app/shared/lazy.ts',
          imports: [{ spec: '../../engine/loop/golden/g', kind: 'dynamic' }],
        },
        { path: 'engine/loop/driver.ts', imports: [{ spec: './testing/h', kind: 'static' }] },
        {
          path: 'app/features/x/page.spec.ts',
          imports: [{ spec: '../../testing/fake', kind: 'static' }],
        },
        { path: 'app/core/fine.ts', imports: [{ spec: '../features/x/page', kind: 'static' }] },
      ];
      const byPath = new Set(graph.map((f) => f.path));
      expect(testSupportImports(graph, (rel) => byPath.has(rel))).toEqual([
        'app/features/x/page.ts -> ../../testing/fake (static)',
        'app/core/typed.ts -> ../testing/fake (type)',
        'app/shared/lazy.ts -> ../../engine/loop/golden/g (dynamic)',
        'engine/loop/driver.ts -> ./testing/h (static)',
      ]);
    });

    it('the reach check follows static chains and stops at dynamic and type-only edges', () => {
      const graph: FileInfo[] = [
        { path: 'app/a.ts', imports: [{ spec: '../engine/sim/x', kind: 'static' }] },
        { path: 'engine/sim/x.ts', imports: [{ spec: '../render/pixi-renderer', kind: 'static' }] },
        { path: 'engine/render/pixi-renderer.ts', imports: [{ spec: PIXI, kind: 'static' }] },
        {
          path: 'app/lazy.ts',
          imports: [{ spec: '../engine/render/pixi-renderer', kind: 'dynamic' }],
        },
        {
          path: 'app/typed.ts',
          imports: [{ spec: '../engine/render/pixi-renderer', kind: 'type' }],
        },
      ];
      const reach = pixiReach(graph);
      expect(reach.get('app/a.ts')).toEqual([
        'app/a.ts',
        'engine/sim/x.ts',
        'engine/render/pixi-renderer.ts',
        PIXI,
      ]);
      expect(reach.has('app/lazy.ts')).toBe(false);
      expect(reach.has('app/typed.ts')).toBe(false);
    });
  });
});
