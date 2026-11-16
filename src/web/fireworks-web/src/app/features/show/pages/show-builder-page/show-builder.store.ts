import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  type Signal,
  signal,
  untracked,
} from '@angular/core';
import { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import {
  CUE_LIMITS,
  NAME_MAX_LENGTH,
  SHOW_LIMITS,
  SKY_LIMITS,
} from '../../../../../engine/model/limits';
import { normalizeQuality } from '../../../../../engine/model/normalize';
import type { QualitySettings } from '../../../../../engine/model/shell';
import {
  embeddedShell,
  type EmbeddedShell,
  type ShowCue,
  type ShowDocument,
} from '../../../../../engine/model/show';
import { cueTimes, estimateShowEnd } from '../../../../../engine/sim/lifetime';
import { BROWSER_STORAGE, REDUCED_MOTION_QUERY, mediaQuery } from '../../../../core/browser';
import { ClientConfigStore, checkpointOptions } from '../../../../core/client-config';
import type { CreationSource } from '../../../../core/creation-save';
import { DevicePreferencesService } from '../../../../core/device-preferences';
import { readDraft } from '../../../designer/shared/designer-draft';
import {
  CUE_CAP,
  SHELL_CAP,
  addedAnnouncement,
  deletedAnnouncement,
  duplicatedAnnouncement,
  pastWindow,
} from '../../shared/show-copy';
import {
  DEFAULT_ACTIVE,
  FIT_VIEW,
  readShowDraft,
  serializeShowDraft,
  writeShowDraft,
  type ActiveShell,
  type ShowDraft,
  type TimelineView,
} from '../../shared/show-draft';
import {
  atCueCap,
  clamp,
  cueIdFor,
  cuesUsing,
  deleteCue,
  embedShell,
  emptyShow,
  firingOrder,
  minDuration,
  nextCueIdAfter,
  randomSeed,
  removeShell,
  updateCue,
  withCue,
} from '../../shared/show-edit';
import type { ShowWorkingCopy } from '../../shared/show-working-copy-handoff';
import { announcement } from '../../../../shared/announcer';

/** Draft writes wait this long (phase-6.md §10.1: "at most every 500 ms"). */
export const SHOW_DRAFT_DEBOUNCE_MS = 500;
/** Session-only Undo depth (Skyler, 2026-11-14). */
export const UNDO_LIMIT = 50;

/** A question waiting for the visitor's answer. */
export type ShowPending =
  | { readonly kind: 'link'; readonly copy: ShowWorkingCopy }
  | { readonly kind: 'new' }
  | { readonly kind: 'remove-shell'; readonly key: string }
  /** Show JSON Apply over a dirty show (phase-7.md §9.3): the opened show and its note. */
  | { readonly kind: 'json'; readonly show: ShowDocument; readonly note: string };

/** Why an add did nothing (phase-6.md §9.2). */
export type AddBlock = 'cue-cap' | 'shell-cap' | 'past-window';

export type AddOutcome =
  { readonly ok: true; readonly cue: ShowCue } | { readonly ok: false; readonly reason: AddBlock };

export interface ShowSaveSnapshot {
  readonly show: ShowDocument;
}

/**
 * State of one Show Builder page (phase-6.md). `@Injectable()`, provided by the page. Like the
 * designer's store it never reaches HTTP or identity (designer-structure.spec.ts, the 2c.8 rule
 * extended to the builder); "My shells" and Save live in the page's flows.
 *
 *  - `show` is the document, replaced (never mutated) by every edit, so Undo keeps references.
 *  - `dirty` (one flag, §10.2): any edit sets it; New show, a link load's own write (it sets it
 *    back on, L1) and a save clear or set it. Selection, zoom, scroll, playhead and play state never.
 *  - `saved` and `source` follow Phase 5 F4: any document change clears `saved`; a save sets it only
 *    when the document sent is still the current object.
 *  - `driver` is rebuilt on every document change with `{ from: previous }`, so checkpoints before
 *    the edit are kept (yoshi-phase6-timeline-driver.md point 6).
 */
@Injectable()
export class ShowBuilderStore {
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly prefs = inject(DevicePreferencesService);
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly reducedMotion = mediaQuery(REDUCED_MOTION_QUERY);
  private readonly restored: ShowDraft | null = readShowDraft(this.storage);
  private readonly restoredSaved = this.restored?.saved ?? false;

  readonly show = signal<ShowDocument>(this.restored?.show ?? emptyShow());
  readonly nextCueId = signal(this.restored?.nextCueId ?? 1);
  private readonly selectedId = signal<string | null>(this.restored?.selectedCueId ?? null);
  /** The selected cue's id, or null; follows the document (a deleted or undone cue deselects). */
  readonly selectedCueId = computed(() => {
    const id = this.selectedId();
    return id !== null && this.show().cues.some((c) => c.id === id) ? id : null;
  });
  readonly activeShell = signal<ActiveShell>(this.restored?.activeShell ?? DEFAULT_ACTIVE);
  readonly view = signal<TimelineView>(this.restored?.view ?? FIT_VIEW);
  readonly dirty = signal(this.restored?.dirty ?? false);
  readonly saved = linkedSignal<ShowDocument, boolean>({
    source: this.show,
    computation: (_show, previous) => (previous === undefined ? this.restoredSaved : false),
  });
  private readonly sourceState = signal<CreationSource | null>(this.restored?.source ?? null);
  readonly source = this.sourceState.asReadonly();

  readonly driver = linkedSignal<ShowDocument, TimelineDriver>({
    source: this.show,
    // The configured checkpoint spacing and memory cap, read untracked: a config that arrives
    // later applies from the next edit rather than replacing the driver mid-play.
    computation: (show, previous) =>
      new TimelineDriver(show, {
        from: previous?.value,
        ...checkpointOptions(untracked(this.clientConfig.playback)),
      }),
  });
  /** Cues in firing order `(fireStep, id)` (orderCues). */
  readonly ordered = computed(() => firingOrder(this.show()));
  readonly selectedCue = computed(() => {
    const id = this.selectedCueId();
    return id === null ? null : (this.show().cues.find((c) => c.id === id) ?? null);
  });
  /** §7.3 "Ends about", capped at the hard bound. */
  readonly estimatedEnd = computed(() => estimateShowEnd(this.show()));
  /** The true end once a run reached it in this session (§7.3); dropped on any document change. */
  readonly knownEnd = linkedSignal<ShowDocument, number | null>({
    source: this.show,
    computation: () => null,
  });
  readonly end = computed(() => this.knownEnd() ?? this.estimatedEnd());

  readonly reduceFlashingChoice = this.prefs.reduceFlashingChoice;
  readonly reduceFlashing = computed(() => this.reduceFlashingChoice() ?? this.reducedMotion());
  readonly reduceFlashingFromDevice = computed(
    () => this.reduceFlashingChoice() === null && this.reducedMotion(),
  );
  /**
   * Motion blur is the device preference shared with the designer and the player (Skyler,
   * 2026-11-14; replaces §10.1's read of the designer draft). A designer draft from before then
   * still holds the visitor's value, so it is adopted once if the device has none; the builder only
   * reads that draft, never writes it.
   */
  readonly persistence = this.adoptMotionBlur();
  /** The builder previews at `starBudget` 1, like the player (§3.1; Peach Q3). */
  readonly quality = computed<QualitySettings>(() =>
    normalizeQuality({
      persistence: this.persistence(),
      starBudget: 1,
      reduceFlashing: this.reduceFlashing(),
    }),
  );

  readonly flashNoticeVisible = signal(!this.prefs.flashNoticeDismissed());
  readonly pending = signal<ShowPending | null>(null);
  /** The dock's polite region; repeats re-announce (phase-7.md §10 B4). */
  readonly announcement = announcement();

  private past: ShowDocument[] = [];
  private future: ShowDocument[] = [];
  private lastCoalesce: string | null = null;
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  private lastWritten: string;
  private pendingDraft: string | null = null;

  constructor() {
    this.lastWritten = serializeShowDraft(this.draft());
    effect((onCleanup) => {
      const json = serializeShowDraft(this.draft());
      if (json === this.lastWritten) {
        this.pendingDraft = null;
        return;
      }
      this.pendingDraft = json;
      const handle = setTimeout(() => this.flushDraft(), SHOW_DRAFT_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(handle));
    });
    const onPageHide = () => this.flushDraft();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
    inject(DestroyRef).onDestroy(() => {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
      this.flushDraft();
    });
  }

  /** The draft as it is stored. */
  draft(): ShowDraft {
    return {
      show: this.show(),
      nextCueId: this.nextCueId(),
      selectedCueId: this.selectedCueId(),
      activeShell: this.activeShell(),
      view: this.view(),
      dirty: this.dirty(),
      saved: this.saved(),
      source: this.source(),
    };
  }

  flushDraft(): void {
    const json = this.pendingDraft;
    if (json === null) return;
    this.pendingDraft = null;
    this.lastWritten = json;
    writeShowDraft(this.storage, json);
  }

  // ---- Undo (session only; Skyler 2026-11-14) ------------------------------------------------

  /**
   * One visitor edit: replaces the document, records Undo, sets `dirty`. Edits with the same
   * `coalesce` key in a row (typing a name, dragging a slider) are one Undo step.
   */
  edit(next: ShowDocument, coalesce: string | null = null): void {
    const current = untracked(this.show);
    if (next === current) return;
    if (coalesce === null || coalesce !== this.lastCoalesce) {
      this.past.push(current);
      if (this.past.length > UNDO_LIMIT) this.past.shift();
    }
    this.lastCoalesce = coalesce;
    this.future = [];
    this.show.set(next);
    this.dirty.set(true);
    this.syncUndo();
  }

  /** Ends a coalescing run (a field blurred), so the next edit is its own step. */
  endCoalesce(): void {
    this.lastCoalesce = null;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(untracked(this.show));
    this.lastCoalesce = null;
    this.show.set(prev);
    this.dirty.set(true);
    this.syncUndo();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(untracked(this.show));
    this.lastCoalesce = null;
    this.show.set(next);
    this.dirty.set(true);
    this.syncUndo();
    return true;
  }

  private clearUndo(): void {
    this.past = [];
    this.future = [];
    this.lastCoalesce = null;
    this.syncUndo();
  }

  private syncUndo(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }

  // ---- Selection, library, view (never dirty) ------------------------------------------------

  select(id: string | null): void {
    this.selectedId.set(id);
  }

  setActive(ref: ActiveShell): void {
    this.activeShell.set(ref);
  }

  setView(view: TimelineView): void {
    this.view.set(view);
  }

  private adoptMotionBlur(): Signal<number> {
    this.prefs.adoptLegacyMotionBlur(readDraft(this.storage)?.display.persistence);
    return this.prefs.motionBlur;
  }

  setPersistence(v: number): void {
    this.prefs.setMotionBlur(v);
  }

  setReduceFlashing(on: boolean): void {
    this.prefs.setReduceFlashing(on);
  }

  dismissFlashNotice(turnOnReduceFlashing: boolean): void {
    if (turnOnReduceFlashing) this.prefs.setReduceFlashing(true);
    this.flashNoticeVisible.set(false);
    this.prefs.dismissFlashNotice();
  }

  /** A run reached the end: the exact value replaces the estimate until the next change. */
  recordEnd(seconds: number): void {
    if (untracked(this.knownEnd) !== seconds) this.knownEnd.set(seconds);
  }

  // ---- Cue edits ----------------------------------------------------------------------------

  /** Why an add at playhead time `t` (seconds) would be blocked, or null. */
  addBlock(t: number, shell: EmbeddedShell | null): AddBlock | null {
    const show = untracked(this.show);
    if (atCueCap(show)) return 'cue-cap';
    if (t > show.duration + 1e-9) return 'past-window';
    if (shell && !embedShell(show, shell).ok) return 'shell-cap';
    return null;
  }

  /**
   * Adds a cue with `shell` (copied in, or reusing an identical embedded one) at `t` and `x`
   * (phase-6.md §4.1). New id from the counter, new random seed, no `burstHeight`. Selects it.
   */
  addCue(shell: EmbeddedShell, t: number, x: number, seed: number = randomSeed()): AddOutcome {
    const show = untracked(this.show);
    const block = this.addBlock(t, shell);
    if (block) {
      this.announcement.set(this.blockText(block));
      return { ok: false, reason: block };
    }
    const embedded = embedShell(show, shell);
    if (!embedded.ok) return { ok: false, reason: 'shell-cap' };
    const { id, next } = cueIdFor(show, untracked(this.nextCueId));
    const cue: ShowCue = {
      id,
      t: clamp(t, 0, show.duration),
      shell: embedded.key,
      x: clamp(x, 0, 1),
      seed,
    };
    this.edit(withCue(embedded.show, cue));
    this.nextCueId.set(next);
    this.selectedId.set(id);
    this.announcement.set(
      addedAnnouncement(embeddedShell(embedded.show, embedded.key)?.name ?? '', cue.t),
    );
    return { ok: true, cue };
  }

  blockText(block: AddBlock): string {
    if (block === 'cue-cap') return CUE_CAP;
    if (block === 'shell-cap') return SHELL_CAP;
    return pastWindow(untracked(this.show).duration);
  }

  updateCue(id: string, patch: Partial<Omit<ShowCue, 'id'>>, coalesce: string | null = null): void {
    this.edit(updateCue(untracked(this.show), id, patch), coalesce);
  }

  moveCue(id: string, t: number): void {
    this.updateCue(id, { t });
  }

  /** Nudges by `dt` seconds, clamped to the window (§4.4 `,` `.`). */
  nudgeCue(id: string, dt: number): void {
    const cue = untracked(this.show).cues.find((c) => c.id === id);
    if (!cue) return;
    const t = Math.round((cue.t + dt) * 1e6) / 1e6;
    this.updateCue(id, { t: clamp(t, 0, untracked(this.show).duration) });
  }

  newSeed(id: string): void {
    this.updateCue(id, { seed: randomSeed() });
  }

  /** §4.3: t + 0.5 s (clamped), same shell, x, burstHeight; new id and seed. Selects the copy. */
  duplicateCue(id: string): AddOutcome {
    const show = untracked(this.show);
    const cue = show.cues.find((c) => c.id === id);
    if (!cue) return { ok: false, reason: 'cue-cap' };
    if (atCueCap(show)) {
      this.announcement.set(CUE_CAP);
      return { ok: false, reason: 'cue-cap' };
    }
    const { id: newId, next } = cueIdFor(show, untracked(this.nextCueId));
    const copy: ShowCue = {
      ...cue,
      id: newId,
      t: clamp(cue.t + 0.5, 0, show.duration),
      seed: randomSeed(),
    };
    this.edit(withCue(show, copy));
    this.nextCueId.set(next);
    this.selectedId.set(newId);
    this.announcement.set(duplicatedAnnouncement(copy.t));
    return { ok: true, cue: copy };
  }

  /** §4.3: no confirm; selection moves to the next cue in firing order, else the previous. */
  deleteCue(id: string): void {
    const order = untracked(this.ordered);
    const at = order.findIndex((c) => c.id === id);
    if (at < 0) return;
    const neighbour = order[at + 1] ?? order[at - 1] ?? null;
    const t = order[at].t;
    this.edit(deleteCue(untracked(this.show), id));
    this.selectedId.set(neighbour?.id ?? null);
    this.announcement.set(deletedAnnouncement(t, order.length - 1));
  }

  // ---- Show fields -------------------------------------------------------------------------

  setName(name: string): void {
    this.edit({ ...untracked(this.show), name: name.slice(0, NAME_MAX_LENGTH * 2) }, 'name');
  }

  /**
   * §9.3: Duration can't go below the last launch (blocked, never clamping cues). Returns false
   * when blocked or out of range, and changes nothing.
   */
  setDuration(d: number): boolean {
    const show = untracked(this.show);
    if (!Number.isFinite(d)) return false;
    if (d < minDuration(show) || d < SHOW_LIMITS.duration.min || d > SHOW_LIMITS.duration.max) {
      return false;
    }
    if (d !== show.duration) this.edit({ ...show, duration: d }, 'duration');
    return true;
  }

  setSky(part: 'gravity' | 'wind', v: number): void {
    const show = untracked(this.show);
    const value = clamp(v, SKY_LIMITS[part].min, SKY_LIMITS[part].max);
    this.edit({ ...show, sky: { ...show.sky, [part]: value } }, `sky.${part}`);
  }

  // ---- Shells ------------------------------------------------------------------------------

  /** §4.3: an unused shell goes at once; a used one asks first. */
  removeShell(key: string): void {
    const show = untracked(this.show);
    if (!Object.hasOwn(show.shells, key)) return;
    if (cuesUsing(show, key) > 0) {
      this.pending.set({ kind: 'remove-shell', key });
      return;
    }
    this.doRemoveShell(key);
  }

  private doRemoveShell(key: string): void {
    this.edit(removeShell(untracked(this.show), key));
    const active = untracked(this.activeShell);
    if (active.kind === 'embedded' && active.key === key) this.activeShell.set(DEFAULT_ACTIVE);
  }

  // ---- Replacing the show ------------------------------------------------------------------

  /** §10.3: New show asks only when dirty. True when it replaced at once. */
  newShow(): boolean {
    if (untracked(this.dirty)) {
      this.pending.set({ kind: 'new' });
      return false;
    }
    this.replaceWithEmpty();
    return true;
  }

  /** §10.3: a show link asks only when the builder is dirty. True when it loaded at once. */
  openWorkingCopy(copy: ShowWorkingCopy): boolean {
    if (untracked(this.dirty)) {
      this.pending.set({ kind: 'link', copy });
      return false;
    }
    this.loadCopy(copy);
    return true;
  }

  confirmPending(): ShowPending | null {
    const pending = untracked(this.pending);
    this.pending.set(null);
    if (!pending) return null;
    if (pending.kind === 'link') this.loadCopy(pending.copy);
    else if (pending.kind === 'new') this.replaceWithEmpty();
    else if (pending.kind === 'json') this.applyShow(pending.show);
    else this.doRemoveShell(pending.key);
    return pending;
  }

  /**
   * Show JSON Apply (phase-7.md §9.1): asks first over a dirty show (`pending`), else applies.
   * `show` comes from `parseShowJson` (openShow), never from raw text. True when applied now.
   */
  applyJson(show: ShowDocument, note: string): boolean {
    if (untracked(this.dirty)) {
      this.pending.set({ kind: 'json', show, note });
      return false;
    }
    this.applyShow(show);
    return true;
  }

  /**
   * Replaces the show with an applied one as ONE Undo step (Skyler, 2026-11-15; phase-7.md §9.1):
   * the previous show is pushed, Redo is cleared. Nothing selected, Fit, `nextCueId` past the
   * largest `c{n}`. An embedded active shell that's gone falls back to the default (Peony); a
   * preset, the designer item or My shells stay. Clears `dirty` and `saved`; `source` is unchanged,
   * as the designer's Apply leaves it.
   */
  private applyShow(show: ShowDocument): void {
    this.edit(show);
    this.lastCoalesce = null;
    this.nextCueId.set(nextCueIdAfter(show));
    this.selectedId.set(null);
    this.view.set(FIT_VIEW);
    const active = untracked(this.activeShell);
    if (active.kind === 'embedded' && !Object.hasOwn(show.shells, active.key)) {
      this.activeShell.set(DEFAULT_ACTIVE);
    }
    this.dirty.set(false);
    this.saved.set(false);
  }

  cancelPending(): void {
    this.pending.set(null);
  }

  private replaceWithEmpty(): void {
    this.show.set(emptyShow());
    this.nextCueId.set(1);
    this.selectedId.set(null);
    this.activeShell.set(DEFAULT_ACTIVE);
    this.view.set(FIT_VIEW);
    this.dirty.set(false);
    this.sourceState.set(null);
    this.clearUndo();
  }

  /** L1: loads dirty, not saved, with the response's source; nothing selected, Fit. */
  private loadCopy(copy: ShowWorkingCopy): void {
    const show = structuredClone(copy.show);
    this.show.set({ ...show, shells: { ...show.shells } });
    this.nextCueId.set(nextCueIdAfter(show));
    this.selectedId.set(null);
    this.activeShell.set(DEFAULT_ACTIVE);
    this.view.set(FIT_VIEW);
    this.dirty.set(true);
    this.saved.set(false);
    this.sourceState.set(copy.source);
    this.clearUndo();
  }

  // ---- Save (F4) ---------------------------------------------------------------------------

  snapshotForSave(): ShowSaveSnapshot {
    return { show: untracked(this.show) };
  }

  completeSave(source: CreationSource, sent: ShowSaveSnapshot): void {
    this.sourceState.set(source);
    if (sent.show !== untracked(this.show)) return;
    this.dirty.set(false);
    this.saved.set(true);
  }

  forgetSource(): void {
    this.sourceState.set(null);
  }

  // ---- Derived helpers ---------------------------------------------------------------------

  /** Burst and fade times for a cue (§8.1 note), under the show's gravity. */
  timesOf(cue: ShowCue): { burst: number; fade: number } | null {
    const show = this.show();
    const shell = embeddedShell(show, cue.shell);
    if (!shell) return null;
    const times = cueTimes(cue, shell, show.sky.gravity);
    return { burst: times.bursts[0], fade: times.endEstimate };
  }

  readonly tRange = CUE_LIMITS.t;
}
