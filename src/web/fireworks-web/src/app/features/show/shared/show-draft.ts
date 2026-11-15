import { KEY_PATTERN } from '../../../../engine/model/limits';
import { openShow } from '../../../../engine/model/open';
import { PRESETS } from '../../../../engine/model/presets';
import type { ShowDocument } from '../../../../engine/model/show';
import { readStorage, writeStorage } from '../../../core/browser';
import type { CreationSource } from '../../../core/creation-save';
import { readSource } from '../../designer/shared/designer-draft';
import { embeddable, nextCueIdAfter } from './show-edit';

/** localStorage key of the Show Builder's draft (phase-6.md §10.1). The designer never reads it. */
export const SHOW_DRAFT_KEY = 'fireworks.showDraft.v1';

/** The library shell new cues use (phase-6.md §4.1). Selecting one changes nothing in the show. */
export type ActiveShell =
  | { readonly kind: 'preset'; readonly index: number }
  | { readonly kind: 'designer' }
  | { readonly kind: 'embedded'; readonly key: string }
  | { readonly kind: 'mine'; readonly shareCode: string; readonly name: string };

export const DEFAULT_ACTIVE: ActiveShell = { kind: 'preset', index: 0 };

/** Zoom: null is Fit (phase-6.md §5.1). `scroll` is the left edge of the view, in seconds. */
export interface TimelineView {
  readonly pxPerSecond: number | null;
  readonly scroll: number;
}

export const FIT_VIEW: TimelineView = { pxPerSecond: null, scroll: 0 };

/**
 * The builder draft (phase-6.md §10.1). One `dirty` flag, plus `saved` and `source` under the
 * Phase 5 F4 rule. `display` isn't here: Motion blur and Reduce flashing are device
 * preferences (`core/device-preferences.ts`). The playhead and play state are never stored (Peach 6i.3).
 */
export interface ShowDraft {
  show: ShowDocument;
  nextCueId: number;
  selectedCueId: string | null;
  activeShell: ActiveShell;
  view: TimelineView;
  dirty: boolean;
  saved: boolean;
  source: CreationSource | null;
}

/**
 * Opens a stored or applied show the way `openShow` does (upgrade, then lenient normalize), except
 * that an empty `cues` array is allowed: a draft may hold no cues (Save is what's blocked, §9.1).
 * For that case a sentinel cue (and a sentinel shell, when there are none) is walked and dropped.
 */
export function openShowDraftDocument(raw: unknown): ShowDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  const cues = doc['cues'];
  if (!(Array.isArray(cues) && cues.length === 0)) {
    const opened = openShow(raw);
    return opened.ok ? { ...opened.show, shells: { ...opened.show.shells } } : null;
  }
  const shells = doc['shells'];
  const shellKeys =
    typeof shells === 'object' && shells !== null && !Array.isArray(shells)
      ? Object.keys(shells)
      : null;
  if (shellKeys === null) return null;
  const sentinelShell = shellKeys.length === 0 ? 'sentinel' : null;
  const key = sentinelShell ?? shellKeys.find((k) => KEY_PATTERN.test(k));
  if (!key) return null;
  const withSentinel = {
    ...doc,
    shells: sentinelShell ? { [sentinelShell]: embeddable(PRESETS[0]) } : shells,
    cues: [{ id: 'sentinel', t: 0, shell: key, x: 0, seed: 0 }],
  };
  const opened = openShow(withSentinel);
  if (!opened.ok) return null;
  const outShells = { ...opened.show.shells };
  if (sentinelShell) delete outShells[sentinelShell];
  return { ...opened.show, shells: outShells, cues: [] };
}

export function readShowDraft(storage: Storage | null): ShowDraft | null {
  const text = readStorage(storage, SHOW_DRAFT_KEY);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const show = openShowDraftDocument(raw['show']);
  if (!show) return null;
  const minNext = nextCueIdAfter(show);
  const next = raw['nextCueId'];
  const nextCueId =
    typeof next === 'number' && Number.isInteger(next) && next >= minNext && next < 1e9
      ? next
      : minNext;
  const sel = raw['selectedCueId'];
  const selectedCueId = typeof sel === 'string' && show.cues.some((c) => c.id === sel) ? sel : null;
  return {
    show,
    nextCueId,
    selectedCueId,
    activeShell: readActive(raw['activeShell'], show),
    view: readView(raw['view']),
    // Fail safe (as the designer's flags): only an explicit false is clean, only true is saved.
    dirty: raw['dirty'] !== false,
    saved: raw['saved'] === true,
    source: readSource(raw['source'], 'show'),
  };
}

function readActive(value: unknown, show: ShowDocument): ActiveShell {
  if (!isRecord(value)) return DEFAULT_ACTIVE;
  switch (value['kind']) {
    case 'preset': {
      const i = value['index'];
      return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < PRESETS.length
        ? { kind: 'preset', index: i }
        : DEFAULT_ACTIVE;
    }
    case 'designer':
      return { kind: 'designer' };
    case 'embedded': {
      const key = value['key'];
      return typeof key === 'string' && Object.hasOwn(show.shells, key)
        ? { kind: 'embedded', key }
        : DEFAULT_ACTIVE;
    }
    default:
      // My shells aren't restored: the list may have changed, and it reloads anyway.
      return DEFAULT_ACTIVE;
  }
}

function readView(value: unknown): TimelineView {
  if (!isRecord(value)) return FIT_VIEW;
  const px = value['pxPerSecond'];
  const scroll = value['scroll'];
  return {
    pxPerSecond: typeof px === 'number' && Number.isFinite(px) && px > 0 && px <= 200 ? px : null,
    scroll: typeof scroll === 'number' && Number.isFinite(scroll) && scroll >= 0 ? scroll : 0,
  };
}

/** The draft as stored, with a fixed key order. */
export function serializeShowDraft(draft: ShowDraft): string {
  return JSON.stringify({
    show: draft.show,
    nextCueId: draft.nextCueId,
    selectedCueId: draft.selectedCueId,
    activeShell: draft.activeShell,
    view: draft.view,
    dirty: draft.dirty,
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

export function writeShowDraft(storage: Storage | null, serialized: string): boolean {
  return writeStorage(storage, SHOW_DRAFT_KEY, serialized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
