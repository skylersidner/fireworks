import type { SaveChoice } from '../core/creation-save';

/** Announced when ⌘S finds nothing new (phase-7.md §3.3). */
export const SHORTCUT_NOTHING_NEW = 'Nothing new to save.';
/** Announced when ⌘S finds two choices: it picks neither (phase-7.md §3.3, R1). */
export const SHORTCUT_CHOOSE = 'Choose Update original or Save as new.';

/** What the page knows when Ctrl/⌘+S is pressed. */
export interface SaveShortcutState {
  /** The save choices render (`session.canWrite`). */
  readonly canWrite: boolean;
  /**
   * Signed out with the bar rendered (phase-8.md §5.5): one `Save` that opens the sign-in dialog.
   * With neither this nor `canWrite` there is no bar.
   */
  readonly prompt: boolean;
  readonly dialogOpen: boolean;
  readonly saving: boolean;
  readonly saved: boolean;
  /** The builder's `cannotSave` note (an empty show), else null. */
  readonly cannotSave: string | null;
  readonly choices: readonly SaveChoice[];
}

export type SaveShortcutOutcome =
  /** No save bar: the browser's own Save Page is the honest answer. Not prevented. */
  | { readonly kind: 'pass' }
  /** Prevented; nothing happens and nothing is announced. */
  | { readonly kind: 'hold' }
  | { readonly kind: 'announce'; readonly text: string }
  /** Open the sign-in dialog (Save variant), the same as pressing the signed-out `Save`. */
  | { readonly kind: 'prompt' }
  /** The same as pressing the single `Save`. */
  | { readonly kind: 'save'; readonly choice: SaveChoice }
  /** Focus `Update original`, send nothing, and announce. */
  | { readonly kind: 'choose'; readonly text: string };

/**
 * phase-7.md §3.3's table, first match, with phase-8.md §5.5's row: signed out with a bar, ⌘S is
 * the signed-out Save (after "a dialog is open" and "a save is in flight"). `pass` only with no bar.
 * `saving` includes the restore refresh (§6.2).
 */
export function saveShortcut(state: SaveShortcutState): SaveShortcutOutcome {
  if (!state.canWrite && !state.prompt) return { kind: 'pass' };
  if (state.dialogOpen || state.saving) return { kind: 'hold' };
  if (!state.canWrite)
    return state.cannotSave !== null
      ? { kind: 'announce', text: state.cannotSave }
      : { kind: 'prompt' };
  if (state.saved) return { kind: 'announce', text: SHORTCUT_NOTHING_NEW };
  if (state.cannotSave !== null) return { kind: 'announce', text: state.cannotSave };
  if (state.choices.length > 1) return { kind: 'choose', text: SHORTCUT_CHOOSE };
  return state.choices.length === 1 ? { kind: 'save', choice: state.choices[0] } : { kind: 'hold' };
}
