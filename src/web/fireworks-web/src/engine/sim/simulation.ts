import { COLORS, PALETTE, isPaletteColor, lighten } from '../model/colors';
import { EFFECTS, TRAILS } from '../model/enums';
import {
  DEFAULT_QUALITY,
  DEFAULT_SKY,
  type BreakDef,
  type ShellDocument,
  type SkySettings,
} from '../model/shell';
import { CAP, GROUND } from './constants';
import {
  E_CRACKLE,
  E_CROSSETTE,
  E_NONE,
  K_EMBER,
  K_FLASH,
  K_GLITTER,
  K_HEAD,
  K_POP,
  K_STAR,
  T_GLITTER,
  T_NONE,
} from './kinds';
import { ParticleStore } from './particle-store';
import { directions } from './patterns';
import { mulberry32, type Rng } from './rng';

/** A shell in flight: rising, or between breaks. Plain object, as in the prototype. */
interface ActiveShell {
  readonly def: ShellDocument;
  readonly rng: Rng;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  fuse: number;
  idx: number;
  rising: boolean;
  emit: number;
}

export interface FireworksSimOptions {
  capacity?: number;
  sky?: SkySettings;
  starBudget?: number;
}

const TWO_POW_31 = 2 ** 31;

function paletteColor(name: string): number | undefined {
  return isPaletteColor(name) ? COLORS[name] : undefined;
}

/**
 * The fireworks simulation (prototype lines 179-384), as an instance. No Pixi, no DOM, no
 * Angular. Fully deterministic for a given sequence of `launch` seeds, `sky`, `starBudget` and
 * `step` calls.
 */
export class FireworksSim {
  readonly particles: ParticleStore;
  /** Gravity and wind, read every step (and by `launch` for the ballistic arc). */
  sky: SkySettings;
  /** Fraction of stars spawned per break. A viewer setting, never saved; changes RNG draws. */
  starBudget: number;

  private _simTime = 0;
  private shells: ActiveShell[] = [];

  constructor(options: FireworksSimOptions = {}) {
    this.particles = new ParticleStore(options.capacity ?? CAP);
    this.sky = { ...(options.sky ?? DEFAULT_SKY) };
    this.starBudget = options.starBudget ?? DEFAULT_QUALITY.starBudget;
  }

  /** Simulated seconds since construction (not reset by `clear`, as in the prototype). */
  get simTime(): number {
    return this._simTime;
  }

  /** Shells still rising or waiting for a later break. */
  get shellCount(): number {
    return this.shells.length;
  }

  /** Launches `def` so it bursts at world point (tx, ty). Deterministic from `seed`. */
  launch(def: ShellDocument, tx: number, ty: number, seed: number): void {
    const rng = mulberry32(seed);
    const g = this.sky.gravity;
    const h = Math.max(60, GROUND - ty);
    const vy = -Math.sqrt(2 * g * h);
    const fuse = -vy / g;
    const jitter = Math.tan((def.angleJitter * Math.PI) / 180) * h;
    const x0 = tx + (rng() - 0.5) * 2 * jitter;
    this.shells.push({
      def: structuredClone(def),
      rng,
      x: x0,
      y: GROUND,
      vx: (tx - x0) / fuse,
      vy,
      t: 0,
      fuse,
      idx: 0,
      rising: true,
      emit: 0,
    });
  }

  /** Removes every shell and particle (prototype Clear sky). */
  clear(): void {
    this.shells = [];
    this.particles.clear();
  }

  /** Seconds a preview-loop cycle waits before re-firing `def` (prototype `shellDuration`). */
  shellDuration(def: ShellDocument): number {
    const h = def.burstHeight * GROUND;
    let t = Math.sqrt((2 * h) / this.sky.gravity);
    def.breaks.forEach((b, k) => {
      if (k) t += b.delay;
    });
    return t + Math.max(...def.breaks.map((b) => b.burn)) * 1.1 + 0.4;
  }

  /** Where `def` bursts by default: centered, at its burst height (prototype `defaultTarget`). */
  defaultTarget(def: ShellDocument, worldWidth: number): [x: number, y: number] {
    return [worldWidth / 2, GROUND - def.burstHeight * GROUND];
  }

  /** Advances the world by `dt` seconds (the loop always passes `STEP`). */
  step(dt: number): void {
    this._simTime += dt;
    const P = this.particles;
    const g = this.sky.gravity;
    const wind = this.sky.wind;

    // Shells (few, plain objects)
    for (let s = this.shells.length - 1; s >= 0; s--) {
      const sh = this.shells[s];
      sh.t += dt;
      sh.vy += g * dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      if (sh.rising) {
        sh.emit += 150 * dt;
        while (sh.emit >= 1) {
          sh.emit -= 1;
          const r = sh.rng;
          P.spawn(
            K_EMBER,
            sh.x,
            sh.y,
            -sh.vx * 0.05 + (r() - 0.5) * 20,
            -sh.vy * 0.08 + (r() - 0.5) * 20,
            0.25 + r() * 0.35,
            {
              drag: 3,
              grav: 0.4,
              c1: 0xffb347,
              size: 0.8,
              alpha: 0.7,
              seed: (r() * TWO_POW_31) | 0,
            },
          );
        }
        P.spawn(K_HEAD, sh.x, sh.y, 0, 0, dt * 1.01, { c1: 0xffe2b0 });
      }
      if (sh.t >= sh.fuse) {
        const br = sh.def.breaks[sh.idx];
        this.burst(sh, br);
        sh.idx++;
        sh.rising = false;
        if (sh.idx < sh.def.breaks.length) {
          sh.fuse = sh.t + Math.max(0.1, sh.def.breaks[sh.idx].delay);
          sh.vx *= 0.3;
          sh.vy = -60;
        } else {
          this.shells.splice(s, 1);
        }
      }
    }

    // Particles (typed arrays). Iterate downward so swap-remove is safe.
    for (let i = P.n - 1; i >= 0; i--) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        this.onDeath(i);
        P.kill(i);
        continue;
      }
      const f = Math.exp(-P.drag[i] * dt);
      P.vx[i] = P.vx[i] * f + wind * dt * (P.kind[i] === K_STAR ? 0.6 : 1);
      P.vy[i] = P.vy[i] * f + g * P.grav[i] * dt;
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;

