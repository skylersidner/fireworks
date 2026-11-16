import { Injectable, signal } from '@angular/core';
import type { TimelineDriverOptions } from '../../engine/loop/timeline-driver';
import { STEPS_PER_SECOND } from '../../engine/model/show';
import type { ClientPlaybackConfig } from './models';

/**
 * The client's playback knobs as values only: signals plus defaults, no HTTP. The stage (in
 * `app/shared`) and the Show Builder may read this module; the 2c.8 structure rule bans them from
 * HTTP-reaching core modules, so the request lives in core/client-config-loader.ts, which runs at
 * app init and writes here. Until it answers (or when it fails), the defaults apply, so a seek that
 * starts before the config arrives runs on the defaults and picks up the served values on its next
 * frame.
 */

/** One knob's allowed range and default. The server validates the same ranges at startup. */
interface Knob {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
}

export const PLAYBACK_LIMITS: Readonly<Record<keyof ClientPlaybackConfig, Knob>> = {
  seekBudgetMs: { min: 4, max: 100, fallback: 25 },
  catchingUpDelayMs: { min: 0, max: 5000, fallback: 300 },
  checkpointIntervalSeconds: { min: 1, max: 60, fallback: 10 },
  checkpointMemoryMiB: { min: 8, max: 512, fallback: 64 },
};

/** The defaults, identical to the server's appsettings (seek budget 25 ms, Skyler). */
export const DEFAULT_PLAYBACK: Readonly<ClientPlaybackConfig> = {
  seekBudgetMs: PLAYBACK_LIMITS.seekBudgetMs.fallback,
  catchingUpDelayMs: PLAYBACK_LIMITS.catchingUpDelayMs.fallback,
  checkpointIntervalSeconds: PLAYBACK_LIMITS.checkpointIntervalSeconds.fallback,
  checkpointMemoryMiB: PLAYBACK_LIMITS.checkpointMemoryMiB.fallback,
};

/**
 * A served `playback` object made safe: each finite number is clamped to its range, and anything
 * else (missing, a string, NaN, Infinity, a non-object) takes the default.
 */
export function clampPlayback(raw: unknown): ClientPlaybackConfig {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PLAYBACK };
  for (const key of Object.keys(PLAYBACK_LIMITS) as (keyof ClientPlaybackConfig)[]) {
    const { min, max } = PLAYBACK_LIMITS[key];
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v));
  }
  return out;
}

/** The TimelineDriver options the playback config implies (checkpoint spacing and memory cap). */
export function checkpointOptions(
  p: ClientPlaybackConfig,
): Pick<TimelineDriverOptions, 'checkpointSteps' | 'checkpointBytes'> {
  return {
    checkpointSteps: p.checkpointIntervalSeconds * STEPS_PER_SECOND,
    checkpointBytes: p.checkpointMemoryMiB * 1024 * 1024,
  };
}

@Injectable({ providedIn: 'root' })
export class ClientConfigStore {
  private readonly playbackState = signal<ClientPlaybackConfig>(DEFAULT_PLAYBACK);
  /** Always in range: `set` clamps. Read untracked from frame code (it is never written per frame). */
  readonly playback = this.playbackState.asReadonly();

  /** Called by ClientConfigLoader once, with the served (untrusted) `playback` object. */
  setPlayback(raw: unknown): void {
    this.playbackState.set(clampPlayback(raw));
  }
}
