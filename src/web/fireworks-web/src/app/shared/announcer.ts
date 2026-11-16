import { signal, untracked } from '@angular/core';

/** How long a repeated message waits after the region is cleared (phase-7.md §10 B4). */
export const ANNOUNCE_REPEAT_MS = 100;

/** A polite live region's text: read like a signal, written with `set`. */
export interface Announcement {
  /** The region's text now (a reactive read of a signal). */
  (): string;
  /** Announces `text`. The same text twice is announced twice (B4). */
  set(text: string): void;
}

/**
 * The one helper for every `sr-only` polite region (phase-7.md §10 B4). A screen reader announces a
 * live region when its text changes, so an identical message (a second blocked add, a second show
 * end) is silent if it's simply set again. A repeat clears the region and sets the text
 * `ANNOUNCE_REPEAT_MS` later; a different message is set at once, which already announces. Any
 * new `set` cancels a pending one.
 */
export function announcement(): Announcement {
  const text = signal('');
  let pending: ReturnType<typeof setTimeout> | null = null;
  const read = (() => text()) as Announcement;
  read.set = (next: string) => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
    if (next === '' || next !== untracked(text)) {
      text.set(next);
      return;
    }
    text.set('');
    pending = setTimeout(() => {
      pending = null;
      text.set(next);
    }, ANNOUNCE_REPEAT_MS);
  };
  return read;
}

/** A visible live note's text and the sequence number its text node is keyed by. */
export interface LiveNoteEntry {
  readonly text: string;
  readonly seq: number;
}

/** A visible note in a stable `aria-live` container: read like a signal, written with `set`. */
export interface LiveNote {
  (): LiveNoteEntry | null;
  /** Shows `text` (null clears). Every set gets a new `seq`, so the same text re-announces. */
  set(text: string | null): void;
}

/**
 * B4 for visible notes (phase-7.md §10): the template renders the entry inside a keyed `@for`
 * (`track entry.seq`) under a stable live container, so setting the same message again replaces
 * the text node, which is announced, without the note ever blinking empty.
 */
export function liveNote(): LiveNote {
  const entry = signal<LiveNoteEntry | null>(null);
  let seq = 0;
  const read = (() => entry()) as LiveNote;
  read.set = (text: string | null) => entry.set(text === null ? null : { text, seq: ++seq });
  return read;
}
