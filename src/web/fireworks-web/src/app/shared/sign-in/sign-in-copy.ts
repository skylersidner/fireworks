import type { SaveNoun } from '../save-copy';

/** Sign-in copy (docs/fireworks-app/design/phase-8.md §2, §5.3, §6.1, §7, §9.4), verbatim. */

export const SIGN_IN_LABEL = 'Sign in';
export const SIGN_OUT_LABEL = 'Sign out';
export const NOT_NOW_LABEL = 'Not now';
export const CLOSE_LABEL = 'Close';

export const SAVE_DIALOG_TITLE = 'Sign in to save';
export const NAV_DIALOG_TITLE = 'Sign in';
export const UNAVAILABLE_DIALOG_TITLE = "Sign-in isn't available right now";

/** Boo confirmed the scopes are `openid profile` and no email is stored (A1, A38). */
export const PRIVACY_LINE =
  'Fireworks Sandbox keeps your name from Google, not your email address.';
/** Builder only, and only when Undo or Redo history exists (§5.3). */
export const UNDO_LINE = 'Undo history starts fresh when you come back.';

export function saveDialogBody(noun: SaveNoun): string {
  return `Saving needs a Google sign-in, so your ${noun}s stay yours and only you can update their links. Your ${noun} stays in this browser while you sign in and will be here when you come back. Nothing is saved until you press Save.`;
}

export const NAV_DIALOG_BODY =
  "Sign in with Google to save shells and shows and see My creations. Whatever you're working on stays in this browser.";

export function unavailableDialogBody(noun: SaveNoun): string {
  return `Saving needs a sign-in, and it's switched off on this site at the moment. Your ${noun} is kept in this browser.`;
}

/** §6.1 toast. A blank name reads `Signed in.` Defined in core/sign-in.ts (core/save-session.ts shows it). */
export { signedInToast } from '../../core/sign-in';
export const SIGNED_OUT_TOAST = 'Signed out.';
export const SIGN_OUT_FAILED = "Couldn't sign out: can't reach the server. Try again.";
/** §2.1: a blank `displayName` reads `Signed in`. */
export const BLANK_NAME = 'Signed in';
