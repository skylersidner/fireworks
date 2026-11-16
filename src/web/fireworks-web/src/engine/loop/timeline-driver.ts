import {
  cueFireStep,
  embeddedShell,
  orderCues,
  STEPS_PER_SECOND,
  type ShowCue,
  type ShowDocument,
} from '../model/show';
import type { ShellDocument } from '../model/shell';
import { GROUND, STEP } from '../sim/constants';
import { shellLifetimeBound } from '../sim/lifetime';
import type { FireworksSim, SimSnapshot } from '../sim/simulation';
import type { PlaybackContext, PlaybackDriver } from './playback-driver';

/** One cue as fired: the launch ledger row (tests, cross-browser comparison, the HUD). */
export interface TimelineLaunch {
  /** The show step it fired before (§4.4 rule 3). Always equals `fireStep` of the cue. */
  readonly step: number;
  readonly id: string;
  /** The `shells` key it fired. */
  readonly shell: string;
  readonly seed: number;
  /** The cue's fraction of the world width, as stored. */
  readonly x: number;
  /** World units at fire time: `tx = x * worldWidth()`, `ty = 760 - burstHeight * 760`. */
  readonly tx: number;
  readonly ty: number;
}

/** A cue resolved for playback, in firing order. */
export interface ScheduledCue {
  readonly cue: Readonly<ShowCue>;
  /** `Math.round(t * 120)` (§4.4 rule 2). */
  readonly fireStep: number;
  readonly def: Readonly<ShellDocument>;
  /** Launch target height in world units (§4.3). */
  readonly ty: number;
  /** Step by which this cue has nothing alive (`shellLifetimeBound`, a bound, not a prediction). */
  readonly endBoundStep: number;
}

export interface TimelineDriverOptions {
  /**
   * The driver this one replaces after a document edit. Its checkpoints from before the first
   * step where the two schedules differ are kept, so an edit re-seeks from there, not from 0.
   */
  readonly from?: TimelineDriver;
  /** Steps between checkpoints (default 1200, 10 s). 0 turns checkpoints off: every seek re-runs. */
  readonly checkpointSteps?: number;
  /** Memory cap for checkpoints, bytes (default 64 MiB). Over it, the spacing doubles. */
  readonly checkpointBytes?: number;
  /**
   * Keep `traceDigest`, a hash of the per-kind live counts after every step (acceptance 6a.2).
   * Costs one pass over the particles per step, so it's off by default.
   */
  readonly traceDigest?: boolean;
}

export const DEFAULT_CHECKPOINT_STEPS = 1200;
export const DEFAULT_CHECKPOINT_BYTES = 64 * 1024 * 1024;

/** FNV-1a offset basis: the digest of an empty trace. */
const FNV_BASIS = 0x811c9dc5;

/** Seconds of show time at the start of step `k`. */
export function stepToSeconds(step: number): number {
  return step / STEPS_PER_SECOND;
}

/** The step a show time falls on (the same rounding as a cue, §4.4 rule 2). */
export function secondsToStep(t: number): number {
  return cueFireStep(t);
}

/** What a checkpoint's world depends on besides the document. A mismatch makes it unusable. */
interface RunKey {
  readonly width: number;
  readonly starBudget: number;
  readonly capacity: number;
}

/** The exact driver and sim state before step `step` runs (before its cues fire). */
interface Checkpoint {
  readonly step: number;
  readonly next: number;
  readonly endStep: number | null;
  readonly ledger: readonly TimelineLaunch[];
  readonly digest: number;
  readonly key: RunKey;
  readonly sim: SimSnapshot;
}

function sameKey(a: RunKey, b: RunKey): boolean {
  return a.width === b.width && a.starBudget === b.starBudget && a.capacity === b.capacity;
}

