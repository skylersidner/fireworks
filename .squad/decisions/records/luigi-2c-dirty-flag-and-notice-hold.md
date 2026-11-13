# Designer 2c fix round: dirty flag replaces the baseline; the flashing notice holds playback
**By:** Luigi (Frontend), 2026-11-13. **Status:** proposed. Implements Skyler's 2026-11-13 rulings (plan Phase 2c, decisions README §5), Rosalina's updated `designer-2c.md` §6.2, §6.4 and §7.2, and Peach's 2c.11 as the coordinator settled it. Supersedes points 1–2 of `luigi-designer-2c.md`.

## What
1. **Draft layout.** `fireworks.draft.v1` is `{ shell, activeBreak, display: { mode, persistence, starBudget, reduceFlashing }, dirty }`. There's no `baseline` and no `stateJson`. A stored 2c draft that still has `baseline` reads fine, because the key is ignored.
2. **Reading `dirty` fails safe.** Only an explicit `false` reads as clean. A missing, `null`, string, number or object value reads as dirty, so a preset or Apply asks before overwriting a restored draft (2c.11).
3. **Dirty is a `linkedSignal`** in `ShellDesignerStore`.
   - Its source is the visitor-editable signals: `model`, `displayModel`, `activeBreak` and `reduceFlashingChoice`. Its computation is "restored value on the first run, `true` on every later change".
   - `load()` writes the shell and tab, then calls `dirty.set(false)`. Angular's `linkedSignalSetFn` calls `producerUpdateValueVersion` before it sets, so the load's own writes are absorbed and the flag ends up false. Mutant D5, which clears first and writes after, is killed.
   - App-made changes stay out of the source. The OS-driven Reduce flashing is a media-query computed, not a source. The forced Manual is the initial value of `displayModel`. Restoring the draft is the first computation.
   - The notice's "Turn on Reduce flashing" saves and restores the flag around its write (designer-2c.md §6.4). JSON textarea edits aren't a source.
4. **Hold.** `FireworksStageComponent` has a `paused` input. While it's true:
   - `loop.frame` isn't called, so the driver timers don't advance;
   - `launch`, `replay` and `fireNow` don't fire (`fireNow` still makes the shell and sky current), and clicks are ignored;
   - rendering continues.
   The store exposes `playbackPaused = flashNoticeVisible`. The page also ignores Space while the notice shows, without `preventDefault`. Launch and Replay are disabled with the title "Close the flashing notice to start.".
5. **Notice dismissal.** Only the two notice buttons dismiss it. The Display switch doesn't, per Rosalina's §7.2: the panel stays usable while the notice is held.
6. **Notice focus.** On first render, the notice takes focus only if focus is on `body`. On dismiss, focus moves to Launch.
7. **DOM order (revised 2026-11-13, Rosalina's corrected §7.2).** DOM order stays panel, then stage, as in the prototype, so the `h1` is read first and Tab order matches the visual order. No `flex-row-reverse`: the row is `flex h-full overflow-hidden max-[761px]:flex-col-reverse`, so the stage sits on top at 760px and below (smoke: 1280×800 panel x=0 w=340, stage x=340 w=940; 390×844 stage top 0 h=464, panel below). The notice stays inside `<main>`, right after `<app-fireworks-stage>`. It reaches the visitor through three cues instead of DOM order: the initial focus move to its first button; both buttons' `aria-describedby` pointing at the copy paragraph (unique id `flash-notice-text-N` from a module counter); and the playback note, which reads `Close the flashing notice on the stage to start.` while held. The earlier stage-first order is withdrawn.

## Why
- Skyler wanted a flag, not a snapshot comparison. Setting a field back stays dirty, at the cost of one extra question.
- A `linkedSignal` with set-after-writes gives a synchronous flag with no effect writing signals and no stored copy of the old state.
- Skipping `loop.frame` freezes every driver timer in one place, so nothing queues up and bursts all at once on dismiss. Preview loop's `remaining` starts at 0, so its first burst fires on the first frame after the hold ends.

## Boundary
- **Phase 5 (`/c/:code` working copy).** Load the record through the same `load()` path (or one that ends in `dirty.set(false)`), so opening a link is clean and edits to the copy set dirty as usual. A "saved vs edited" indicator is a separate concern (designer-2c.md N2). Don't overload `dirty` with "differs from the server".
- New visitor-editable state must join the `dirty` source. New app-driven state must not.
- The player's notice (Phase 5) can reuse `FireworksStageComponent.paused`.

## Addendum (2026-11-13): two flags, shell and sky (supersedes points 1–3 where they differ)
Skyler ruled that a preset or Apply asks only when it would replace something the visitor changed.
- **Draft layout** is now `{ shell, activeBreak, display, shellDirty, skyDirty }`. Each flag fails safe on its own (only an explicit `false` is clean). A pre-split draft's single `dirty` stands for both when the new key is absent: `dirty: true` (or missing, or broken) reads shell- and sky-dirty, `dirty: false` reads clean. A present new key wins over a stale `dirty`.
- **Sources.** `shellDirty` watches the model without `sky` (version, name, burstHeight, angleJitter, breaks) and `skyDirty` watches `model().sky`, both **by reference**. Signal Forms rebuilds only the objects on the edited path, so a sky edit leaves the shell part equal and vice versa, and a field set back still counts (a by-value source loses set-backs that happen without a read in between: mutant S7). Display settings, the tab and Reduce flashing are no longer sources; they are still autosaved. `dirty` survives as a computed `shellDirty || skyDirty`.
- **Decisions.** A preset asks iff `shellDirty`. Apply asks iff `shellDirty || (json has sky && skyDirty)`.
- **Clearing.** Every load clears `shellDirty`. Only a load that replaces the sky (Apply with `sky`) clears `skyDirty`; otherwise `load()` reads `skyDirty` before its writes and sets it back after, because `structuredClone` gives the kept sky a new reference. A kept sky is still the visitor's sky.
- **Turn on Reduce flashing** no longer needs the save-and-restore around its write, because display settings aren't a source.
- **Boundary update:** new visitor-editable *shell or sky* state joins the matching source. Display-like state (device settings, UI position) does not.
- **Unrelated teardown fix:** `PixiRenderer.destroy` now destroys the glow texture after `app.destroy`. The particle pipe's shared default shader keeps `uTexture` bound until the renderer is destroyed, so destroying the texture first logged `[BindGroup] a 'textureSource' was destroyed while still bound to a shader` once per teardown.
