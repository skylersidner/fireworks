/**
 * Sign-in navigation and the return marker (phase-8-auth.md §6.1; design phase-8.md §5.4, §6.1;
 * Boo A5, A6, A41). No HTTP and no identity: the session lives in core/session.ts.
 *
 *  - Sign-in is a top-level GET navigation to the API's login endpoint, never a form, a fetch or a
 *    popup (A6). **This is the only file that calls `location.assign`** (unsafe-sinks.spec.ts), and
 *    the only target it builds is `LOGIN_PATH` plus an encoded `returnUrl` query value. The client
 *    never navigates to a `returnUrl` itself; the server's `SafeReturnUrl` is the authority (A5).
 *  - The return is a full page load with nothing in the URL to say so. Before leaving, a
 *    `sessionStorage` marker records where the visitor came from; the page they land on reads it and
 *    deletes it at once. It carries no identity or draft data, and it only ever moves focus and
 *    shows a toast: nothing is saved because of it (A41), and no query flag is read.
 */

/** The API's login endpoint for the one provider (Skyler: Google only). */
export const LOGIN_PATH = '/api/auth/login/google';

/** phase-8.md §6.1's return toast (here, not in shared copy, because core/save-session.ts shows it). */
export function signedInToast(name: string): string {
  return name ? `Signed in as ${name}.` : 'Signed in.';
}

/** The return marker's key (phase-8.md §6.1). */
export const SIGN_IN_INTENT_KEY = 'fireworks.signin.v1';

/** A marker older than this is ignored (phase-8.md §6.1). */
export const SIGN_IN_INTENT_MAX_AGE_MS = 10 * 60 * 1000;

/** What the visitor pressed to start: Save (focus Save on return) or a nav/page sign-in (the h1). */
export type SignInFrom = 'save' | 'nav';

export interface SignInIntent {
  readonly from: SignInFrom;
  readonly path: string;
  readonly at: number;
}

/**
 * The client half of A5: the same rule table as the server's `SafeReturnUrl.From`. At most 2,048
 * chars; starts with `/` and the second char is neither `/` nor `\`; no `\`, no char below U+0020
 * and no U+007F anywhere; and the path, raw or percent-decoded, doesn't start with `/api` (any
 * case) or decode to a `//` or `/\` start. Used only to choose what this client passes on or links
 * to; the server re-checks everything.
 */
export function isSafeInternalUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false;
  if (url[0] !== '/') return false;
  if (url.length > 1 && (url[1] === '/' || url[1] === '\\')) return false;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return false;
  }
  const end = url.search(/[?#]/);
  const path = end < 0 ? url : url.slice(0, end);
  // Like the server's Uri.UnescapeDataString: valid %XX escapes decode, anything else stays as it
  // is (so `/%zz` passes there and here). Byte-wise is enough: only `/`, `\` and `api` matter.
  const decoded = path.replace(/%[0-9a-f]{2}/gi, (m) =>
    String.fromCharCode(parseInt(m.slice(1), 16)),
  );
  const isApi = (p: string) => /^\/api/i.test(p);
  if (isApi(path) || isApi(decoded)) return false;
  return !(decoded.length > 1 && (decoded[1] === '/' || decoded[1] === '\\'));
}

/** The login URL for `returnPath`: an unsafe path is replaced by `/` before it is sent. */
export function loginUrl(returnPath: string): string {
  const target = isSafeInternalUrl(returnPath) ? returnPath : '/';
  return `${LOGIN_PATH}?returnUrl=${encodeURIComponent(target)}`;
}

/** The current page's path and query (never the fragment), for `returnUrl`. */
export function currentReturnPath(): string {
  return `${location.pathname}${location.search}`;
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Writes the marker. A blocked `sessionStorage` only loses the return toast and focus move. */
export function writeSignInIntent(from: SignInFrom, path: string, now: number = Date.now()): void {
  try {
    sessionStore()?.setItem(SIGN_IN_INTENT_KEY, JSON.stringify({ from, path, at: now }));
  } catch {
    // Blocked or full: nothing breaks (phase-8.md §6.1).
  }
}

/**
 * Reads the marker and deletes it at once, whatever it holds. Returns it only when it is well
 * formed, its `path` is `path` (the page's own path, without the query) and it is under ten
 * minutes old; otherwise null. `/signin` passes `null` for `path`: a failed sign-in lands there,
 * not on the page that started it, and it keeps `from` to write again on a retry (phase-8.md §9.4).
 */
export function takeSignInIntent(
  path: string | null,
  now: number = Date.now(),
): SignInIntent | null {
  const store = sessionStore();
  let raw: string | null = null;
  try {
    raw = store?.getItem(SIGN_IN_INTENT_KEY) ?? null;
    store?.removeItem(SIGN_IN_INTENT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { from, path: savedPath, at } = parsed as Record<string, unknown>;
  if (from !== 'save' && from !== 'nav') return null;
  if (typeof savedPath !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (path !== null && pathOnly(savedPath) !== pathOnly(path)) return null;
  const age = now - at;
  if (age < 0 || age >= SIGN_IN_INTENT_MAX_AGE_MS) return null;
  return { from, path: savedPath, at };
}

function pathOnly(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/** The navigation itself, behind a seam so specs can record it instead of leaving the page. */
export type Navigate = (url: string) => void;

let leave: Navigate = (url) => location.assign(url);

/** Specs only: replaces the navigation and returns a restore function. */
export function setSignInNavigationForTesting(fn: Navigate): () => void {
  const previous = leave;
  leave = fn;
  return () => (leave = previous);
}

export interface StartSignIn {
  readonly from: SignInFrom;
  /** Where to come back to: the page's path and query. */
  readonly returnPath: string;
  /** The page store's `flushDraft()`, so the draft is on disk before the page unloads. */
  readonly beforeLeave?: () => void;
}

/**
 * The Google button's press (phase-8.md §5.4): flush the draft, write the marker, then one
 * top-level navigation to the login endpoint. Nothing else is sent (A40).
 */
export function startSignIn({ from, returnPath, beforeLeave }: StartSignIn): void {
  try {
    beforeLeave?.();
  } catch {
    // A failed flush must not strand the visitor; the debounced draft is already on disk.
  }
  writeSignInIntent(from, returnPath);
  leave(loginUrl(returnPath));
}