/** Whether two scheduled cues fire identically and write identical ledger rows. */
function sameScheduled(a: ScheduledCue, b: ScheduledCue): boolean {
  return (
    a.fireStep === b.fireStep &&
    a.cue.id === b.cue.id &&
    a.cue.shell === b.cue.shell &&
    a.cue.x === b.cue.x &&
    a.cue.seed === b.cue.seed &&
    a.ty === b.ty &&
    // Key order can differ between equal shells; that only costs a checkpoint, never exactness.
    JSON.stringify(a.def) === JSON.stringify(b.def)
  );
}

/**
 * The last step at which `from`'s checkpoints still describe the receiver's show exactly
 * (Infinity when the schedules never differ). Before the first differing cue every fire is
 * identical; cues on that step itself fire after a checkpoint taken there, so a checkpoint at
 * exactly this step is still exact. `b` is the receiver.
 *
 * When `b` is a strict prefix of `a` (its last cues removed), the world agrees up to `a`'s first
 * extra cue, but a checkpoint taken after `b`'s last cue fired carries `a`'s unended `endStep` and
 * `next === b.length`, so `restore` would date the end at the checkpoint. Capping at `b`'s last
 * `fireStep` keeps only checkpoints taken before that cue fired (yoshi-phase7-architecture-rulings
 * addendum 1, D1).
 */
function divergeStep(a: readonly ScheduledCue[], b: readonly ScheduledCue[]): number {
  let i = 0;
  while (i < a.length && i < b.length && sameScheduled(a[i], b[i])) i++;
  const d = Math.min(a[i]?.fireStep ?? Infinity, b[i]?.fireStep ?? Infinity);
  return i === b.length && i < a.length ? Math.min(d, b.at(-1)?.fireStep ?? 0) : d;
}

/**
 * Plays a ShowDocument (schema.md §4, plan Phase 6) on an `EngineLoop`: a pure, deterministic
 * driver with its own show clock.
 *
 *  - **Clock.** `step` counts `beforeStep` calls since the last `reset`. The loop calls
 *    `beforeStep` immediately before every `sim.step(STEP)`, so `step` is the number of steps the
 *    show has simulated. Wall time never enters: a paused stage simply doesn't step.
 *  - **Firing (§4.4).** Before step `k`, every unfired cue with `fireStep <= k` fires in
 *    `(fireStep, id)` order through `ctx.fireSeeded` with the cue's own seed, at
 *    `x * ctx.worldWidth()`. `duration` never gates firing (§4.5).
 *  - **End (§4.5).** `endStep` is the first step `k` at which every cue has fired and the sim has
 *    no shell and no particle. `done` is true from then on.
 *  - **Seek.** `seek(ctx, k)` leaves the sim exactly as a straight run from 0 to `k` would. It
 *    starts from the latest exact checkpoint at or before `k` (or from where it is, if that's
 *    later), else from a reset, and runs on. Checkpoints are full copies of the world taken on
 *    the way (every 10 s of show time), so this is a cached re-run from 0, never an
 *    approximation; they're dropped when the world width, `starBudget` or capacity changes.
 *
 * The sky is the show's (§4.1): `reset` sets it. Determinism holds at equal `starBudget` and
 * world width (§13); both belong to the viewer. User fire (clicks) would break it, so hosts turn
 * `clickToFire` off; `onUserFire` and `hold` are no-ops.
 */
export class TimelineDriver implements PlaybackDriver {
  readonly mode = 'timeline';
  /** Every cue, resolved, in firing order. */
  readonly schedule: readonly ScheduledCue[];
  /** `fireStep` of the last cue to fire (0 for an empty show, which can't be saved). */
  readonly lastFireStep: number;
  /**
   * A step by which the show has certainly ended: the largest `endBoundStep`. The real end is
   * `endStep` once reached.
   */
  readonly endBoundStep: number;

  private readonly doc: ShowDocument;
  private readonly sky: ShowDocument['sky'];
  private readonly digestOn: boolean;
  private readonly cpBytesMax: number;
  private cpSteps: number;
  private checkpoints: Checkpoint[] = [];
  private runKey: RunKey | null = null;
  private k = 0;
  private next = 0;
  private started = false;
  private digest = FNV_BASIS;
  private _endStep: number | null = null;
  private _ledger: TimelineLaunch[] = [];

