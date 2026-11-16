/**
 * T3 seeded property tests for TimelineDriver seek exactness (Yoshi's T3 in
 * `.squad/decisions/records/yoshi-interlude-show-testing.md`; testing strategy §3 item 5). Specs
 * only: nothing in the app imports this file. It lives under engine/loop, so it imports only model,
 * sim and loop (`engine-boundary.spec.ts`).
 *
 * One case is a small bounded show (2–6 cues in 0–3 s, forced same-step ties, shells from a fixed
 * subset: crossette, crackle, a 4-break and glitter), a capacity that reaches the cap (800 or
 * 2500), checkpoint spacing 37, 60 or 120 (odd spacings expose modulo bugs), sometimes a memory cap
 * small enough to double the spacing, and a width of 1000 or 1280. A seeded random sequence of
 * actions then drives it: budgeted seeks whose target can move mid-way, loop frames at 24, 60 and
 * 144 fps, a resize, edits through `{ from }` (move, re-seed, add, delete the last cue (D1), delete
 * all), and a warm-up twin with `adoptCheckpoints` both ways.
 *
 * The oracle is independent of TimelineDriver: a test driver that fires the cues itself (its own
 * `Math.round(t * 120)` and `(fireStep, id)` order), folds its own FNV-1a digest and finds the end
 * itself. Every observed state (store, shells in flight, ledger, `endStep`, digest) is
 * compared with one straight oracle pass per (document, width). So a mutant that moves the driver
 * and the oracle together (a digest that skips step 1) still fails.
 *
 * Bookkeeping checked on every action, from a model of the documented rules, not the code:
 *  - a twin holds its source's checkpoints and spacing;
 *  - an edit through `from` takes `from`'s spacing and exactly its checkpoints at or before the
 *    divergence step (with the D1 strict-prefix cap);
 *  - `adoptCheckpoints` spacing is at least the wider of the two, on the merged grid;
 *  - no checkpoint is taken while the run's width differs from the current width;
 *  - every checkpoint sits on the current grid, and the memory cap holds;
 *  - a seek runs exactly `target − base` steps (base: the latest same-width checkpoint at or
 *    before the target, or the current step if that's later and the run is current, else 0),
 *    capped by its budget.
 *
 * Every failure names the case seed. Replay one case with `T3_CASE_SEED=<n>`, a whole run with
 * `T3_SEED=<n>`.
 */
import { PRESETS } from '../../model/presets';
import { newShell, type ShellDocument } from '../../model/shell';
import {
  embeddedShell,
  type EmbeddedShell,
  type ShowCue,
  type ShowDocument,
} from '../../model/show';
import { GROUND } from '../../sim/constants';
import { FireworksSim, type SimSnapshot } from '../../sim/simulation';
import { EngineLoop } from '../engine-loop';
import type { PlaybackContext, PlaybackDriver } from '../playback-driver';
import { TimelineDriver, type TimelineLaunch } from '../timeline-driver';

// ---- Seeds ----------------------------------------------------------------------------------

/** mulberry32: the same generator the engine uses, written out so the spec owns its stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Reads a numeric environment variable when the spec runs in Node; undefined in a browser. */
export function envNumber(name: string): number | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const v = env?.[name];
  return v === undefined || v === '' ? undefined : Number(v);
}

/** The case seeds of a run: N draws from the run seed, so any one replays alone. */
export function caseSeeds(runSeed: number, n: number): number[] {
  const r = mulberry32(runSeed);
  return Array.from({ length: n }, () => Math.floor(r() * 2 ** 31));
}

// ---- Shells and shows --------------------------------------------------------------------------

function embed(shell: ShellDocument): EmbeddedShell {
  const { sky: _sky, ...rest } = structuredClone(shell);
  return rest;
}

const byName = (name: string) => PRESETS.find((p) => p.name === name)!;

