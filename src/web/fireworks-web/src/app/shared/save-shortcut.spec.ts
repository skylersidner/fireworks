// @vitest-environment node
import {
  SHORTCUT_CHOOSE,
  SHORTCUT_NOTHING_NEW,
  saveShortcut,
  type SaveShortcutState,
} from './save-shortcut';

const base: SaveShortcutState = {
  canWrite: true,
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
