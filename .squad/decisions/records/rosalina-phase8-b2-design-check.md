# Phase 8 B2 post-implementation design check (Rosalina)

**Date:** 2026-11-16 · **Status:** proposed. Reviews Luigi's `luigi-phase8-client-sign-in.md` against `docs/fireworks-app/design/phase-8.md`. Details are in phase-8.md §15.

## What

1. **The G is rejected.** Google's current `signin-assets.zip` (files dated 2026-04-15) draws the gradient G, not the flat four-colour G that B2 inlines. The fix is the file route already allowed in §3:
   - take the bundle's Light / Square / no-text web SVG;
   - delete its two button-chrome paths (`M4 0.5H36…`);
   - crop to `viewBox="10 10 20 20"` at 20×20;
   - serve it as `public/brand/google-g.svg` through `<img alt="">`.
   The exact steps are in §15.1.
2. **Accepted deviations:**
   - the font fallback (a recorded departure from Google Sans Medium);
   - the 403 server-fault row;
   - `/signin` `Go back` limited to three literal routes;
   - the builder's stranded-focus move after a save.
3. **Conformance passed everywhere else:**
   - every new string matches the spec;
   - the §12.1 focus table, including the return after the restore refresh;
   - the builder's Undo line;
   - the banner and the player wrappers are gone;
   - "Remixed from" appears on the player only, behind the checks;
   - both panels have `tabindex="-1"`;
   - every new control is 44px tall under a coarse pointer (measured in Chromium).

## Why

- The spec said "copied unmodified from the bundle". The bundle's G changed, so the code is out of date even though it is a genuine Google mark. Brand review compares the button with the current assets.
- An inline template isn't the right home for the bundle SVG, because it uses `foreignObject` with an XHTML `div`. An `<img>` under `img-src 'self'` renders it, as verified in Chromium.

## Boundary

- Don't redraw or flatten the gradient G. If an engine renders it wrongly as an `<img>`, report that to Rosalina and Skyler rather than editing the paths.
- The fix touches only `google-sign-in-button.ts` and the new asset. No CSP change is needed.
- Under the strict lockout, the revision goes to someone other than Luigi, at the coordinator's call.
- Toad's three-engine render check covers the new asset.
