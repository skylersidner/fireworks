# Signed-in return flow (OAuth round trip in an SPA)

**Use when** a page sends the visitor to an external sign-in and must behave well when they come back as a full page load: focus, toast, refreshing state that depended on identity, and never writing because of the return.

## Pattern (Fireworks Phase 8, `core/sign-in.ts`, `core/save-session.ts`)

1. **One navigation function, one file.** `startSignIn` flushes the draft, writes the marker, then calls `location.assign(LOGIN + '?returnUrl=' + encodeURIComponent(checked))`. Pin the shape in the unsafe-sinks spec. Keep a test seam (`setSignInNavigationForTesting`) so specs record the URL instead of leaving.
2. **The marker is in `sessionStorage`** (`{from, path, at}`): no identity, no data. Read it once and delete it at once. Act on it only for the same path and under N minutes. Wrap every access in try/catch, because a blocked store only loses the nicety. Never honour a query flag (an attacker can start the login).
3. **Capture page-entry state in the constructor**, before any handoff (`/c/` load) runs. Here, "the restored source" was the bug: capturing it later picked up the link copy and sent a redundant GET.
4. **Wait for `settled()`** (a one-shot replay of the first identity load), then do the identity-dependent refresh once, only when signed in. Keep the edit base (`updatedAt`) when you refresh ownership. After that, toast and set a `returned` signal with a `seq`.
5. **Focus after the refresh, once** (`watchIdentityFocus`): to the action they came for, or the h1. A modal or notice that owns focus wins. A K9 guard runs when the action bar re-keys.

## Verify

- Call ledger: zero writes before and after the return, until a click.
- Mutants: refresh while signed out; refresh after a handoff; refresh adopts the token; the marker isn't deleted; the marker never expires; the toast without a session. See `tools/mutants/sets/phase8-client.mjs`.
- Running app: two contexts on the same account give a real 412, then Replace.
