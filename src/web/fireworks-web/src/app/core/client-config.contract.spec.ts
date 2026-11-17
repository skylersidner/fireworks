/**
 * Contract parity for `GET api/client-config` (Toad, Phase 6 follow-up): the client's keys, ranges
 * and defaults against the server's source of truth, read as text from the C# tree and the
 * committed appsettings.json. The C# endpoint test pins the JSON shape on the wire; this pins that
 * the browser clamps to the same ranges the API validates at startup and falls back to the same
 * values it commits. Without it, a server range widened to 4..200 serves 150 and the client quietly
 * clamps it to 100, or a renamed record field reaches the client as "missing" and takes a default.
 *
 * Also the read-only rule (luigi-phase6-show-builder.md point 13): only app.config.ts reaches
 * ClientConfigLoader; the stage, the builder store and the player read ClientConfigStore. The
 * Show Builder and `shared` are covered by designer-structure.spec.ts; the player is not, so the
 * exact importer ledgers live here.
 *
 * Every parser has a negative control on a mutated copy of the real text, so a parser that matches
 * nothing cannot pass.
 */
import { DEFAULT_PLAYBACK, PLAYBACK_LIMITS, clampPlayback } from './client-config';

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
const API = `${process.cwd()}/../../api/Fireworks.Api`;
const APP = `${process.cwd()}/src/app`;
const read = (p: string) => fs.readFileSync(p, 'utf8');

const CONTRACTS = read(`${API}/Contracts/ApiContracts.cs`);
const OPTIONS = read(`${API}/Services/ClientConfig/ClientPlaybackOptions.cs`);
const APPSETTINGS = read(`${API}/appsettings.json`);

const camel = (s: string) => s[0].toLowerCase() + s.slice(1);

/** `record Name(int A, int B)` → ['a', 'b'] (System.Text.Json web defaults: camelCase). */
function recordKeys(cs: string, name: string): string[] {
  const m = cs.match(new RegExp(`\\brecord ${name}\\(([^)]*)\\)`));
  if (!m) return [];
  return m[1].split(',').map((p) => camel(p.trim().split(/\s+/).pop() ?? ''));
}

/** `[Range(a, b, …)] public int Name { get; init; } = d;` → { name: { min, max, fallback } }. */
function optionRanges(cs: string): Record<string, { min: number; max: number; fallback: number }> {
  const out: Record<string, { min: number; max: number; fallback: number }> = {};
  const re =
    /\[Range\((-?\d+),\s*(-?\d+)[^\]]*\]\s*(?:\/\/\/[^\n]*\n\s*)*public int (\w+) \{ get; init; \} = (-?\d+);/g;
  for (const m of cs.matchAll(re)) {
    out[camel(m[3])] = { min: Number(m[1]), max: Number(m[2]), fallback: Number(m[4]) };
  }
  return out;
}

