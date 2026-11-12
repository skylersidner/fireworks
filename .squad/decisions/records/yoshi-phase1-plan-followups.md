# Phase 1 plan follow-ups: "My creations" follows the write switch, and the interim write gate
**By:** Yoshi (Architect) · 2026-11-12 · Phase 1 follow-up (plan edits)

## What
1. **Skyler's ruling, recorded:** before Phase 8, "My creations" follows the write switch. `GET api/me/creations` returns results only when `ICurrentUser.CanWrite` is true. Share-code GETs stay public.
2. **When `CanWrite` is false the endpoint returns 403** (`ServiceErrorType.Forbidden`), not an empty 200. The client hides the My creations entry, and a direct visit to `/mine` shows an "unavailable" notice without calling the endpoint.
3. **The interim write gate is a service-layer check**: `CanWrite` plus non-null `UserId`, returning `Forbidden` (403) on every create, update, delete and remix path. No `[Authorize(Policy)]` before Phase 8. The plan's `RequireWriteIdentity` wording is removed.
4. `ICurrentUser` has three members (`UserId`, `IsAuthenticated`, `CanWrite`), and `CanWrite` implies `UserId != null`.

## Why
1. Every interim visitor is the same default user. Listing that user's creations to everyone turns every share code saved during a test window into a public gallery, which contradicts OQ4 (Boo's open question in `boo-phase1-pipeline-security-review.md`).
2. 403 over an empty list: with writes off there is no honest owner to list for. "You have saved nothing" would be false and would hide a misconfigured switch. A 403 matches the write endpoints and is covered by the same enumerated gate test. The client never makes the call when `canWrite` is false, so the UX cost is nil.
3. With no authentication scheme registered, a failing authorization policy has no scheme to Forbid with and throws (`yoshi-phase1-parity-review.md` item 4).
4. This keeps the Phase 8 swap to one DI registration plus a policy for services, controllers and the schema. After Phase 8, `CanWrite` means "is authenticated", so the listing rule becomes "needs a login" without a code change.

## Boundary
- Binds Phase 4 (Bowser implements, Toad tests the 403 alongside the non-GET enumeration) and Phase 5 (Luigi hides `/mine`; Rosalina writes the notice copy).
- If a public or "recent" listing is ever wanted, that's a new endpoint and a scope call for Skyler, not a loosening of this one.
- Plan sections: §3.4, Phase 4 (service, controller, tests), Phase 5 (My creations), Phase 8 (server seam), §5 OQ4.
