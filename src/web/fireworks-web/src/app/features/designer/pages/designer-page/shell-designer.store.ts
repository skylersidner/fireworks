import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { applyEach, disabled, form, maxLength, schema } from '@angular/forms/signals';
import type { PlaybackMode } from '../../../../../engine/model/enums';
import { MAX_BREAKS, MIN_BREAKS, NAME_MAX_LENGTH } from '../../../../../engine/model/limits';
import { normalizeQuality } from '../../../../../engine/model/normalize';
import { openShell } from '../../../../../engine/model/open';
import { PRESETS } from '../../../../../engine/model/presets';
import type { QualitySettings, SkySettings } from '../../../../../engine/model/shell';
import { BROWSER_STORAGE, REDUCED_MOTION_QUERY, mediaQuery } from '../../../../core/browser';
import type { CreationSource } from '../../../../core/creation-save';
import { DevicePreferencesService } from '../../../../core/device-preferences';
import {
  JSON_NOTE_DEFAULT,
  JSON_NOTE_EDITED,
  appliedNote,
  invalidShellNote,
  notJsonNote,
} from '../../shared/designer-copy';
import {
  DEFAULT_DISPLAY,
  editableFrom,
  readDraft,
  serializeDraft,
  toEditable,
  writeDraft,
  type DesignerDraft,
  type DisplayModel,
  type DisplaySettings,
  type EditableShell,
} from '../../shared/designer-draft';

