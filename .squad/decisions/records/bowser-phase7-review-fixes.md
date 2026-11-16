# Phase 7 review-fix round: Rosalina C2 rulings and defects, Boo F1 (Bowser)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7 · **Inputs:** `rosalina-phase7-post-implementation-review.md` (rulings 2–4, C2-1 to C2-4), `boo-phase7-security-verification.md` (F1), `docs/fireworks-app/design/phase-7.md` §3.2 K9, §9.1, §9.2, §15. Luigi wrote the frontend code; I fixed it under strict lockout.

## What

**Frontend (`src/web/fireworks-web/src/`):**
- **Ruling 2:** Show JSON Copy writes `jsonValue()` (the textarea text, edits included), as the designer's Shell JSON does.
- **Ruling 3:** a plain wheel scroll in `timeline.ts` goes out through `emitManual`, so the page stops Follow (phase-6.md §5.1).
- **Ruling 4:** the designer's Shell JSON note is a `LiveNoteEntry`. `ShellDesignerStore.jsonNoteEntry` carries a `seq` that every `setNote` bumps (default −1, edited −2, as in the builder). `json-panel.ts` renders it in `@for (… track n.seq)`. `jsonNote` (string) stays for the store spec.
- **C2-1:** in the unlayered coarse block, the scrub rules are `input.scrub-range[type='range']::…` (0,2,2), which beats the generic `input[type='range']::…` (0,1,2). I didn't add `:not()` to the generic rules.
- **C2-2:** the Show JSON `summary` gets an aria-hidden `▸` with `group-open:rotate-90` and no transition. The `details` gets `group`, and the summary gets `justify-start gap-1.5` and `[&::-webkit-details-marker]:hidden`.
- **C2-3 (K9):**
  - `ShowLibraryFlow.pending` (`'retry' | 'more' | null`) records which button started the load.
  - `retry(done?)` and `showMore(done?)` call `done(ok, firstNew)` once, when the load settles.
  - The template draws each button in its own `@if`, and the condition stays true from the press until the load settles. The element survives, `aria-disabled` with `.btn-busy`.
  - On success, focus goes to `items[firstNew]` (Show more) or `items[0]` (Try again). If that item doesn't exist, it stays on the pressed button while that button still renders, and otherwise goes to the `My shells` h3 (`tabindex="-1"`, `data-testid="mine-heading"`).
  - Focus moves only if it's still on the pressed button, or has dropped to body or null. On failure it stays on Try again.
- **C2-4:** `; and 1 more problem` when k is 1.

**Backend (Boo F1):** `ResponseHeaders.Apply` normalizes a handled exception (`IExceptionHandlerFeature` present) to `Cache-Control: no-store` and removes `Pragma` and `Expires`. The exception handler is now named in the writer list as the fifth writer. `ApiCacheControlLedgerTests` has a `GET api/me 500` row, and every row now fails if `Pragma` or `Expires` is present.

## Why
- **One value under `/api`:** the ledger can then stay exact. `UseExceptionHandler` registers its own `OnStarting` after ours, so it runs first (LIFO), and the default-only rule saw a non-empty value and kept it. Overwriting is safe only because the handler has already cleared the response. A handled exception can never carry the share-code `private, no-cache`.
- **Selector instead of `:not()`:** this keeps the generic rules readable and puts the override on the element that needs it. `button-styles.spec.ts` compares specificities. It can't see computed pseudo-element styles, so the runtime evidence is the Chromium touch check.
- **`done` callbacks instead of a page effect:** the flow owns the request lifetime, so a callback fires exactly once per press and never on the first automatic load.

## Boundary
- Any new `Cache-Control` writer must get a ledger row. The exception-handler branch overwrites only when the feature is present. Don't widen it to "any 5xx".
- K9's focus targets are test ids `mine-retry`, `mine-more` and `mine-heading`. Toad's tab-walk can use them.
- Mario still checks C2-1 in the touch smoke at the gate (Rosalina's boundary).
- Nothing here changes a standing decision.

---

## Addendum: C4 touch sizes under the 13px root (2026-11-15)

**Inputs:** `toad-phase7-c3-review.md` (C4 addendum, "New defect"), `scratchpad/toad-c3/gate/gate-touch.mjs`, `docs/fireworks-app/design/phase-7.md` §5.2 and §5.2 item 8, `styles.css:111`, skill `tailwind-layer-overrides`. Luigi wrote the code (B3); I fixed it under strict lockout.

### What
- Every coarse-pointer size or gap utility is raw px: `pointer-coarse:min-h-[44px]` (`quality-fields.ts` Reduce flashing row, `select-row.ts`, `range-row.ts`), `pointer-coarse:gap-[8px]` (builder zoom group and the row at `show-builder-page.html:470`, `/mine` card actions, both player top bars), and the toast × gets `pointer-coarse:size-[44px] pointer-coarse:touch-manipulation` (both toasts in `app.html`).
- The stage marker's hit area (§5.2 item 8, "a transparent 44px hit area", any pointer) was `size-11` = 35.75px; it is now `size-[44px]`. This is the one change visible with a fine pointer, and it brings the marker to the spec. `show-builder-page.phase7.spec.ts` asserts `size-[44px]`.
- New guard `src/app/touch-px-utilities.spec.ts`: no `pointer-coarse:(gap|gap-x|gap-y|size|min-h|min-w|h|w)-<number>` and no `(size|min-h|min-w|h|w)-11` in any non-spec `.ts`/`.html` under `src/app`; the toast × carries both coarse classes. Negative controls: an in-spec case with the pre-fix spellings, and a live revert of the zoom group to `gap-2`, which fails the guard.

### Why
- `html, body { font: 13px }` makes every rem utility 0.8125× its name. Px values are what §5.2 promises, and the same choice `.btn`, `.touch-row` and `.touch-link` already make. Template classes, not new `styles.css` rules, because each site already had a coarse variant and the guard reads them.

### Boundary
- New coarse-pointer sizes or gaps use px (arbitrary values or a px class from `styles.css`). The guard does not see padding or `space-*`; nothing uses those for touch today.
- Evidence: `gate-touch.mjs` on 5180 (rebuilt wwwroot, API restarted) 18/18; `NEG=1` 13/13 counted checks fail. Web 1640/1640 (68 files), typecheck, ng build and prettier clean.