  /**
   * @param show A valid ShowDocument (from `openShow` / `normalizeShow` with `ok: true`). Throws if
   *   a cue names a shell the show doesn't have; the validator rejects that document (§6.3).
   */
  constructor(show: ShowDocument, options: TimelineDriverOptions = {}) {
    this.doc = show;
    this.sky = { ...show.sky };
    this.digestOn = options.traceDigest ?? false;
    this.cpSteps = Math.max(0, Math.floor(options.checkpointSteps ?? DEFAULT_CHECKPOINT_STEPS));
    this.cpBytesMax = options.checkpointBytes ?? DEFAULT_CHECKPOINT_BYTES;
    this.schedule = orderCues(show.cues).map((cue) => {
      const embedded = embeddedShell(show, cue.shell);
      if (!embedded) {
        throw new Error(`TimelineDriver: cue ${cue.id} names unknown shell ${cue.shell}`);
      }
      const def = structuredClone(embedded) as ShellDocument;
      const burstHeight = cue.burstHeight ?? def.burstHeight;
      const fireStep = cueFireStep(cue.t);
      return {
        cue: { ...cue },
        fireStep,
        def,
        ty: GROUND - burstHeight * GROUND,
        endBoundStep:
          fireStep + Math.ceil(shellLifetimeBound(def, burstHeight, show.sky.gravity) / STEP),
      };
    });
    this.lastFireStep = this.schedule.at(-1)?.fireStep ?? 0;
    this.endBoundStep = Math.max(0, ...this.schedule.map((s) => s.endBoundStep));
    if (options.from) this.inherit(options.from);
  }

  /** Steps simulated since show start; the next `beforeStep` is for this step. */
  get step(): number {
    return this.k;
  }

  /** Show time in seconds (`step / 120`). */
  get time(): number {
    return stepToSeconds(this.k);
  }

  /** Cues fired so far. */
  get firedCount(): number {
    return this.next;
  }

  /** The step the show ended on (§4.5), or null while anything is still to fire or alive. */
  get endStep(): number | null {
    return this._endStep;
  }

  /** True once the last cue has fired and the last particle has faded. */
  get done(): boolean {
    return this._endStep !== null;
  }

  /** Every launch since the last reset, in firing order. A copy. */
  get ledger(): readonly TimelineLaunch[] {
    return [...this._ledger];
  }

  /**
   * FNV-1a over `countByKind()` after every step so far (steps `0..step − 1`), as uint32. At
   * `endStep` it covers the whole show through its first empty step. Null unless
   * `traceDigest` was set. Equal digests and ledgers in two browsers mean the same show (6a.2).
   */
  get traceDigest(): number | null {
    return this.digestOn ? this.digest : null;
  }

  /** Steps of the checkpoints held, ascending. For specs and for tuning. */
  get checkpointSteps(): readonly number[] {
    return this.checkpoints.map((c) => c.step);
  }

  /** Bytes the checkpoints hold (approximate). */
  get checkpointBytes(): number {
    return this.checkpoints.reduce((sum, c) => sum + c.sim.bytes, 0);
  }

  /** Back to step 0: empties the sky, applies the show's sky, forgets every fire. */
  reset(ctx: PlaybackContext): void {
    ctx.sim.clear();
    ctx.sim.sky = { ...this.sky };
    this.k = 0;
    this.next = 0;
    this.digest = FNV_BASIS;
    this._endStep = null;
    this._ledger = [];
    this.started = true;
    this.runKey = this.keyOf(ctx);
  }