/** The fixed subset (Yoshi T3): crossette, crackle, a 4-break and glitter. */
export const T3_SHELLS: Readonly<Record<string, EmbeddedShell>> = Object.freeze({
  cross: embed(byName('Crossette')),
  crackle: embed(byName('Crackling Heart')),
  four: embed(
    newShell('Four Break', {
      burstHeight: 0.55,
      breaks: [
        ...byName('Triple Break').breaks.map((b) => ({ ...b })),
        { color1: 'green', stars: 30, speed: 200, burn: 1.0, effect: 'crossette', delay: 0.5 },
      ],
    }),
  ),
  glitter: embed(byName('Willow')),
});
const SHELL_KEYS = Object.keys(T3_SHELLS);
/** Ids that don't sort in creation order, so ordinal tie order is exercised. */
const ID_POOL = ['c1', 'c10', 'c2', 'B', 'a', 'z9', 'c3', 'Z', 'c11', 'm'];

function newCue(r: Rng, id: string, ties: readonly number[]): ShowCue {
  // A third of cues land on a step another cue already uses: exact copy or within half a step.
  const t =
    ties.length && r() < 0.35
      ? Math.max(0, Math.min(3, pick(r, ties) + pick(r, [0, 0, 1 / 300, -1 / 300])))
      : Math.round(r() * 3000) / 1000;
  const c: ShowCue = {
    id,
    t,
    shell: pick(r, SHELL_KEYS),
    x: Math.round(r() * 100) / 100,
    seed: (Math.floor(r() * 2 ** 32) | 0) as number,
  };
  if (r() < 0.3) c.burstHeight = Math.round((0.3 + r() * 0.55) * 100) / 100;
  return c;
}

function makeShow(r: Rng, n: number): ShowDocument {
  const ids = [...ID_POOL].sort(() => r() - 0.5).slice(0, n);
  const cues: ShowCue[] = [];
  for (const id of ids)
    cues.push(
      newCue(
        r,
        id,
        cues.map((c) => c.t),
      ),
    );
  return {
    version: 1,
    name: 'T3 show',
    sky: { gravity: 160, wind: 0 },
    duration: 30,
    shells: { ...T3_SHELLS },
    cues,
  };
}

// ---- The independent oracle -------------------------------------------------------------------

const FNV_BASIS = 0x811c9dc5;

interface OracleCue {
  readonly cue: ShowCue;
  readonly step: number;
  readonly def: EmbeddedShell;
  readonly ty: number;
}

/** The schedule from schema.md §4.4 rules 2 and 3, written from the rules, not from the driver. */
export function oracleSchedule(doc: ShowDocument): OracleCue[] {
  return doc.cues
    .map((cue) => {
      const def = embeddedShell(doc, cue.shell)!;
      return {
        cue,
        step: Math.round(cue.t * 120),
        def,
        ty: GROUND - (cue.burstHeight ?? def.burstHeight) * GROUND,
      };
    })
    .sort((a, b) => a.step - b.step || (a.cue.id < b.cue.id ? -1 : a.cue.id > b.cue.id ? 1 : 0));
}

/** Fires on schedule before each step; nothing else. */
class OracleDriver implements PlaybackDriver {
  readonly mode = 'oracle';
  k = 0;
  next = 0;
  constructor(private readonly schedule: readonly OracleCue[]) {}
  beforeStep(ctx: PlaybackContext): void {
    while (this.next < this.schedule.length && this.schedule[this.next].step <= this.k) {
      const s = this.schedule[this.next++];
      ctx.fireSeeded(s.def as ShellDocument, s.cue.x * ctx.worldWidth(), s.ty, s.cue.seed);
    }
    this.k++;
  }
  tick(): void {}
  onUserFire(): void {}
  hold(): void {}
}

/** What a straight run looks like before step `step` (before that step's cues fire). */
export interface Observed {
  readonly step: number;
  readonly sim: SimSnapshot;
  readonly ledger: readonly TimelineLaunch[];
  readonly endStep: number | null;
  readonly digest: number | null;
  /** 'seek': end detection has run at this step. 'frames': it runs on the next step. */
  readonly via: 'seek' | 'frames';
  readonly what: string;
  /** The checkpoint the last seek call restored, if any (coverage only). */
  readonly restored?: number;
}

