import { CAP } from './constants';
import { KIND_COUNT } from './kinds';
import { mulberry32Step } from './rng';

/** Per-spawn options. Missing values take the prototype's defaults (see `spawn`). */
export interface SpawnOptions {
  age?: number;
  drag?: number;
  grav?: number;
  size?: number;
  change?: number;
  alpha?: number;
  c1?: number;
  c2?: number;
  seed?: number;
  trail?: number;
  effect?: number;
  gen?: number;
}

type FieldArray = Float32Array | Uint32Array | Int32Array | Uint8Array;

/** A copy of the live particles (`ParticleStore.snapshot`). Opaque: restore it, don't edit it. */
export interface ParticleSnapshot {
  readonly n: number;
  /** Every field array cut to `n`, in `fields` order. */
  readonly fields: readonly FieldArray[];
  readonly bytes: number;
}

/**
 * Particles as parallel typed arrays with swap-remove (prototype `P`, `spawn`, `kill`, `prand`),
 * as an instance so two stages, or two tests, never share state.
 */
export class ParticleStore {
  readonly capacity: number;
  n = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly drag: Float32Array;
  readonly grav: Float32Array;
  readonly size: Float32Array;
  readonly emit: Float32Array;
  readonly change: Float32Array;
  readonly alpha: Float32Array;
  readonly c1: Uint32Array;
  readonly c2: Uint32Array;
  readonly seed: Int32Array;
  readonly kind: Uint8Array;
  readonly trail: Uint8Array;
  readonly effect: Uint8Array;
  readonly gen: Uint8Array;

  /** Every field array, in the prototype's FIELDS order; `kill` copies all of them. */
  private readonly fields: readonly FieldArray[];

  constructor(capacity: number = CAP) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.emit = new Float32Array(capacity);
    this.change = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.c1 = new Uint32Array(capacity);
    this.c2 = new Uint32Array(capacity);
    this.seed = new Int32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.trail = new Uint8Array(capacity);
    this.effect = new Uint8Array(capacity);
    this.gen = new Uint8Array(capacity);
    this.fields = [
      this.x,
      this.y,
      this.vx,
      this.vy,
      this.age,
      this.life,
      this.drag,
      this.grav,
      this.size,
      this.emit,
      this.change,
      this.alpha,
      this.c1,
      this.c2,
      this.seed,
      this.kind,
      this.trail,
      this.effect,
      this.gen,
    ];
  }

  /** Adds a particle and returns its index, or -1 when the store is full. */
  spawn(
    kind: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    o: SpawnOptions,
  ): number {
    if (this.n >= this.capacity) return -1;
    const i = this.n++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = o.age ?? 0;
    this.life[i] = life;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.grav ?? 1;
    this.size[i] = o.size ?? 1;
    this.emit[i] = 0;
    this.change[i] = o.change ?? 2;
    this.alpha[i] = o.alpha ?? 1;
    this.c1[i] = o.c1 ?? 0xffffff;
    this.c2[i] = o.c2 ?? this.c1[i];
    this.seed[i] = o.seed ?? 1;
    this.trail[i] = o.trail ?? 0;
    this.effect[i] = o.effect ?? 0;
    this.gen[i] = o.gen ?? 0;
    return i;
  }

  /** Swap-removes particle i (the last particle moves into slot i). */
  kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      for (const f of this.fields) f[i] = f[last];
    }
  }

  /** Next draw from particle i's own deterministic stream (prototype `prand`). */
  prand(i: number): number {
    return mulberry32Step(this.seed, i);
  }

  /** Color at the particle's current age: c1 before its change point, c2 after. */
  colorAt(i: number): number {
    return this.age[i] / this.life[i] < this.change[i] ? this.c1[i] : this.c2[i];
  }

  clear(): void {
    this.n = 0;
  }

  /** Copies every field of the live particles. `restore` brings back exactly this store. */
  snapshot(): ParticleSnapshot {
    const fields = this.fields.map((f) => f.slice(0, this.n));
    return { n: this.n, fields, bytes: fields.reduce((sum, f) => sum + f.byteLength, 0) };
  }

  /** Makes the live particles exactly those of `snap`. Slots past `n` are dead and never read. */
  restore(snap: ParticleSnapshot): void {
    if (snap.n > this.capacity || snap.fields.length !== this.fields.length) {
      throw new Error('ParticleStore.restore: snapshot from a different store');
    }
    this.fields.forEach((f, i) => f.set(snap.fields[i]));
    this.n = snap.n;
  }

  /** Live particle count per kind code (index = `K_*`). */
  countByKind(): number[] {
    const counts = new Array<number>(KIND_COUNT).fill(0);
    for (let i = 0; i < this.n; i++) counts[this.kind[i]]++;
    return counts;
  }
}