  /** §4.4 rule 3, then advance the clock. The loop calls this before every `sim.step`. */
  beforeStep(ctx: PlaybackContext): void {
    if (!this.started) this.reset(ctx);
    const k = this.k;
    if (k > 0) {
      if (this.cpSteps > 0 && k % this.cpSteps === 0) this.takeCheckpoint(ctx);
      if (this.digestOn) this.foldCounts(ctx.sim);
    }
    const schedule = this.schedule;
    while (this.next < schedule.length && schedule[this.next].fireStep <= k) {
      const s = schedule[this.next++];
      const tx = s.cue.x * ctx.worldWidth();
      ctx.fireSeeded(s.def, tx, s.ty, s.cue.seed);
      this._ledger.push({
        step: k,
        id: s.cue.id,
        shell: s.cue.shell,
        seed: s.cue.seed,
        x: s.cue.x,
        tx,
        ty: s.ty,
      });
    }
    this.checkEnd(ctx.sim);
    this.k = k + 1;
  }

  /** Runs `steps` fixed steps now, synchronously (no rendering). Returns the steps run. */
  advance(ctx: PlaybackContext, steps: number): number {
    const n = Math.max(0, Math.floor(steps));
    for (let i = 0; i < n; i++) {
      this.beforeStep(ctx);
      ctx.sim.step(STEP);
    }
    // The state after the last step is the state "before step k": end detection needn't wait.
    this.checkEnd(ctx.sim);
    return n;
  }

  /**
   * Puts the show at step `target` (clamped to ≥ 0, floored) exactly as a straight run from 0
   * would. Runs at most `maxSteps` steps per call, so a host can spread a long scrub over frames:
   * call it every frame with the latest target until it returns true (arrived). A target that
   * moves backward mid-way starts again from a checkpoint; one that moves forward runs on.
   */
  seek(ctx: PlaybackContext, target: number, maxSteps = Infinity): boolean {
    const k = Math.max(0, Math.floor(target));
    const key = this.keyOf(ctx);
    this.checkpoints = this.checkpoints.filter((c) => sameKey(c.key, key));
    const behind = !this.started || k < this.k || !this.runKey || !sameKey(this.runKey, key);
    const cp = this.latestCheckpoint(k);
    if (cp && (behind || cp.step > this.k)) this.restore(ctx, cp);
    else if (behind) this.reset(ctx);
    this.advance(ctx, Math.min(k - this.k, maxSteps));
    return this.k === k;
  }

  /** Runs to the end (§4.5), at most `endBoundStep + 1` steps. Returns `endStep`. */
  runToEnd(ctx: PlaybackContext): number | null {
    if (!this.started) this.reset(ctx);
    while (!this.done && this.k <= this.endBoundStep) this.advance(ctx, 1);
    return this._endStep;
  }

  /** Steps between checkpoints now (0: off). The memory cap can have doubled the configured value. */
  get checkpointInterval(): number {
    return this.cpSteps;
  }

  /**
   * A fresh driver for the same document and options, holding this one's checkpoints: the shadow
   * a host runs ahead on its own sim to warm checkpoints up (Phase 7), then hands back with
   * `adoptCheckpoints`. Its run never touches this driver or its sim.
   */
  twin(): TimelineDriver {
    return new TimelineDriver(this.doc, {
      from: this,
      checkpointSteps: this.cpSteps,
      checkpointBytes: this.cpBytesMax,
      traceDigest: this.digestOn,
    });
  }

  /**
   * Merges `from`'s checkpoints into this driver's, without touching this driver's own run: the
   * warm-up handoff (both ways). Only checkpoints taken before the first step where the two
   * schedules differ are taken (the `inherit` rule), so each one is exactly a straight run of this
   * show at its run key; checkpoints under another key are still filtered by `seek`. The spacing
   * becomes the wider of the two and the memory cap applies. Returns the number added.
   */
  adoptCheckpoints(from: TimelineDriver): number {
    if (from === this || !this.compatible(from)) return 0;
    const diverge = divergeStep(from.schedule, this.schedule);
    this.cpSteps = Math.max(this.cpSteps, from.cpSteps);
    const held = new Set(this.checkpoints.map((c) => c.step));
    const added = from.checkpoints.filter(
      (c) => c.step <= diverge && !held.has(c.step) && c.step % this.cpSteps === 0,
    );
    if (added.length === 0 && this.checkpoints.every((c) => c.step % this.cpSteps === 0)) return 0;
    this.checkpoints = [...this.checkpoints, ...added]
      .filter((c) => c.step % this.cpSteps === 0)
      .sort((a, b) => a.step - b.step);
    this.enforceCap();
    return added.length;
  }

