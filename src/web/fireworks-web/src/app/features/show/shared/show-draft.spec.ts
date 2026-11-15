import { PRESETS } from '../../../../engine/model/presets';
import { MemoryStorage } from '../../../testing/memory-storage';
import { doneWhenShow } from '../../../testing/show-fixtures';
import { CODE_A } from '../../../testing/creation-fixtures';
import {
  SHOW_DRAFT_KEY,
  openShowDraftDocument,
  readShowDraft,
  serializeShowDraft,
  type ShowDraft,
} from './show-draft';
import { embeddable, emptyShow } from './show-edit';

function draftOf(over: Partial<ShowDraft> = {}): ShowDraft {
  return {
    show: doneWhenShow(),
    nextCueId: 51,
    selectedCueId: 'c3',
    activeShell: { kind: 'preset', index: 2 },
    view: { pxPerSecond: 40, scroll: 12 },
    dirty: false,
    saved: true,
    source: { shareCode: CODE_A, kind: 'show', isOwner: true, updatedAt: 'x', name: 'S' },
    ...over,
  };
}

describe('show draft (phase-6.md §10.1; acceptance 6c.1)', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(SHOW_DRAFT_KEY, serializeShowDraft(draftOf()));
    const read = readShowDraft(storage)!;
    expect(read).toEqual({
      ...draftOf(),
      show: expect.objectContaining({ cues: doneWhenShow().cues }),
    });
    expect(serializeShowDraft(read)).toBe(serializeShowDraft(draftOf()));
  });

  it('an empty show (no cues) is a valid draft, with or without shells', () => {
    expect(openShowDraftDocument(emptyShow())).toEqual(emptyShow());
    const withShell = { ...emptyShow(), shells: { s1: embeddable(PRESETS[3])! } };
    expect(openShowDraftDocument(withShell)).toEqual(withShell);
  });

  it('unreadable shows, flags and sources fall back safely', () => {
    const storage = new MemoryStorage();
    storage.setItem(SHOW_DRAFT_KEY, '{"show": {"version": 9}}');
    expect(readShowDraft(storage)).toBeNull();
    storage.setItem(
      SHOW_DRAFT_KEY,
      JSON.stringify({
        ...JSON.parse(serializeShowDraft(draftOf())),
        dirty: 'no',
        saved: 'yes',
        nextCueId: 3,
        selectedCueId: 'gone',
        source: { shareCode: CODE_A, kind: 'shell', isOwner: true, updatedAt: 'x', name: 'S' },
      }),
    );
    const read = readShowDraft(storage)!;
    // Dirty fails safe to true, saved to false; a shell source isn't a show's; the id counter never
    // goes below the largest c{n} + 1 (N4).
    expect([read.dirty, read.saved, read.source, read.nextCueId, read.selectedCueId]).toEqual([
      true,
      false,
      null,
      51,
      null,
    ]);
  });
});
