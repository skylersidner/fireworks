// @vitest-environment node
import {
  SHORTCUT_CHOOSE,
  SHORTCUT_NOTHING_NEW,
  saveShortcut,
  type SaveShortcutState,
} from './save-shortcut';

const base: SaveShortcutState = {
  canWrite: true,
  prompt: false,
  dialogOpen: false,
  saving: false,
  saved: false,
  cannotSave: null,
  choices: ['save'],
};

/** phase-7.md §3.3's table, row by row (acceptance 7g.10–7g.15). */
describe('saveShortcut (Ctrl/⌘+S)', () => {
  it('no save bar: passes to the browser (not prevented)', () => {
    expect(saveShortcut({ ...base, canWrite: false })).toEqual({ kind: 'pass' });
    expect(saveShortcut({ ...base, canWrite: false, choices: ['update', 'saveAsNew'] })).toEqual({
      kind: 'pass',
    });
  });

  it('signed out with a bar (phase-8.md §5.5): opens the sign-in dialog, after dialog and saving', () => {
    const out = { ...base, canWrite: false, prompt: true };
    expect(saveShortcut(out)).toEqual({ kind: 'prompt' });
    expect(saveShortcut({ ...out, choices: ['update', 'saveAsNew'] })).toEqual({ kind: 'prompt' });
    expect(saveShortcut({ ...out, saved: true })).toEqual({ kind: 'prompt' });
    expect(saveShortcut({ ...out, dialogOpen: true })).toEqual({ kind: 'hold' });
    expect(saveShortcut({ ...out, saving: true })).toEqual({ kind: 'hold' });
    // An empty show stays unsaveable signed out: its note, no dialog (§5.1).
    expect(saveShortcut({ ...out, cannotSave: 'x' })).toEqual({ kind: 'announce', text: 'x' });
    // canWrite wins over a stale prompt flag.
    expect(saveShortcut({ ...base, prompt: true })).toEqual({ kind: 'save', choice: 'save' });
  });

  it('a dialog open or a save in flight: held, nothing announced', () => {
    expect(saveShortcut({ ...base, dialogOpen: true })).toEqual({ kind: 'hold' });
    expect(saveShortcut({ ...base, saving: true })).toEqual({ kind: 'hold' });
  });

  it('Saved: Nothing new to save.', () => {
    expect(saveShortcut({ ...base, saved: true })).toEqual({
      kind: 'announce',
      text: SHORTCUT_NOTHING_NEW,
    });
    expect(SHORTCUT_NOTHING_NEW).toBe('Nothing new to save.');
  });

  it('an empty show: the cannot-save note, no request', () => {
    const note = 'A show needs at least one cue before it can be saved.';
    expect(saveShortcut({ ...base, cannotSave: note })).toEqual({ kind: 'announce', text: note });
  });

  it('one choice saves it; two choices pick neither', () => {
    expect(saveShortcut(base)).toEqual({ kind: 'save', choice: 'save' });
    expect(saveShortcut({ ...base, choices: ['update', 'saveAsNew'] })).toEqual({
      kind: 'choose',
      text: SHORTCUT_CHOOSE,
    });
    expect(SHORTCUT_CHOOSE).toBe('Choose Update original or Save as new.');
  });

  it('first match: a dialog outranks Saved, Saved outranks two choices', () => {
    expect(saveShortcut({ ...base, dialogOpen: true, saved: true })).toEqual({ kind: 'hold' });
    expect(saveShortcut({ ...base, saved: true, choices: ['update', 'saveAsNew'] }).kind).toBe(
      'announce',
    );
  });
});