/** Draft writes wait this long after the last change (acceptance: "within 1 s", never per frame). */
export const DRAFT_DEBOUNCE_MS = 300;
/** Set once the visitor dismisses a flashing notice; device-wide (core/device-preferences.ts). */
export { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';

/** A replace waiting for the visitor's answer (Skyler 2026-11-12: confirm over unsaved edits). */
export type PendingReplace =
  | { readonly kind: 'preset'; readonly index: number; readonly name: string }
  | {
      readonly kind: 'json';
      readonly shell: EditableShell;
      readonly note: string;
      /** The JSON has `sky`, so Apply replaces the sky (picks the §6.4 body). */
      readonly hasSky: boolean;
    }
  | { readonly kind: 'link'; readonly copy: WorkingCopy };

/**
 * A saved record opened through `/c/:code` (schema.md §11.2): exactly its saved settings, with
 * `DEFAULT_SKY` when it has none, and the `source` it came from.
 */
export interface WorkingCopy {
  readonly shell: EditableShell;
  readonly source: CreationSource;
}

/**
 * What a save sent, captured when the button was pressed (phase-5.md §3.3): the document, and the
 * model parts the flags watch, by reference, so a completed save can tell whether the visitor
 * edited while it was in flight.
 */
export interface SaveSnapshot {
  readonly shell: EditableShell;
  readonly parts: readonly unknown[];
}

/** What a load did. `loaded` carries the shell the page must fire now (prototype `loadShell(s, true)`). */
export type LoadOutcome =
  | { readonly status: 'loaded'; readonly shell: EditableShell }
  | { readonly status: 'needs-confirm' }
  | { readonly status: 'rejected' };

/**
 * Change at is disabled while Changes to is No change (designer-2c.md D6). Signal Forms passes the
 * state to range-row's `disabled` input.
 */
const SHELL_FORM_SCHEMA = schema<EditableShell>((p) => {
  // FormField puts maxlength="80" on the Name input from this rule (designer-2c.md §3.3).
  maxLength(p.name, NAME_MAX_LENGTH);
  applyEach(p.breaks, (b) => {
    disabled(b.changeAt, ({ valueOf }) => valueOf(b.color2) === 'none');
  });
});

/**
 * State of one Shell Designer page. `@Injectable()`, provided by the page component, so every
 * visit gets a fresh store that restores from the draft (acceptance 2c.3).
 *
 *  - `model` is the Signal Form's model: exactly what the fields show, untouched by normalize, so
 *    no field fights the user (2c.5: an empty Name stays empty while focused).
 *  - `shell` is `model` through normalize (clamped, defaults filled; 2c.4). The stage, JSON panel
 *    and draft read it. If the model ever fails normalize, the last good shell stays.
 *  - `shellDirty` and `skyDirty` are flags (Skyler 2026-11-13): a preset or Apply asks first only
 *    when it would replace something the visitor changed. Only shell and sky edits count; display
 *    settings and the tab are autosaved but never set either flag, and neither do app-made changes
 *    (the forced Manual, OS-driven Reduce flashing). No baseline snapshot is kept.
 *
 * Identity never enters here: the designer reads nothing from SessionService (2c.8).
 */
@Injectable()
export class ShellDesignerStore {
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly prefs = inject(DevicePreferencesService);
  private readonly reducedMotion = mediaQuery(REDUCED_MOTION_QUERY);
  private readonly restored = readDraft(this.storage);
  /** Under the OS reduced-motion setting the designer opens in Manual, every load (Skyler). */
  private readonly forcedManual = untracked(this.reducedMotion);
  private readonly restoredMode: PlaybackMode = this.restored?.display.mode ?? DEFAULT_DISPLAY.mode;
  private readonly restoredShellDirty = this.restored?.shellDirty ?? false;
  private readonly restoredSkyDirty = this.restored?.skyDirty ?? false;
  private readonly restoredSaved = this.restored?.saved ?? false;

  readonly model = signal<EditableShell>(this.restored?.shell ?? editableFrom(PRESETS[0]));
  readonly form = form(this.model, SHELL_FORM_SCHEMA);

  readonly shell = linkedSignal<EditableShell, EditableShell>({
    source: this.model,
    computation: (model, previous) =>
      toEditable(model) ?? previous?.value ?? editableFrom(PRESETS[0]),
  });
  readonly sky = computed<SkySettings>(() => this.shell().sky);
  readonly shellJson = computed(() => JSON.stringify(this.shell(), null, 2));

  readonly activeBreak = signal(this.restored?.activeBreak ?? 0);

  readonly displayModel = signal<DisplayModel>({
    mode: this.forcedManual ? 'manual' : this.restoredMode,
    persistence: this.restored?.display.persistence ?? DEFAULT_DISPLAY.persistence,
    starBudget: this.restored?.display.starBudget ?? DEFAULT_DISPLAY.starBudget,
  });
  readonly displayForm = form(this.displayModel);
  readonly mode = computed(() => this.displayModel().mode);

  /**
   * The visitor's explicit choice, or null to follow the OS (stored only once chosen). Device-wide
   * since Phase 5, shared with the player (Skyler, 2026-11-14).
   */
  readonly reduceFlashingChoice = this.prefs.reduceFlashingChoice;
  readonly reduceFlashing = computed(() => this.reduceFlashingChoice() ?? this.reducedMotion());
  /** True when Reduce flashing is on only because the device asks for reduced motion. */
  readonly reduceFlashingFromDevice = computed(
    () => this.reduceFlashingChoice() === null && this.reducedMotion(),
  );
  readonly quality = computed<QualitySettings>(() =>
    normalizeQuality({
      persistence: this.displayModel().persistence,
      starBudget: this.displayModel().starBudget,
      reduceFlashing: this.reduceFlashing(),
    }),
  );

  /**
   * The form model split into what the two flags watch: the shell without `sky`, and the sky. By
   * reference, not by value: Signal Forms rebuilds only the objects on an edited path, so a sky
   * edit keeps every other part, and a field set back still counts as a change.
   */
  private readonly shellPart = computed(
    () => {
      const { version, name, burstHeight, angleJitter, breaks } = this.model();
      return [version, name, burstHeight, angleJitter, breaks] as const;
    },
    { equal: (a, b) => a.every((v, i) => Object.is(v, b[i])) },
  );
  private readonly skyPart = computed(() => this.model().sky);

  /**
   * Set by any visitor change to the shell (everything but `sky`) after construction. A preset or
   * Apply clears it. `load()` writes first, then sets it false: linkedSignal's `set` catches up
   * with the source first, so the load's own writes never leave it dirty. Restored from the draft.
   */
  readonly shellDirty = linkedSignal<unknown, boolean>({
    source: this.shellPart,
    computation: (_source, previous) => (previous === undefined ? this.restoredShellDirty : true),
  });
  /** Set by any visitor change to the sky. Only an Apply whose JSON has `sky` clears it. */
  readonly skyDirty = linkedSignal<unknown, boolean>({
    source: this.skyPart,
    computation: (_source, previous) => (previous === undefined ? this.restoredSkyDirty : true),
  });
  /** Anything a load could replace has been changed by the visitor. */
  readonly dirty = computed(() => this.shellDirty() || this.skyDirty());

  /**
   * The shell and sky are exactly what was last saved (phase-5.md §4, F4). Any change to either
   * part clears it, the visitor's or a load's (preset, Apply, link); only a completed save sets it,
   * and only if the parts are still the ones it sent. Restored from the draft.
   */
  readonly saved = linkedSignal<unknown, boolean>({
    source: computed(() => [this.shellPart(), this.skyPart()], {
      equal: (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]),
    }),
    computation: (_source, previous) => (previous === undefined ? this.restoredSaved : false),
  });

  /**
   * The saved record this shell is a working copy of (schema.md §11.2), or null for fresh work.
   * Restored from the draft and written back with it, so a reload keeps the link. Only a link load
   * or a successful save sets it, and a 404 from Update original or a remix clears it (schema.md
   * §11.2); a preset or an Apply is an edit to the copy and leaves it alone. Never part of the
   * shell or its dirty flags.
   */
  private readonly sourceState = signal<CreationSource | null>(this.restored?.source ?? null);
  readonly source = this.sourceState.asReadonly();

  /** Current state as the draft stores it. */
  readonly draft = computed<DesignerDraft>(() => ({
    shell: this.shell(),
    activeBreak: this.activeBreak(),
    display: this.displayForDraft(),
    shellDirty: this.shellDirty(),
    skyDirty: this.skyDirty(),
    saved: this.saved(),
    source: this.source(),
  }));

  readonly pendingReplace = signal<PendingReplace | null>(null);

  /** JSON panel: unapplied text (null when the textarea shows the shell), and the note. */
  readonly jsonEdits = signal<string | null>(null);
  readonly jsonText = computed(() => this.jsonEdits() ?? this.shellJson());
  private readonly note = signal<{ text: string; json: string; edits: string | null } | null>(null);
  /** A note holds until the next edit (shell or textarea), Copy or Apply (designer-2c.md §3.6). */
  readonly jsonNote = computed(() => {
    const note = this.note();
    if (note && note.json === this.shellJson() && note.edits === this.jsonEdits()) return note.text;
    const edits = this.jsonEdits();
    return edits !== null && edits !== this.shellJson() ? JSON_NOTE_EDITED : JSON_NOTE_DEFAULT;
  });
  readonly hasJsonEdits = computed(() => {
    const edits = this.jsonEdits();
    return edits !== null && edits !== this.shellJson();
  });

  /** Polite announcement for break add/remove (designer-2c.md §3.4, §8.3). */
  readonly announcement = signal('');

  /**
   * First-visit flashing notice (designer-2c.md §7.2). While it shows, playback is paused: nothing
   * fires, not the preview loop, a click, Space, Launch or a preset load (Skyler 2026-11-13).
   * When storage can't be read it shows (and pauses) on every load.
   */
  readonly flashNoticeVisible = signal(!this.prefs.flashNoticeDismissed());
  readonly playbackPaused = computed(() => this.flashNoticeVisible());

  private lastWritten: string;
  private pendingDraft: string | null = null;

  constructor() {
    // A draft from before Phase 5 holds the Reduce flashing choice; it becomes the device's.
    this.prefs.adoptLegacyReduceFlashing(this.restored?.display.reduceFlashing);
    this.lastWritten = this.serialize();

    effect((onCleanup) => {
      const json = this.serialize();
      if (json === this.lastWritten) {
        this.pendingDraft = null;
        return;
      }
      this.pendingDraft = json;
      const handle = setTimeout(() => this.flushDraft(), DRAFT_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(handle));
    });

    // A reload or tab close inside the debounce window must not lose the last edit.
    const onPageHide = () => this.flushDraft();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
    inject(DestroyRef).onDestroy(() => {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
      this.flushDraft();
    });
  }

  selectBreak(index: number): void {
    const count = this.shell().breaks.length;
    this.activeBreak.set(Math.max(0, Math.min(index, count - 1)));
  }

  /** Appends a copy of the last break with delay 0.6 and selects it (prototype l.676–681). */
  addBreak(): void {
    const breaks = this.shell().breaks;
    if (breaks.length >= MAX_BREAKS) return;
    const copy = { ...breaks[breaks.length - 1], delay: 0.6 };
    this.model.update((m) => ({ ...m, breaks: [...m.breaks, copy] }));
    this.activeBreak.set(breaks.length);
    this.announcement.set(`Break ${breaks.length + 1} added.`);
  }

  /** Removes the active break and selects the one before it (prototype l.682–686). */
  removeBreak(): void {
    const count = this.shell().breaks.length;
    if (count <= MIN_BREAKS) return;
    const k = this.activeBreak();
    this.activeBreak.set(Math.max(0, k - 1));
    this.model.update((m) => ({ ...m, breaks: m.breaks.filter((_, i) => i !== k) }));
    this.announcement.set(`Break ${k + 1} removed.`);
  }

  /**
   * The visitor's Reduce flashing choice (the Display switch). It doesn't dismiss the flashing
   * notice: the panel stays usable while the notice holds playback (designer-2c.md §7.2).
   */
  setReduceFlashing(on: boolean): void {
    this.prefs.setReduceFlashing(on);
  }

  /**
   * Loads preset `index`, keeping the current sky and display settings (prototype: the world
   * settings survive a preset). It keeps the sky, so it asks first (`needs-confirm`) only when
   * the visitor changed the shell.
   */
  loadPreset(index: number): LoadOutcome {
    const preset = PRESETS[index];
    if (!preset) return { status: 'rejected' };
    if (this.shellDirty()) {
      this.pendingReplace.set({ kind: 'preset', index, name: preset.name });
      return { status: 'needs-confirm' };
    }
    return { status: 'loaded', shell: this.load(editableFrom(preset, this.sky()), false) };
  }

  /**
   * Parses, upgrades and normalizes `text` (`openShell`, schema.md §8.3; Peach F6), so JSON from an
   * older version is upgraded and one newer than this bundle is rejected with a `version` note.
   * Invalid input changes nothing and sets the note. A valid shell
   * waits for confirmation when the visitor changed the shell, or the JSON has `sky` and the
   * visitor changed the sky; otherwise it loads. A document without `sky` keeps the current sky,
   * as a preset does.
   */
  applyJson(text: string = this.jsonText()): LoadOutcome {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      this.setNote(notJsonNote(error instanceof Error ? error.message : String(error)));
      return { status: 'rejected' };
    }
    const result = openShell(parsed);
    if (!result.ok) {
      this.setNote(invalidShellNote(result.errors));
      return { status: 'rejected' };
    }
    const shell = editableFrom(result.shell, this.sky());
    const note = appliedNote(result.adjustments);
    const hasSky = result.shell.sky !== undefined;
    if (this.shellDirty() || (hasSky && this.skyDirty())) {
      this.pendingReplace.set({ kind: 'json', shell, note, hasSky });
      return { status: 'needs-confirm' };
    }
    return { status: 'loaded', shell: this.applyLoaded(shell, note, hasSky) };
  }

  /** The visitor confirmed the pending replace. */
  confirmReplace(): LoadOutcome {
    const pending = this.pendingReplace();
    this.pendingReplace.set(null);
    if (!pending) return { status: 'rejected' };
    if (pending.kind === 'link') return { status: 'loaded', shell: this.loadCopy(pending.copy) };
    if (pending.kind === 'preset') {
      return {
        status: 'loaded',
        shell: this.load(editableFrom(PRESETS[pending.index], this.sky()), false),
      };
    }
    return {
      status: 'loaded',
      shell: this.applyLoaded(pending.shell, pending.note, pending.hasSky),
    };
  }

  cancelReplace(): void {
    this.pendingReplace.set(null);
  }

  editJson(text: string): void {
    this.jsonEdits.set(text);
  }

  revertJson(): void {
    this.jsonEdits.set(null);
  }

  /** Sets a JSON note that holds until the next edit, Copy or Apply. */
  setNote(text: string): void {
    this.note.set({ text, json: this.shellJson(), edits: this.jsonEdits() });
  }

  /**
   * Either notice button (`Turn on Reduce flashing` or `Continue`). Ends the hold; remembered
   * unless storage refuses it. Turning Reduce flashing on here records the visitor's choice (a
   * display setting, so it never sets a dirty flag). The choice is set before the hold ends, so
   * the first burst is already reduced.
   */
  dismissFlashNotice(turnOnReduceFlashing: boolean): void {
    if (turnOnReduceFlashing) this.prefs.setReduceFlashing(true);
    this.flashNoticeVisible.set(false);
    this.prefs.dismissFlashNotice();
  }

  /**
   * A working copy from `/c/:code` (schema.md §11.1–11.3). Asks first only when the shell or sky
   * is dirty; display settings and the tab never count. Otherwise loads it.
   */
  openWorkingCopy(copy: WorkingCopy): LoadOutcome {
    if (this.dirty()) {
      this.pendingReplace.set({ kind: 'link', copy });
      return { status: 'needs-confirm' };
    }
    return { status: 'loaded', shell: this.loadCopy(copy) };
  }

  /** What a save sends, captured now (phase-5.md §3.3). */
  snapshotForSave(): SaveSnapshot {
    return { shell: this.shell(), parts: [this.shellPart(), this.skyPart()] };
  }

  /**
   * A save succeeded (F4, phase-5.md §4.3). `source` is the record just written, whatever happened
   * meanwhile. The flags clear, and `saved` is set, only when the shell and sky are still the
   * objects that were sent: an edit during the request keeps `Not saved` and both flags.
   */
  completeSave(source: CreationSource, sent: SaveSnapshot): void {
    this.sourceState.set(source);
    const [shell, sky] = sent.parts;
    if (!Object.is(shell, this.shellPart()) || !Object.is(sky, this.skyPart())) return;
    this.shellDirty.set(false);
    this.skyDirty.set(false);
    this.saved.set(true);
  }

  /** The source is gone to this visitor: a 404 from Update original or a remix (§11.2, Y2). */
  forgetSource(): void {
    this.sourceState.set(null);
  }

  /** Writes any pending draft now (debounce end, pagehide, page destroy). */
  flushDraft(): void {
    const json = this.pendingDraft;
    if (json === null) return;
    this.pendingDraft = null;
    this.lastWritten = json;
    writeDraft(this.storage, json);
  }

  private applyLoaded(shell: EditableShell, note: string, replacesSky: boolean): EditableShell {
    this.jsonEdits.set(null);
    const loaded = this.load(shell, replacesSky);
    this.setNote(note);
    return loaded;
  }

  /**
   * A link load (schema.md §11.2): the copy replaces shell and sky, selects Break 1, loads dirty
   * (both flags set, the one load that does), is not saved, and takes the copy's `source`. Display
   * settings stay (Skyler, 2026-11-14). Any pending JSON edits are dropped: they were for the
   * shell being replaced.
   */
  private loadCopy(copy: WorkingCopy): EditableShell {
    this.jsonEdits.set(null);
    this.note.set(null);
    this.model.set(structuredClone(copy.shell));
    this.activeBreak.set(0);
    this.shellDirty.set(true);
    this.skyDirty.set(true);
    this.saved.set(false);
    this.sourceState.set(copy.source);
    return this.shell();
  }

  /**
   * Makes `shell` current, selects Break 1 and clears `shellDirty`, plus `skyDirty` when the load
   * replaced the sky (after the writes: see `shellDirty`). A kept sky keeps its flag: it is still
   * the visitor's sky.
   */
  private load(shell: EditableShell, replacesSky: boolean): EditableShell {
    const skyDirty = !replacesSky && this.skyDirty();
    this.model.set(structuredClone(shell));
    this.activeBreak.set(0);
    this.shellDirty.set(false);
    this.skyDirty.set(skyDirty);
    return this.shell();
  }

  /**
   * Display settings as the draft keeps them. The OS-forced Manual is never written back: while
   * the mode is that forced Manual, the draft keeps the mode the visitor last had
   * (designer-2c.md §3.5). A Manual the visitor picks while the OS forces it is indistinguishable,
   * which costs nothing: the next load under the same setting is Manual either way.
   */
  private displayForDraft(): DisplaySettings {
    const d = this.displayModel();
    const mode = this.forcedManual && d.mode === 'manual' ? this.restoredMode : d.mode;
    return {
      mode,
      persistence: d.persistence,
      starBudget: d.starBudget,
      reduceFlashing: this.reduceFlashingChoice(),
    };
  }

  private serialize(): string {
    return serializeDraft(this.draft());
  }
}
