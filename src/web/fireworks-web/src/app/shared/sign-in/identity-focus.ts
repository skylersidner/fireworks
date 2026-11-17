import { Injector, afterNextRender, effect, untracked, type Signal } from '@angular/core';
import type { SignInReturn } from '../../core/save-session';

export interface IdentityFocusOptions {
  readonly injector: Injector;
  /** The page host, for the save bar's buttons. */
  readonly host: HTMLElement;
  /** `SaveSession.returned`. */
  readonly returned: Signal<SignInReturn | null>;
  /** Anything that re-keys the save bar: refreshing, prompt, the choices. */
  readonly barKey: Signal<string>;
  /** A save or a Replace is in flight. */
  readonly busy: Signal<boolean>;
  readonly flashNoticeVisible: Signal<boolean>;
  readonly heading: () => HTMLElement | null;
}

const isStranded = (el: Element | null) =>
  el === null ||
  el === document.body ||
  !el.isConnected ||
  (el instanceof HTMLButtonElement && el.disabled);

/** The save bar's first rendered save button: Save, Update original, or (while Saved) Save as new. */
export function firstSaveButton(host: HTMLElement): HTMLElement | null {
  const buttons = host.querySelectorAll<HTMLButtonElement>(
    '[data-testid="save-bar"] button[data-testid^="save-"]',
  );
  for (const b of buttons) if (!b.disabled) return b;
  return host.querySelector<HTMLElement>('[data-testid="save-bar"] [data-testid="share"]');
}

/**
 * Focus across identity changes on the designer and the Show Builder (phase-8.md §6.2, §9.1,
 * §9.2, §12.1; skill focus-never-drops). One move each, never two:
 *  - the return from sign-in, after the restore refresh: the save bar's first choice
 *    (`from: save`) or the panel h1 (`from: nav`); the flashing notice keeps focus if it shows;
 *  - the bar re-keyed (the refresh settled, a 401 collapsed it, the choices changed): if focus was
 *    in the save bar and is now on body or a removed or disabled button, the first save button;
 *  - a save or Replace ended with focus stranded (the Replace button left with the status block,
 *    or the pressed button is disabled while `Saved`): the first enabled save button.
 */
export function watchIdentityFocus(o: IdentityFocusOptions): void {
  const later = (fn: () => void) => afterNextRender(fn, { injector: o.injector });
  effect(
    () => {
      const back = o.returned();
      if (!back) return;
      untracked(() =>
        later(() => {
          if (o.flashNoticeVisible()) return;
          if (back.from === 'nav') o.heading()?.focus();
          else firstSaveButton(o.host)?.focus();
        }),
      );
    },
    { injector: o.injector },
  );
  let lastKey: string | null = null;
  effect(
    () => {
      const key = o.barKey();
      if (key === lastKey) return;
      const first = lastKey === null;
      lastKey = key;
      if (first) return;
      untracked(() => {
        const active = document.activeElement;
        const wasOnBar =
          active instanceof Element && active.closest('[data-testid="save-bar"]') !== null;
        if (!wasOnBar) return;
        later(() => {
          if (isStranded(document.activeElement)) firstSaveButton(o.host)?.focus();
        });
      });
    },
    { injector: o.injector },
  );
  let wasBusy = false;
  effect(
    () => {
      const busy = o.busy();
      if (wasBusy && !busy) {
        untracked(() =>
          later(() => {
            if (isStranded(document.activeElement)) firstSaveButton(o.host)?.focus();
          }),
        );
      }
      wasBusy = busy;
    },
    { injector: o.injector },
  );
}
