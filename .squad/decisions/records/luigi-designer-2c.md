# Shell Designer (2c): draft layout, one API probe, confirm dialog, normalize report shape
**By:** Luigi (Frontend), 2026-11-12. **Status:** proposed. Implements plan 2c, `docs/fireworks-app/design/designer-2c.md`, Skyler's 2026-11-12 rulings, and Yoshi's L1–L4, L6, L7 (`yoshi-phase2a-engine-boundaries.md`).

## What
> **Superseded in part (2026-11-13):** points 1–2 (the stored `baseline` and the `stateJson` comparison) were replaced by a stored `dirty` flag, per Skyler's 2026-11-13 ruling. The draft is now `{ shell, activeBreak, display, dirty }`. See `luigi-2c-dirty-flag-and-notice-hold.md`. Points 3–7 stand.

1. **Draft layout (one key).** `fireworks.draft.v1` holds `{ shell, activeBreak, display: { mode, persistence, starBudget, reduceFlashing }, baseline: { shell, activeBreak, display } }`. `shell` is a ShellDocument with `sky` always present, keys in §3.3 order. `display.reduceFlashing` is `null` until the visitor chooses. `display.mode` is the visitor's mode, never the OS-forced Manual. There is no separate `fireworks.display.v1`. The flashing notice uses `fireworks.flashNotice.v1`. Code: `features/designer/shared/designer-draft.ts`.
2. **"Unsaved edits"** is `stateJson(current) !== stateJson(baseline)` over shell, display (the stored choice, not the effective flag) and tab. The baseline is re-snapshotted on a preset load, a successful Apply, and a first visit. A corrupt current state drops the whole draft. A broken baseline alone becomes the restored state.
3. **Sky on load.** A preset load, or an Apply whose JSON has no `sky`, keeps the current sky. The prototype keeps world settings across presets. JSON with `sky` takes it.
4. **One API probe app-wide.** `core/api-status.ts` (`ApiStatusService`), started by `App`. The designer banner and `/status` read it. The cold-start ledger is `GET /api/me` and `GET /health/live`, once each, on both `/` and `/status` (`app.startup.spec.ts`). `/api/me` is in `SELF_HANDLED_PATHS`, and the generic toast is `GENERIC_ERROR_MESSAGE`.
5. **Confirm dialog** is `app/shared/confirm-dialog.ts`, a native `<dialog>` with `showModal()` and `role="alertdialog"`. It answers once. **Escape is read from both `cancel` and `close`.**
6. **normalize report.** This is Yoshi's §4 shape. `ShellIssue` also carries `code` (`not-object | version | type | enum | break-count`) plus `value`/`options`, so a UI can phrase reasons without parsing `message`. The designer's labels live in `engine/model/labels.ts`.
7. **Boundary spec (L1).** The layer-edge rule applies to shipped source only. `model/presets.spec.ts` reads the prototype golden recorded under `sim/golden/`. Every other rule (packages, `@angular`, Pixi direct and transitive, fail-closed parsing) covers specs too.

## Why
1. Skyler's ruling puts display settings and the tab in the draft. One key means the draft and its baseline are written, read and dropped together (`toad-a-baseline-and-its-draft-share-one-lifecycle.md`). A nullable choice is how "follows the OS until chosen" (§7.1) survives a reload.
4. Two probes meant two failing requests in one outage. One shared probe keeps a single source and an exact ledger.
5. In the 2c headless smoke (Chrome, SwiftShader), Escape closed the modal with no `cancel` event. Chrome's close-watcher rules skip `cancel` without fresh user activation. With `cancel` alone, the store kept a pending replace and no dialog was visible. A later preset click then had nothing to confirm. `close` fires on every closing path. Mutants C29 and C30 each kill one handler's spec.
6. Rosalina's §3.6 wants reasons in field-label language. Rebuilding that from `message` strings would couple the UI to developer text.

## Boundary
- Phase 5's player draft, if any, gets its own key. It must not reuse this envelope without a record.
- `ConfirmDialogComponent` is the dialog for Phase 5 discard/delete. Keep the single-answer guard and both Escape paths.
- The C# validator (Phase 3) mirrors `ShellIssue.path` and `AdjustmentKind`, not `code`. `code` is a TS-side convenience, and Yoshi may fold it into the schema doc or drop it.
- The `cancel` + `close` handling departs from §6.4's "use the dialog's cancel event". Rosalina may want the spec line changed.