      if (P.kind[i] === K_STAR && P.trail[i] !== T_NONE && P.age[i] > 0) {
        const glitter = P.trail[i] === T_GLITTER;
        P.emit[i] += (glitter ? 55 : 70) * dt;
        while (P.emit[i] >= 1) {
          P.emit[i] -= 1;
          if (glitter) {
            P.spawn(
              K_GLITTER,
              P.x[i],
              P.y[i],
              (P.prand(i) - 0.5) * 30,
              (P.prand(i) - 0.5) * 30,
              0.5 + P.prand(i) * 0.6,
              {
                drag: 2.5,
                grav: 0.5,
                c1: P.prand(i) < 0.7 ? 0xffd27a : 0xffffff,
                size: 0.7,
                seed: (P.prand(i) * TWO_POW_31) | 0,
              },
            );
          } else {
            P.spawn(
              K_EMBER,
              P.x[i],
              P.y[i],
              P.vx[i] * 0.15 + (P.prand(i) - 0.5) * 10,
              P.vy[i] * 0.15 + (P.prand(i) - 0.5) * 10,
              0.35 + P.prand(i) * 0.2,
              { drag: 3, grav: 0.3, c1: P.colorAt(i), size: 0.9 * P.size[i], alpha: 0.55 },
            );
          }
        }
      }
    }
  }

  private burst(s: ActiveShell, br: BreakDef): void {
    const P = this.particles;
    const rng = s.rng;
    const n = Math.max(1, Math.round(br.stars * this.starBudget));
    const rainbow = br.color1 === 'rainbow';
    const c1 = paletteColor(br.color1) ?? 0xffffff;
    const c2 = br.color2 !== 'none' ? (paletteColor(br.color2) ?? c1) : c1;
    const flashColor = rainbow ? 0xffffff : c1;
    P.spawn(K_FLASH, s.x, s.y, 0, 0, 0.16, { c1: lighten(flashColor), size: 1 + br.stars / 120 });
    const eff = EFFECTS.indexOf(br.effect);
    const tr = TRAILS.indexOf(br.trail);
    for (const [dx, dy] of directions(br.pattern, n, rng)) {
      const sp = br.speed * (0.94 + rng() * 0.12);
      const col = rainbow ? COLORS[PALETTE[(rng() * PALETTE.length) | 0]] : c1;
      P.spawn(
        K_STAR,
        s.x,
        s.y,
        dx * sp + s.vx * 0.3,
        dy * sp + s.vy * 0.3,
        br.burn * (0.88 + rng() * 0.24),
        {
          drag: br.drag,
          size: br.size,
          c1: col,
          c2: rainbow ? col : c2,
          change: br.color2 !== 'none' ? br.changeAt : 2,
          trail: tr,
          effect: eff,
          seed: (rng() * TWO_POW_31) | 0,
        },
      );
    }
  }

  private onDeath(i: number): void {
    const P = this.particles;
    if (P.kind[i] !== K_STAR) return;
    const x = P.x[i];
    const y = P.y[i];
    const vx = P.vx[i];
    const vy = P.vy[i];
    if (P.effect[i] === E_CRACKLE) {
      const k = 3 + ((P.prand(i) * 5) | 0);
      for (let j = 0; j < k; j++) {
        const a = P.prand(i) * 6.283;
        const sp = 30 + P.prand(i) * 70;
        P.spawn(
          K_POP,
          x,
          y,
          vx * 0.2 + Math.cos(a) * sp,
          vy * 0.2 + Math.sin(a) * sp,
          0.06 + P.prand(i) * 0.07,
          {
            age: -P.prand(i) * 0.3,
            drag: 5,
            grav: 0.2,
            c1: P.prand(i) < 0.5 ? 0xffffff : 0xffe3a0,
            size: 1,
          },
        );
      }
    } else if (P.effect[i] === E_CROSSETTE && P.gen[i] === 0) {
      const a0 = (P.prand(i) * Math.PI) / 2;
      const col = P.c2[i];
      for (let j = 0; j < 4; j++) {
        const a = a0 + (j * Math.PI) / 2;
        P.spawn(
          K_STAR,
          x,
          y,
          vx * 0.4 + Math.cos(a) * 110,
          vy * 0.4 + Math.sin(a) * 110,
          0.8 + P.prand(i) * 0.3,
          {
            drag: P.drag[i],
            size: P.size[i] * 0.8,
            c1: col,
            c2: col,
            trail: P.trail[i],
            effect: E_NONE,
            gen: 1,
            seed: (P.prand(i) * TWO_POW_31) | 0,
          },
        );
      }
      P.spawn(K_POP, x, y, 0, 0, 0.07, { c1: 0xffffff, size: 1.4 });
    }
  }
}
