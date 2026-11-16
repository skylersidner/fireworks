/**
 * Integer show fingerprints (testing interlude T2; record `yoshi-interlude-t2-fingerprints.md`).
 *
 * One straight run of a show to its end, reduced to integers that every JS engine computes
 * exactly: the end step, a hash of the launch ledger, a digest of the per-kind live counts after
 * every step, and the counts sampled every 600 steps. Committed goldens
 * (`fingerprints/<case>.json`, written only by `tools/fingerprints/record.mjs --reason …`) pin
 * them, so a sim change that moves every run the same way fails, which a run-vs-run spec can't
 * see.
 *
 * Why only integers: deaths are `age >= life` (`simulation.ts`) and no spawn or death reads a
 * position, so counts, the ledger and the end come from integer RNG and correctly rounded
 * `+ − × ÷` only. Positions and velocities go through `Math.exp/sin/cos`, which engines
 * approximate differently, so they are never hashed. The ledger's `tx`/`ty` are hashed by their
 * float64 bits: they are `x * width` and `760 − h * 760`, one correctly rounded operation each.
 *
 * Pure engine code (model, sim, loop imports only; `engine-boundary.spec.ts`). Three callers run
 * this same source: the regular and daily specs (Node), the recorder (esbuild bundle in Node) and
 * the browser harness (`tools/browser-gates/fingerprints.mjs`, the same bundle in Chromium,
 * Firefox and WebKit). Nothing in the app imports it.
 */
import { openShow } from '../../model/open';
import { PRESETS } from '../../model/presets';
import type { EmbeddedShell, ShowDocument } from '../../model/show';
import { CAP } from '../../sim/constants';
import { FireworksSim } from '../../sim/simulation';
import { EngineLoop } from '../engine-loop';
import { TimelineDriver } from '../timeline-driver';

/** The sim settings a fingerprint is for. Anything here changes the run, so it is in the key. */
export interface RunKey {
  readonly width: number;
  readonly capacity: number;
  readonly starBudget: number;
}

/** Where a case's show comes from: a shared schema fixture, or the realistic generator. */
export type FingerprintInput = { readonly fixture: string } | { readonly realistic: number };

export interface FingerprintCase {
  /** File stem of the golden: `fingerprints/<name>.json`. */
  readonly name: string;
  /**
   * `regular` runs in `show-fingerprint.spec.ts`; `daily` in `show-fingerprint.daily.spec.ts`,
   * except the names in `FINAL_ONLY_CASES`, which run in `show-fingerprint.final.spec.ts`. The tier
   * is part of each golden's `case`, so moving a case between tiers is a re-record.
   */
  readonly tier: 'regular' | 'daily';
  readonly input: FingerprintInput;
  readonly run: RunKey;
}

export interface FingerprintSample {
  /** Steps simulated so far (a multiple of `SAMPLE_EVERY`). */
  readonly step: number;
  readonly n: number;
  readonly shells: number;
  /** Live particles per kind code (`KIND_NAMES` order). */
  readonly kinds: readonly number[];
}

/** Every field is an integer; hashes are uint32. */
export interface ShowFingerprint {
  /** The step the show ended on (§4.5). */
  readonly endStep: number;
  readonly lastFireStep: number;
  /** Ledger rows (one per cue fired). */
  readonly launches: number;
  /** FNV-1a over every ledger row: step, seed, id, shell, and the float64 bits of tx and ty. */
  readonly ledgerHash: number;
  /** The driver's own `traceDigest`: per-kind live counts after every step through the end. */
  readonly traceDigest: number;
  /** FNV-1a over `n` and `shellCount` after every step (independent of the driver's digest). */
  readonly populationDigest: number;
  readonly peakN: number;
  /** First step after which `n` was `peakN`. */
  readonly peakStep: number;
  /** Counts every `SAMPLE_EVERY` steps, up to the end. */
  readonly samples: readonly FingerprintSample[];
}

export const SAMPLE_EVERY = 600;

