import { Injectable, computed, signal } from '@angular/core';
import type { TimelineDriverOptions } from '../../engine/loop/timeline-driver';
import { STEPS_PER_SECOND } from '../../engine/model/show';
import type { ClientPlaybackConfig, LoginProviderConfig } from './models';

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
  warmUpDelayMs: { min: 0, max: 5000, fallback: 1000 },
};

/** The defaults, identical to the server's appsettings (seek budget 25 ms, Skyler). */
export const DEFAULT_PLAYBACK: Readonly<ClientPlaybackConfig> = {
  seekBudgetMs: PLAYBACK_LIMITS.seekBudgetMs.fallback,
  catchingUpDelayMs: PLAYBACK_LIMITS.catchingUpDelayMs.fallback,
  checkpointIntervalSeconds: PLAYBACK_LIMITS.checkpointIntervalSeconds.fallback,
  checkpointMemoryMiB: PLAYBACK_LIMITS.checkpointMemoryMiB.fallback,
  warmUpDelayMs: PLAYBACK_LIMITS.warmUpDelayMs.fallback,
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

  /**
   * The sign-in providers (Phase 8: Google only). `loading` until `api/client-config` answers;
   * `failed` when it didn't. Sign-in reads as unavailable only when the config answered with no
   * providers or failed (phase-8.md §5.3); while it is loading, the button is offered and the server
   * decides.
   */
  private readonly providersState = signal<{
    readonly status: 'loading' | 'ready' | 'failed';
    readonly providers: readonly LoginProviderConfig[];
  }>({ status: 'loading', providers: [] });
  readonly loginProviders = computed(() => this.providersState().providers);
  readonly signInAvailable = computed(() => {
    const state = this.providersState();
    return state.status === 'loading' || state.providers.some((p) => p.id === 'google');
  });

  /** The served (untrusted) `loginProviders`: absent means `[]`; malformed entries are dropped. */
  setLoginProviders(raw: unknown): void {
    const list = Array.isArray(raw) ? raw : [];
    const providers = list.filter(
      (p): p is LoginProviderConfig =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>)['id'] === 'string' &&
        typeof (p as Record<string, unknown>)['name'] === 'string',
    );
    this.providersState.set({ status: 'ready', providers });
  }

  /** `api/client-config` failed: sign-in reads as unavailable. */
  setConfigFailed(): void {
    this.providersState.set({ status: 'failed', providers: [] });
  }
}
