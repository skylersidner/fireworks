# Bowser: Phase 6 review fixes (Rosalina B1–B3) and flash spacing 41

**Date:** 2026-11-14 · **Status:** proposed · **Phase:** 6 · **Inputs:** `rosalina-phase6-post-implementation-review.md`, phase-6.md §14.1, §14.2, §19.2.

## What
1. `ApiBannerComponent` (`features/designer/shared/api-banner/api-banner.ts`) takes a `message` input. Its default, `API_BANNER_DESIGNER`, is the designer's sentence unchanged. The builder passes `BUILDER_API_BANNER` from `features/show/shared/show-copy.ts`. The button, `Checking…` state and show/hide rule are shared.
2. The 2c.8 structure rule (`features/designer/designer-structure.spec.ts`) allows `show-builder-page.ts` exactly `import core/api-status` and `inject(ApiStatusService)`, as it already allows the designer page. The builder page is no longer in the "stores and drafts never reach" list. The exact-equality allowlist holds it to those two hits.
3. Builder Undo/Redo are `aria-disabled` and ignore presses (page `undo()`/`redo()` guard), not `disabled`.
4. The builder notice takes focus from body to its first button (an effect on `flashNoticeVisible`).
5. `FLASH_SPACING_STEPS` is the literal 41; `FLASH_SPACING_SECONDS` is derived as 41/120.

## Why
- One banner component means copy and behavior can't drift between surfaces; a default keeps the designer's copy byte-identical with no call-site change.
- Injecting `ApiStatusService` in the page mirrors the designer. Routing it through `ShowSaveFlow` would have mixed availability into the save flow.
- Deriving seconds from steps keeps the step count, which is what the WCAG bound depends on, as the one source.

## Boundary
- The builder's banner, like the designer's, follows `/health/live`, not `api/me`. If `api/me` fails while health is fine, neither surface shows a banner, and Try again doesn't reload the session. That's a shared behavior for Rosalina/Luigi to rule on, not something this round changed.
- The banner's own Try again still uses `disabled` while checking (the designer's existing behavior), so focus drops to body during a retry. Phase 7 accessibility pass.
- Any further page reaching HTTP or identity still needs its own exact allowlist entry.
