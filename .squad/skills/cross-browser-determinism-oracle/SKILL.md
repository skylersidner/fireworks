# Skill: Cross-browser checks vs determinism

**Domain:** Any "plays in two browsers" claim (shows, replays, export)
**Confidence:** medium. Phase 6 requirement set by Skyler 2026-11-14; the exact-compare section is from code reading and not measured.

## The default requirement (what Skyler asked for)
Cross-browser means **it runs** in each browser, not that the output matches. In each engine (Chromium, plus Firefox and WebKit via Playwright where they install, else Safari by hand): it loads, plays to its ended state, logs no `pageerror` or `console.error`, and the save/share/player flow works. Observe the page (ended-state DOM, Network, console), not dev globals like `window.ng`. Negative controls: an injected `console.error` must fail the run, and a missing ended state must fail by timeout. The smoke must exit non-zero on its own; logging the errors for a human to read doesn't count. Phase 6 form: `addInitScript` a delayed `console.error`, and a `MutationObserver` that removes the ended element, with a short end allowance (`scratchpad/p6smoke/done-when-toad.mjs`). Run each engine once as the builder and once as the player in pairs (A saves, B plays), and assert that the GET `document` deep-equals the POSTed one.

Keep exact determinism (ledger, count trace, end step, seek exactness) as **same-engine specs**. Don't turn it into a cross-browser gate unless a feature explicitly needs engines to agree.

## Only if cross-engine agreement is explicitly required
Split what the sim computes by the math it uses:
- **Exact compare:** anything from integer RNG and `+ − × ÷ sqrt` (correctly rounded everywhere): fire steps, seeds, targets, lifetimes, counts, end step. First check that no death or spawn condition reads a position (`simulation.ts`: deaths are `age >= life` only).
- **Tolerance compare:** anything touched by `Math.sin/cos/exp/pow/atan2` (implementation-approximated): positions, velocities. Record the measured max.
- **Never:** pixel diffs across GPUs. Use different JS engines; two Chromium builds prove nothing. This needs a readout in the production build, which is real cost; confirm the requirement with Skyler before asking for it.
