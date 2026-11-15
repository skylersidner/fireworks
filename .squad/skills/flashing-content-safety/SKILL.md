# Skill: Flashing Content Safety

**Domain:** Any surface that plays fireworks (designer, player, Show Builder preview)
**Applies to:** Design reviews and implementation of playback surfaces
**Confidence:** medium. Derived in the 2c design-review (`docs/fireworks-app/design/designer-2c.md` §7); not yet verified in a running app.

---

## The rule

> **Flashing is a viewer setting applied in the renderer, never a property of the saved creation and never a change to the sim.**

## Checklist for a new playback surface

1. **Find where flashing actually comes from** before deciding anything. Read the prototype/engine, not the plan's summary: on `/` the default shell (Peony) has no strobe; strobe arrives through presets, Auto show, restored drafts and links. List the entry points for the new surface.
2. **Honor `quality.reduceFlashing` as a tri-state choice** (`unset` / `on` / `off`). While `unset`, the effective value is `matchMedia('(prefers-reduced-motion: reduce)')`, re-read live. Store only an explicit choice; persisting the unchosen effective value freezes today's OS setting as if the visitor had chosen it. OS-derived values (this, and a forced Manual mode) are never "unsaved edits".
3. **Renderer rules when on:** strobe stars steady, burst flash peak alpha 0.3 and 100 px × size, glitter alpha floor 0.5, crackle unchanged. Driver rule: no two random-show launches closer than 0.8 s.
4. **Under the OS reduced-motion setting, don't auto-play** on surfaces that otherwise would (designer starts in Manual). The designer re-applies Manual on every load and never writes the forced value back. Surfaces whose whole purpose is playback (player, Phase 5) show their own notice and Reduce flashing control; `/` keeps auto-playing (Skyler, 2026-11-12).
5. **Show a non-modal notice** until dismissed, with a one-click "Turn on Reduce flashing". It holds playback until it's answered (Skyler, 2026-11-13). It takes focus only when focus is still on `body`.
   - Name the actual risk from the content: say "strobe" only when the creation has a strobe effect (player, `phase-5.md` §8.3).
   - Name the button for what it does on that surface: "Continue" in the designer, "Play" on the player.
   - A surface whose only job is playback also needs Pause/Play (WCAG 2.2.2), and under reduced motion it opens paused with a visible Play.
   - **Timed content (shows):** a driver-side spacing rule can't apply, because moving launches changes the creation. Space the flashes in the renderer instead: under Reduce flashing, skip a burst flash within 0.33 s of the previous one (≤ 3 a second; `phase-6.md` §14.2). Decide "strobe" from the shells that cues actually use, not every embedded one, and name the length in the notice for long motion.
   - **Editors that preview a timeline** (Show Builder) open paused on every load, so the notice holds only Play, Space and sky clicks.
6. **Test it in the renderer, and prove the sim didn't move:** flip the flag and assert sim goldens are identical (negative control), and assert a strobe star's alpha at a fixed age with the flag on and off.

## Anti-patterns

- Saving a "no strobe" flag in the creation document, or editing the shell to remove strobe.
- Gating with a modal that blocks the whole page.
- Deciding the landing page is dangerous (or safe) from the plan text without checking which shell actually plays.
