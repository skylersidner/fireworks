import { Injectable, computed, inject, signal } from '@angular/core';
import { QUALITY_LIMITS } from '../../engine/model/limits';
import { DEFAULT_QUALITY } from '../../engine/model/shell';
import { BROWSER_STORAGE, readStorage, writeStorage } from './browser';

/** Set once the visitor dismisses a flashing notice, on the designer or the player (designer-2c.md §7.2). */
export const FLASH_NOTICE_KEY = 'fireworks.flashNotice.v1';
/** The visitor's explicit Reduce flashing choice: `"on"` or `"off"`. Absent follows the OS. */
export const REDUCE_FLASHING_KEY = 'fireworks.reduceFlashing.v1';
/** The visitor's Motion blur (trail persistence) as a decimal string. Absent is the default. */
export const MOTION_BLUR_KEY = 'fireworks.motionBlur.v1';

/**
 * This device's flashing preferences, shared by the designer and the player (Skyler, 2026-11-14;
 * phase-5.md §8.3): one flashing-notice dismissal and one Reduce flashing choice per device. A
 * visitor who turned Reduce flashing on in the designer gets it on a share link too.
 *
 * They live under their own keys, not in the designer draft, so the player can read and write them
 * without touching the draft (acceptance 5f.7: the player never edits the draft). A draft written
 * before Phase 5 carries the choice in `display.reduceFlashing`; the designer store copies it here
 * once (`adoptLegacyReduceFlashing`).
 *
 * Motion blur joined them on 2026-11-14 (Skyler): one device-wide value shared by the designer, the
 * Show Builder and the player, under its own key for the same reason. A pre-Phase 6 designer draft
 * carries it in `display.persistence`; the designer store copies it here once
 * (`adoptLegacyMotionBlur`). The builder never reads or writes the designer draft for it.
 *
 * Every read and write goes through the never-throwing storage helpers: with storage refused, the
 * notice shows on every load and the choice lasts for the page.
 */
@Injectable({
  providedIn: 'root',
})
export class DevicePreferencesService {
  private readonly storage = inject(BROWSER_STORAGE);

  private readonly choice = signal<boolean | null>(readChoice(this.storage));

  /** The explicit Reduce flashing choice, or null while it follows the OS reduced-motion setting. */
  readonly reduceFlashingChoice = this.choice.asReadonly();

  private readonly blur = signal<number | null>(readMotionBlur(this.storage));

  /** The stored Motion blur, or null when this device never chose one. */
  readonly motionBlurChoice = this.blur.asReadonly();
  /** The Motion blur to render with: the stored value, else the default (0.78). */
  readonly motionBlur = computed(() => this.blur() ?? DEFAULT_QUALITY.persistence);

  /**
   * True once a flashing notice has been dismissed on this device. Read from storage when a page
   * opens, and each page keeps its own answer: with storage refused, the notice shows (and holds
   * playback) on every page load, as in 2c.
   */
  flashNoticeDismissed(): boolean {
    return readStorage(this.storage, FLASH_NOTICE_KEY) !== null;
  }

  setReduceFlashing(on: boolean): void {
    this.choice.set(on);
    writeStorage(this.storage, REDUCE_FLASHING_KEY, on ? 'on' : 'off');
  }

  /** Clamped to 0..0.92; a non-number is ignored. Same value again writes nothing. */
  setMotionBlur(value: number): void {
    const v = clampBlur(value);
    if (v === null || v === this.blur()) return;
    this.blur.set(v);
    writeStorage(this.storage, MOTION_BLUR_KEY, String(v));
  }

  /** Remembers the dismissal for every page on this device (unless storage refuses it). */
  dismissFlashNotice(): void {
    writeStorage(this.storage, FLASH_NOTICE_KEY, '1');
  }

  /** A pre-Phase 5 draft's choice, adopted only while this device has none of its own. */
  adoptLegacyReduceFlashing(legacy: boolean | null | undefined): void {
    if (this.choice() !== null || typeof legacy !== 'boolean') return;
    this.setReduceFlashing(legacy);
  }

  /** A pre-Phase 6 designer draft's Motion blur, adopted only while this device has none. */
  adoptLegacyMotionBlur(legacy: number | null | undefined): void {
    if (this.blur() !== null || typeof legacy !== 'number') return;
    this.setMotionBlur(legacy);
  }
}

function clampBlur(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const { min, max } = QUALITY_LIMITS.persistence;
  return Math.min(max, Math.max(min, value));
}

function readMotionBlur(storage: Storage | null): number | null {
  const text = readStorage(storage, MOTION_BLUR_KEY);
  return text === null || text.trim() === '' ? null : clampBlur(Number(text));
}

function readChoice(storage: Storage | null): boolean | null {
  const value = readStorage(storage, REDUCE_FLASHING_KEY);
  return value === 'on' ? true : value === 'off' ? false : null;
}