function snapDiff(a: SimSnapshot, b: SimSnapshot): string | null {
  // `simTime` is not compared: `reset` clears the sim but keeps its clock, so a seek that re-runs
  // from 0 ends with a later `simTime` than a straight run. Only the Reduce-flashing renderer reads
  // it (visual-rules.ts), through differences. Reported in the T3 record, not asserted here.
  if (a.particles.n !== b.particles.n) return `n ${a.particles.n} vs ${b.particles.n}`;
  for (let f = 0; f < a.particles.fields.length; f++) {
    const x = a.particles.fields[f];
    const y = b.particles.fields[f];
    for (let i = 0; i < a.particles.n; i++) {
      if (!Object.is(x[i], y[i])) return `field ${f} particle ${i}: ${x[i]} vs ${y[i]}`;
    }
  }
  const sa = JSON.stringify(a.shells);
  const sb = JSON.stringify(b.shells);
  return sa === sb ? null : `shells in flight differ (${a.shells.length} vs ${b.shells.length})`;
}

/**
 * One straight pass of `doc` at `width`, `starBudget` and `capacity`, comparing each observation in step order.
 * Returns the end step it found (or null) and the first mismatch.
 */
function checkAgainstOracle(
  doc: ShowDocument,
  width: number,
  starBudget: number,
  capacity: number,
  obs: readonly Observed[],
  hit: (k: string) => void,
): string | null {
  const schedule = oracleSchedule(doc);
  const sim = new FireworksSim({ capacity, starBudget });
  sim.sky = { ...doc.sky };
  const driver = new OracleDriver(schedule);
  const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
  const lastFire = schedule.at(-1)?.step ?? -1;
  let digest = FNV_BASIS;
  let end: number | null = null;
  let k = 0;
  const empty = () => sim.shellCount === 0 && sim.particles.n === 0;
  if (lastFire < 0 && empty()) end = 0;
  const sorted = [...obs].sort((a, b) => a.step - b.step);
  for (const o of sorted) {
    while (k < o.step) {
      // The digest folds the counts seen before each step k > 0, i.e. after steps 0..k − 2 at
      // step k (what the code does; its doc comment says 0..k − 1, see the T3 record).
      if (k > 0) {
        for (const c of sim.particles.countByKind())
          digest = Math.imul(digest ^ c, 0x01000193) >>> 0;
      }
      driver.beforeStep(loop);
      sim.step(1 / 120);
      k++;
      if (end === null && k > lastFire && empty()) end = k;
    }
    const at = `${o.what} at step ${o.step}`;
    const d = snapDiff(o.sim, sim.snapshot());
    if (d) return `${at}: world differs from a straight run: ${d}`;
    const ledger = schedule
      .filter((s) => s.step < o.step)
      .map((s) => ({
        step: s.step,
        id: s.cue.id,
        shell: s.cue.shell,
        seed: s.cue.seed,
        x: s.cue.x,
        tx: s.cue.x * width,
        ty: s.ty,
      }));
    if (JSON.stringify(o.ledger) !== JSON.stringify(ledger)) {
      return `${at}: ledger ${JSON.stringify(o.ledger.map((l) => [l.id, l.step]))} vs ${JSON.stringify(ledger.map((l) => [l.id, l.step]))}`;
    }
    const reached = end !== null && (o.via === 'seek' ? o.step >= end : o.step > end);
    const unsure = o.via === 'frames' && end === o.step;
    if (!unsure && o.endStep !== (reached ? end : null)) {
      return `${at}: endStep ${o.endStep}, a straight run ${reached ? `ended at ${end}` : 'has not ended'}`;
    }
    if (unsure && o.endStep !== null && o.endStep !== end)
      return `${at}: endStep ${o.endStep} vs ${end}`;
    if (o.digest !== digest) return `${at}: traceDigest ${o.digest} vs ${digest}`;
    if (o.restored !== undefined && end !== null && o.restored > end) hit('restore past end');
  }
  return null;
}

