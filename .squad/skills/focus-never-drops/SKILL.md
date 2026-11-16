# Skill: Focus Never Drops

**Domain:** Any Angular page where a control can disable itself, or be removed, as a result of the visitor's own action
**Applies to:** Design reviews, implementation and tab-walk tests
**Confidence:** high. Phase 5 (Save → `Saved`), Phase 6 (B2 Undo, B5 Save on undo) and Phase 7 (K1–K8, `docs/fireworks-app/design/phase-7.md` §3.2) each found new cases after the build.

---

## The rule

> **For every control, ask: can the action it triggers, or any key the page handles (⌘Z, Delete, Escape), disable it or remove it while it has focus? If so, name where focus goes, in the spec.**

A `disabled` button drops focus to `body` in most browsers, and browsers disagree about `document.activeElement` afterwards. So "refocus when `activeElement === body`" isn't a reliable recovery.

## Checklist

1. **Self-disabling:** count limits (`+ Add` at the max, `Zoom in` at the max, `Next` on the last page, `Undo` with empty history). Either use `aria-disabled` with the "unavailable" look and ignore activation, or move focus to a named neighbour when the pressed control disables.
2. **Self-removing:** buttons that exist only in a state (`Revert` while there are edits, `Remove` on a list row, a banner's `Try again` when the banner unmounts, an error card's `Try again`, a toast `×`). Name the target: the related field, the next row, or the page `h1` (`tabindex="-1"`).
3. **Removed by another path:** keyboard shortcuts that change state somewhere else (⌘Z empties the inspector or disables Save). After the command, if focus is on `body`, a disabled control or a disconnected node, move it to a target named by where it was.
4. **Native `<dialog>` return focus** goes to the opener. If the confirm removed the opener (a row), the host must move focus itself.
5. **Two looks for `aria-disabled`:** unavailable (dimmed, `not-allowed`) and busy (`.btn-busy`, full look, `progress`). Every time you spec an ARIA state, also name its style (Phase 5 lesson).
6. **Test:** a Playwright tab-walk that presses each such control and asserts that `document.activeElement` isn't `body` and isn't disabled afterward.

## Anti-patterns

- "Focus stays on Add" with no exception for the press that reaches the limit (designer-2c.md §8.1, fixed in Phase 7).
- Recovering only when `activeElement === document.body`.
- Using `aria-disabled` for "unavailable" with a style made for "in flight", so it looks pressable.

- **Async loads count as removal (Phase 7 C2).** A button whose own press switches the state to `loading` (and so drops it out of the `@if`) drops focus just like `[disabled]`. Keep it rendered as `aria-disabled` + `.btn-busy` while loading, then hand focus to the first new item.

- **Don't steal focus back after an async load (Phase 7 fix round, K9).** When a load the visitor started settles, move focus only if it is still on the pressed button or has dropped to `body` or `null`. If they moved on during the load, leave it where they put it. Test it: press, move focus elsewhere during the load, and assert it's still there after the load settles (`gate-keyboard.mjs` K9).
- **Tab-walk controls come in two kinds.** Programmatic recovery is controlled by making the app's `focus()` a no-op and mirroring `aria-disabled` onto `disabled`. Native Tab order and visibility are controlled by a positive-tabindex intruder, a self-removing stop, pulled listed controls and hidden outlines. One control can't fail both (`scratchpad/toad-c3/gate/gate-keyboard.mjs`).
