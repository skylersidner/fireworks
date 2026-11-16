// @vitest-environment node
/**
 * Structure checks for the designer (acceptance 2c.2, 2c.7, 2c.8 as narrowed in Phase 5), read
 * from the source tree. Fails on: a legacy forms API or a ControlValueAccessor in the designer or
 * the shared controls; a presentational component that injects the store; identity or HTTP in the
 * designer or `src/app/shared` outside the allowlist (the Save flow, the `/c/` page, the designer
 * and builder pages' ApiStatusService, the test-mode banner's SessionService). The builder page is
 * held to exactly its ApiStatusService hits by the allowlist, not listed with the stores. The app-wide unsafe-sink ban
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
/** The Show Builder (Phase 6) follows the same rule (luigi-phase6-show-builder.md). */
const builder = walk(`${APP}/features/show`);
const controls = walk(`${APP}/shared`);
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('designer structure', () => {
  it('sees the files it checks', () => {
    expect(designer.some((p) => p.endsWith('shell-designer.store.ts'))).toBe(true);
    expect(controls.some((p) => p.endsWith('range-row.ts'))).toBe(true);
  });

  it('only the builder page and its Save flow inject the builder store', () => {
    const injectors = builder.filter((p) => /inject\(ShowBuilderStore\)/.test(read(p))).map(rel);
    expect(injectors.sort()).toEqual([
      'features/show/pages/show-builder-page/show-builder-page.ts',
      'features/show/pages/show-builder-page/show-save.ts',
    ]);
  });

  it('uses Signal Forms only: no ReactiveFormsModule, FormGroup/FormControl, or ControlValueAccessor', () => {
    // Code forms only: doc comments may name what is avoided, and '@angular/forms/signals' is the
    // one allowed entry point.
    const banned =
      /ReactiveFormsModule|\bFormsModule\b|new Form(Group|Control|Array)\b|FormBuilder|implements[^{]*\bControlValueAccessor\b|NG_VALUE_ACCESSOR|from '@angular\/forms'/;
    const offenders = [...designer, ...builder, ...controls]
      .filter((p) => banned.test(read(p)))
      .map(rel);
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
   * Feature layering (yoshi-phase7-architecture-rulings.md point 3): `app/shared` never value-imports
   * a feature, so a shared component can't reach a feature store; the builder may read only the
   * designer's draft (its storage) and copy (shell wording) from the designer.
   */
  const SHOW_MAY_IMPORT_FROM_DESIGNER = [
    'features/designer/shared/designer-draft',
    'features/designer/shared/designer-copy',
  ];
  function resolve(from: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }
  function layeringOffenses(list: readonly { path: string; text: string }[]): string[] {
    const out: string[] = [];
    for (const f of list) {
      for (const spec of valueImports(f.text)) {
        const target = resolve(f.path, spec);
        if (target === null) continue;
        if (f.path.startsWith('shared/') && target.startsWith('features/')) {
          out.push(`${f.path} -> ${target}`);
        }
        if (
          f.path.startsWith('features/show/') &&
          target.startsWith('features/designer/') &&
          !SHOW_MAY_IMPORT_FROM_DESIGNER.includes(target)
        ) {
          out.push(`${f.path} -> ${target}`);
        }
      }
    }
    return out;
  }

  it('app/shared imports no feature; the builder reads only the designer draft and copy', () => {
    const list = [...controls, ...builder]
      .filter((p) => p.endsWith('.ts'))
      .map((p) => ({ path: rel(p), text: read(p) }));
    expect(list.some((f) => f.path === 'shared/save-copy.ts')).toBe(true);
    expect(list.some((f) => f.path === 'shared/save-bar/save-bar.ts')).toBe(true);
    expect(layeringOffenses(list)).toEqual([]);
  });

  it('the layering rule catches each crossing (negative controls)', () => {
    const imp = (from: string) => `import { x } from '${from}';`;
    expect(
      layeringOffenses([
        { path: 'shared/save-copy.ts', text: imp('../features/designer/shared/designer-copy') },
        {
          path: 'shared/hud/hud.ts',
          text: imp('../../features/designer/pages/designer-page/shell-designer.store'),
        },
        {
          path: 'features/show/pages/show-builder-page/show-builder-page.ts',
          text: imp('../../../designer/shared/save-bar/save-bar'),
        },
      ]),
    ).toHaveLength(3);
    expect(
      layeringOffenses([
        // A type-only import is erased; the two designer reads the builder may make; core.
        {
          path: 'shared/x.ts',
          text: `import type { X } from '../features/show/shared/show-edit';`,
        },
        {
          path: 'features/show/shared/show-copy.ts',
          text: imp('../../designer/shared/designer-copy'),
        },
        {
          path: 'features/show/pages/show-builder-page/show-builder.store.ts',
          text: imp('../../../designer/shared/designer-draft'),
        },
        { path: 'shared/save-bar/save-bar.ts', text: imp('../../core/creation-save') },
      ]),
    ).toEqual([]);
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
    // The builder's API banner only (phase-6.md §19.2 B1); identity goes through ShowSaveFlow.
    'features/show/pages/show-builder-page/show-builder-page.ts': [
      'import core/api-status',
      'inject(ApiStatusService)',
    ],
    // ShowSaveFlow, the builder's page-provided Save (Phase 6).
    'features/show/pages/show-builder-page/show-save.ts': [
      'import core/creation-save',
      'import core/creations',
      'import core/session',
      'inject(CreationsService)',
      'inject(SessionService)',
    ],
    // "My shells": the write switch (session) and one openCreation per added shell (Peach N2).
    'features/show/pages/show-builder-page/show-library.ts': [
      'import core/creations',
      'import core/open-creation',
      'import core/session',
      'inject(CreationsService)',
      'inject(SessionService)',
    ],
    // canWrite && !isAuthenticated (Boo C17); identity comes only from SessionService.
    'shared/test-mode-banner.ts': ['import core/session', 'inject(SessionService)'],
  };

  it('derives the banned core modules (health and api-status included)', () => {
    expect([...BANNED_CORE].sort()).toEqual([
      'api',
      'api-status',
      'client-config-loader',
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
      [...designer, ...builder, ...controls]
        .map((p) => [rel(p), reaches(read(p))] as const)
        .filter(([, hits]) => hits.length > 0),
    );
    expect(matching).toEqual(ALLOWED);
  });

  it('the stores and the drafts never reach HTTP or identity (designer and Show Builder)', () => {
    expect(builder.some((p) => p.endsWith('show-builder.store.ts'))).toBe(true);
    for (const f of [
      'features/designer/pages/designer-page/shell-designer.store.ts',
      'features/designer/shared/designer-draft.ts',
      'features/show/pages/show-builder-page/show-builder.store.ts',
      'features/show/shared/show-draft.ts',
      'features/show/shared/show-edit.ts',
      'features/show/shared/show-working-copy-handoff.ts',
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
      // The playback config: the loader reaches HTTP; only its value store is open to the stage.
      [
        "import { ClientConfigLoader } from '../../core/client-config-loader';",
        'import core/client-config-loader',
      ],
      ['private readonly l = inject(ClientConfigLoader);', 'inject(ClientConfigLoader)'],
    ] as const) {
      expect(reaches(bad), bad).toContain(hit);
    }
    for (const ok of [
      "import type { CreationSource } from '../../core/creation-save';",
      'import type { CreationError } from "../../../core/creations";',
      "import { isShareCode } from '../../core/share-code';",
      "import { readStorage } from '../../core/browser';",
      "import { ClientConfigStore } from '../../core/client-config';",
      'private readonly c = inject(ClientConfigStore);',
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

  /**
   * The show twin of the F6 rule (Boo Phase 6 F5). A show enters the builder from storage (the
   * draft) or the network (`/c/` through openCreation and ShowWorkingCopyHandoff), and both go
   * through `openShow` (upgrade, then lenient normalize). `normalizeShow` is otherwise called only by
   * `validateShow` and by ShowSaveFlow on the store's own document. Keyed by path under `src/`.
   */
  function showEntryViolations(sources: Readonly<Record<string, string>>): string[] {
    const out: string[] = [];
    const callers = (re: RegExp, except: RegExp = /^$/) =>
      Object.keys(sources)
        .filter((p) => new RegExp(re.source, 'g').test(sources[p].replace(except, '')))
        .sort();
    const calls = (p: string, re: RegExp) => sources[p]?.match(new RegExp(re.source, 'g')) ?? [];
    const pin = (label: string, actual: unknown, expected: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        out.push(`${label}: ${JSON.stringify(actual)}`);
      }
    };
    const DRAFT = 'app/features/show/shared/show-draft.ts';
    const SAVE = 'app/features/show/pages/show-builder-page/show-save.ts';
    const STORE = 'app/features/show/pages/show-builder-page/show-builder.store.ts';
    const LINK = 'app/features/designer/pages/open-link-page/open-link-page.ts';
    const OPEN = 'app/core/open-creation.ts';
    pin('upgradeShow callers', callers(/\bupgradeShow\(/, /export function upgradeShow\(/), [
      'engine/model/open.ts',
    ]);
    pin('normalizeShow callers', callers(/\bnormalizeShow\(/, /export function normalizeShow\(/), [
      SAVE,
      'engine/model/open.ts',
      'engine/model/validate.ts',
    ]);
    pin(
      'ShowSaveFlow normalizes only the store document',
      calls(SAVE, /\bnormalizeShow\([^)]*\)/),
      ['normalizeShow(sent.show)'],
    );
    pin('validateShow callers', callers(/\bvalidateShow\(/, /export function validateShow\(/), [
      SAVE,
    ]);
    // FIXTURES is test-only (never imported by shipped code; enforced in engine-boundary.spec.ts,
    // Boo F6): Toad's shared Done-when fixture, opened
    // like any document (Luigi B2, Phase 7).
    const FIXTURES = 'app/testing/show-fixtures.ts';
    // Show JSON Apply (Luigi B3, Phase 7; acceptance 7b.9): the one new show entry. It parses the
    // pasted text once and passes the parsed value straight to openShow.
    const JSON_APPLY = 'app/features/show/shared/show-json.ts';
    // Test-only too (same rule, Boo F6): the T2 fingerprint harness opens committed
    // schema fixtures and generated shows like any document (Yoshi, testing interlude T2).
    const FINGERPRINT = 'engine/loop/golden/show-fingerprint.ts';
    pin('openShow callers', callers(/\bopenShow\(/, /export function openShow\(/), [
      OPEN,
      DRAFT,
      JSON_APPLY,
      FIXTURES,
      FINGERPRINT,
    ]);
    pin('Show JSON parses once', calls(JSON_APPLY, /\bJSON\.parse\([^)]*\)/), ['JSON.parse(text)']);
    pin('Show JSON opens the parsed value', calls(JSON_APPLY, /\bopenShow\([^)]*\)/), [
      'openShow(parsed)',
    ]);
    pin(
      'Show JSON Apply goes through parseShowJson',
      callers(/\bparseShowJson\(/, /export function parseShowJson\(/),
      ['app/features/show/pages/show-builder-page/show-builder-page.ts'],
    );
    pin('openCreation opens a show with openShow', calls(OPEN, /\bopenShow\([^)]*\)/), [
      'openShow(r.document)',
    ]);
    // Storage: one parse, the whole `show` field through openShowDraftDocument, which calls
    // openShow on both branches (with cues, and the empty-cues sentinel).
    pin('show draft parses', calls(DRAFT, /\bJSON\.parse\(/), ['JSON.parse(']);
    pin('show draft openShow calls', calls(DRAFT, /\bopenShow\([^)]*\)/), [
      'openShow(raw)',
      'openShow(withSentinel)',
    ]);
    pin(
      'show draft restore',
      calls(DRAFT, /const show = openShowDraftDocument\(raw\['show'\]\);/),
      ["const show = openShowDraftDocument(raw['show']);"],
    );
    pin(
      'openShowDraftDocument callers',
      callers(/\bopenShowDraftDocument\(/, /export function openShowDraftDocument\(/),
      [DRAFT],
    );
    pin('readShowDraft callers', callers(/\breadShowDraft\(/, /export function readShowDraft\(/), [
      STORE,
    ]);
    // No other show surface parses text or casts its way to a ShowDocument.
    pin(
      'JSON.parse under features/show',
      callers(/\bJSON\.parse\(/).filter((p) => p.startsWith('app/features/show/')),
      [DRAFT, JSON_APPLY],
    );
    pin('casts to ShowDocument', callers(/\bas\s+ShowDocument\b/), []);
    // Network: only `/c/` offers a show, and only what openCreation returned.
    pin('ShowWorkingCopyHandoff offers', callers(/\bshowHandoff\.offer\(/), [LINK]);
    pin('the offered show', calls(LINK, /showHandoff\.offer\(\{ show: [\w.]+/), [
      'showHandoff.offer({ show: opened.show',
    ]);
    return out;
  }

  const SRC = APP.slice(0, -'/app'.length);
  const showSources: Record<string, string> = Object.fromEntries(
    [...walk(APP), ...walk(`${SRC}/engine`)].map((p) => [p.slice(SRC.length + 1), read(p)]),
  );

  it('untrusted shows enter through openShow, from storage and from /c/ (Boo Phase 6 F5)', () => {
    expect(showSources['app/features/show/shared/show-draft.ts']).toBeDefined();
    expect(showSources['engine/model/open.ts']).toBeDefined();
    expect(showEntryViolations(showSources)).toEqual([]);
  });

  it('the show entry rule catches each bypass (negative controls)', () => {
    const DRAFT = 'app/features/show/shared/show-draft.ts';
    const STORE = 'app/features/show/pages/show-builder-page/show-builder.store.ts';
    const LINK = 'app/features/designer/pages/open-link-page/open-link-page.ts';
    const swap = (path: string, from: string, to: string): Record<string, string> => {
      expect(showSources[path], path).toContain(from);
      return { ...showSources, [path]: showSources[path].replace(from, to) };
    };
    for (const [label, mutated] of [
      [
        'draft restore skips openShow',
        swap(
          DRAFT,
          "const show = openShowDraftDocument(raw['show']);",
          "const show = raw['show'] as ShowDocument;",
        ),
      ],
      ['draft normalizes without upgrade', swap(DRAFT, 'openShow(raw)', 'normalizeShow(raw)')],
      [
        'empty-cues branch skips openShow',
        swap(DRAFT, 'openShow(withSentinel)', 'normalizeShow(withSentinel)'),
      ],
      [
        'store parses storage itself',
        swap(STORE, 'readShowDraft(this.storage)', "JSON.parse(this.storage?.getItem('x') ?? '')"),
      ],
      [
        '/c/ offers the raw response',
        swap(
          LINK,
          'showHandoff.offer({ show: opened.show',
          'showHandoff.offer({ show: opened.response.document',
        ),
      ],
      [
        'openCreation normalizes a show without upgrade',
        swap('app/core/open-creation.ts', 'openShow(r.document)', 'normalizeShow(r.document)'),
      ],
      [
        'save normalizes something other than the store document',
        swap(
          'app/features/show/pages/show-builder-page/show-save.ts',
          'normalizeShow(sent.show)',
          'normalizeShow(pasted)',
        ),
      ],
      [
        'a new show surface normalizes directly',
        {
          ...showSources,
          'app/features/show/shared/show-other.ts': 'const r = normalizeShow(JSON.parse(t));',
        },
      ],
      [
        'a new show surface upgrades on its own',
        { ...showSources, 'app/features/show/shared/show-other.ts': 'const u = upgradeShow(raw);' },
      ],
      // Show JSON Apply (Luigi B3): every way around openShow fails the rule.
      [
        'Show JSON normalizes without upgrade',
        swap('app/features/show/shared/show-json.ts', 'openShow(parsed)', 'normalizeShow(parsed)'),
      ],
      [
        'Show JSON casts the parsed value',
        swap(
          'app/features/show/shared/show-json.ts',
          'const result = openShow(parsed);',
          'const result = { ok: true, show: parsed as ShowDocument, adjustments: [] };',
        ),
      ],
      [
        'Show JSON parses twice',
        swap(
          'app/features/show/shared/show-json.ts',
          'parsed = JSON.parse(text);',
          'parsed = JSON.parse(text);\n    JSON.parse(JSON.stringify(parsed));',
        ),
      ],
      [
        'the page opens pasted text itself',
        swap(
          'app/features/show/pages/show-builder-page/show-builder-page.ts',
          'const parsed = parseShowJson(this.jsonValue());',
          'const parsed = openShow(JSON.parse(this.jsonValue()));',
        ),
      ],
    ] as const) {
      expect(showEntryViolations(mutated), label).not.toEqual([]);
    }
  });
});
