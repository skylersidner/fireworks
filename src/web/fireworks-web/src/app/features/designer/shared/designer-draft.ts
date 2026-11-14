import { PLAYBACK_MODES, type PlaybackMode } from '../../../../engine/model/enums';
import { MAX_BREAKS } from '../../../../engine/model/limits';
import { normalizeQuality, normalizeShell, normalizeSky } from '../../../../engine/model/normalize';
import { openShell } from '../../../../engine/model/open';
import type { ShellDocument, SkySettings } from '../../../../engine/model/shell';
import { readStorage, writeStorage } from '../../../core/browser';
import { isShareCode } from '../../../core/share-code';
import type { CreationSource } from '../../../core/creation-save';
import type { CreationKind } from '../../../core/models';

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
 *
 * `source` (Phase 5; schema.md §11.2) is the saved record this shell is a working copy of, or null
 * for fresh work. Only a link load or a successful save sets it. A draft from before Phase 5 has
 * no `source` and reads as fresh work; a malformed one reads as null too, without discarding the
 * shell (the worst case is a Save that creates a new record instead of offering Update original).
 */
export interface DesignerDraft {
  shell: EditableShell;
  activeBreak: number;
  display: DisplaySettings;
  shellDirty: boolean;
  skyDirty: boolean;
  /**
   * The shell and sky are exactly what was last saved (phase-5.md §4, F4). Set by a successful
   * save; cleared by any shell or sky change, a load's included. Fails safe the other way from the
   * dirty flags: only an explicit `true` reads as saved, so a broken flag never claims the work is
   * on the server.
   */
  saved: boolean;
  source: CreationSource | null;
}

export const DEFAULT_DISPLAY: Readonly<DisplaySettings> = {
  mode: 'loop',
  persistence: 0.78,
  starBudget: 1,
  reduceFlashing: null,
};

/**
 * Normalizes the designer's own form model into an EditableShell, ordered as plan §3.3 shows a
 * ShellDocument (sky before breaks). A shell without `sky` takes `skyFallback`. Null when
 * normalize rejects it. No upgrade: the model is always the current version. Anything from
 * outside the designer (storage, pasted JSON, the API) goes through `openShell` instead
 * (schema.md §8.3; designer-structure.spec.ts pins it).
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
 * breaks). The shell goes upgrade → normalize (`openShell`, schema.md §8.3), so a draft written by
 * an older bundle is upgraded and one from a newer bundle is dropped. Out-of-range values are
 * clamped by normalize, and a bad display field, tab or `source` falls back on its own without
 * discarding the shell.
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
  return {
    ...state,
    shellDirty: readFlag(raw, 'shellDirty'),
    skyDirty: readFlag(raw, 'skyDirty'),
    saved: raw['saved'] === true,
    source: readSource(raw['source'], 'shell'),
  };
}

/**
 * A well-formed `source` of the draft's own `kind`, or null. Every field must be right: a half-valid
 * source isn't trusted. A shell draft whose source says `show` (only a hand-edited draft) reads as
 * null, so Save offers a plain create instead of a plan that can't be made (Boo, Phase 5 info).
 */
export function readSource(value: unknown, expected: CreationKind): CreationSource | null {
  if (!isRecord(value)) return null;
  const { shareCode, kind, isOwner, updatedAt, name } = value;
  if (!isShareCode(shareCode)) return null;
  if (kind !== expected) return null;
  if (typeof isOwner !== 'boolean') return null;
  if (typeof updatedAt !== 'string' || updatedAt === '') return null;
  if (updatedAt.length > MAX_UPDATED_AT_LENGTH) return null;
  // `name` is copy only (Y1), but all-or-nothing like the rest (schema.md §11.2): no deployed
  // draft ever carried the four-field form.
  if (typeof name !== 'string' || name.length > MAX_SOURCE_NAME_LENGTH) return null;
  return { shareCode, kind: expected, isOwner, updatedAt, name };
}

/** Boo C6: an `updatedAt` token is an ISO timestamp; anything longer than this isn't one. */
const MAX_UPDATED_AT_LENGTH = 64;
/** 80 code points (schema.md §6.4) are at most 160 UTF-16 units; more isn't a saved name. */
const MAX_SOURCE_NAME_LENGTH = 160;

/**
 * Fail safe (acceptance 2c.11): only an explicit `false` is clean; a broken flag reads as dirty, so
 * a preset or Apply asks before overwriting what was restored. A draft from before the split has
 * one `dirty` flag, which stands for both (absent too, it reads as dirty).
 */
function readFlag(raw: Record<string, unknown>, key: 'shellDirty' | 'skyDirty'): boolean {
  const flag = key in raw ? raw[key] : raw['dirty'];
  return flag !== false;
}

function readState(
  raw: unknown,
): Omit<DesignerDraft, 'shellDirty' | 'skyDirty' | 'saved' | 'source'> | null {
  if (!isRecord(raw)) return null;
  const opened = openShell(raw['shell']);
  if (!opened.ok) return null;
  const shell = editableFrom(opened.shell);

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
    saved: draft.saved,
    source: draft.source && {
      shareCode: draft.source.shareCode,
      kind: draft.source.kind,
      isOwner: draft.source.isOwner,
      updatedAt: draft.source.updatedAt,
      name: draft.source.name,
    },
  });
}

/** Writes the serialized draft. Never throws; false when storage refused it. */
export function writeDraft(storage: Storage | null, serialized: string): boolean {
  return writeStorage(storage, DRAFT_KEY, serialized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
