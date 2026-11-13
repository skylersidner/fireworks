import { PLAYBACK_MODES, type PlaybackMode } from '../../../../engine/model/enums';
import { MAX_BREAKS } from '../../../../engine/model/limits';
import { normalizeQuality, normalizeShell, normalizeSky } from '../../../../engine/model/normalize';
import type { ShellDocument, SkySettings } from '../../../../engine/model/shell';
import { readStorage, writeStorage } from '../../../core/browser';

/** localStorage key of the designer's working draft (plan 2c). Owned by the designer. */
export const DRAFT_KEY = 'fireworks.draft.v1';

/** A ShellDocument whose `sky` is always present: what the designer edits, shows and saves. */
export interface EditableShell extends ShellDocument {
  sky: SkySettings;
}

/** This device's display settings (designer-2c.md §3.5). Saved in the draft, never in a shell. */
export interface DisplaySettings {
  mode: PlaybackMode;
  persistence: number;
  starBudget: number;
  /** The visitor's explicit Reduce flashing choice; null follows the OS reduced-motion setting. */
  reduceFlashing: boolean | null;
}

/** The display settings the Mode select and the Display section edit through a Signal Form. */
export interface DisplayModel {
  mode: PlaybackMode;
  persistence: number;
  starBudget: number;
}

/**
 * The draft (plan 2c; Skyler 2026-11-13): the designer's current state, autosaved so leaving the
 * sandbox for any reason (reload, `/status`, closing the tab) never loses it.
 *
 * `shellDirty` and `skyDirty` (Skyler 2026-11-13) say whether the visitor has changed the shell
 * (everything but `sky`) or the sky since it was last replaced (preset or Apply for the shell; an
 * Apply whose JSON has `sky` for the sky; or the first-visit default). Display settings and the tab
 * are saved but never set either flag. They are flags, not comparisons: setting a field back
 * doesn't clear them. They are stored so a reload doesn't make edits count as clean.
 *
 * `display.mode` is the visitor's mode, never the Manual the OS reduced-motion setting forces at
 * load, and `display.reduceFlashing` is null until the visitor chooses (designer-2c.md §3.5).
 */
export interface DesignerDraft {
  shell: EditableShell;
  activeBreak: number;
  display: DisplaySettings;
  shellDirty: boolean;
  skyDirty: boolean;
}

export const DEFAULT_DISPLAY: Readonly<DisplaySettings> = {
  mode: 'loop',
  persistence: 0.78,
  starBudget: 1,
  reduceFlashing: null,
};

/**
 * Validates untrusted input into an EditableShell, ordered as plan §3.3 shows a ShellDocument
 * (sky before breaks). A shell without `sky` takes `skyFallback`. Null when normalize rejects it.
 */
export function toEditable(input: unknown, skyFallback?: SkySettings): EditableShell | null {
  const result = normalizeShell(input);
  if (!result.ok) return null;
  return editableFrom(result.shell, skyFallback);
}

/** An already-normalized ShellDocument as an EditableShell (same key order as `toEditable`). */
export function editableFrom(shell: ShellDocument, skyFallback?: SkySettings): EditableShell {
  const { version, name, burstHeight, angleJitter, breaks } = shell;
  return {
    version,
    name,
    burstHeight,
    angleJitter,
    sky: normalizeSky(shell.sky ?? skyFallback),
    breaks: breaks.map((b) => ({ ...b })),
  };
}

/**
 * Reads the draft. Anything unreadable falls back silently to null: no key, storage that throws,
 * non-JSON, a non-object, a missing or invalid `shell` (an unknown enum, a future version, 0 or 5
 * breaks). Out-of-range values are clamped by normalize, and a bad display field or tab falls
 * back on its own without discarding the shell.
 */
export function readDraft(storage: Storage | null): DesignerDraft | null {
  const text = readStorage(storage, DRAFT_KEY);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const state = readState(raw);
  if (!state || !isRecord(raw)) return null;
  return { ...state, shellDirty: readFlag(raw, 'shellDirty'), skyDirty: readFlag(raw, 'skyDirty') };
}

/**
 * Fail safe (acceptance 2c.11): only an explicit `false` is clean; a broken flag reads as dirty, so
 * a preset or Apply asks before overwriting what was restored. A draft from before the split has
 * one `dirty` flag, which stands for both (absent too, it reads as dirty).
 */
function readFlag(raw: Record<string, unknown>, key: 'shellDirty' | 'skyDirty'): boolean {
  const flag = key in raw ? raw[key] : raw['dirty'];
  return flag !== false;
}

function readState(raw: unknown): Omit<DesignerDraft, 'shellDirty' | 'skyDirty'> | null {
  if (!isRecord(raw)) return null;
  const shell = toEditable(raw['shell']);
  if (!shell) return null;

  const tab = raw['activeBreak'];
  const activeBreak =
    typeof tab === 'number' && Number.isInteger(tab) && tab >= 0
      ? Math.min(tab, shell.breaks.length - 1, MAX_BREAKS - 1)
      : 0;

  const d = isRecord(raw['display']) ? raw['display'] : {};
  const quality = normalizeQuality({
    persistence: d['persistence'] as number,
    starBudget: d['starBudget'] as number,
  });
  const mode = (PLAYBACK_MODES as readonly unknown[]).includes(d['mode'])
    ? (d['mode'] as PlaybackMode)
    : DEFAULT_DISPLAY.mode;
  const reduceFlashing = typeof d['reduceFlashing'] === 'boolean' ? d['reduceFlashing'] : null;

  return {
    shell,
    activeBreak,
    display: {
      mode,
      persistence: quality.persistence,
      starBudget: quality.starBudget,
      reduceFlashing,
    },
  };
}

/** The draft as it is stored, with a fixed key order so equal drafts serialize identically. */
export function serializeDraft(draft: DesignerDraft): string {
  const { mode, persistence, starBudget, reduceFlashing } = draft.display;
  return JSON.stringify({
    shell: draft.shell,
    activeBreak: draft.activeBreak,
    display: { mode, persistence, starBudget, reduceFlashing },
    shellDirty: draft.shellDirty,
    skyDirty: draft.skyDirty,
  });
}

/** Writes the serialized draft. Never throws; false when storage refused it. */
export function writeDraft(storage: Storage | null, serialized: string): boolean {
  return writeStorage(storage, DRAFT_KEY, serialized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
