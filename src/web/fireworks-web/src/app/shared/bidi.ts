/** U+2068 FIRST STRONG ISOLATE. Built from its code so no invisible character sits in the source. */
export const FSI = String.fromCharCode(0x2068);
/** U+2069 POP DIRECTIONAL ISOLATE. */
export const PDI = String.fromCharCode(0x2069);

/**
 * A user-supplied name isolated for plain strings (toasts, dialogs, `document.title`, labels), so
 * right-to-left or override characters in it can't reorder the text around it (Boo C3). The quotes
 * stay outside the isolate. Templates use `<bdi>` instead.
 */
export function isolate(name: string): string {
  return `${FSI}${name}${PDI}`;
}