// ---- The model of checkpoint bookkeeping --------------------------------------------------------

/** The documented divergence step (driver doc comment and D1, yoshi-phase7 addendum 1). */
export function modelDiverge(a: ShowDocument, b: ShowDocument): number {
  const sa = oracleSchedule(a);
  const sb = oracleSchedule(b);
  const same = (x: OracleCue, y: OracleCue) =>
    x.step === y.step &&
    x.cue.id === y.cue.id &&
    x.cue.shell === y.cue.shell &&
    x.cue.x === y.cue.x &&
    x.cue.seed === y.cue.seed &&
    x.ty === y.ty &&
    JSON.stringify(x.def) === JSON.stringify(y.def);
  let i = 0;
  while (i < sa.length && i < sb.length && same(sa[i], sb[i])) i++;
  const d = Math.min(sa[i]?.step ?? Infinity, sb[i]?.step ?? Infinity);
  // b is a strict prefix of a: only checkpoints from before b's last cue fired are exact.
  return i === sb.length && i < sa.length ? Math.min(d, sb.at(-1)?.step ?? 0) : d;
}

interface Run {
  readonly name: 'visible' | 'twin';
  driver: TimelineDriver;
  doc: ShowDocument;
  readonly sim: FireworksSim;
  readonly loop: EngineLoop;
  /** The run key (`width|starBudget`) each held checkpoint was taken under: the model's copy. */
  cpKey: Map<number, string>;
  /** The key of the current run since its reset or restore; null before the first. */
  runKey: string | null;
  /** Frames ran while the key differed from the run's: the run is no longer a straight run. */
  tainted: boolean;
  steps: number;
  restored?: number;
}

export interface CaseResult {
  readonly seed: number;
  readonly error: string | null;
  readonly log: readonly string[];
  readonly coverage: Readonly<Record<string, number>>;
}

/** Runs one case. Never throws: the error names the failing check and the action log. */
export interface CaseOptions {
  /**
   * Allow a resize or quality change back to the run's own key (`width|starBudget`) after frames
   * ran under another key, and expect the
   * driver to treat that run as stale (a seek re-runs from a checkpoint, and no checkpoint is
   * taken). On by default since F1 was fixed (T3 record; repros in
   * `timeline-driver.run-key.spec.ts`). Pass false to reproduce the old generator.
   */
  readonly resizeBack?: boolean;
}