/** The committed `ClientPlayback` section (appsettings.json is JSON with `//` line comments). */
function committed(jsonc: string): Record<string, unknown> {
  const json = jsonc
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  const section = (JSON.parse(json) as Record<string, unknown>)['ClientPlayback'];
  return Object.fromEntries(
    Object.entries((section ?? {}) as Record<string, unknown>).map(([k, v]) => [camel(k), v]),
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const SOURCES = Object.fromEntries(walk(APP).map((p) => [p.slice(APP.length + 1), read(p)]));

/** Files with a value import of `core/<module>` (type-only imports excluded). */
function importers(sources: Record<string, string>, module: string): string[] {
  const re = new RegExp(`^import (?!type\\b)[^;]*?from '(?:\\.{1,2}/)+(?:core/)?${module}';`, 'ms');
  return Object.keys(sources)
    .filter((f) => !f.endsWith(`core/${module}.ts`) && re.test(sources[f]))
    .sort();
}

const TS_KEYS = Object.keys(DEFAULT_PLAYBACK).sort();

describe('api/client-config contract parity (TS against C#)', () => {
  it('the C# records carry exactly the TS keys: { playback: { five knobs }, loginProviders }', () => {
    // loginProviders: [{ id, name }] (schema.md §2.8, Phase 8 B1). The TS model reads it as optional.
    expect(recordKeys(CONTRACTS, 'ClientConfigResponse')).toEqual(['playback', 'loginProviders']);
    expect(recordKeys(CONTRACTS, 'LoginProviderConfig')).toEqual(['id', 'name']);
    expect(recordKeys(CONTRACTS, 'ClientPlaybackConfig').sort()).toEqual(TS_KEYS);
    expect(Object.keys(PLAYBACK_LIMITS).sort()).toEqual(TS_KEYS);
    expect(TS_KEYS).toEqual([
      'catchingUpDelayMs',
      'checkpointIntervalSeconds',
      'checkpointMemoryMiB',
      'seekBudgetMs',
      'warmUpDelayMs',
    ]);
  });

  it('the client clamps to the ranges the server validates, and defaults to its class defaults', () => {
    expect(optionRanges(OPTIONS)).toEqual(PLAYBACK_LIMITS);
  });

  it('every knob: both range ends pass through, one past either end clamps to it', () => {
    for (const [key, { min, max }] of Object.entries(PLAYBACK_LIMITS)) {
      const at = (v: number) =>
        clampPlayback({ ...DEFAULT_PLAYBACK, [key]: v })[key as keyof typeof DEFAULT_PLAYBACK];
      expect([at(min), at(max), at(min - 1), at(max + 1)], key).toEqual([min, max, min, max]);
    }
  });

  it('the committed appsettings values are the client defaults', () => {
    expect(committed(APPSETTINGS)).toEqual(DEFAULT_PLAYBACK);
  });

  it('negative controls: each parser sees a drift in the real text', () => {
    const swap = (src: string, from: string, to: string) => {
      expect(src.split(from)).toHaveLength(2);
      return src.replace(from, to);
    };
    expect(
      recordKeys(
        swap(CONTRACTS, 'int CheckpointMemoryMiB,', 'int CheckpointMemoryMb,'),
        'ClientPlaybackConfig',
      ),
    ).toContain('checkpointMemoryMb');
    expect(recordKeys(CONTRACTS, 'NoSuchRecord')).toEqual([]);
    expect(
      optionRanges(swap(OPTIONS, '[Range(4, 100,', '[Range(4, 200,'))['seekBudgetMs'].max,
    ).toBe(200);
    expect(
      optionRanges(
        swap(
          OPTIONS,
          '[Range(0, 5000, ErrorMessage = "ClientPlayback:CatchingUpDelayMs',
          '[Range(1, 5000, ErrorMessage = "ClientPlayback:CatchingUpDelayMs',
        ),
      )['catchingUpDelayMs'].min,
    ).toBe(1);
    expect(
      optionRanges(
        swap(
          OPTIONS,
          'CheckpointMemoryMiB { get; init; } = 64;',
          'CheckpointMemoryMiB { get; init; } = 32;',
        ),
      )['checkpointMemoryMiB'].fallback,
    ).toBe(32);
    // A property whose annotation is lost drops out, so toEqual(PLAYBACK_LIMITS) fails.
    expect(
      Object.keys(optionRanges(swap(OPTIONS, '[Range(1, 60,', '[Obsolete] //'))).sort(),
    ).toEqual(['catchingUpDelayMs', 'checkpointMemoryMiB', 'seekBudgetMs', 'warmUpDelayMs']);
    // The newest knob (warm-up delay, 2026-11-17): a drifted default or range is seen too.
    expect(
      optionRanges(
        swap(
          OPTIONS,
          'WarmUpDelayMs { get; init; } = 1000;',
          'WarmUpDelayMs { get; init; } = 500;',
        ),
      )['warmUpDelayMs'].fallback,
    ).toBe(500);
    expect(
      committed(swap(APPSETTINGS, '"WarmUpDelayMs": 1000', '"WarmUpDelayMs": 0'))['warmUpDelayMs'],
    ).toBe(0);
    expect(
      committed(swap(APPSETTINGS, '"SeekBudgetMs": 25,', '"SeekBudgetMs": 30,'))['seekBudgetMs'],
    ).toBe(30);
  });

  it('only app.config.ts reaches ClientConfigLoader; the stage, builder and player read the store', () => {
    expect(importers(SOURCES, 'client-config-loader')).toEqual(['app.config.ts']);
    expect(
      Object.keys(SOURCES).filter((f) => /\binject\(\s*ClientConfigLoader\b/.test(SOURCES[f])),
    ).toEqual(['app.config.ts']);
    expect(importers(SOURCES, 'client-config')).toEqual([
      'core/client-config-loader.ts',
      // `loginProviders` (Phase 8): the /mine prompt, /signin and the sign-in dialog.
      'features/mine/pages/mine-page/mine-page.ts',
      'features/player/pages/player-page/player-page.ts',
      'features/show/pages/show-builder-page/show-builder.store.ts',
      'pages/signin/signin-page.ts',
      'shared/fireworks-stage/fireworks-stage.ts',
      'shared/sign-in/sign-in-dialog.ts',
    ]);
  });

  it('negative controls: the importer ledger sees a loader import in the player, and skips type imports', () => {
    const player = 'features/player/pages/player-page/player-page.ts';
    const withLoader = {
      ...SOURCES,
      [player]: `import { ClientConfigLoader } from '../../../../core/client-config-loader';\n${SOURCES[player]}`,
    };
    expect(importers(withLoader, 'client-config-loader')).toEqual(['app.config.ts', player]);
    const multiline = {
      x: "import {\n  ClientConfigLoader,\n} from './client-config-loader';",
      y: "import type { ClientConfigLoader } from './client-config-loader';",
      z: "import { ClientConfigStore } from './client-config';",
    };
    expect(importers(multiline, 'client-config-loader')).toEqual(['x']);
    expect(importers(multiline, 'client-config')).toEqual(['z']);
  });
});