  tick(_ctx: PlaybackContext, _dt: number): void {}

  onUserFire(_ctx: PlaybackContext): void {}

  hold(_seconds: number): void {}

  private keyOf(ctx: PlaybackContext): RunKey {
    return {
      width: ctx.worldWidth(),
      starBudget: ctx.sim.starBudget,
      capacity: ctx.sim.particles.capacity,
    };
  }

  private latestCheckpoint(step: number): Checkpoint | undefined {
    let best: Checkpoint | undefined;
    for (const c of this.checkpoints) if (c.step <= step) best = c;
    return best;
  }

  private takeCheckpoint(ctx: PlaybackContext): void {
    const key = this.keyOf(ctx);
    // A run whose width or budget changed since its reset isn't a straight run at either.
    if (!this.runKey || !sameKey(this.runKey, key)) return;
    if (this.checkpoints.some((c) => c.step === this.k)) return;
    const cp: Checkpoint = {
      step: this.k,
      next: this.next,
      endStep: this._endStep,
      ledger: [...this._ledger],
      digest: this.digest,
      key,
      sim: ctx.sim.snapshot(),
    };
    const at = this.checkpoints.findIndex((c) => c.step > cp.step);
    if (at < 0) this.checkpoints.push(cp);
    else this.checkpoints.splice(at, 0, cp);
    this.enforceCap();
  }

  /** Over the memory cap, the spacing doubles and off-grid checkpoints go. */
  private enforceCap(): void {
    while (this.checkpointBytes > this.cpBytesMax && this.checkpoints.length > 1) {
      this.cpSteps *= 2;
      this.checkpoints = this.checkpoints.filter((c) => c.step % this.cpSteps === 0);
    }
  }

  /** Whether `from`'s checkpoints can describe this show's world at all (sky, digest, grid on). */
  private compatible(from: TimelineDriver): boolean {
    return (
      this.cpSteps > 0 &&
      from.cpSteps > 0 &&
      from.digestOn === this.digestOn &&
      from.sky.gravity === this.sky.gravity &&
      from.sky.wind === this.sky.wind
    );
  }

  private restore(ctx: PlaybackContext, cp: Checkpoint): void {
    ctx.sim.restore(cp.sim);
    ctx.sim.sky = { ...this.sky };
    this.k = cp.step;
    this.next = cp.next;
    this.digest = cp.digest;
    // An inherited checkpoint's end belongs to the old show unless the schedules agree throughout.
    this._endStep = cp.next === this.schedule.length ? cp.endStep : null;
    this._ledger = [...cp.ledger];
    this.started = true;
    this.runKey = cp.key;
  }

  /**
   * Keeps `from`'s checkpoints taken before the first step where the schedules differ, and its
   * spacing. Note (yoshi-phase7-architecture-rulings.md point 2): because the spacing is copied,
   * a `ClientPlayback` checkpoint interval that arrives after the first driver was built applies
   * only to a driver built without `from` (the next show opened), never mid-session. That is
   * deliberate: a checkpoint is exact on any grid, and resetting would throw away every one.
   */
  private inherit(from: TimelineDriver): void {
    if (!this.compatible(from)) return;
    const diverge = divergeStep(from.schedule, this.schedule);
    this.cpSteps = from.cpSteps;
    this.checkpoints = from.checkpoints.filter((c) => c.step <= diverge);
  }

  private foldCounts(sim: FireworksSim): void {
    let h = this.digest;
    for (const c of sim.particles.countByKind()) h = Math.imul(h ^ c, 0x01000193) >>> 0;
    this.digest = h;
  }

  private checkEnd(sim: FireworksSim): void {
    if (
      this._endStep === null &&
      this.next === this.schedule.length &&
      sim.shellCount === 0 &&
      sim.particles.n === 0
    ) {
      this._endStep = this.k;
    }
  }
}
