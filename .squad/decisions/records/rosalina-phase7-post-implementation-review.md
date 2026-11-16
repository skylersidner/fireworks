# Phase 7 C2: post-implementation design review (Rosalina)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7, batch C2 · **Inputs:** `luigi-phase7-ux-accessibility.md` (B3), `luigi-phase7-client-hardening.md` (B2), `docs/fireworks-app/design/phase-7.md` (now §15), code under `src/web/fireworks-web/src/`, one Chromium look at 4200.

## What
Verdict: **conditional pass.** Everything in phase-7.md conforms except the items below, which need fixing before the gate.

Deviation rulings:
1. B4: a different message is set at once and only an exact repeat clears for 100 ms. **Accepted.**
2. Show JSON Copy copies the saved document even with unapplied edits. **Rejected:** Copy copies the textarea text, as the designer's Shell JSON does (`json-panel.ts` `el.value`). The round trip is unchanged, because it copies with no edits. Closing the disclosure drops edits and the note. **Accepted.**
3. A wheel scroll doesn't stop Follow. **Rejected:** phase-6.md §5.1 says a manual scroll stops following. Fix: `timeline.ts:518` emits through `emitManual`.
4. The designer's Shell JSON Copy-twice isn't re-announced. **Rejected:** B4 applies to every polite note. Fix: `json-panel.ts:55` renders the note keyed, as in `liveNote`.
5. The `+k` badge hit box uses an estimated text width with a 24×24 minimum. **Accepted.**
6. Warm-up caps of 12 ms while idle and 6 ms while playing. **Accepted.**

Defects:
- **C2-1:** `styles.css:271–298` vs `317–338`. Under coarse, `input[type='range']::…` (0,1,2) beats `.scrub-range::…` (0,1,1). The scrub gets a round 24 px thumb on an opaque 4 px track that hides the overview. Seen at 390×844.
- **C2-2:** `show-builder-page.html:428`. The Show JSON `summary` is `display:flex` and has no disclosure marker. phase-7.md §9.1 now specifies one.
- **C2-3 (K9):** `show-builder-page.html:362,366` with `show-library.ts:82–97`. My shells `Try again` and `Show more` are removed while the list loads, so focus drops to body.
- **C2-4:** `show-json.ts:73` reads `; and 1 more problems`.

Spec changes: §3.2 K9; §9.1 Copy and the disclosure indicator; §9.2 plural; §11 restore after the failure is ignored (N1); §15.

## Why
Copy has to copy what the visitor sees, and it has to behave the same on both JSON panels. Follow must never fight a gesture. Focus never drops (skill `focus-never-drops`). Layer and specificity overrides need a real-browser check.

## Boundary
- The coordinator decides who fixes these: Luigi if this counts as a conditional pass, or another member if it counts as a rejection under strict lockout. Toad's tab-walk should add K9.
- Mario checks C2-1 in the touch smoke at the gate.
- Nothing here changes a standing decision.

## Addendum: sign-off on the fix round, 7g.25 (2026-11-15)

**Inputs:** `bowser-phase7-review-fixes.md`, the re-check addendum in `toad-phase7-c3-review.md`.

### What
- **Signed off.** Rulings 2–4 and C2-1 to C2-4 are fixed as specified, and Toad's Chromium re-check passes them. Copy copies `jsonValue()`. Wheel scroll goes through `emitManual`. The designer note is keyed by `seq`. The scrub selector is (0,2,2). The summary has the `▸` marker. K9 keeps the pressed button rendered. The plural reads `1 more problem`. I have no remaining objection.
- **K9 settle guard accepted:** focus moves on settle only if it is still on the pressed button or has dropped to `body`. Added to phase-7.md §3.2 K9.
- **Touch sizes are CSS px, not rem.** My §5.2 named `min-h-11`, `size-11` and `gap-2`. With the 13px root those are 35.75px and 6.5px, so the spec itself caused Toad's defect. §5.2 now names raw px and states the rule. Bowser's px fix matches it.
- **7h.4:** `transition-property: none` meets my intent (§4: no slide under `reduce`; `motion-reduce:transition-none` is exactly that). The duration can stay at 0.15s. Peach should word the criterion as "no transition runs", as Toad's script asserts.

### Boundary
- Mario still checks C2-1 and the px sizes in the touch smoke at the gate.
- Nothing here changes a standing decision.