/** The run key of the plain cases: the default world width, the 40k cap, full star budget. */
export const STANDARD_RUN: RunKey = { width: 1280, capacity: CAP, starBudget: 1 };

const fixture = (name: string, tier: FingerprintCase['tier'] = 'regular'): FingerprintCase => ({
  name,
  tier,
  input: { fixture: name },
  run: STANDARD_RUN,
});

/**
 * The committed set. Regular: every valid show fixture except `at-maximums`, the Done-when show
 * once more at capacity 2500 (the cap is where order and history matter), and a 60 s realistic
 * preset show. Daily: the 600 s `at-maximums` (1,000 cues) and a 600 s realistic show.
 */
export const FINGERPRINT_CASES: readonly FingerprintCase[] = [
  fixture('done-when-60s-50'),
  {
    name: 'done-when-60s-50.cap2500',
    tier: 'regular',
    input: { fixture: 'done-when-60s-50' },
    run: { ...STANDARD_RUN, capacity: 2500 },
  },
  { name: 'realistic-60', tier: 'regular', input: { realistic: 60 }, run: STANDARD_RUN },
  fixture('cue-at-duration'),
  fixture('same-step-cues'),
  fixture('at-minimums'),
  fixture('cue-burst-height'),
  fixture('key-edges'),
  fixture('minimal'),
  fixture('seed-extremes'),
  fixture('unreferenced-shell'),
  fixture('at-maximums', 'daily'),
  { name: 'realistic-600', tier: 'daily', input: { realistic: 600 }, run: STANDARD_RUN },
];

/**
 * Daily-tier cases that run only in the final tier (end-of-project review; Skyler 2026-11-16: the
 * at-maximums runs leave daily). Kept as a list rather than a third `tier` value so the committed
 * goldens, whose `case` carries the tier, stay byte-identical.
 */
export const FINAL_ONLY_CASES: readonly string[] = ['at-maximums'];

// ---- Hashing ----------------------------------------------------------------------------------

const FNV_BASIS = 0x811c9dc5;
const fold = (h: number, word: number): number => Math.imul(h ^ (word >>> 0), 0x01000193) >>> 0;
const f64 = new Float64Array(1);
const f64Words = new Uint32Array(f64.buffer);

function foldFloatBits(h: number, x: number): number {
  f64[0] = x;
  return fold(fold(h, f64Words[0]), f64Words[1]);
}

function foldString(h: number, s: string): number {
  h = fold(h, s.length);
  for (let i = 0; i < s.length; i++) h = fold(h, s.charCodeAt(i));
  return h;
}

/** FNV-1a over a document's JSON text: tells "the input moved" apart from "the sim moved". */
export function inputDigest(doc: unknown): number {
  return foldString(FNV_BASIS, JSON.stringify(doc));
}

// ---- The run ----------------------------------------------------------------------------------

/**
 * Runs `raw` (a ShowDocument as stored; it goes through `openShow`) to its end and returns its
 * fingerprint. Throws if the document doesn't open or the show doesn't end within its bound.
 */
export function fingerprintShow(raw: unknown, run: RunKey): ShowFingerprint {
  const opened = openShow(raw);
  if (!opened.ok)
    throw new Error(`fingerprintShow: the show does not open (${opened.errors[0]?.code})`);
  const sim = new FireworksSim({ capacity: run.capacity, starBudget: run.starBudget });
  const driver = new TimelineDriver(opened.show, { checkpointSteps: 0, traceDigest: true });
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => run.width, driver });

  let population = FNV_BASIS;
  let peakN = 0;
  let peakStep = 0;
  const samples: FingerprintSample[] = [];
  while (!driver.done && driver.step <= driver.endBoundStep) {
    driver.advance(loop, 1);
    const k = driver.step;
    const n = sim.particles.n;
    const shells = sim.shellCount;
    population = fold(fold(population, n), shells);
    if (n > peakN) {
      peakN = n;
      peakStep = k;
    }
    if (k % SAMPLE_EVERY === 0)
      samples.push({ step: k, n, shells, kinds: sim.particles.countByKind() });
  }
  const endStep = driver.endStep;
  if (endStep === null) {
    throw new Error(
      `fingerprintShow: no end by step ${driver.step} (bound ${driver.endBoundStep})`,
    );
  }

  let ledgerHash = FNV_BASIS;
  const ledger = driver.ledger;
  for (const row of ledger) {
    ledgerHash = fold(fold(ledgerHash, row.step), row.seed);
    ledgerHash = foldString(foldString(ledgerHash, row.id), row.shell);
    ledgerHash = foldFloatBits(foldFloatBits(ledgerHash, row.tx), row.ty);
  }
  return {
    endStep,
    lastFireStep: driver.lastFireStep,
    launches: ledger.length,
    ledgerHash,
    traceDigest: driver.traceDigest ?? 0,
    populationDigest: population,
    peakN,
    peakStep,
    samples,
  };
}