export function runCase(seed: number, options: CaseOptions = {}): CaseResult {
  const r = mulberry32(seed);
  const log: string[] = [];
  const cov: Record<string, number> = {};
  const hit = (k: string) => (cov[k] = (cov[k] ?? 0) + 1);
  const capacity = pick(r, [800, 2500]);
  const cpSteps = pick(r, [37, 60, 120]);
  // Small enough in about half the cases that the spacing doubles (1, 2 or 4 snapshots at the cap).
  const cpBytes = r() < 0.5 ? capacity * 64 * pick(r, [1, 2, 4]) : undefined;
  let width = pick(r, [1000, 1280]);
  let budget = 1; // the visible sim's starBudget (DEFAULT_QUALITY), toggled by a quality change
  const key = () => `${width}|${budget}`;
  let doc = makeShow(r, int(r, 2, 6));
  log.push(
    `case seed ${seed}: capacity ${capacity}, checkpointSteps ${cpSteps}, checkpointBytes ${cpBytes ?? 'default'}, width ${width}, cues ${JSON.stringify(doc.cues)}`,
  );
  const obs = new Map<ShowDocument, Map<string, Observed[]>>();
  const fail = (msg: string): CaseResult => ({
    seed,
    error: `${msg}\n  replay: T3_CASE_SEED=${seed}\n  ${log.join('\n  ')}`,
    log,
    coverage: cov,
  });

  const mkRun = (name: Run['name'], driver: TimelineDriver, d: ShowDocument): Run => {
    const sim = new FireworksSim({ capacity });
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
    const run: Run = {
      name,
      driver,
      doc: d,
      sim,
      loop,
      cpKey: new Map(),
      runKey: null,
      tainted: false,
      steps: 0,
    };
    const step = sim.step.bind(sim);
    sim.step = (dt: number) => {
      run.steps++;
      step(dt);
    };
    return run;
  };
  const opts = { checkpointSteps: cpSteps, checkpointBytes: cpBytes, traceDigest: true };
  const vis = mkRun('visible', new TimelineDriver(doc, opts), doc);
  let twin: Run | null = null;

  /** Checks the grid and cap, and records the width of checkpoints that appeared. */
  const sync = (run: Run, mixed: boolean): string | null => {
    const held = run.driver.checkpointSteps;
    const I = run.driver.checkpointInterval;
    for (let i = 0; i < held.length; i++) {
      if (I > 0 && held[i] % I !== 0)
        return `${run.name}: checkpoint ${held[i]} off the ${I}-step grid`;
      if (i && held[i] <= held[i - 1]) return `${run.name}: checkpoints not ascending ${held}`;
    }
    if (cpBytes !== undefined && held.length > 1 && run.driver.checkpointBytes > cpBytes) {
      return `${run.name}: ${run.driver.checkpointBytes} checkpoint bytes over the ${cpBytes} cap`;
    }
    for (const s of [...run.cpKey.keys()]) if (!held.includes(s)) run.cpKey.delete(s);
    for (const s of held) {
      if (run.cpKey.has(s)) continue;
      if (mixed)
        return `${run.name}: checkpoint ${s} taken while the run's key differs from the current key`;
      run.cpKey.set(s, key());
    }
    return null;
  };

  const observe = (run: Run, via: Observed['via'], what: string) => {
    const byKey = obs.get(run.doc) ?? new Map<string, Observed[]>();
    obs.set(run.doc, byKey);
    const list = byKey.get(key()) ?? [];
    byKey.set(key(), list);
    list.push({
      step: run.driver.step,
      sim: run.sim.snapshot(),
      ledger: run.driver.ledger,
      endStep: run.driver.endStep,
      digest: run.driver.traceDigest,
      via,
      what: `${run.name} ${what}`,
      restored: via === 'seek' ? run.restored : undefined,
    });
  };

  /** One seek call, with its exact cost predicted from the model. */
  const seekCall = (run: Run, target: number, budget: number): string | null => {
    const k = run.driver.step;
    // A seek first drops every checkpoint taken under another run key (documented in `seek`).
    for (const [s, w] of [...run.cpKey]) if (w !== key()) run.cpKey.delete(s);
    const started = run.runKey !== null;
    const behind = !started || target < k || run.runKey !== key() || run.tainted;
    let cp: number | undefined;
    for (const s of run.cpKey.keys()) if (s <= target && (cp === undefined || s > cp)) cp = s;
    const base = cp !== undefined && (behind || cp > k) ? cp : behind ? 0 : k;
    if (cp !== undefined && (behind || cp > k)) {
      hit('restore');
      run.restored = cp;
    }
    const before = run.steps;
    const arrived = run.driver.seek(run.loop, target, budget);
    const ran = run.steps - before;
    const want = Math.min(target - base, budget);
    if (ran !== want) {
      return `${run.name} seek(${target}, ${budget}) from step ${k} ran ${ran} steps; the model says ${want} (base ${base}, checkpoints ${JSON.stringify([...run.cpKey])})`;
    }
    if (arrived !== (base + want === target))
      return `${run.name} seek(${target}) returned ${arrived}`;
    run.runKey = key();
    run.tainted = false;
    return sync(run, false);
  };

  const seekTo = (run: Run, target: number, budget: number, moveTo?: number): string | null => {
    let t = target;
    run.restored = undefined;
    for (let call = 0; call < 10_000; call++) {
      const e = seekCall(run, t, budget);
      if (e) return e;
      if (moveTo !== undefined && call === 0 && t !== moveTo) {
        t = moveTo; // the host's target moved after the first slice
        continue;
      }
      if (run.driver.step === t) break;
    }
    observe(run, 'seek', `seek(${target}${moveTo !== undefined ? `→${moveTo}` : ''}, ${budget})`);
    return null;
  };

  const targetFor = (run: Run) => {
    // A fifth of targets land on (or next to) a held checkpoint: users scrub to round times.
    const held = run.driver.checkpointSteps;
    if (held.length && r() < 0.2) {
      hit('target on a checkpoint');
      return Math.max(0, pick(r, held) + pick(r, [0, 0, 1, -1]));
    }
    return int(r, 0, Math.min(run.driver.endBoundStep, 2400) + 40);
  };
  /** A cue time for an edit: mostly in 0–3 s, sometimes late. */
  const editT = () => {
    // Late cues land between the last fire and the end bound, so often after the real end, where
    // inherited checkpoints carry the old show's end.
    const d = vis.driver;
    const lateFrom = d.endStep ?? d.lastFireStep;
    if (r() < 0.5 && d.endBoundStep > lateFrom) {
      return Math.round((int(r, lateFrom + 1, d.endBoundStep) / 120) * 1000) / 1000;
    }
    return Math.round(r() * 3000) / 1000;
  };
  /** A key back happened and no seek or frames have been checked since (coverage only). */
  let checkAfterBack = false;
  /** The next action is the directed key back (set after frames under another key). */
  let forceBack = false;
  const nActions = int(r, 6, 14);
  for (let a = 0; a < nActions; a++) {
    const roll = forceBack ? 0.55 : r();
    let e: string | null = null;
    if (roll < 0.34) {
      const target = targetFor(vis);
      const budget = r() < 0.6 ? Infinity : pick(r, [37, 50, 200]);
      const moveTo = budget !== Infinity && r() < 0.3 ? targetFor(vis) : undefined;
      log.push(
        `${a}: visible seek ${target}${moveTo !== undefined ? ` then ${moveTo}` : ''} budget ${budget}`,
      );
      e = seekTo(vis, target, budget, moveTo);
      if (!e && checkAfterBack) {
        hit('seek after key back');
        checkAfterBack = false;
      }
    } else if (roll < 0.52) {
      const ms = pick(r, [1000 / 24, 1000 / 60, 1000 / 144]);
      const frames = int(r, 1, 40);
      log.push(`${a}: ${frames} frames of ${ms.toFixed(2)} ms`);
      const fresh = vis.runKey === null;
      const mixed = !fresh && (vis.runKey !== key() || vis.tainted);
      const before = vis.steps;
      for (let f = 0; f < frames; f++) vis.loop.frame(ms);
      const ran = vis.steps - before;
      if (fresh && ran > 0) vis.runKey = key(); // the first beforeStep resets
      if (mixed && ran > 0) vis.tainted = true;
      e = sync(vis, mixed);
      if (!e && !mixed && vis.runKey !== null) observe(vis, 'frames', `after ${frames} frames`);
      if (mixed && ran > 0) hit('frames after a key change');
      if (!e && checkAfterBack && ran > 0) hit('frames after key back');
      if (!e && mixed && ran > 0 && vis.runKey !== key() && options.resizeBack !== false)
        forceBack = r() < 0.8;
    } else if (roll < 0.6) {
      // A resize (the stage doesn't re-seek on one) or a quality change of starBudget. After
      // frames under another key, the next action usually (0.8) goes straight back to the run's
      // key: the F1 shape (Toad, interlude: undirected, N 24 never produced it and N 500 about 3
      // times).
      const directBack = forceBack && vis.tainted && vis.runKey !== null && vis.runKey !== key();
      forceBack = false;
      const [rkW, rkB] = (vis.runKey ?? '').split('|').map(Number);
      const quality = directBack ? rkW === width : r() < 0.35;
      const w = directBack ? rkW : quality ? width : width === 1280 ? 1000 : 1280;
      const b = directBack ? rkB : quality ? (budget === 1 ? 0.5 : 1) : budget;
      const back = vis.tainted && `${w}|${b}` === vis.runKey;
      const what = quality ? `starBudget ${b}` : `resize to ${w}`;
      if (back && options.resizeBack === false) {
        log.push(
          `${a}: ${what} skipped: back to the run's key (finding F1; CaseOptions.resizeBack)`,
        );
        hit('key back skipped');
      } else {
        width = w;
        budget = b;
        vis.sim.starBudget = b;
        log.push(`${a}: ${what}`);
        hit(back ? 'key back' : quality ? 'quality change' : 'resize');
        if (back) checkAfterBack = true;
      }
    } else if (roll < 0.78) {
      const op = pick(r, [
        'move',
        'move',
        'reseed',
        'add',
        'add',
        'delete last',
        'delete last',
        'delete all',
        'extend',
        'extend',
        'extend',
      ]);
      if (op === 'extend') {
        // Play past the end, then add a cue after it: inherited checkpoints from after the old end
        // carry the old show's endStep (the W3 rule in `restore`).
        log.push(`${a}: play to the end (seek ${vis.driver.endBoundStep})`);
        const pe = seekTo(vis, vis.driver.endBoundStep, Infinity);
        if (pe) return fail(pe);
      }
      const cues = structuredClone(doc.cues);
      const order = oracleSchedule(doc).map((s) => s.cue.id);
      if (op === 'move' && cues.length) {
        const c = pick(r, cues);
        c.t = editT();
      } else if (op === 'reseed' && cues.length) {
        pick(r, cues).seed ^= 0x5bd1e995;
      } else if (op === 'add') {
        const id = ID_POOL.find((x) => !cues.some((c) => c.id === x));
        if (id) {
          const c = newCue(
            r,
            id,
            cues.map((x) => x.t),
          );
          if (r() < 0.5) c.t = editT();
          cues.push(c);
        }
      } else if (op === 'delete last' && order.length) {
        cues.splice(
          cues.findIndex((c) => c.id === order.at(-1)),
          1,
        );
      } else if (op === 'delete all') {
        cues.length = 0;
      } else if (op === 'extend') {
        const id = ID_POOL.find((x) => !cues.some((c) => c.id === x));
        const end = vis.driver.endStep ?? vis.driver.step;
        if (id) {
          const c = newCue(r, id, []);
          c.t = Math.round(((end + int(r, 1, 200)) / 120) * 1000) / 1000;
          cues.push(c);
        }
      }
      const next: ShowDocument = { ...doc, cues };
      const spacing = r() < 0.3 ? pick(r, [37, 60, 120]) : cpSteps;
      const from = vis.driver;
      const d = modelDiverge(doc, next);
      const want = from.checkpointSteps.filter((s) => s <= d);
      const edited = new TimelineDriver(next, { ...opts, checkpointSteps: spacing, from });
      log.push(
        `${a}: edit ${op} (spacing option ${spacing}) → cues ${JSON.stringify(cues.map((c) => [c.id, c.t]))}; diverge ${d}`,
      );
      hit(`edit ${op}`);
      const fromEnd = from.endStep;
      if (fromEnd !== null && oracleSchedule(next).some((x) => x.step > fromEnd)) {
        hit('edit after the end');
      }
      if (want.some((c) => c > (from.endStep ?? Infinity)))
        hit('inherits a checkpoint past the end');
      if (edited.checkpointInterval !== from.checkpointInterval) {
        e = `edit: interval ${edited.checkpointInterval}, from's is ${from.checkpointInterval}`;
      } else if (JSON.stringify(edited.checkpointSteps) !== JSON.stringify(want)) {
        e = `edit: inherited ${JSON.stringify(edited.checkpointSteps)}, want ${JSON.stringify(want)} (diverge ${d})`;
      } else {
        if (want.length) hit('inherited checkpoints');
        if (op === 'delete last' && want.length && want.at(-1)! > (from.endStep ?? 0))
          hit('D1 shape');
        const at = vis.driver.step;
        vis.driver = edited;
        vis.doc = next;
        vis.cpKey = new Map([...vis.cpKey].filter(([s]) => want.includes(s)));
        vis.runKey = null;
        vis.tainted = false;
        vis.loop.setDriver(edited);
        doc = next;
        // The stage always seeks after a new driver: to where it was (fireworks-stage.ts, the
        // timeline effect), or to a seek already pending.
        e = seekTo(vis, r() < 0.7 ? at : targetFor(vis), Infinity);
      }
    } else if (roll < 0.92) {
      if (!twin || r() < 0.25) {
        const t = vis.driver.twin();
        twin = mkRun('twin', t, vis.doc);
        twin.sim.starBudget = budget;
        twin.cpKey = new Map(vis.cpKey);
        log.push(`${a}: twin of the visible driver`);
        hit('twin');
        if (JSON.stringify(t.checkpointSteps) !== JSON.stringify(vis.driver.checkpointSteps)) {
          e = `twin holds ${JSON.stringify(t.checkpointSteps)}, its source ${JSON.stringify(vis.driver.checkpointSteps)}`;
        } else if (t.checkpointInterval !== vis.driver.checkpointInterval) {
          e = `twin interval ${t.checkpointInterval}, its source ${vis.driver.checkpointInterval}`;
        }
      }
      if (!e) {
        twin.sim.starBudget = budget; // the stage syncs the shadow's budget (W8/M10)
        // The stage warms its shadow to the end; sometimes stop part-way.
        const target = r() < 0.6 ? twin.driver.endBoundStep : targetFor(twin);
        log.push(`${a}: twin warms to ${target} in 200-step slices`);
        e = seekTo(twin, target, 200);
      }
      if (!e) e = adopt(vis, twin, log, a, hit, key());
    } else {
      if (twin) e = adopt(twin, vis, log, a, hit, key());
    }
    if (e) return fail(e);
  }

  // Compare every observation with one straight pass per (document, run key).
  for (const [d, byKey] of obs) {
    for (const [k, list] of byKey) {
      const [w, b] = k.split('|').map(Number);
      const e = checkAgainstOracle(d, w, b, capacity, list, hit);
      if (e) return fail(e);
      hit('oracle pass');
      if (list.some((o) => o.sim.particles.n >= capacity - 5)) hit('at the cap');
      if (list.some((o) => o.endStep !== null)) hit('ended');
    }
  }
  return { seed, error: null, log, coverage: cov };
}

