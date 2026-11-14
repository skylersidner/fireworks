// @vitest-environment node
/**
 * Structure checks for the designer (acceptance 2c.2, 2c.7, 2c.8 as narrowed in Phase 5), read
 * from the source tree. Fails on: a legacy forms API or a ControlValueAccessor in the designer or
 * the shared controls; a presentational component that injects the store; identity or HTTP in the
 * designer or `src/app/shared` outside the allowlist (the Save flow, the `/c/` page, the designer
 * page's ApiStatusService, the test-mode banner's SessionService). The app-wide unsafe-sink ban
 * (Boo C1) is `src/app/unsafe-sinks.spec.ts`.
 */
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
const APP = `${process.cwd()}/src/app`;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(APP.length + 1);
const designer = walk(`${APP}/features/designer`);
const controls = walk(`${APP}/shared`);
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('designer structure', () => {
  it('sees the files it checks', () => {
    expect(designer.some((p) => p.endsWith('shell-designer.store.ts'))).toBe(true);
    expect(controls.some((p) => p.endsWith('range-row.ts'))).toBe(true);
  });

  it('uses Signal Forms only: no ReactiveFormsModule, FormGroup/FormControl, or ControlValueAccessor', () => {
    // Code forms only: doc comments may name what is avoided, and '@angular/forms/signals' is the
    // one allowed entry point.
    const banned =
      /ReactiveFormsModule|\bFormsModule\b|new Form(Group|Control|Array)\b|FormBuilder|implements[^{]*\bControlValueAccessor\b|NG_VALUE_ACCESSOR|from '@angular\/forms'/;
    const offenders = [...designer, ...controls].filter((p) => banned.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the page and its Save flow inject the store; presentational components take inputs', () => {
    const injectors = designer.filter((p) => /inject\(ShellDesignerStore\)/.test(read(p))).map(rel);
    expect(injectors.sort()).toEqual([
      'features/designer/pages/designer-page/designer-page.ts',
      'features/designer/pages/designer-page/designer-save.ts',
    ]);
  });

  /**
   * 2c.8, narrowed for Phase 5 (record luigi-phase5-save-share-player.md, "Final 2c.8 rule").
   * The banned core modules aren't hand-listed: they are every `core/*.ts` that injects HttpClient
   * or ApiService (or calls fetch, XMLHttpRequest or httpResource), closed over value imports
   * between core files. That catches core/health and core/api-status. A type-only import is erased,
   * so it is allowed anywhere.
   */
  const DIRECT_HTTP: readonly [string, RegExp][] = [
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['httpResource', /\bhttpResource\b/],
  ];
  const injects = (src: string, names: readonly string[]): string[] =>
    names.filter((n) => new RegExp(String.raw`\binject\s*(?:<[^>]*>)?\(\s*${n}\s*[,)]`).test(src));

  /** Non-type module specifiers: static and side-effect imports, re-exports, dynamic import(). */
  function valueImports(src: string): string[] {
    const forms = [
      /^\s*import\s+(?!type\s)[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
      /^\s*import\s*['"]([^'"]+)['"]/gm,
      /^\s*export\s+(?!type\s)[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    return forms.flatMap((re) => [...src.matchAll(re)].map((m) => m[1]));
  }

  /** Core modules that reach HTTP, by name, given each core module's source. */
  function reachingCore(sources: Readonly<Record<string, string>>): Set<string> {
    const reaching = new Set(
      Object.keys(sources).filter(
        (m) =>
          injects(sources[m], ['HttpClient', 'ApiService']).length > 0 ||
          DIRECT_HTTP.some(([, re]) => re.test(sources[m])),
      ),
    );
    for (let grew = true; grew;) {
      grew = false;
      for (const m of Object.keys(sources)) {
        if (reaching.has(m)) continue;
        const deps = valueImports(sources[m]).map((spec) => spec.match(/^\.\/([\w.-]+)$/)?.[1]);
        if (deps.some((d) => d !== undefined && reaching.has(d))) {
          reaching.add(m);
          grew = true;
        }
      }
    }
    return reaching;
  }

  const CORE_SOURCES: Record<string, string> = Object.fromEntries(
    fs
      .readdirSync(`${APP}/core`, { withFileTypes: true })
      .filter((e) => !e.isDirectory() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts'))
      .map((e) => [e.name.slice(0, -3), read(`${APP}/core/${e.name}`)]),
  );
  const BANNED_CORE = reachingCore(CORE_SOURCES);
  /** What a banned module exports as a class, plus HttpClient: the injectables that reach HTTP. */
  const BANNED_INJECTABLES = [
    'HttpClient',
    ...[...BANNED_CORE].flatMap((m) =>
      [...CORE_SOURCES[m].matchAll(/^export class (\w+)/gm)].map((x) => x[1]),
    ),
  ];

  /** Every way `src` reaches identity or HTTP, as sorted labels; [] when it doesn't. */
  function reaches(src: string): string[] {
    const hits = new Set<string>();
    for (const spec of valueImports(src)) {
      const core = spec.match(/(?:^|\/)core\/([\w.-]+)$/)?.[1];
      if (core && BANNED_CORE.has(core)) hits.add(`import core/${core}`);
      if (spec === '@angular/common/http' || spec.startsWith('@angular/common/http/')) {
        hits.add('import @angular/common/http');
      }
    }
    for (const n of injects(src, BANNED_INJECTABLES)) hits.add(`inject(${n})`);
    for (const [label, re] of DIRECT_HTTP) if (re.test(src)) hits.add(label);
    return [...hits].sort();
  }

  /** The only files that may match, and exactly how each one may. */
  const ALLOWED: Record<string, string[]> = {
    // DesignerSaveFlow, the page-provided "Save component".
    'features/designer/pages/designer-page/designer-save.ts': [
      'import core/creation-save',
      'import core/creations',
      'import core/session',
      'inject(CreationsService)',
      'inject(SessionService)',
    ],
    // `/c/:code`.
    'features/designer/pages/open-link-page/open-link-page.ts': [
      'import core/creation-save',
      'import core/creations',
      'import core/open-creation',
      'inject(CreationsService)',
    ],
    // The API banner only; the page reaches identity through DesignerSaveFlow.
    'features/designer/pages/designer-page/designer-page.ts': [
      'import core/api-status',
      'inject(ApiStatusService)',
    ],
    // canWrite && !isAuthenticated (Boo C17); identity comes only from SessionService.
    'shared/test-mode-banner.ts': ['import core/session', 'inject(SessionService)'],
  };

  it('derives the banned core modules (health and api-status included)', () => {
    expect([...BANNED_CORE].sort()).toEqual([
      'api',
      'api-status',
      'creation-save',
      'creations',
      'health',
      'open-creation',
      'session',
    ]);
    expect(BANNED_INJECTABLES).toEqual(
      expect.arrayContaining(['ApiStatusService', 'HealthService', 'SessionService']),
    );
  });

  it('identity and HTTP only where the allowlist says, and only how (2c.8, Phase 5 form)', () => {
    const matching = Object.fromEntries(
      [...designer, ...controls]
        .map((p) => [rel(p), reaches(read(p))] as const)
        .filter(([, hits]) => hits.length > 0),
    );
    expect(matching).toEqual(ALLOWED);
  });

  it('the store and the draft never reach HTTP or identity', () => {
    for (const f of [
      'features/designer/pages/designer-page/shell-designer.store.ts',
      'features/designer/shared/designer-draft.ts',
    ]) {
      expect(reaches(read(`${APP}/${f}`)), f).toEqual([]);
    }
  });

  it('the rule catches what it bans (negative controls)', () => {
    for (const [bad, hit] of [
      ['const s = inject(SessionService);', 'inject(SessionService)'],
      ['const c = inject(CreationsService);', 'inject(CreationsService)'],
      ['const s = inject(SessionService, { optional: true });', 'inject(SessionService)'],
      ['const h = inject<HttpClient>(HttpClient);', 'inject(HttpClient)'],
      ['const h = inject( HealthService );', 'inject(HealthService)'],
      ['const a = inject(ApiStatusService);', 'inject(ApiStatusService)'],
      ["import { SessionService } from '../../../../core/session';", 'import core/session'],
      ['import { SessionService } from "../../../../core/session";', 'import core/session'],
      [
        "import { saveChoices } from '../../../../core/creation-save';",
        'import core/creation-save',
      ],
      ["import { HealthService } from '../../core/health';", 'import core/health'],
      ["import { ApiStatusService } from '../../core/api-status';", 'import core/api-status'],
      [
        "import {\n  type CreationSource,\n  saveChoices,\n} from '../../core/creation-save';",
        'import core/creation-save',
      ],
      ["const m = await import('../../core/session');", 'import core/session'],
      ["export { SessionService } from '../core/session';", 'import core/session'],
      ["import { HttpClient } from '@angular/common/http';", 'import @angular/common/http'],
      ['import { HttpClient } from "@angular/common/http";', 'import @angular/common/http'],
      ["const r = await fetch('/api/creations');", 'fetch('],
      ['const x = new XMLHttpRequest();', 'XMLHttpRequest'],
      ["readonly list = httpResource(() => '/api/me');", 'httpResource'],
    ] as const) {
      expect(reaches(bad), bad).toContain(hit);
    }
    for (const ok of [
      "import type { CreationSource } from '../../core/creation-save';",
      'import type { CreationError } from "../../../core/creations";',
      "import { isShareCode } from '../../core/share-code';",
      "import { readStorage } from '../../core/browser';",
      'const store = inject(ShellDesignerStore);',
      'prefetch(link);',
    ]) {
      expect(reaches(ok), ok).toEqual([]);
    }
  });

  it('the derivation follows value imports between core files, not type imports (negative controls)', () => {
    expect(
      [
        ...reachingCore({
          a: 'export class A { private readonly http = inject(HttpClient); }',
          b: "import { A } from './a';",
          c: "import { B } from './b';",
          d: "import type { A } from './a';",
          e: "const r = fetch('/x');",
          f: 'export class F { private readonly api = inject(ApiService, { optional: true }); }',
          g: "import { readStorage } from './browser';",
        }),
      ].sort(),
    ).toEqual(['a', 'b', 'c', 'e', 'f']);
  });

  it('untrusted shells enter through openShell, upgrade before normalize (schema.md §8.3; F6)', () => {
    // normalizeShell is called in exactly one place, toEditable, which only ever sees the form model.
    const callers = designer.filter((p) => /\bnormalizeShell\(/.test(read(p))).map(rel);
    expect(callers).toEqual(['features/designer/shared/designer-draft.ts']);
    const draft = read(`${APP}/features/designer/shared/designer-draft.ts`);
    expect(draft.match(/\bnormalizeShell\(/g)).toHaveLength(1);
    expect(draft).toMatch(
      /function toEditable\([^)]*\)[^{]*\{\s*const result = normalizeShell\(input\);/,
    );
    const toEditableCallers = designer
      .filter((p) => /\btoEditable\(/.test(read(p)))
      .map((p) => [rel(p), read(p).match(/\btoEditable\(([^)]*)\)/g)])
      .sort();
    expect(toEditableCallers).toEqual([
      ['features/designer/pages/designer-page/shell-designer.store.ts', ['toEditable(model)']],
      [
        'features/designer/shared/designer-draft.ts',
        ['toEditable(input: unknown, skyFallback?: SkySettings)'],
      ],
    ]);
    // Draft restore and JSON Apply.
    expect(draft).toContain("openShell(raw['shell'])");
    const store = read(`${APP}/features/designer/pages/designer-page/shell-designer.store.ts`);
    expect(store).toContain('const result = openShell(parsed);');
  });
});
