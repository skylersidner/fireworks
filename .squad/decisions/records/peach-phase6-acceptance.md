# Peach: Phase 6 acceptance — what "plays in two browsers" means

**Date:** 2026-11-14, revised the same day for Skyler's Phase 6 rulings · Full criteria: `docs/fireworks-app/acceptance/phase-6.md` §6a.

## What
Cross-browser means the show **runs** in each browser (Skyler: "not necessarily perfect matching fidelity"). For the Done-when show, in each browser:
1. it loads (stage and WebGL canvas, flashing notice, no error page);
2. it plays to the end: the player's ended state (`{name} has ended.` + Replay) appears;
3. no `pageerror` and no `console.error` from load to the ended state;
4. Save, Share and the player work (POST 201, Share copies `/s/{code}`, the link plays to the end).

Browsers: Chromium, plus Firefox and WebKit through Playwright where they install; otherwise Safari by hand. Nothing is compared *between* browsers: no ledger, count trace, position or pixel diff, and no production-build ledger readout is required.

Exact determinism (launch ledger, per-kind count trace, end step, frame-size and array-order independence, exact seek at the cap) is a **same-engine** property, proven by `engine/loop/timeline-driver.spec.ts` and the 6i specs.

## Why
Skyler's ruling: the goal is that the show works everywhere, not that engines agree bit for bit. Same-engine specs already guard the determinism that saving and sharing depend on (the same document replays the same way for each viewer's engine). The earlier exact cross-browser compare needed a production readout and a two-engine harness, which cost more than the risk it covered.

## Boundary
Applies to the Phase 6 Done-when and, by default, to later "works in two browsers" claims. A future feature that does need cross-engine agreement (for example a deterministic video export compared across machines) must state so and reopen this; the `cross-browser-determinism-oracle` skill describes how. A same-engine determinism failure is still a defect, never a tolerance to widen.