// ---- Comparison -------------------------------------------------------------------------------

/**
 * Every difference between two fingerprints (or any JSON values), as `path: expected X, got Y`.
 * Walks the union of keys, so a missing or extra field is a difference too. Empty means equal.
 */
export function diffFingerprint(expected: unknown, actual: unknown, path = ''): string[] {
  const show = (v: unknown) => (v === undefined ? 'nothing' : JSON.stringify(v));
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const out: string[] = [];
    if (expected.length !== actual.length) {
      out.push(`${path}.length: expected ${expected.length}, got ${actual.length}`);
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++)
      out.push(...diffFingerprint(expected[i], actual[i], `${path}[${i}]`));
    return out;
  }
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObj(expected) && isObj(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    return keys.flatMap((k) => diffFingerprint(expected[k], actual[k], path ? `${path}.${k}` : k));
  }
  return Object.is(expected, actual)
    ? []
    : [`${path}: expected ${show(expected)}, got ${show(actual)}`];
}

// ---- Inputs -----------------------------------------------------------------------------------

/**
 * The show a case runs. `readFixture(name)` returns the fixture file's parsed JSON
 * (`schema/fixtures/valid/show/<name>.json`, `{ description, kind, document }`); each caller
 * reads files its own way (fs in Node, a bundled map in the browser).
 */
export function caseInput(c: FingerprintCase, readFixture: (name: string) => unknown): unknown {
  if ('fixture' in c.input) {
    const file = readFixture(c.input.fixture) as { document?: unknown } | null;
    if (!file || file.document === undefined) throw new Error(`no fixture ${c.input.fixture}`);
    return file.document;
  }
  return realisticShow(c.input.realistic);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embed(shell: (typeof PRESETS)[number]): EmbeddedShell {
  const { sky: _sky, ...rest } = structuredClone(shell);
  return rest;
}

/**
 * The bench's realistic preset show (`tools/bench/shows.mjs` `realistic`, same RNG and rounding;
 * the recorder checks the two agree): a cue every 1–4 s, then a 30 s finale at one cue per 0.3 s,
 * every preset, wind 8. `duration` ≥ 30.
 */
export function realisticShow(duration: number): ShowDocument {
  const r = mulberry32(424242);
  const times: number[] = [];
  const finale = duration - 30;
  let t = 0;
  while (t < finale) {
    times.push(t);
    t += 1 + r() * 3;
  }
  for (t = finale; t <= duration; t += 0.3) times.push(t);
  const shells: Record<string, EmbeddedShell> = {};
  PRESETS.forEach((p, i) => (shells['p' + i] = embed(p)));
  return {
    version: 1,
    name: `Realistic ${duration}s`,
    sky: { gravity: 160, wind: 8 },
    duration,
    shells,
    cues: times.map((tt, i) => ({
      id: 'c' + (i + 1),
      t: Math.round(Math.min(tt, duration) * 100) / 100,
      shell: 'p' + Math.floor(r() * PRESETS.length),
      x: Math.round((0.1 + r() * 0.8) * 1000) / 1000,
      seed: (r() * 4294967296) | 0,
    })),
  };
}