/** `receiver.adoptCheckpoints(source)`, checked against the documented rule. */
function adopt(
  receiver: Run,
  source: Run,
  log: string[],
  a: number,
  hit: (k: string) => void,
  key: string,
): string | null {
  const Ir = receiver.driver.checkpointInterval;
  const Is = source.driver.checkpointInterval;
  const d = modelDiverge(source.doc, receiver.doc);
  const held = receiver.driver.checkpointSteps;
  const offered = source.driver.checkpointSteps.filter((s) => s <= d && !held.includes(s));
  receiver.driver.adoptCheckpoints(source.driver);
  const I = receiver.driver.checkpointInterval;
  log.push(
    `${a}: ${receiver.name} adopts from ${source.name} (intervals ${Ir}/${Is} → ${I}; diverge ${d})`,
  );
  hit('adopt');
  if (Ir !== Is) hit('adopt across spacings');
  const wide = Math.max(Ir, Is);
  if (I < wide || I % wide !== 0 || !Number.isInteger(Math.log2(I / wide))) {
    return `adopt: interval ${I}, want the wider ${wide} (doubled only by the memory cap)`;
  }
  const want = [...new Set([...held, ...offered])].filter((s) => s % I === 0).sort((x, y) => x - y);
  if (JSON.stringify(receiver.driver.checkpointSteps) !== JSON.stringify(want)) {
    return `adopt: ${receiver.name} holds ${JSON.stringify(receiver.driver.checkpointSteps)}, want ${JSON.stringify(want)}`;
  }
  const merged = new Map(receiver.cpKey);
  for (const s of offered) merged.set(s, source.cpKey.get(s) ?? key);
  receiver.cpKey = new Map([...merged].filter(([s]) => want.includes(s)));
  return null;
}
